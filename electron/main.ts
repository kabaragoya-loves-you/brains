import { app, BrowserWindow, ipcMain, shell } from "electron";
import path from "path";
import {
  canEncrypt,
  clearCredentials,
  loadCredentials,
  saveCredentials
} from "./auth-store";
import { NeurosityClient } from "./neurosity-client";

const client = new NeurosityClient();
let mainWindow: BrowserWindow | null = null;

function bindClientEmitters(): void {
  client.setEmitters({
    onMetrics: (message) => {
      if (!mainWindow || mainWindow.isDestroyed())
        return;
      mainWindow.webContents.send("metrics", message);
    },
    onAuthChanged: (state) => {
      if (!mainWindow || mainWindow.isDestroyed())
        return;
      mainWindow.webContents.send("auth-changed", state);
    }
  });
}

function createWindow(): void {
  const iconPath = path.join(__dirname, "..", "..", "assets", "kabaragoya.png");

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 960,
    minWidth: 1100,
    minHeight: 720,
    title: "Brains!",
    icon: iconPath,
    backgroundColor: "#0f1115",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  bindClientEmitters();
  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });

  const emitFullscreen = () => {
    if (!mainWindow || mainWindow.isDestroyed())
      return;
    mainWindow.webContents.send("fullscreen-changed", mainWindow.isFullScreen());
  };
  mainWindow.on("enter-full-screen", emitFullscreen);
  mainWindow.on("leave-full-screen", emitFullscreen);

  mainWindow.on("closed", () => {
    client.setEmitters(null);
    mainWindow = null;
  });
}

function registerIpc(): void {
  ipcMain.handle("auth:getState", () => client.getAuthState());

  ipcMain.handle("auth:canEncrypt", () => canEncrypt());

  ipcMain.handle("auth:tryRestore", async () => {
    const stored = loadCredentials();
    if (!stored)
      return client.getAuthState();
    return client.login(stored);
  });

  ipcMain.handle(
    "auth:login",
    async (_event, payload: { email: string; password: string; staySignedIn: boolean }) => {
      const state = await client.login({
        email: payload.email,
        password: payload.password
      });

      if (state.signedIn && payload.staySignedIn)
        saveCredentials(payload.email, payload.password);
      else if (!payload.staySignedIn)
        clearCredentials();

      return state;
    }
  );

  ipcMain.handle("auth:logout", async () => {
    clearCredentials();
    return client.logout();
  });

  ipcMain.handle("devices:list", async () => client.refreshDevices());

  ipcMain.handle("devices:select", async (_event, deviceId: string) => {
    try {
      return await client.selectDevice(deviceId);
    } catch (err) {
      const state = client.getAuthState();
      return {
        ...state,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  });

  ipcMain.handle("stream:stop", async () => client.stopStreaming());

  ipcMain.handle("stream:start", async () => {
    await client.startStreaming();
    return client.getAuthState();
  });

  ipcMain.handle("stream:health", () => client.getStreamHealth());

  ipcMain.handle("window:setFullscreen", (_event, on: boolean) => {
    const win = BrowserWindow.fromWebContents(_event.sender) ?? mainWindow;
    if (!win || win.isDestroyed())
      return false;
    win.setFullScreen(!!on);
    return win.isFullScreen();
  });

  ipcMain.handle("window:isFullscreen", (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) ?? mainWindow;
    if (!win || win.isDestroyed())
      return false;
    return win.isFullScreen();
  });
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0)
      createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin")
    app.quit();
});
