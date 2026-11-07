import fs from "node:fs";
import path from "node:path";
import Fastify from "fastify";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import type { WebSocket } from "ws";
import type { ServerMessage } from "@remotedesk/shared";
import { loadConfig } from "./config";
import { Hub, type Peer } from "./hub";
import { DeviceStore } from "./store";

const config = loadConfig();
const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" }, trustProxy: config.trustProxy });
const hub = new Hub({
  store: new DeviceStore(path.join(config.dataDir, "devices.json")),
  iceServers: config.iceServers,
  consentTimeoutMs: config.consentTimeoutMs,
});

await app.register(websocket, { options: { maxPayload: 256 * 1024 } });

const csp = [
  "default-src 'self'",
  "connect-src 'self' ws: wss: http: https:",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "frame-ancestors 'none'",
].join("; ");

app.addHook("onSend", async (_req, reply) => {
  reply.header("X-Content-Type-Options", "nosniff");
  reply.header("Referrer-Policy", "no-referrer");
  reply.header("X-Frame-Options", "DENY");
  reply.header("Content-Security-Policy", csp);
});

app.get("/api/health", async () => ({ ok: true, hosts: hub.onlineHosts, sessions: hub.activeSessions }));

app.get("/ws", { websocket: true }, (socket: WebSocket, request) => {
  const peer: Peer = {
    ip: request.ip,
    send: (message: ServerMessage) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
    },
    close: () => socket.close(),
  };
  hub.attach(peer);

  let alive = true;
  socket.on("pong", () => {
    alive = true;
  });
  const heartbeat = setInterval(() => {
    if (!alive) return socket.terminate();
    alive = false;
    socket.ping();
  }, 30_000);

  socket.on("message", (data) => hub.handleRaw(peer, data.toString()));
  socket.on("close", () => {
    clearInterval(heartbeat);
    hub.handleClose(peer);
  });
  socket.on("error", () => socket.terminate());
});

if (fs.existsSync(config.viewerDir)) {
  await app.register(fastifyStatic, { root: config.viewerDir });
  app.setNotFoundHandler((req, reply) => {
    if (req.method === "GET" && !req.url.startsWith("/api") && !req.url.startsWith("/ws")) {
      return reply.sendFile("index.html");
    }
    return reply.code(404).send({ error: "Not found" });
  });
} else {
  app.log.warn(`Viewer build not found at ${config.viewerDir}; run "npm run build" or use the Vite dev server.`);
}

const shutdown = async () => {
  await app.close();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await app.listen({ port: config.port, host: config.host });
