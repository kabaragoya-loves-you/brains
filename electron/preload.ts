import { contextBridge, ipcRenderer, IpcRendererEvent } from "electron";
import type { AuthState, MetricMessage, StreamHealth } from "./types";

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
  listDevices: () => Promise<AuthState["devices"]>;
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

const api: CrownApi = {
  getAuthState: () => ipcRenderer.invoke("auth:getState"),
  canEncrypt: () => ipcRenderer.invoke("auth:canEncrypt"),
  tryRestore: () => ipcRenderer.invoke("auth:tryRestore"),
  login: (payload) => ipcRenderer.invoke("auth:login", payload),
  logout: () => ipcRenderer.invoke("auth:logout"),
  listDevices: () => ipcRenderer.invoke("devices:list"),
  selectDevice: (deviceId) => ipcRenderer.invoke("devices:select", deviceId),
  startStreaming: () => ipcRenderer.invoke("stream:start"),
  stopStreaming: () => ipcRenderer.invoke("stream:stop"),
  getStreamHealth: () => ipcRenderer.invoke("stream:health"),
  setFullscreen: (on) => ipcRenderer.invoke("window:setFullscreen", on),
  isFullscreen: () => ipcRenderer.invoke("window:isFullscreen"),
  onFullscreenChanged: (cb) => {
    const listener = (_event: IpcRendererEvent, on: boolean) => cb(on);
    ipcRenderer.on("fullscreen-changed", listener);
    return () => ipcRenderer.removeListener("fullscreen-changed", listener);
  },
  onAuthChanged: (cb) => {
    const listener = (_event: IpcRendererEvent, state: AuthState) => cb(state);
    ipcRenderer.on("auth-changed", listener);
    return () => ipcRenderer.removeListener("auth-changed", listener);
  },
  onMetrics: (cb) => {
    const listener = (_event: IpcRendererEvent, message: MetricMessage) => cb(message);
    ipcRenderer.on("metrics", listener);
    return () => ipcRenderer.removeListener("metrics", listener);
  }
};

contextBridge.exposeInMainWorld("crown", api);
