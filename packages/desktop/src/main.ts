import path from "node:path";
import fs from "node:fs";
import {
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  app,
  clipboard,
  dialog,
  ipcMain,
  nativeImage,
  powerSaveBlocker,
  screen,
  session,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from "electron";
import { MAX_FILE_SIZE, inputEventSchema } from "@remotedesk/shared";
import { loadConfig, saveConfig } from "./config";
import { fileAbort, fileBegin, fileChunk, fileEnd } from "./files";
import { injectInput, loadInputBackend, releaseAllInput } from "./input";
import { getPermissions, openPermissionSettings } from "./permissions";
import { listScreens, pickCaptureSource, selectScreen } from "./screens";
import { z } from "zod";

const E2E = process.env.RD_E2E === "1";
const DEFAULT_SERVER = process.env.RD_SERVER_URL ?? "http://localhost:47831";
const assets = path.join(__dirname, "..", "assets");

let mainWindow: BrowserWindow | null = null;
let bannerWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let sleepBlocker: number | null = null;
let consentAbort: AbortController | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

function viewerTarget(): { url?: string; file?: string } {
  if (process.env.VIEWER_URL) return { url: process.env.VIEWER_URL };
  const candidates = [
    path.join(process.resourcesPath ?? "", "viewer", "index.html"),
    path.join(__dirname, "..", "..", "viewer", "dist", "index.html"),
  ];
  const file = candidates.find((c) => fs.existsSync(c));
  if (!file) throw new Error("Viewer build not found. Run `npm run build` first.");
  return { file };
}

function isOwnContent(url: string): boolean {
  const target = viewerTarget();
  if (target.url) return url.startsWith(new URL(target.url).origin);
  return url.startsWith("file://");
}

function fromMainWindow(event: IpcMainEvent | IpcMainInvokeEvent): boolean {
  return mainWindow !== null && event.sender === mainWindow.webContents;
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 760,
    minWidth: 760,
    minHeight: 560,
    title: "RemoteDesk",
    backgroundColor: "#0c0e14",
    icon: path.join(assets, "icon.png"),
    show: !process.argv.includes("--hidden"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  mainWindow.setMenu(null);

  const target = viewerTarget();
  if (target.url) void mainWindow.loadURL(target.url);
  else void mainWindow.loadFile(target.file!);

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isOwnContent(url)) event.preventDefault();
  });
  mainWindow.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
}

function showMainWindow(): void {
  if (!mainWindow) return createMainWindow();
  mainWindow.show();
  mainWindow.focus();
}

function createTray(): void {
  const image = nativeImage.createFromPath(path.join(assets, "tray.png"));
  tray = new Tray(image.resize({ width: 16, height: 16 }));
  tray.setToolTip("RemoteDesk");
  tray.on("click", showMainWindow);
  updateTrayMenu(false);
}

function updateTrayMenu(sessionActive: boolean): void {
  if (!tray) return;
  tray.setToolTip(sessionActive ? "RemoteDesk: someone is controlling this computer" : "RemoteDesk");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open RemoteDesk", click: showMainWindow },
      ...(sessionActive
        ? [{ label: "Disconnect remote session", click: () => mainWindow?.webContents.send("session:disconnect-request") }]
        : []),
      { type: "separator" },
      {
        label: "Start at login",
        type: "checkbox",
        checked: app.getLoginItemSettings().openAtLogin,
        click: (item) => app.setLoginItemSettings({ openAtLogin: item.checked, args: ["--hidden"] }),
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          quitting = true;
          app.quit();
        },
      },
    ]),
  );
}

