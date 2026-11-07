import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IceServer } from "@remotedesk/shared";

const here = path.dirname(fileURLToPath(import.meta.url));

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  viewerDir: string;
  trustProxy: boolean;
  consentTimeoutMs: number;
  iceServers: IceServer[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const iceServers: IceServer[] = [
    { urls: (env.STUN_URLS ?? "stun:stun.l.google.com:19302").split(",").map((s) => s.trim()).filter(Boolean) },
  ];
  if (env.TURN_URL) {
    iceServers.push({
      urls: env.TURN_URL.split(",").map((s) => s.trim()).filter(Boolean),
      username: env.TURN_USER,
      credential: env.TURN_PASS,
    });
  }
  return {
    port: Number(env.PORT ?? 47831),
    host: env.HOST ?? "0.0.0.0",
    dataDir: path.resolve(env.DATA_DIR ?? path.join(here, "..", "data")),
    viewerDir: path.resolve(env.VIEWER_DIR ?? path.join(here, "..", "..", "viewer", "dist")),
    trustProxy: env.TRUST_PROXY === "1" || env.TRUST_PROXY === "true",
    consentTimeoutMs: Number(env.CONSENT_TIMEOUT_MS ?? 30_000),
    iceServers,
  };
}
