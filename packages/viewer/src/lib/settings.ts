import { useSyncExternalStore } from "react";

const SERVER_KEY = "remotedesk.serverUrl";
const RECENT_KEY = "remotedesk.recent";
const NAME_KEY = "remotedesk.viewerName";
const DEFAULT_DESKTOP_SERVER = "http://localhost:47831";

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

export function getServerUrl(): string {
  const saved = read(SERVER_KEY);
  if (saved) return saved;
  if (window.desktop?.defaultServerUrl) return window.desktop.defaultServerUrl;
  if (location.protocol === "http:" || location.protocol === "https:") return location.origin;
  return DEFAULT_DESKTOP_SERVER;
}

export function setServerUrl(url: string) {
  write(SERVER_KEY, url.trim().replace(/\/+$/, ""));
  emit();
}

export function toWebSocketUrl(serverUrl: string): string {
  const url = new URL(serverUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = "";
  return url.toString();
}

export function isValidServerUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function useServerUrl(): string {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    getServerUrl,
  );
}

export function getRecentDevices(): string[] {
  try {
    const parsed = JSON.parse(read(RECENT_KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === "string").slice(0, 5) : [];
  } catch {
    return [];
  }
}

export function rememberDevice(id: string) {
  const next = [id, ...getRecentDevices().filter((x) => x !== id)].slice(0, 5);
  write(RECENT_KEY, JSON.stringify(next));
}

export function forgetDevice(id: string) {
  write(RECENT_KEY, JSON.stringify(getRecentDevices().filter((x) => x !== id)));
}

export function getViewerName(): string {
  const saved = read(NAME_KEY);
  if (saved) return saved;
  const platform = navigator.platform || "Browser";
  return window.desktop ? `${platform} (app)` : `${platform} (browser)`;
}

export function setViewerName(name: string) {
  write(NAME_KEY, name.trim());
}
