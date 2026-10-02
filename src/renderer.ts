import type { AuthState, MetricMessage } from "./global.js";
import { AudioEngine } from "./audio-engine.js";
import { DemoFeeder } from "./demo-feeder.js";
import { MetricBus } from "./metrics-bus.js";
import { PlotBoard } from "./plots.js";
import { VizEngine } from "./viz/engine.js";
import type { VizModeId } from "./viz/types.js";
import { worldClock } from "./viz/world-clock.js";

const loginView = mustEl("loginView");
const deviceView = mustEl("deviceView");
const streamView = mustEl("streamView");
const timelineView = mustEl("timelineView");
const vizView = mustEl("vizView");
const vizHost = mustEl("vizHost");
const modeSwitch = mustEl("modeSwitch");
const clockBar = mustEl("clockBar");
const statusLine1 = mustEl("statusLine1");
const statusLine2 = mustEl("statusLine2");
const loginError = mustEl("loginError");
const logoutBtn = mustEl("logoutBtn") as HTMLButtonElement;
const fullscreenBtn = mustEl("fullscreenBtn") as HTMLButtonElement;
const fsExitWrap = mustEl("fsExitWrap");
const fsExitBtn = mustEl("fsExitBtn") as HTMLButtonElement;
const pauseToggle = mustEl("pauseToggle") as HTMLInputElement;
const audioToggle = mustEl("audioToggle") as HTMLInputElement;
const demoToggle = mustEl("demoToggle") as HTMLInputElement;
const clockSlider = mustEl("clockSlider") as HTMLInputElement;
const clockLabel = mustEl("clockLabel");
const clockNowBtn = mustEl("clockNowBtn") as HTMLButtonElement;
const loginForm = mustEl("loginForm") as HTMLFormElement;
const staySignedIn = mustEl("staySignedIn") as HTMLInputElement;
const deviceList = mustEl("deviceList");

const bus = new MetricBus();
const audio = new AudioEngine(bus);
let plots: PlotBoard | null = null;
let viz: VizEngine | null = null;
let healthTimer: number | null = null;
let wallClockTimer: number | null = null;

function feedPlots(message: MetricMessage): void {
  if (!plots?.isActive())
    return;
  const board = plots;
  switch (message.kind) {
    case "raw":
      board.pushRaw(message.times, message.channels, message.channelNames);
      break;
    case "powerByBand":
      board.pushBands(message.times, message.bands, message.channelNames);
      break;
    case "psd":
      board.setPsd(message.freqs, message.psd, message.channelNames);
      break;
    case "focusCalm":
      board.pushFocusCalm(message.time, message.focus, message.calm);
      break;
    case "signalQuality":
      board.pushSignalQuality(
        message.time,
        message.channelNames,
        message.standardDeviations,
        message.statuses
      );
      break;
    case "accelerometer":
      board.pushAccel(message.time, message.x, message.y, message.z);
      break;
    case "status":
      break;
  }
}

const demo = new DemoFeeder(bus, feedPlots);

const MODE_KEY = "crown.timeline.activeMode";
const MODE_IDS: VizModeId[] = [
  "timeline", "head", "fireflies", "rings", "attractors",
  "storm", "aurora", "crystal", "weather"
];

function loadSavedMode(): VizModeId {
  try {
    const raw = localStorage.getItem(MODE_KEY);
    if (raw && MODE_IDS.includes(raw as VizModeId))
      return raw as VizModeId;
  } catch {
    // ignore
  }
  return "head";
}

let activeMode: VizModeId = loadSavedMode();

function setStatus(line1: string, line2 = ""): void {
  statusLine1.textContent = line1;
  statusLine2.textContent = line2;
  statusLine2.hidden = !line2;
}

function mustEl(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el)
    throw new Error(`Missing element #${id}`);
  return el;
}

function ensurePlots(): PlotBoard {
  if (!plots)
    plots = new PlotBoard();
  return plots;
}

function ensureViz(): VizEngine {
  if (!viz)
    viz = new VizEngine(bus, vizHost);
  return viz;
}

function syncClockUi(): void {
  const minutes = Math.round(worldClock.hours * 60) % (24 * 60);
  clockSlider.value = String(minutes);
  clockLabel.textContent = worldClock.label();
}

function setMode(mode: VizModeId): void {
  activeMode = mode;
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // ignore
  }
  for (const btn of modeSwitch.querySelectorAll<HTMLButtonElement>(".mode-btn"))
    btn.classList.toggle("active", btn.dataset.mode === mode);

  const isTimeline = mode === "timeline";
  timelineView.hidden = !isTimeline;
  vizView.hidden = isTimeline;

  demo.setPlotsEnabled(isTimeline);

  if (isTimeline) {
    ensureViz().clear();
    ensurePlots().setActive(true);
    return;
  }

  plots?.setActive(false);
  ensureViz().setMode(mode);
  requestAnimationFrame(() => ensureViz().resize());
}

