import type { MetricBus } from "../metrics-bus.js";

/**
 * Ambient sonification: soft drone + band-tuned partials + focus sparkle.
 * Starts suspended until the user enables audio (browser autoplay rules).
 */
const MASTER_LEVEL = 0.22;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private drone: OscillatorNode | null = null;
  private droneGain: GainNode | null = null;
  private partials: Array<{ osc: OscillatorNode; gain: GainNode }> = [];
  private sparkle: OscillatorNode | null = null;
  private sparkleGain: GainNode | null = null;
  private lfo: OscillatorNode | null = null;
  private lfoGain: GainNode | null = null;
  private filter: BiquadFilterNode | null = null;
  private enabled = false;
  private windowFocused = true;
  private bus: MetricBus;
  private timer: number | null = null;
  private onFocus: (() => void) | null = null;
  private onBlur: (() => void) | null = null;
  private onVisibility: (() => void) | null = null;

  constructor(bus: MetricBus) {
    this.bus = bus;
    this.onFocus = () => this.setWindowFocused(true);
    this.onBlur = () => this.setWindowFocused(false);
    this.onVisibility = () => {
      this.setWindowFocused(document.visibilityState === "visible" && document.hasFocus());
    };
    window.addEventListener("focus", this.onFocus);
    window.addEventListener("blur", this.onBlur);
    document.addEventListener("visibilitychange", this.onVisibility);
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  async setEnabled(on: boolean): Promise<void> {
    if (on === this.enabled)
      return;
    if (on) {
      this.enabled = true;
      await this.start();
      this.applyMasterGain(true);
    } else {
      this.enabled = false;
      this.stop();
    }
  }

  private async start(): Promise<void> {
    if (this.ctx)
      return;

    const ctx = new AudioContext();
    this.ctx = ctx;
    if (ctx.state === "suspended")
      await ctx.resume();

    const master = ctx.createGain();
    master.gain.value = 0.0001;
    master.connect(ctx.destination);
    this.master = master;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 900;
    filter.Q.value = 0.7;
    filter.connect(master);
    this.filter = filter;

    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.12;
    droneGain.connect(filter);
    this.droneGain = droneGain;

    const drone = ctx.createOscillator();
    drone.type = "sine";
    drone.frequency.value = 55;
    drone.connect(droneGain);
    drone.start();
    this.drone = drone;

    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 8;
    this.lfoGain = lfoGain;
    const lfo = ctx.createOscillator();
    lfo.type = "sine";
    lfo.frequency.value = 0.08;
    lfo.connect(lfoGain);
    lfoGain.connect(drone.frequency);
    lfo.start();
    this.lfo = lfo;

    const ratios = [1, 1.5, 2, 2.5, 3];
    this.partials = ratios.map((ratio, i) => {
      const gain = ctx.createGain();
      gain.gain.value = 0.02;
      gain.connect(filter);
      const osc = ctx.createOscillator();
      osc.type = i % 2 === 0 ? "triangle" : "sine";
      osc.frequency.value = 110 * ratio;
      osc.connect(gain);
      osc.start();
      return { osc, gain };
    });

    const sparkleGain = ctx.createGain();
    sparkleGain.gain.value = 0.0001;
    sparkleGain.connect(master);
    this.sparkleGain = sparkleGain;
    const sparkle = ctx.createOscillator();
    sparkle.type = "sine";
    sparkle.frequency.value = 880;
    sparkle.connect(sparkleGain);
    sparkle.start();
    this.sparkle = sparkle;

    this.timer = window.setInterval(() => this.tick(), 80);
  }

  private setWindowFocused(on: boolean): void {
    if (on === this.windowFocused)
      return;
    this.windowFocused = on;
    this.applyMasterGain(false);
  }

  private applyMasterGain(fadeIn: boolean): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || !this.enabled)
      return;
    const audible = this.windowFocused;
    const target = audible ? MASTER_LEVEL : 0.0001;
    const now = ctx.currentTime;
    try {
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), now);
      master.gain.exponentialRampToValueAtTime(
        target,
        now + (fadeIn && audible ? 1.0 : audible ? 0.12 : 0.08)
      );
    } catch {
      master.gain.value = target;
    }
  }

  private stop(): void {
    if (this.timer != null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    const ctx = this.ctx;
    if (ctx && this.master) {
      try {
        this.master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.4);
      } catch {
        // ignore
      }
    }
    window.setTimeout(() => this.teardown(), 500);
  }

  private teardown(): void {
    for (const p of this.partials) {
      try {
        p.osc.stop();
      } catch {
        // ignore
      }
    }
    this.partials = [];
    for (const node of [this.drone, this.lfo, this.sparkle]) {
      try {
        node?.stop();
      } catch {
        // ignore
      }
    }
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
    this.drone = null;
    this.droneGain = null;
    this.sparkle = null;
    this.sparkleGain = null;
    this.lfo = null;
    this.lfoGain = null;
    this.filter = null;
  }

  private tick(): void {
    const ctx = this.ctx;
    if (!ctx || !this.filter || !this.drone || !this.sparkleGain || !this.sparkle)
      return;

    const snap = this.bus.snapshot;
    const demo = snap.updatedAt === 0;
    const t = ctx.currentTime;
    const focus = demo ? 0.45 + 0.35 * Math.sin(t * 0.4) : snap.focus;
    const calm = demo ? 0.45 + 0.35 * Math.cos(t * 0.33) : snap.calm;
    const bands = snap.bands;
    const mean = (arr: number[]) =>
      arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    const delta = demo ? 0.3 : mean(bands.delta);
    const theta = demo ? 0.25 : mean(bands.theta);
    const alpha = demo ? 0.35 : mean(bands.alpha);
    const beta = demo ? 0.3 : mean(bands.beta);
    const gamma = demo ? 0.2 : mean(bands.gamma);

    const base = 48 + calm * 24 + delta * 10;
    this.drone.frequency.setTargetAtTime(base, t, 0.25);
    this.filter.frequency.setTargetAtTime(500 + alpha * 900 + focus * 1200, t, 0.2);

    const levels = [delta, theta, alpha, beta, gamma];
    this.partials.forEach((p, i) => {
      const freq = base * (1.5 + i * 0.55) * (1 + levels[i] * 0.35);
      p.osc.frequency.setTargetAtTime(freq, t, 0.2);
      p.gain.gain.setTargetAtTime(0.015 + levels[i] * 0.08 * (0.4 + calm), t, 0.2);
    });

    this.sparkle.frequency.setTargetAtTime(660 + focus * 900 + gamma * 400, t, 0.1);
    this.sparkleGain.gain.setTargetAtTime(0.001 + focus * beta * 0.06, t, 0.08);

    if (this.lfo)
      this.lfo.frequency.setTargetAtTime(0.05 + (1 - calm) * 0.2, t, 0.3);
  }
}
