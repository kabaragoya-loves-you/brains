export type BandPowers = {
  delta: number[];
  theta: number[];
  alpha: number[];
  beta: number[];
  gamma: number[];
};

export type AccelState = {
  x: number;
  y: number;
  z: number;
  pitch: number;
  roll: number;
  inclination: number;
  orientation: number;
  acceleration: number;
};

export type MetricSnapshot = {
  channelNames: string[];
  bands: BandPowers;
  focus: number;
  calm: number;
  signalQuality: number[];
  signalStatuses: string[];
  accel: AccelState;
  psd: { freqs: number[]; values: number[][] } | null;
  rawMeans: number[];
  updatedAt: number;
};

const CHANNEL_DEFAULT = ["CP3", "C3", "F5", "PO3", "PO4", "F6", "C4", "CP4"];
const SMOOTH_TAU_S = 0.055;

function zeros(n: number): number[] {
  return Array.from({ length: n }, () => 0);
}

function emptyBands(n: number): BandPowers {
  return {
    delta: zeros(n),
    theta: zeros(n),
    alpha: zeros(n),
    beta: zeros(n),
    gamma: zeros(n)
  };
}

function cloneSnapshot(s: MetricSnapshot): MetricSnapshot {
  return {
    channelNames: [...s.channelNames],
    bands: {
      delta: [...s.bands.delta],
      theta: [...s.bands.theta],
      alpha: [...s.bands.alpha],
      beta: [...s.bands.beta],
      gamma: [...s.bands.gamma]
    },
    focus: s.focus,
    calm: s.calm,
    signalQuality: [...s.signalQuality],
    signalStatuses: [...s.signalStatuses],
    accel: { ...s.accel },
    psd: s.psd
      ? { freqs: [...s.psd.freqs], values: s.psd.values.map((row) => [...row]) }
      : null,
    rawMeans: [...s.rawMeans],
    updatedAt: s.updatedAt
  };
}

function defaultSnapshot(): MetricSnapshot {
  return {
    channelNames: [...CHANNEL_DEFAULT],
    bands: emptyBands(8),
    focus: 0.5,
    calm: 0.5,
    signalQuality: zeros(8),
    signalStatuses: Array.from({ length: 8 }, () => "unknown"),
    accel: {
      x: 0,
      y: 0,
      z: 1,
      pitch: 0,
      roll: 0,
      inclination: 0,
      orientation: 0,
      acceleration: 0
    },
    psd: null,
    rawMeans: zeros(8),
    updatedAt: 0
  };
}

export class MetricBus {
  private target: MetricSnapshot = defaultSnapshot();
  private display: MetricSnapshot = defaultSnapshot();
  private lastSmoothMs = 0;

  /** Smoothed view for viz/audio; decouples render rate from packet rate. */
  get snapshot(): MetricSnapshot {
    this.smoothTowardTargets();
    return this.display;
  }

  /** Latest packet values (no smoothing). */
  get targets(): MetricSnapshot {
    return this.target;
  }

