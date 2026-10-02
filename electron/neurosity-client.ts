import type { Neurosity } from "@neurosity/sdk";
import type { Subscription } from "rxjs";
import type {
  AccelerometerSample,
  AuthState,
  DeviceSummary,
  FocusCalmSample,
  MetricMessage,
  PowerByBandBatch,
  PsdFrame,
  RawBatch,
  SignalQualityBatch,
  StatusUpdate
} from "./types";

const BATCH_MS = 80;
const CHANNEL_ORDER = ["CP3", "C3", "F5", "PO3", "PO4", "F6", "C4", "CP4"];

type LoginInput = {
  email: string;
  password: string;
};

export type NeurosityEmitters = {
  onMetrics: (message: MetricMessage) => void;
  onAuthChanged: (state: AuthState) => void;
};

export type SdkFactory = (autoSelectDevice: boolean) => Promise<Neurosity>;

async function defaultCreateSdk(autoSelectDevice: boolean): Promise<Neurosity> {
  // tsc CommonJS rewrites import() to require(); force a real ESM import so we
  // hit @neurosity/sdk's .mjs build (its .js "require" entry is broken).
  const loadEsm = new Function(
    "specifier",
    "return import(specifier)"
  ) as (specifier: string) => Promise<typeof import("@neurosity/sdk")>;
  const mod = await loadEsm("@neurosity/sdk");
  return new mod.Neurosity({ autoSelectDevice });
}

export class NeurosityClient {
  private neurosity: Neurosity | null = null;
  private emitters: NeurosityEmitters | null = null;
  private createSdk: SdkFactory;
  private subs: Subscription[] = [];
  private email: string | null = null;
  private device: DeviceSummary | null = null;
  private devices: DeviceSummary[] = [];
  private streaming = false;
  private error: string | null = null;

  private rawBuffer: RawBatch | null = null;
  private bandBuffer: PowerByBandBatch | null = null;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastPacketAt: number | null = null;
  private samplingRate: number | null = null;
  private lastStatus: StatusUpdate | null = null;
  private streamingConnected: boolean | null = null;
  private activeMode: string | null = null;
  private metricCounts: Record<string, number> = {};

  constructor(createSdk: SdkFactory = defaultCreateSdk) {
    this.createSdk = createSdk;
  }

  setEmitters(emitters: NeurosityEmitters | null): void {
    this.emitters = emitters;
  }

  getAuthState(): AuthState {
    return {
      signedIn: !!this.email,
      email: this.email,
      device: this.device,
      devices: this.devices,
      needsDevicePick: this.devices.length > 1 && !this.device,
      streaming: this.streaming,
      error: this.error
    };
  }

  async login(input: LoginInput): Promise<AuthState> {
    this.error = null;
    await this.teardown(false);

    const neurosity = await this.createSdk(false);
    this.neurosity = neurosity;

    try {
      await neurosity.login({
        email: input.email,
        password: input.password
      });
      this.email = input.email;
      await this.refreshDevices();
      if (this.devices.length === 1)
        await this.selectDevice(this.devices[0].deviceId);
    } catch (err) {
      this.email = null;
      this.devices = [];
      this.device = null;
      this.error = err instanceof Error ? err.message : String(err);
      await this.teardown(false);
    }

    return this.getAuthState();
  }

  async logout(): Promise<AuthState> {
    await this.teardown(true);
    this.email = null;
    this.devices = [];
    this.device = null;
    this.error = null;
    return this.getAuthState();
  }

  async refreshDevices(): Promise<DeviceSummary[]> {
    if (!this.neurosity)
      return [];

    const devices = await this.neurosity.getDevices();
    this.devices = (devices ?? []).map((d) => ({
      deviceId: d.deviceId,
      deviceNickname: d.deviceNickname ?? d.deviceId,
      model: d.model ?? "unknown"
    }));
    return this.devices;
  }

  async selectDevice(deviceId: string): Promise<AuthState> {
    if (!this.neurosity)
      throw new Error("Not signed in.");

    const selected = await this.neurosity.selectDevice((list) => {
      const match = list.find((d) => d.deviceId === deviceId);
      if (!match)
        throw new Error(`Device ${deviceId} not found.`);
      return match;
    });

    this.device = {
      deviceId: selected.deviceId,
      deviceNickname: selected.deviceNickname ?? selected.deviceId,
      model: selected.model ?? "unknown"
    };
    this.error = null;
    await this.startStreaming();
    return this.getAuthState();
  }