function showView(state: AuthState): void {
  const signedIn = state.signedIn;
  const needsPick = state.needsDevicePick;
  const ready = signedIn && !!state.device;

  loginView.hidden = signedIn;
  deviceView.hidden = !needsPick;
  streamView.hidden = !ready;
  logoutBtn.hidden = !signedIn;
  modeSwitch.hidden = !ready;
  clockBar.hidden = !ready;

  if (needsPick)
    renderDevices(state);

  if (ready) {
    setMode(activeMode);
    syncClockUi();
  } else {
    viz?.clear();
    void audio.setEnabled(false);
    audioToggle.checked = false;
    demo.setEnabled(false);
    demoToggle.checked = false;
  }
}

function renderDevices(state: AuthState): void {
  deviceList.innerHTML = "";
  for (const device of state.devices) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = `${device.deviceNickname} (${device.model})`;
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      const next = await window.crown.selectDevice(device.deviceId);
      applyAuth(next);
    });
    deviceList.appendChild(btn);
  }
}

function applyAuth(state: AuthState): void {
  showView(state);

  if (state.error && !state.signedIn) {
    loginError.hidden = false;
    loginError.textContent = state.error;
  } else if (state.error) {
    setStatus(state.error);
  } else {
    loginError.hidden = true;
  }

  if (!state.signedIn) {
    setStatus("Signed out");
    stopHealth();
    return;
  }

  if (state.device) {
    setStatus(
      `${state.email ?? ""} · ${state.device.deviceNickname}`,
      "streaming"
    );
    startHealth();
  } else if (state.needsDevicePick) {
    setStatus(`${state.email ?? ""}`, "choose a device");
    stopHealth();
  } else {
    setStatus(`${state.email ?? ""}`, "no devices found");
    stopHealth();
  }
}

function startHealth(): void {
  if (healthTimer != null)
    return;
  const tick = async () => {
    const health = await window.crown.getStreamHealth();
    const age = health.lastPacketAgeMs == null
      ? "no metric packets"
      : health.lastPacketAgeMs < 1000
        ? "metrics live"
        : `${Math.round(health.lastPacketAgeMs / 1000)}s since metrics`;
    const hb = health.heartbeatAgeMs == null
      ? "no heartbeat"
      : health.heartbeatAgeMs < 5000
        ? "heartbeat fresh"
        : `heartbeat ${Math.round(health.heartbeatAgeMs / 1000)}s old`;
    const batt = health.battery == null ? "?" : `${Math.round(health.battery)}%`;
    const stream = health.streamingConnected == null
      ? "stream ?"
      : health.streamingConnected
        ? `stream connected (${health.activeMode ?? "?"})`
        : "stream not connected";
    const sleep = health.sleeping
      ? `sleep:${health.sleepModeReason ?? "yes"}`
      : "awake";
    const ssid = health.ssid ? `ssid ${health.ssid}` : "ssid none";
    const counts = health.metricCounts;
    const countText = [
      `status ${counts.status ?? 0}`,
      `raw ${counts.raw ?? 0}`,
      `bands ${counts.powerByBand ?? 0}`,
      `focus ${counts.focus ?? 0}`
    ].join(", ");
    const line1 = [
      health.deviceNickname ?? "Crown",
      `cloud ${health.state ?? "?"}`,
      stream,
      sleep,
      ssid
    ].filter(Boolean).join(" · ");
    const line2 = [
      hb,
      age,
      `battery ${batt}`,
      countText,
      demo.isEnabled ? "demo on" : "demo off",
      audio.isEnabled ? "audio on" : "audio off",
      worldClock.label(),
      health.lastError ? `err ${health.lastError}` : null
    ].filter(Boolean).join(" · ");
    setStatus(line1, line2);
  };
  void tick();
  healthTimer = window.setInterval(() => void tick(), 1000);
}

function stopHealth(): void {
  if (healthTimer != null) {
    clearInterval(healthTimer);
    healthTimer = null;
  }
}

function lastSample(channels: number[][]): number[] {
  return channels.map((row) => row[row.length - 1] ?? 0);
}

