import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { app } from "electron";

export interface HostConfig {
  deviceId?: string;
  hostKey?: string;
  password: string;
  unattended: boolean;
  serverUrl?: string;
}

const PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomPassword(length = 10): string {
  return Array.from(crypto.randomBytes(length), (b) => PASSWORD_ALPHABET[b % PASSWORD_ALPHABET.length]).join("");
}

let cached: HostConfig | null = null;

function file(): string {
  return path.join(app.getPath("userData"), "config.json");
}

export function loadConfig(): HostConfig {
  if (cached) return cached;
  let stored: Partial<HostConfig> = {};
  try {
    stored = JSON.parse(fs.readFileSync(file(), "utf8")) as Partial<HostConfig>;
  } catch {
    /* first run */
  }
  cached = {
    deviceId: stored.deviceId,
    hostKey: stored.hostKey,
    password: typeof stored.password === "string" && stored.password.length >= 6 ? stored.password : randomPassword(),
    unattended: stored.unattended === true,
    serverUrl: stored.serverUrl,
  };
  persist(cached);
  return cached;
}

export function saveConfig(patch: Partial<HostConfig>): HostConfig {
  const current = loadConfig();
  const next: HostConfig = { ...current };
  for (const key of ["deviceId", "hostKey", "serverUrl"] as const) {
    if (key in patch) next[key] = patch[key] || undefined;
  }
  if (typeof patch.password === "string" && patch.password.length >= 6 && patch.password.length <= 64) next.password = patch.password;
  if (typeof patch.unattended === "boolean") next.unattended = patch.unattended;
  cached = next;
  persist(next);
  return next;
}

function persist(config: HostConfig): void {
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(config, null, 2), { mode: 0o600 });
}