  async startStreaming(): Promise<void> {
    if (!this.neurosity || !this.device || this.streaming)
      return;

    this.clearSubscriptions();
    this.streaming = true;
    this.metricCounts = {};
    this.streamingConnected = null;
    this.activeMode = null;
    this.emitAuth();

    const n = this.neurosity;

    this.subs.push(
      n.streamingState().subscribe({
        next: (state) => {
          this.streamingConnected = !!state.connected;
          this.activeMode = String(state.activeMode ?? "");
        },
        error: (err) => this.onStreamError("streamingState", err)
      })
    );

    this.subs.push(
      n.brainwaves("raw").subscribe({
        next: (epoch) => {
          if (!("data" in epoch))
            return;
          this.bumpMetric("raw");
          this.onRaw(epoch);
        },
        error: (err) => this.onStreamError("raw", err)
      })
    );

    this.subs.push(
      n.brainwaves("powerByBand").subscribe({
        next: (band) => {
          if (!("delta" in band))
            return;
          this.bumpMetric("powerByBand");
          this.onPowerByBand(band);
        },
        error: (err) => this.onStreamError("powerByBand", err)
      })
    );

    this.subs.push(
      n.brainwaves("psd").subscribe({
        next: (psd) => {
          if (!("psd" in psd) || !("freqs" in psd))
            return;
          this.bumpMetric("psd");
          this.onPsd(psd);
        },
        error: (err) => this.onStreamError("psd", err)
      })
    );

    this.subs.push(
      n.focus().subscribe({
        next: (focus) => {
          this.bumpMetric("focus");
          this.markPacket();
          this.send({
            kind: "focusCalm",
            time: focus.timestamp,
            focus: focus.probability
          } satisfies FocusCalmSample);
        },
        error: (err) => this.onStreamError("focus", err)
      })
    );

    this.subs.push(
      n.calm().subscribe({
        next: (calm) => {
          this.bumpMetric("calm");
          this.markPacket();
          this.send({
            kind: "focusCalm",
            time: calm.timestamp,
            calm: calm.probability
          } satisfies FocusCalmSample);
        },
        error: (err) => this.onStreamError("calm", err)
      })
    );

    this.subs.push(
      n.signalQuality().subscribe({
        next: (quality) => {
          this.bumpMetric("signalQuality");
          this.onSignalQuality(quality);
        },
        error: (err) => this.onStreamError("signalQuality", err)
      })
    );

    this.subs.push(
      n.accelerometer().subscribe({
        next: (accel) => {
          this.bumpMetric("accelerometer");
          this.markPacket();
          this.send({
            kind: "accelerometer",
            time: accel.timestamp,
            x: accel.x,
            y: accel.y,
            z: accel.z,
            pitch: accel.pitch,
            roll: accel.roll,
            inclination: accel.inclination,
            orientation: accel.orientation,
            acceleration: accel.acceleration
          } satisfies AccelerometerSample);
        },
        error: (err) => this.onStreamError("accelerometer", err)
      })
    );

    this.subs.push(
      n.status().subscribe({
        next: (status) => {
          this.bumpMetric("status");
          const update: StatusUpdate = {
            kind: "status",
            state: status.state ?? "unknown",
            sleeping: !!status.sleepMode,
            sleepModeReason: status.sleepModeReason ?? null,
            charging: !!status.charging,
            battery: typeof status.battery === "number" ? status.battery : 0,
            ssid: status.ssid ?? "",
            lastHeartbeat: status.lastHeartbeat
          };
          this.lastStatus = update;
          this.send(update);
        },
        error: (err) => this.onStreamError("status", err)
      })
    );
  }

  async stopStreaming(): Promise<AuthState> {
    this.clearSubscriptions();
    this.streaming = false;
    this.flushAll();
    return this.getAuthState();
  }

  getStreamHealth() {
    const heartbeat = this.lastStatus?.lastHeartbeat;
    return {
      deviceNickname: this.device?.deviceNickname ?? null,
      online: this.lastStatus ? this.lastStatus.state === "online" : false,
      samplingRate: this.samplingRate,
      lastPacketAgeMs: this.lastPacketAt == null
        ? null
        : Date.now() - this.lastPacketAt,
      battery: this.lastStatus?.battery ?? null,
      state: this.lastStatus?.state ?? null,
      ssid: this.lastStatus?.ssid || null,
      sleeping: this.lastStatus?.sleeping ?? null,
      sleepModeReason: this.lastStatus?.sleepModeReason ?? null,
      charging: this.lastStatus?.charging ?? null,
      heartbeatAgeMs: heartbeat == null ? null : Date.now() - heartbeat,
      streamingConnected: this.streamingConnected,
      activeMode: this.activeMode,
      metricCounts: { ...this.metricCounts },
      lastError: this.error
    };
  }

