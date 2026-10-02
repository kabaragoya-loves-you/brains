import type uPlot from "uplot";

const WINDOW_MS = 20_000;
const CHANNEL_COLORS = [
  "#5b8cff",
  "#3ecf8e",
  "#ffb020",
  "#ff6b7a",
  "#c084fc",
  "#22d3ee",
  "#f472b6",
  "#a3e635"
];

type SeriesBuffers = {
  times: number[];
  series: number[][];
  labels: string[];
};

type UPlotInstance = uPlot;
type UPlotCtor = {
  new (
    opts: uPlot.Options,
    data?: uPlot.AlignedData,
    target?: HTMLElement | null
  ): UPlotInstance;
};

function trimToWindow(buf: SeriesBuffers, now: number): void {
  const cutoff = now - WINDOW_MS;
  while (buf.times.length && buf.times[0] < cutoff) {
    buf.times.shift();
    for (const s of buf.series)
      s.shift();
  }
}

function uplot(): UPlotCtor {
  return window.uPlot;
}

function makeTimeline(
  el: HTMLElement,
  labels: string[],
  height: number,
  yRange?: [number, number] | null
): UPlotInstance {
  const series: uPlot.Series[] = [
    {},
    ...labels.map((label, i) => ({
      label,
      stroke: CHANNEL_COLORS[i % CHANNEL_COLORS.length],
      width: 1.25,
      points: { show: false }
    }))
  ];

  const opts: uPlot.Options = {
    width: el.clientWidth || el.parentElement?.clientWidth || 800,
    height,
    scales: {
      x: { time: false },
      y: yRange ? { auto: false, range: () => yRange } : { auto: true }
    },
    axes: [
      {
        stroke: "#9aa3b5",
        grid: { stroke: "#2a3140" },
        ticks: { stroke: "#2a3140" },
        values: (_u: uPlot, splits: number[]) =>
          splits.map((v) => `${v.toFixed(1)}s`)
      },
      {
        stroke: "#9aa3b5",
        grid: { stroke: "#2a3140" },
        ticks: { stroke: "#2a3140" },
        size: 56
      }
    ],
    series,
    legend: { show: true, live: false }
  };

  return new (uplot())(opts, [[]], el);
}

function emptyBuffers(labels: string[]): SeriesBuffers {
  return {
    times: [],
    series: labels.map(() => []),
    labels: [...labels]
  };
}

function ensureSeriesCount(buf: SeriesBuffers, count: number, labels?: string[]): void {
  while (buf.series.length < count) {
    const idx = buf.series.length;
    buf.series.push(buf.times.map(() => 0));
    buf.labels.push(labels?.[idx] ?? `ch${idx + 1}`);
  }
}

function toRelative(times: number[], now: number): number[] {
  return times.map((t) => (t - now) / 1000);
}

export class PlotBoard {
  private paused = false;
  private active = true;
  private raw: SeriesBuffers;
  private bands: Record<"delta" | "theta" | "alpha" | "beta" | "gamma", SeriesBuffers>;
  private focusCalm: SeriesBuffers;
  private signalQuality: SeriesBuffers;
  private accel: SeriesBuffers;
  private sqStatuses: string[] = [];

  private rawPlot: UPlotInstance;
  private bandPlots: Record<"delta" | "theta" | "alpha" | "beta" | "gamma", UPlotInstance>;
  private focusCalmPlot: UPlotInstance;
  private signalQualityPlot: UPlotInstance;
  private accelPlot: UPlotInstance;
  private psdPlot: UPlotInstance;

  private raf = 0;
  private dirty = false;
  private channelNames: string[] = [
    "CP3", "C3", "F5", "PO3", "PO4", "F6", "C4", "CP4"
  ];

