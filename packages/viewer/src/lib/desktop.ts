import type { InputEvent, ScreenInfo } from "@remotedesk/shared";

export interface HostConfig {
  deviceId?: string;
  hostKey?: string;
  password: string;
  unattended: boolean;
  serverUrl?: string;
}

export interface PermissionStatus {
  platform: string;
  screen: "granted" | "denied" | "not-determined" | "restricted" | "unknown";
  accessibility: boolean;
  inputAvailable: boolean;
  sessionType?: string;
}

/** API exposed by the Electron preload script. Undefined when running in a normal browser. */
export interface DesktopBridge {
  platform: string;
  defaultServerUrl: string | null;
  loadConfig(): Promise<HostConfig>;
  saveConfig(patch: Partial<HostConfig>): Promise<HostConfig>;
  listScreens(): Promise<{ screens: ScreenInfo[]; selected: string }>;
  selectScreen(id: string): Promise<void>;
  injectInput(event: InputEvent): void;
  requestConsent(info: { viewerName: string; viewerIp: string; sameNetwork?: boolean }): Promise<boolean>;
  sessionStarted(info: { viewerName: string }): void;
  sessionEnded(): void;
  onDisconnectRequest(callback: () => void): () => void;
  readClipboard(): Promise<string>;
  writeClipboard(text: string): Promise<void>;
  fileBegin(name: string, size: number): Promise<string>;
  fileChunk(id: string, chunk: ArrayBuffer): void;
  fileEnd(id: string): Promise<string>;
  fileAbort(id: string): void;
  getPermissions(): Promise<PermissionStatus>;
  openPermissionSettings(kind: "screen" | "accessibility"): Promise<void>;
}

declare global {
  interface Window {
    desktop?: DesktopBridge;
  }
}

export const desktop = (): DesktopBridge | undefined => window.desktop;
export const isDesktopApp = (): boolean => window.desktop !== undefined;
