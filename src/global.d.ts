export type DeviceSummary = {
  deviceId: string;
  deviceNickname: string;
  model: string;
};

export type AuthState = {
  signedIn: boolean;
  email: string | null;
  device: DeviceSummary | null;
  devices: DeviceSummary[];
  needsDevicePick: boolean;
  streaming: boolean;
  error: string | null;
};

export type ChannelNames = string[];

export type RawBatch = {
  kind: "raw";
  channelNames: ChannelNames;
  samplingRate: number;
  times: number[];
  channels: number[][];
};

export type PowerByBandBatch = {
  kind: "powerByBand";
  channelNames: ChannelNames;
  times: number[];
  bands: {
    delta: number[][];
    theta: number[][];
    alpha: number[][];
    beta: number[][];
    gamma: number[][];
  };
};

export type PsdFrame = {
  kind: "psd";
  channelNames: ChannelNames;
  freqs: number[];
  psd: number[][];
  startTime: number;
};

export type FocusCalmSample = {
  kind: "focusCalm";
  time: number;
  focus?: number;
  calm?: number;
};

export type SignalQualityBatch = {
  kind: "signalQuality";
  time: number;
  channelNames: ChannelNames;
  standardDeviations: number[];
  statuses: string[];
};

export type AccelerometerSample = {
  kind: "accelerometer";
  time: number;
  x: number;
  y: number;
  z: number;
  pitch: number;
  roll: number;
  inclination: number;
  orientation: number;
  acceleration: number;
};

export type StatusUpdate = {
  kind: "status";
  state: string;
  sleeping: boolean;
  sleepModeReason: string | null;
  charging: boolean;
  battery: number;
  ssid: string;
  lastHeartbeat?: number;
};

export type MetricMessage =
  | RawBatch
  | PowerByBandBatch
  | PsdFrame
  | FocusCalmSample
  | SignalQualityBatch
  | AccelerometerSample
  | StatusUpdate;

export type StreamHealth = {
  deviceNickname: string | null;
  online: boolean;
  samplingRate: number | null;
  lastPacketAgeMs: number | null;
  battery: number | null;
  state: string | null;
  ssid: string | null;
  sleeping: boolean | null;
  sleepModeReason: string | null;
  charging: boolean | null;
  heartbeatAgeMs: number | null;
  streamingConnected: boolean | null;
  activeMode: string | null;
  metricCounts: Record<string, number>;
  lastError: string | null;
};

export type CrownApi = {
  getAuthState: () => Promise<AuthState>;
  canEncrypt: () => Promise<boolean>;
  tryRestore: () => Promise<AuthState>;
  login: (payload: {
    email: string;
    password: string;
    staySignedIn: boolean;
  }) => Promise<AuthState>;
  logout: () => Promise<AuthState>;
  listDevices: () => Promise<DeviceSummary[]>;
  selectDevice: (deviceId: string) => Promise<AuthState>;
  startStreaming: () => Promise<AuthState>;
  stopStreaming: () => Promise<AuthState>;
  getStreamHealth: () => Promise<StreamHealth>;
  setFullscreen: (on: boolean) => Promise<boolean>;
  isFullscreen: () => Promise<boolean>;
  onFullscreenChanged: (cb: (on: boolean) => void) => () => void;
  onAuthChanged: (cb: (state: AuthState) => void) => () => void;
  onMetrics: (cb: (message: MetricMessage) => void) => () => void;
};

declare global {
  interface Window {
    crown: CrownApi;
    uPlot: {
      new (
        opts: import("uplot").Options,
        data?: import("uplot").AlignedData,
        target?: HTMLElement | null
      ): import("uplot").default;
    };
  }
}

export {};
