import type { MetricBus } from "../metrics-bus.js";
import { createAttractorsMode } from "./attractors.js";
import { createAuroraMode } from "./aurora.js";
import { createCrystalMode } from "./crystal.js";
import { createFirefliesMode } from "./fireflies.js";
import { createHeadMode } from "./head.js";
import { createRingsMode } from "./rings.js";
import { createStormMode } from "./storm.js";
import { createWeatherMode } from "./weather.js";
import type { VizMode, VizModeId } from "./types.js";

export class VizEngine {
  private modes: Map<VizModeId, VizMode>;
  private active: VizMode | null = null;
  private bus: MetricBus;
  private host: HTMLElement;
  private paused = false;

  constructor(bus: MetricBus, host: HTMLElement) {
    this.bus = bus;
    this.host = host;
    this.modes = new Map([
      ["head", createHeadMode()],
      ["fireflies", createFirefliesMode()],
      ["attractors", createAttractorsMode()],
      ["aurora", createAuroraMode()],
      ["rings", createRingsMode()],
      ["storm", createStormMode()],
      ["crystal", createCrystalMode()],
      ["weather", createWeatherMode()]
    ]);
  }

  get activeId(): VizModeId | null {
    return this.active?.id ?? null;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  setMode(id: VizModeId): void {
    if (id === "timeline") {
      this.clear();
      return;
    }
    if (this.active?.id === id)
      return;
    this.clear();
    const mode = this.modes.get(id);
    if (!mode)
      return;
    this.active = mode;
    mode.mount({
      bus: this.bus,
      container: this.host,
      paused: () => this.paused
    });
    this.resize();
  }

  resize(): void {
    if (!this.active?.setSize)
      return;
    const width = this.host.clientWidth || this.host.parentElement?.clientWidth || 800;
    const height = this.host.clientHeight || 560;
    this.active.setSize(width, height);
  }

  clear(): void {
    this.active?.unmount();
    this.active = null;
    this.host.innerHTML = "";
  }
}