  private smoothTowardTargets(): void {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastSmoothMs) / 1000);
    if (dt <= 0)
      return;
    this.lastSmoothMs = now;

    const a = 1 - Math.exp(-dt / SMOOTH_TAU_S);
    const d = this.display;
    const t = this.target;

    d.focus = lerp(d.focus, t.focus, a);
    d.calm = lerp(d.calm, t.calm, a);
    d.updatedAt = t.updatedAt;

    lerpArrayInPlace(d.rawMeans, t.rawMeans, a);
    lerpArrayInPlace(d.signalQuality, t.signalQuality, a);
    d.signalStatuses = t.signalStatuses;

    for (const key of ["delta", "theta", "alpha", "beta", "gamma"] as const)
      lerpArrayInPlace(d.bands[key], t.bands[key], a);

    d.accel.x = lerp(d.accel.x, t.accel.x, a);
    d.accel.y = lerp(d.accel.y, t.accel.y, a);
    d.accel.z = lerp(d.accel.z, t.accel.z, a);
    d.accel.pitch = lerp(d.accel.pitch, t.accel.pitch, a);
    d.accel.roll = lerp(d.accel.roll, t.accel.roll, a);
    d.accel.inclination = lerp(d.accel.inclination, t.accel.inclination, a);
    d.accel.orientation = lerpAngleDeg(d.accel.orientation, t.accel.orientation, a);
    d.accel.acceleration = lerp(d.accel.acceleration, t.accel.acceleration, a);

    if (t.psd)
      d.psd = t.psd;
  }

  setChannels(names: string[]): void {
    if (!names.length || names.join(",") === this.target.channelNames.join(","))
      return;
    const n = names.length;
    const next = {
      channelNames: [...names],
      bands: emptyBands(n),
      signalQuality: zeros(n),
      signalStatuses: Array.from({ length: n }, () => "unknown"),
      rawMeans: zeros(n)
    };
    this.target = { ...this.target, ...next };
    this.display = { ...this.display, ...next };
  }

  pushBands(channelNames: string[], bands: BandPowers): void {
    this.setChannels(channelNames);
    const n = this.target.channelNames.length;
    this.target.bands = {
      delta: meanOrPad(bands.delta, n),
      theta: meanOrPad(bands.theta, n),
      alpha: meanOrPad(bands.alpha, n),
      beta: meanOrPad(bands.beta, n),
      gamma: meanOrPad(bands.gamma, n)
    };
    this.target.updatedAt = Date.now();
  }

  pushBandSample(
    channelNames: string[],
    bands: {
      delta: number[];
      theta: number[];
      alpha: number[];
      beta: number[];
      gamma: number[];
    }
  ): void {
    this.setChannels(channelNames);
    this.target.bands = {
      delta: [...bands.delta],
      theta: [...bands.theta],
      alpha: [...bands.alpha],
      beta: [...bands.beta],
      gamma: [...bands.gamma]
    };
    this.target.updatedAt = Date.now();
  }

  pushFocusCalm(focus?: number, calm?: number): void {
    if (focus != null)
      this.target.focus = clamp01(focus);
    if (calm != null)
      this.target.calm = clamp01(calm);
    this.target.updatedAt = Date.now();
  }

  pushSignalQuality(
    channelNames: string[],
    values: number[],
    statuses: string[]
  ): void {
    this.setChannels(channelNames);
    this.target.signalQuality = [...values];
    this.target.signalStatuses = [...statuses];
    this.target.updatedAt = Date.now();
  }

  pushAccel(accel: Partial<AccelState> & { x: number; y: number; z: number }): void {
    this.target.accel = {
      x: accel.x,
      y: accel.y,
      z: accel.z,
      pitch: accel.pitch ?? this.target.accel.pitch,
      roll: accel.roll ?? this.target.accel.roll,
      inclination: accel.inclination ?? this.target.accel.inclination,
      orientation: accel.orientation ?? this.target.accel.orientation,
      acceleration: accel.acceleration ?? this.target.accel.acceleration
    };
    this.target.updatedAt = Date.now();
  }

  pushPsd(freqs: number[], psd: number[][], channelNames: string[]): void {
    this.setChannels(channelNames);
    this.target.psd = { freqs: [...freqs], values: psd.map((row) => [...row]) };
    this.target.updatedAt = Date.now();
    this.display.psd = this.target.psd;
  }

  pushRawMeans(channelNames: string[], channels: number[][]): void {
    this.setChannels(channelNames);
    this.target.rawMeans = channels.map((ch) => {
      if (!ch.length)
        return 0;
      let s = 0;
      for (const v of ch)
        s += v;
      return s / ch.length;
    });
    this.target.updatedAt = Date.now();
  }

  /** Snap display to targets (e.g. when demo stops). */
  resetSmoothing(): void {
    this.display = cloneSnapshot(this.target);
    this.lastSmoothMs = performance.now();
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpArrayInPlace(out: number[], target: number[], t: number): void {
  const n = Math.max(out.length, target.length);
  while (out.length < n)
    out.push(0);
  for (let i = 0; i < n; i++)
    out[i] = lerp(out[i] ?? 0, target[i] ?? 0, t);
}

function lerpAngleDeg(a: number, b: number, t: number): number {
  let delta = ((b - a + 540) % 360) - 180;
  return a + delta * t;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function meanOrPad(rows: number[] | number[][], n: number): number[] {
  if (!rows.length)
    return zeros(n);
  if (typeof rows[0] === "number") {
    const vec = rows as number[];
    return Array.from({ length: n }, (_, i) => vec[i] ?? 0);
  }
  const matrix = rows as unknown as number[][];
  return Array.from({ length: n }, (_, i) => {
    const row = matrix[i];
    if (!row?.length)
      return 0;
    return row[row.length - 1] ?? 0;
  });
}

/** Approximate Crown electrode positions on a unit-ish head (Y up, nose +Z). */
export const CHANNEL_POSITIONS: Record<string, [number, number, number]> = {
  F5: [-0.52, 0.42, 0.68],
  F6: [0.52, 0.42, 0.68],
  C3: [-0.78, 0.22, 0.08],
  C4: [0.78, 0.22, 0.08],
  CP3: [-0.68, 0.12, -0.38],
  CP4: [0.68, 0.12, -0.38],
  PO3: [-0.38, 0.02, -0.78],
  PO4: [0.38, 0.02, -0.78]
};

export function channelPosition(name: string, index: number): [number, number, number] {
  const known = CHANNEL_POSITIONS[name];
  if (known)
    return known;
  const a = (index / 8) * Math.PI * 2;
  return [Math.cos(a) * 0.8, 0.2, Math.sin(a) * 0.8];
}
