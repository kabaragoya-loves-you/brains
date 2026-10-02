import type { MetricBus } from "../metrics-bus.js";

export type VizModeId =
  | "timeline"
  | "head"
  | "fireflies"
  | "attractors"
  | "aurora"
  | "rings"
  | "storm"
  | "crystal"
  | "weather";

export type VizContext = {
  bus: MetricBus;
  container: HTMLElement;
  paused: () => boolean;
};

export type VizMode = {
  id: VizModeId;
  label: string;
  mount: (ctx: VizContext) => void;
  unmount: () => void;
  setSize?: (width: number, height: number) => void;
};
