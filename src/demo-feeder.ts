import type { MetricBus } from "./metrics-bus.js";
import type { MetricMessage } from "./global.js";

const CHANNELS = ["CP3", "C3", "F5", "PO3", "PO4", "F6", "C4", "CP4"];
const RAW_RATE = 256;
const RAW_CHUNK = 32;
const PSD_FREQS = Array.from({ length: 64 }, (_, i) => i * 0.5);
const PLOT_FEED_MS = 120;
const PSD_BUS_MS = 150;

type DemoScene = {
  t: number;
  focus: number;
  calm: number;
  bands: {
    delta: number[];
    theta: number[];
    alpha: number[];
    beta: number[];
    gamma: number[];
  };
  statuses: string[];
  sqValues: number[];
  accel: {
    x: number;
    y: number;
    z: number;
    pitch: number;
    roll: number;
    inclination: number;
    orientation: number;
    acceleration: number;
  };
  freqs: number[];
  psd: number[][];
};

/**
 * Synthetic Crown metrics at display rate for viz; timeline plots are fed
 * on a slower cadence so uPlot work does not block the WebGL loop.
 */
export class DemoFeeder {
  private bus: MetricBus;
  private onPacket: ((message: MetricMessage) => void) | null;
  private raf = 0;
  private t0 = performance.now();
  private enabled = false;
  private plotsEnabled = false;
  private rawCursor = 0;
  private lastPlotFeedMs = 0;
  private lastPsdBusMs = 0;