function showBanner(viewerName: string): void {
  hideBanner();
  const { workArea } = screen.getPrimaryDisplay();
  const width = 460;
  bannerWindow = new BrowserWindow({
    width,
    height: 46,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: workArea.y + 8,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    hasShadow: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "banner-preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  bannerWindow.setAlwaysOnTop(true, "screen-saver");
  const safeName = viewerName.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const html = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<style>
  html,body{margin:0;height:100%;font:13px system-ui,sans-serif;color:#fff;background:#b45309;-webkit-user-select:none;user-select:none}
  body{display:flex;align-items:center;gap:10px;padding:0 10px 0 14px;box-sizing:border-box;border-radius:10px;overflow:hidden}
  .dot{width:9px;height:9px;border-radius:50%;background:#fde68a;flex:none}
  span{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  button{all:unset;cursor:pointer;background:#fff;color:#7c2d12;font-weight:600;padding:6px 12px;border-radius:7px}
  button:hover{background:#fef3c7}
</style>
<div class="dot"></div><span><b>${safeName}</b> is controlling this computer</span>
<button id="d">Disconnect</button>
<script>document.getElementById('d').onclick=()=>window.banner.disconnect()</script>`;
  void bannerWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  bannerWindow.once("ready-to-show", () => bannerWindow?.showInactive());
}

function hideBanner(): void {
  if (bannerWindow && !bannerWindow.isDestroyed()) bannerWindow.destroy();
  bannerWindow = null;
}

const consentInfoSchema = z.object({ viewerName: z.string().max(64), viewerIp: z.string().max(64) });

async function askConsent(raw: unknown): Promise<boolean> {
  const info = consentInfoSchema.parse(raw);
  if (E2E && process.env.RD_E2E_CONSENT_FILE) {
    return fs.readFileSync(process.env.RD_E2E_CONSENT_FILE, "utf8").trim() === "allow";
  }

  consentAbort?.abort();
  const controller = new AbortController();
  consentAbort = controller;
  if (Notification.isSupported()) {
    new Notification({ title: "RemoteDesk connection request", body: `${info.viewerName} wants to control this computer.` }).show();
  }
  try {
    const result = await dialog.showMessageBox({
      type: "question",
      title: "Allow remote control?",
      message: `${info.viewerName} wants to control this computer`,
      detail: `Connection from ${info.viewerIp}. Only allow this if you recognize the device and expected a connection.`,
      buttons: ["Allow", "Deny"],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
      signal: controller.signal,
    });
    return result.response === 0;
  } catch {
    return false;
  } finally {
    if (consentAbort === controller) consentAbort = null;
  }
}

function registerIpc(): void {
  ipcMain.on("app:default-server-url", (event) => {
    event.returnValue = loadConfig().serverUrl ?? DEFAULT_SERVER;
  });
  ipcMain.handle("config:load", (event) => (fromMainWindow(event) ? loadConfig() : null));
  ipcMain.handle("config:save", (event, patch: unknown) => {
    if (!fromMainWindow(event)) return null;
    return saveConfig(z.object({
      deviceId: z.string().optional(),
      hostKey: z.string().optional(),
      password: z.string().optional(),
      unattended: z.boolean().optional(),
      serverUrl: z.string().optional(),
    }).parse(patch));
  });
  ipcMain.handle("screens:list", (event) => (fromMainWindow(event) ? listScreens() : null));
  ipcMain.handle("screens:select", (event, id: unknown) => {
    if (fromMainWindow(event) && typeof id === "string") selectScreen(id);
  });
  ipcMain.on("input:inject", (event, raw: unknown) => {
    if (!fromMainWindow(event)) return;
    const parsed = inputEventSchema.safeParse(raw);
    if (parsed.success) injectInput(parsed.data);
  });
  ipcMain.handle("consent:request", (event, info: unknown) => (fromMainWindow(event) ? askConsent(info) : false));
  ipcMain.on("session:started", (event, info: unknown) => {
    if (!fromMainWindow(event)) return;
    const parsed = z.object({ viewerName: z.string().max(64) }).safeParse(info);
    showBanner(parsed.success ? parsed.data.viewerName : "A viewer");
    updateTrayMenu(true);
    if (sleepBlocker === null) sleepBlocker = powerSaveBlocker.start("prevent-display-sleep");
  });
  ipcMain.on("session:ended", (event) => {
    if (!fromMainWindow(event)) return;
    consentAbort?.abort();
    releaseAllInput();
    hideBanner();
    updateTrayMenu(false);
    if (sleepBlocker !== null) {
      powerSaveBlocker.stop(sleepBlocker);
      sleepBlocker = null;
    }
  });
  ipcMain.on("banner:disconnect", (event) => {
    if (bannerWindow && event.sender === bannerWindow.webContents) mainWindow?.webContents.send("session:disconnect-request");
  });
  ipcMain.handle("clipboard:read", (event) => (fromMainWindow(event) ? clipboard.readText() : ""));
  ipcMain.handle("clipboard:write", (event, text: unknown) => {
    if (fromMainWindow(event) && typeof text === "string" && text.length <= 1_000_000) clipboard.writeText(text);
  });
  ipcMain.handle("file:begin", (event, name: unknown, size: unknown) => {
    if (!fromMainWindow(event)) throw new Error("Not allowed");
    return fileBegin(z.string().max(255).parse(name), z.number().int().min(0).max(MAX_FILE_SIZE).parse(size));
  });
  ipcMain.on("file:chunk", (event, id: unknown, chunk: unknown) => {
    if (!fromMainWindow(event) || typeof id !== "string") return;
    if (ArrayBuffer.isView(chunk)) fileChunk(id, Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength));
    else if (Object.prototype.toString.call(chunk) === "[object ArrayBuffer]") fileChunk(id, Buffer.from(chunk as ArrayBuffer));
  });
  ipcMain.handle("file:end", (event, id: unknown) => {
    if (!fromMainWindow(event) || typeof id !== "string") throw new Error("Not allowed");
    return fileEnd(id);
  });
  ipcMain.on("file:abort", (event, id: unknown) => {
    if (fromMainWindow(event) && typeof id === "string") fileAbort(id);
  });
  ipcMain.handle("permissions:get", (event) => (fromMainWindow(event) ? getPermissions() : null));
  ipcMain.handle("permissions:open", (event, kind: unknown) => {
    if (fromMainWindow(event) && (kind === "screen" || kind === "accessibility")) return openPermissionSettings(kind);
  });
}

function configureSession(): void {
  session.defaultSession.setDisplayMediaRequestHandler(
    async (request, callback) => {
      if (!mainWindow || request.frame?.processId !== mainWindow.webContents.getProcessId()) return callback({});
      const source = await pickCaptureSource();
      if (source) callback({ video: source });
      else callback({});
    },
    { useSystemPicker: false },
  );
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowed = ["clipboard-sanitized-write", "clipboard-read", "display-capture", "fullscreen", "media"];
    callback(webContents === mainWindow?.webContents && allowed.includes(permission));
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    const allowed = ["clipboard-sanitized-write", "clipboard-read", "display-capture", "fullscreen", "media"];
    return webContents === mainWindow?.webContents && allowed.includes(permission);
  });
}

app.on("second-instance", showMainWindow);
app.on("before-quit", () => {
  quitting = true;
});
app.on("window-all-closed", () => {
  /* keep running in the tray so this computer stays reachable */
});
app.on("activate", showMainWindow);

void app.whenReady().then(() => {
  loadConfig();
  loadInputBackend();
  registerIpc();
  configureSession();
  createMainWindow();
  createTray();
});
