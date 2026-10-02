import { Neurosity } from "@neurosity/sdk";
import type { AuthState, CrownApi, MetricMessage } from "../global.js";
import { NeurosityClient } from "../../electron/neurosity-client.js";

const CRED_KEY = "brains.credentials";

type StoredCredentials = {
  email: string;
  password: string;
};

const client = new NeurosityClient(async (autoSelectDevice) => {
  return new Neurosity({ autoSelectDevice });
});
const metricListeners = new Set<(message: MetricMessage) => void>();
const authListeners = new Set<(state: AuthState) => void>();
const fullscreenListeners = new Set<(on: boolean) => void>();

function loadStored(): StoredCredentials | null {
  try {
    const raw = localStorage.getItem(CRED_KEY);
    if (!raw)
      return null;
    const parsed = JSON.parse(raw) as StoredCredentials;
    if (!parsed.email || !parsed.password)
      return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveStored(email: string, password: string): void {
  localStorage.setItem(CRED_KEY, JSON.stringify({ email, password } satisfies StoredCredentials));
}

function clearStored(): void {
  localStorage.removeItem(CRED_KEY);
}

function isFullscreen(): boolean {
  return !!document.fullscreenElement;
}

client.setEmitters({
  onMetrics: (message) => {
    for (const cb of metricListeners)
      cb(message);
  },
  onAuthChanged: (state) => {
    for (const cb of authListeners)
      cb(state);
  }
});

document.addEventListener("fullscreenchange", () => {
  const on = isFullscreen();
  for (const cb of fullscreenListeners)
    cb(on);
});

const api: CrownApi = {
  getAuthState: async () => client.getAuthState(),
  canEncrypt: async () => true,
  tryRestore: async () => {
    const stored = loadStored();
    if (!stored)
      return client.getAuthState();
    return client.login(stored);
  },
  login: async (payload) => {
    const state = await client.login({
      email: payload.email,
      password: payload.password
    });
    if (state.signedIn && payload.staySignedIn)
      saveStored(payload.email, payload.password);
    else if (!payload.staySignedIn)
      clearStored();
    return state;
  },
  logout: async () => {
    clearStored();
    return client.logout();
  },
  listDevices: async () => client.refreshDevices(),
  selectDevice: async (deviceId) => {
    try {
      return await client.selectDevice(deviceId);
    } catch (err) {
      const state = client.getAuthState();
      return {
        ...state,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  },
  startStreaming: async () => {
    await client.startStreaming();
    return client.getAuthState();
  },
  stopStreaming: async () => client.stopStreaming(),
  getStreamHealth: async () => client.getStreamHealth(),
  setFullscreen: async (on) => {
    if (on) {
      if (!document.fullscreenElement)
        await document.documentElement.requestFullscreen();
    } else if (document.fullscreenElement) {
      await document.exitFullscreen();
    }
    return isFullscreen();
  },
  isFullscreen: async () => isFullscreen(),
  onFullscreenChanged: (cb) => {
    fullscreenListeners.add(cb);
    return () => {
      fullscreenListeners.delete(cb);
    };
  },
  onAuthChanged: (cb) => {
    authListeners.add(cb);
    return () => {
      authListeners.delete(cb);
    };
  },
  onMetrics: (cb) => {
    metricListeners.add(cb);
    return () => {
      metricListeners.delete(cb);
    };
  }
};

window.crown = api;

// Load the UI only after window.crown exists (static imports are hoisted).
void import("../renderer.js");