  constructor() {
    this.raw = emptyBuffers(this.channelNames);
    this.bands = {
      delta: emptyBuffers(this.channelNames),
      theta: emptyBuffers(this.channelNames),
      alpha: emptyBuffers(this.channelNames),
      beta: emptyBuffers(this.channelNames),
      gamma: emptyBuffers(this.channelNames)
    };
    this.focusCalm = emptyBuffers(["focus", "calm"]);
    this.signalQuality = emptyBuffers(this.channelNames);
    this.accel = emptyBuffers(["x", "y", "z"]);

    this.rawPlot = makeTimeline(mustEl("rawChart"), this.channelNames, 240);
    this.bandPlots = {
      delta: makeTimeline(mustEl("deltaChart"), this.channelNames, 150),
      theta: makeTimeline(mustEl("thetaChart"), this.channelNames, 150),
      alpha: makeTimeline(mustEl("alphaChart"), this.channelNames, 150),
      beta: makeTimeline(mustEl("betaChart"), this.channelNames, 150),
      gamma: makeTimeline(mustEl("gammaChart"), this.channelNames, 150)
    };
    this.focusCalmPlot = makeTimeline(
      mustEl("focusCalmChart"),
      ["focus", "calm"],
      150,
      [0, 1]
    );
    this.signalQualityPlot = makeTimeline(
      mustEl("signalQualityChart"),
      this.channelNames,
      150
    );
    this.accelPlot = makeTimeline(mustEl("accelChart"), ["x", "y", "z"], 150);
    this.psdPlot = this.makePsd(mustEl("psdChart"), this.channelNames);

    window.addEventListener("resize", () => this.resizeAll());
    this.loop();
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  /** When false, skip uPlot redraws (Timeline hidden). */
  setActive(active: boolean): void {
    this.active = active;
    if (!active)
      this.dirty = false;
  }

  isActive(): boolean {
    return this.active;
  }

  reset(): void {
    this.raw = emptyBuffers(this.channelNames);
    for (const key of Object.keys(this.bands) as Array<keyof typeof this.bands>)
      this.bands[key] = emptyBuffers(this.channelNames);
    this.focusCalm = emptyBuffers(["focus", "calm"]);
    this.signalQuality = emptyBuffers(this.channelNames);
    this.accel = emptyBuffers(["x", "y", "z"]);
    this.sqStatuses = [];
    this.dirty = true;
  }

  pushRaw(times: number[], channels: number[][], channelNames: string[]): void {
    if (this.paused)
      return;
    this.maybeUpdateChannels(channelNames);
    ensureSeriesCount(this.raw, channels.length, channelNames);
    for (let i = 0; i < times.length; i++) {
      this.raw.times.push(times[i]);
      for (let c = 0; c < channels.length; c++)
        this.raw.series[c].push(channels[c][i] ?? 0);
    }
    this.dirty = true;
  }

  pushBands(
    times: number[],
    bands: Record<"delta" | "theta" | "alpha" | "beta" | "gamma", number[][]>,
    channelNames: string[]
  ): void {
    if (this.paused)
      return;
    this.maybeUpdateChannels(channelNames);
    for (const key of Object.keys(bands) as Array<keyof typeof bands>) {
      const buf = this.bands[key];
      ensureSeriesCount(buf, bands[key].length, channelNames);
      for (let i = 0; i < times.length; i++) {
        buf.times.push(times[i]);
        for (let c = 0; c < bands[key].length; c++)
          buf.series[c].push(bands[key][c][i] ?? 0);
      }
    }
    this.dirty = true;
  }

  pushFocusCalm(time: number, focus?: number, calm?: number): void {
    if (this.paused)
      return;
    const lastT = this.focusCalm.times[this.focusCalm.times.length - 1];
    if (lastT === time) {
      if (focus != null)
        this.focusCalm.series[0][this.focusCalm.series[0].length - 1] = focus;
      if (calm != null)
        this.focusCalm.series[1][this.focusCalm.series[1].length - 1] = calm;
    } else {
      this.focusCalm.times.push(time);
      this.focusCalm.series[0].push(
        focus ?? this.focusCalm.series[0][this.focusCalm.series[0].length - 1] ?? 0
      );
      this.focusCalm.series[1].push(
        calm ?? this.focusCalm.series[1][this.focusCalm.series[1].length - 1] ?? 0
      );
    }
    this.dirty = true;
  }

  pushSignalQuality(
    time: number,
    channelNames: string[],
    values: number[],
    statuses: string[]
  ): void {
    if (this.paused)
      return;
    this.maybeUpdateChannels(channelNames);
    ensureSeriesCount(this.signalQuality, values.length, channelNames);
    this.signalQuality.times.push(time);
    for (let c = 0; c < values.length; c++)
      this.signalQuality.series[c].push(values[c] ?? 0);
    this.sqStatuses = statuses;
    const legend = mustEl("sqLegend");
    legend.textContent = channelNames
      .map((n, i) => `${n}:${statuses[i] ?? "?"}`)
      .join("  ");
    this.dirty = true;
  }

  pushAccel(time: number, x: number, y: number, z: number): void {
    if (this.paused)
      return;
    this.accel.times.push(time);
    this.accel.series[0].push(x);
    this.accel.series[1].push(y);
    this.accel.series[2].push(z);
    this.dirty = true;
  }

  setPsd(freqs: number[], psd: number[][], channelNames: string[]): void {
    if (this.paused)
      return;
    const data: uPlot.AlignedData = [
      freqs,
      ...psd.map((row) => row.slice())
    ];
    if (this.psdPlot.series.length - 1 !== psd.length) {
      this.psdPlot.destroy();
      this.psdPlot = this.makePsd(mustEl("psdChart"), channelNames);
    }
    this.psdPlot.setData(data);
  }

  private maybeUpdateChannels(channelNames: string[]): void {
    if (!channelNames.length)
      return;
    if (channelNames.join(",") === this.channelNames.join(","))
      return;
    this.channelNames = [...channelNames];
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    if (!this.active || !this.dirty || this.paused)
      return;
    this.dirty = false;
    this.redraw();
  };

  private redraw(): void {
    const now = Date.now();
    trimToWindow(this.raw, now);
    for (const key of Object.keys(this.bands) as Array<keyof typeof this.bands>)
      trimToWindow(this.bands[key], now);
    trimToWindow(this.focusCalm, now);
    trimToWindow(this.signalQuality, now);
    trimToWindow(this.accel, now);

    this.setTimeline(this.rawPlot, this.raw, now);
    for (const key of Object.keys(this.bandPlots) as Array<keyof typeof this.bandPlots>)
      this.setTimeline(this.bandPlots[key], this.bands[key], now);
    this.setTimeline(this.focusCalmPlot, this.focusCalm, now);
    this.setTimeline(this.signalQualityPlot, this.signalQuality, now);
    this.setTimeline(this.accelPlot, this.accel, now);

    const rawMeta = mustEl("rawMeta");
    rawMeta.textContent = this.raw.times.length
      ? `${this.raw.series.length} ch · ${this.raw.times.length} pts`
      : "waiting for samples";
  }

  private setTimeline(plot: UPlotInstance, buf: SeriesBuffers, now: number): void {
    const x = toRelative(buf.times, now);
    const data: uPlot.AlignedData = [x, ...buf.series.map((s) => s.slice())];
    plot.setData(data, false);
    plot.setScale("x", { min: -WINDOW_MS / 1000, max: 0 });
  }

  private makePsd(el: HTMLElement, labels: string[]): UPlotInstance {
    el.innerHTML = "";
    const series: uPlot.Series[] = [
      {},
      ...labels.map((label, i) => ({
        label,
        stroke: CHANNEL_COLORS[i % CHANNEL_COLORS.length],
        width: 1.25,
        points: { show: false }
      }))
    ];

    return new (uplot())(
      {
        width: el.clientWidth || 800,
        height: 220,
        scales: {
          x: { time: false },
          y: { auto: true }
        },
        axes: [
          {
            stroke: "#9aa3b5",
            grid: { stroke: "#2a3140" },
            ticks: { stroke: "#2a3140" },
            values: (_u: uPlot, splits: number[]) =>
              splits.map((v: number) => `${v.toFixed(0)} Hz`)
          },
          {
            stroke: "#9aa3b5",
            grid: { stroke: "#2a3140" },
            ticks: { stroke: "#2a3140" },
            size: 56
          }
        ],
        series,
        legend: { show: true, live: false }
      },
      [[]],
      el
    );
  }

  private resizeAll(): void {
    const width = (id: string) =>
      mustEl(id).clientWidth || mustEl(id).parentElement?.clientWidth || 800;

    this.rawPlot.setSize({ width: width("rawChart"), height: 240 });
    for (const key of Object.keys(this.bandPlots) as Array<keyof typeof this.bandPlots>)
      this.bandPlots[key].setSize({ width: width(`${key}Chart`), height: 150 });
    this.focusCalmPlot.setSize({ width: width("focusCalmChart"), height: 150 });
    this.signalQualityPlot.setSize({
      width: width("signalQualityChart"),
      height: 150
    });
    this.accelPlot.setSize({ width: width("accelChart"), height: 150 });
    this.psdPlot.setSize({ width: width("psdChart"), height: 220 });
  }
}

function mustEl(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el)
    throw new Error(`Missing element #${id}`);
  return el;
}