function onMetric(message: MetricMessage): void {
  if (demo.isEnabled)
    return;

  if (activeMode === "timeline")
    ensurePlots().setActive(true);
  feedPlots(message);

  switch (message.kind) {
    case "raw":
      bus.pushRawMeans(message.channelNames, message.channels);
      break;
    case "powerByBand":
      bus.pushBandSample(message.channelNames, {
        delta: lastSample(message.bands.delta),
        theta: lastSample(message.bands.theta),
        alpha: lastSample(message.bands.alpha),
        beta: lastSample(message.bands.beta),
        gamma: lastSample(message.bands.gamma)
      });
      break;
    case "psd":
      bus.pushPsd(message.freqs, message.psd, message.channelNames);
      break;
    case "focusCalm":
      bus.pushFocusCalm(message.focus, message.calm);
      break;
    case "signalQuality":
      bus.pushSignalQuality(
        message.channelNames,
        message.standardDeviations,
        message.statuses
      );
      break;
    case "accelerometer":
      bus.pushAccel({
        x: message.x,
        y: message.y,
        z: message.z,
        pitch: message.pitch,
        roll: message.roll,
        inclination: message.inclination,
        orientation: message.orientation,
        acceleration: message.acceleration
      });
      break;
    case "status":
      break;
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginError.hidden = true;
  const email = (mustEl("email") as HTMLInputElement).value.trim();
  const password = (mustEl("password") as HTMLInputElement).value;
  const loginBtn = mustEl("loginBtn") as HTMLButtonElement;
  loginBtn.disabled = true;
  try {
    const canStore = await window.crown.canEncrypt();
    if (staySignedIn.checked && !canStore) {
      loginError.hidden = false;
      loginError.textContent =
        "Stay signed in needs OS credential encryption, which is unavailable.";
      staySignedIn.checked = false;
    }
    const state = await window.crown.login({
      email,
      password,
      staySignedIn: staySignedIn.checked
    });
    applyAuth(state);
    if (!state.signedIn && state.error) {
      loginError.hidden = false;
      loginError.textContent = state.error;
    }
  } finally {
    loginBtn.disabled = false;
  }
});

logoutBtn.addEventListener("click", async () => {
  plots?.reset();
  viz?.clear();
  void audio.setEnabled(false);
  audioToggle.checked = false;
  demo.setEnabled(false);
  demoToggle.checked = false;
  const state = await window.crown.logout();
  applyAuth(state);
});

function applyFullscreenUi(on: boolean): void {
  document.body.classList.toggle("is-fullscreen", on);
  fsExitWrap.hidden = !on;
  fullscreenBtn.textContent = on ? "Exit full" : "Full screen";
  requestAnimationFrame(() => viz?.resize());
}

async function setFullscreen(on: boolean): Promise<void> {
  const next = await window.crown.setFullscreen(on);
  applyFullscreenUi(next);
}

fullscreenBtn.addEventListener("click", () => {
  const on = !document.body.classList.contains("is-fullscreen");
  void setFullscreen(on);
});

fsExitBtn.addEventListener("click", () => {
  void setFullscreen(false);
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && document.body.classList.contains("is-fullscreen")) {
    event.preventDefault();
    void setFullscreen(false);
  }
});

window.crown.onFullscreenChanged(applyFullscreenUi);
void window.crown.isFullscreen().then(applyFullscreenUi);

pauseToggle.addEventListener("change", () => {
  const paused = pauseToggle.checked;
  ensurePlots().setPaused(paused);
  ensureViz().setPaused(paused);
});

audioToggle.addEventListener("change", () => {
  void audio.setEnabled(audioToggle.checked);
});

demoToggle.addEventListener("change", () => {
  demo.setEnabled(demoToggle.checked);
});

clockSlider.addEventListener("input", () => {
  const minutes = Number(clockSlider.value);
  worldClock.setHours(minutes / 60, true);
  clockLabel.textContent = worldClock.label();
});

clockNowBtn.addEventListener("click", () => {
  worldClock.followWallClock();
  syncClockUi();
});

worldClock.onChange(() => {
  syncClockUi();
});

modeSwitch.addEventListener("click", (event) => {
  const target = event.target as HTMLElement | null;
  const btn = target?.closest?.("button[data-mode]") as HTMLButtonElement | null;
  if (!btn?.dataset.mode)
    return;
  setMode(btn.dataset.mode as VizModeId);
});

window.addEventListener("resize", () => {
  viz?.resize();
});

wallClockTimer = window.setInterval(() => {
  worldClock.tickWallClock();
}, 30_000);

window.crown.onAuthChanged(applyAuth);
window.crown.onMetrics(onMetric);

syncClockUi();

(async () => {
  const restored = await window.crown.tryRestore();
  applyAuth(restored);
  if (!restored.signedIn) {
    const state = await window.crown.getAuthState();
    applyAuth(state);
  }
})();