  constructor(
    bus: MetricBus,
    onPacket: ((message: MetricMessage) => void) | null = null
  ) {
    this.bus = bus;
    this.onPacket = onPacket;
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  setPacketSink(onPacket: ((message: MetricMessage) => void) | null): void {
    this.onPacket = onPacket;
  }

  setPlotsEnabled(on: boolean): void {
    this.plotsEnabled = on;
  }

  setEnabled(on: boolean): void {
    if (on === this.enabled)
      return;
    this.enabled = on;
    if (on) {
      this.t0 = performance.now();
      this.rawCursor = 0;
      this.lastPlotFeedMs = 0;
      this.lastPsdBusMs = 0;
      this.loop(this.t0);
    } else {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.bus.resetSmoothing();
    }
  }

  private loop = (now: number): void => {
    if (!this.enabled)
      return;
    this.raf = requestAnimationFrame(this.loop);

    const scene = synthesizeScene((now - this.t0) / 1000);
    this.pushBus(scene, now);

    if (this.plotsEnabled && this.onPacket && now - this.lastPlotFeedMs >= PLOT_FEED_MS) {
      this.lastPlotFeedMs = now;
      this.emitPlotPackets(scene, now);
    }
  };

  private pushBus(scene: DemoScene, now: number): void {
    this.bus.pushBandSample(CHANNELS, scene.bands);
    this.bus.pushFocusCalm(scene.focus, scene.calm);
    this.bus.pushSignalQuality(CHANNELS, scene.sqValues, scene.statuses);
    this.bus.pushAccel(scene.accel);

    if (now - this.lastPsdBusMs >= PSD_BUS_MS) {
      this.lastPsdBusMs = now;
      this.bus.pushPsd(scene.freqs, scene.psd, CHANNELS);
    }

    const amp = 25 + scene.focus * 55 + stormFromT(scene.t) * 90;
    const channels = CHANNELS.map((_, c) => {
      const sampleT = this.rawCursor / RAW_RATE;
      return [
        Math.sin(sampleT * Math.PI * 2 * 10 + c) * amp * (0.4 + scene.calm) +
        Math.sin(sampleT * Math.PI * 2 * 20 + c * 0.7) * amp * (0.3 + scene.focus) +
        Math.sin(sampleT * Math.PI * 2 * 4 + c * 1.1) * amp * 0.25
      ];
    });
    this.rawCursor += 1;
    this.bus.pushRawMeans(CHANNELS, channels);
  }

  private emitPlotPackets(scene: DemoScene, _frameMs: number): void {
    const sink = this.onPacket;
    if (!sink)
      return;

    const now = Date.now();
    const dt = 1000 / RAW_RATE;
    const times: number[] = [];
    const channels: number[][] = CHANNELS.map(() => []);
    const storm = stormFromT(scene.t);
    const amp = 25 + scene.focus * 55 + storm * 90;

    for (let s = 0; s < RAW_CHUNK; s++) {
      const sampleT = (this.rawCursor - RAW_CHUNK + s) / RAW_RATE;
      times.push(now + s * dt);
      for (let c = 0; c < CHANNELS.length; c++) {
        const v =
          Math.sin(sampleT * Math.PI * 2 * 10 + c) * amp * (0.4 + scene.calm) +
          Math.sin(sampleT * Math.PI * 2 * 20 + c * 0.7) * amp * (0.3 + scene.focus) +
          Math.sin(sampleT * Math.PI * 2 * 4 + c * 1.1) * amp * 0.25 +
          (Math.random() - 0.5) * (8 + storm * 40);
        channels[c].push(v);
      }
    }

    sink({
      kind: "raw",
      channelNames: CHANNELS,
      samplingRate: RAW_RATE,
      times,
      channels
    });
    sink({
      kind: "powerByBand",
      channelNames: CHANNELS,
      times: [now],
      bands: {
        delta: scene.bands.delta.map((v) => [v]),
        theta: scene.bands.theta.map((v) => [v]),
        alpha: scene.bands.alpha.map((v) => [v]),
        beta: scene.bands.beta.map((v) => [v]),
        gamma: scene.bands.gamma.map((v) => [v])
      }
    });
    sink({
      kind: "psd",
      channelNames: CHANNELS,
      freqs: scene.freqs,
      psd: scene.psd,
      startTime: now
    });
    sink({ kind: "focusCalm", time: now, focus: scene.focus, calm: scene.calm });
    sink({
      kind: "signalQuality",
      time: now,
      channelNames: CHANNELS,
      standardDeviations: scene.sqValues,
      statuses: scene.statuses
    });
    sink({
      kind: "accelerometer",
      time: now,
      ...scene.accel
    });
  }
}

function stormFromT(t: number): number {
  const cycle = (t % 18) / 18;
  return Math.exp(-Math.pow((cycle - 0.55) / 0.08, 2));
}

function synthesizeScene(t: number): DemoScene {
  const cycle = (t % 18) / 18;
  const storm = stormFromT(t);
  const rise = smoothstep(0.15, 0.5, cycle);
  const settle = 1 - smoothstep(0.7, 0.95, cycle);
  const energy = clamp01(rise * settle + storm);

  const focus = clamp01(0.12 + energy * 0.82 + 0.08 * Math.sin(t * 1.4));
  const calm = clamp01(0.88 - energy * 0.75 + 0.06 * Math.cos(t * 0.9));

  const bandScale = 0.4 + energy * 2.4 + storm * 3;
  const bands = {
    delta: CHANNELS.map((_, i) => band(t, i, 0.35, 0.4, 0.9) * (0.5 + (1 - energy))),
    theta: CHANNELS.map((_, i) => band(t, i, 0.55, 0.5, 1.1) * (0.6 + calm * 0.8)),
    alpha: CHANNELS.map((_, i) => band(t, i, 0.7, 0.8, 1.4) * (0.35 + calm * 1.6)),
    beta: CHANNELS.map((_, i) => band(t, i, 1.2, 0.5, 1.8) * (0.25 + focus * 1.8) * bandScale * 0.45),
    gamma: CHANNELS.map((_, i) => band(t, i, 1.9, 0.25, 1.5) * (0.15 + focus * 2.2 + storm * 2) * bandScale * 0.4)
  };

  const statuses = CHANNELS.map((_, i) => {
    if (storm > 0.6 && (i === 0 || i === 7) && Math.sin(t * 6 + i) > 0.4)
      return "noContact";
    const q = 0.35 + calm * 0.55 + 0.2 * Math.sin(t * 0.45 + i) - storm * 0.35;
    if (q > 0.8)
      return "great";
    if (q > 0.5)
      return "good";
    if (q > 0.25)
      return "bad";
    return "noContact";
  });
  const sqValues = statuses.map((s) =>
    s === "great" ? 6 : s === "good" ? 16 : s === "bad" ? 45 : 95
  );

  const pitch = Math.sin(t * 0.55) * 22 + Math.sin(t * 0.17) * 10 + storm * Math.sin(t * 4) * 18;
  const roll = Math.cos(t * 0.42) * 18 + storm * Math.cos(t * 3.2) * 14;
  const yawRad = (pitch * Math.PI) / 180;
  const rollRad = (roll * Math.PI) / 180;
  const accel = {
    x: Math.sin(rollRad),
    y: Math.sin(yawRad),
    z: Math.cos(yawRad) * Math.cos(rollRad),
    pitch,
    roll,
    inclination: Math.abs(pitch),
    orientation: (t * 25) % 360,
    acceleration: 0.03 + focus * 0.12 + storm * 0.35
  };

  const psd = CHANNELS.map((_, c) =>
    PSD_FREQS.map((f) => {
      const alphaPeak = Math.exp(-Math.pow((f - 10) / 1.8, 2)) * (0.4 + calm * 1.6);
      const betaPeak = Math.exp(-Math.pow((f - 20) / 3.2, 2)) * (0.25 + focus * 1.8);
      const gammaPeak = Math.exp(-Math.pow((f - 35) / 5, 2)) * (0.1 + focus * 0.9 + storm * 1.4);
      const oneOverF = 0.55 / (1 + f * 0.1);
      return (oneOverF + alphaPeak + betaPeak + gammaPeak) *
        (0.6 + 0.5 * Math.sin(t * 0.8 + c) + storm * 0.8);
    })
  );

  return {
    t,
    focus,
    calm,
    bands,
    statuses,
    sqValues,
    accel,
    freqs: PSD_FREQS,
    psd
  };
}

function band(t: number, i: number, speed: number, base: number, amp: number): number {
  return Math.max(
    0.02,
    base + amp * 0.5 * (Math.sin(t * speed + i * 0.9) * 0.5 + 0.5) +
      0.12 * Math.sin(t * (speed * 2.3) + i)
  );
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function smoothstep(a: number, b: number, x: number): number {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
}