  private async teardown(logout: boolean): Promise<void> {
    this.clearSubscriptions();
    this.streaming = false;
    this.flushAll();

    if (this.neurosity && logout) {
      try {
        await this.neurosity.logout();
      } catch {
        // ignore logout errors during teardown
      }
    }

    this.neurosity = null;
  }

  private clearSubscriptions(): void {
    for (const sub of this.subs)
      sub.unsubscribe();
    this.subs = [];
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  private onRaw(epoch: {
    data: number[][];
    info: { samplingRate: number; startTime: number; channelNames: string[] };
  }): void {
    this.markPacket();
    const { data, info } = epoch;
    this.samplingRate = info.samplingRate;
    const channelNames = info.channelNames?.length
      ? info.channelNames
      : CHANNEL_ORDER;
    const sampleCount = data[0]?.length ?? 0;
    const dt = 1000 / info.samplingRate;

    if (!this.rawBuffer) {
      this.rawBuffer = {
        kind: "raw",
        channelNames,
        samplingRate: info.samplingRate,
        times: [],
        channels: channelNames.map(() => [])
      };
    }

    for (let i = 0; i < sampleCount; i++) {
      this.rawBuffer.times.push(info.startTime + i * dt);
      for (let c = 0; c < channelNames.length; c++)
        this.rawBuffer.channels[c].push(data[c]?.[i] ?? 0);
    }

    this.scheduleFlush();
  }

  private onPowerByBand(band: {
    delta: number[];
    theta: number[];
    alpha: number[];
    beta: number[];
    gamma: number[];
    info: { samplingRate: number; startTime: number; channelNames: string[] };
  }): void {
    this.markPacket();
    const channelNames = band.info.channelNames?.length
      ? band.info.channelNames
      : CHANNEL_ORDER;

    if (!this.bandBuffer) {
      this.bandBuffer = {
        kind: "powerByBand",
        channelNames,
        times: [],
        bands: {
          delta: channelNames.map(() => []),
          theta: channelNames.map(() => []),
          alpha: channelNames.map(() => []),
          beta: channelNames.map(() => []),
          gamma: channelNames.map(() => [])
        }
      };
    }

    const t = band.info.startTime;
    this.bandBuffer.times.push(t);
    for (let c = 0; c < channelNames.length; c++) {
      this.bandBuffer.bands.delta[c].push(band.delta[c] ?? 0);
      this.bandBuffer.bands.theta[c].push(band.theta[c] ?? 0);
      this.bandBuffer.bands.alpha[c].push(band.alpha[c] ?? 0);
      this.bandBuffer.bands.beta[c].push(band.beta[c] ?? 0);
      this.bandBuffer.bands.gamma[c].push(band.gamma[c] ?? 0);
    }

    this.scheduleFlush();
  }

  private onPsd(psd: {
    psd: number[][];
    freqs: number[];
    info: { startTime: number; channelNames: string[] };
  }): void {
    this.markPacket();
    const frame: PsdFrame = {
      kind: "psd",
      channelNames: psd.info.channelNames?.length
        ? psd.info.channelNames
        : CHANNEL_ORDER,
      freqs: psd.freqs,
      psd: psd.psd,
      startTime: psd.info.startTime
    };
    this.send(frame);
  }

  private onSignalQuality(quality: Record<string, {
    standardDeviation: number;
    status: string;
  }>): void {
    this.markPacket();
    const channelNames = Object.keys(quality);
    const ordered = CHANNEL_ORDER.filter((c) => channelNames.includes(c));
    const names = ordered.length ? ordered : channelNames;
    this.send({
      kind: "signalQuality",
      time: Date.now(),
      channelNames: names,
      standardDeviations: names.map((n) => quality[n]?.standardDeviation ?? 0),
      statuses: names.map((n) => quality[n]?.status ?? "unknown")
    } satisfies SignalQualityBatch);
  }

  private scheduleFlush(): void {
    if (this.flushTimer)
      return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushAll();
    }, BATCH_MS);
  }

  private flushAll(): void {
    if (this.rawBuffer && this.rawBuffer.times.length) {
      this.send(this.rawBuffer);
      this.rawBuffer = null;
    }
    if (this.bandBuffer && this.bandBuffer.times.length) {
      this.send(this.bandBuffer);
      this.bandBuffer = null;
    }
  }

  private bumpMetric(name: string): void {
    this.metricCounts[name] = (this.metricCounts[name] ?? 0) + 1;
  }

  private markPacket(): void {
    this.lastPacketAt = Date.now();
  }

  private onStreamError(source: string, err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.error = `${source}: ${message}`;
    this.emitAuth();
  }

  private send(message: MetricMessage): void {
    this.emitters?.onMetrics(message);
  }

  private emitAuth(): void {
    this.emitters?.onAuthChanged(this.getAuthState());
  }
}
