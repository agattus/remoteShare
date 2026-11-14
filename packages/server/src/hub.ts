import {
  clientMessageSchema,
  type ClientMessage,
  type ErrorCode,
  type IceServer,
  type ServerMessage,
} from "@remotedesk/shared";
import { hashSecret, RateLimiter, randomDeviceId, randomToken, sha256, verifySecret } from "./security";
import type { DeviceStore } from "./store";

export interface Peer {
  ip: string;
  send(message: ServerMessage): void;
  close(): void;
}

interface PeerState {
  role?: "host" | "viewer";
  deviceId?: string;
  sessionId?: string;
}

interface Device {
  id: string;
  peer: Peer;
  passwordHash: string;
}

interface Session {
  id: string;
  deviceId: string;
  host: Peer;
  viewer: Peer;
  state: "pending" | "active";
  timer?: NodeJS.Timeout;
}

export interface HubOptions {
  store: DeviceStore;
  iceServers: IceServer[];
  consentTimeoutMs: number;
  idLimiter?: RateLimiter;
  ipLimiter?: RateLimiter;
}

export class Hub {
  private devices = new Map<string, Device>();
  private sessions = new Map<string, Session>();
  private peers = new Map<Peer, PeerState>();
  private idLimiter: RateLimiter;
  private ipLimiter: RateLimiter;

  constructor(private opts: HubOptions) {
    this.idLimiter =
      opts.idLimiter ?? new RateLimiter({ maxFailures: 5, windowMs: 10 * 60_000, lockMs: 10 * 60_000 });
    this.ipLimiter =
      opts.ipLimiter ?? new RateLimiter({ maxFailures: 20, windowMs: 10 * 60_000, lockMs: 10 * 60_000 });
  }

  get onlineHosts(): number {
    return this.devices.size;
  }

  get activeSessions(): number {
    return this.sessions.size;
  }

  attach(peer: Peer): void {
    this.peers.set(peer, {});
  }

  handleRaw(peer: Peer, raw: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return this.error(peer, "bad-request", "Malformed message");
    }
    const result = clientMessageSchema.safeParse(parsed);
    if (!result.success) {
      return this.error(peer, "bad-request", result.error.issues[0]?.message ?? "Invalid message");
    }
    this.handle(peer, result.data);
  }

  handle(peer: Peer, msg: ClientMessage): void {
    if (!this.peers.has(peer)) this.attach(peer);
    switch (msg.type) {
      case "host-register":
        return this.hostRegister(peer, msg);
      case "host-set-password":
        return this.hostSetPassword(peer, msg.password);
      case "connect":
        return this.connect(peer, msg);
      case "consent":
        return this.consent(peer, msg.sessionId, msg.allow);
      case "signal":
        return this.signal(peer, msg);
      case "end":
        return this.end(peer, msg.sessionId, "ended");
    }
  }

  handleClose(peer: Peer): void {
    const state = this.peers.get(peer);
    if (!state) return;
    for (const session of [...this.sessions.values()]) {
      if (session.host === peer) this.dropSession(session, session.viewer, "host-offline");
      else if (session.viewer === peer) this.dropSession(session, session.host, "peer-left");
    }
    if (state.role === "host" && state.deviceId) {
      const device = this.devices.get(state.deviceId);
      if (device?.peer === peer) this.devices.delete(state.deviceId);
    }
    this.peers.delete(peer);
  }

  private error(peer: Peer, code: ErrorCode, message: string, retryAfterSec?: number): void {
    peer.send({ type: "error", code, message, ...(retryAfterSec ? { retryAfterSec } : {}) });
  }

  private hostRegister(peer: Peer, msg: Extract<ClientMessage, { type: "host-register" }>): void {
    const state = this.peers.get(peer)!;
    if (state.role === "viewer") return this.error(peer, "bad-request", "This connection is already a viewer");
    if (state.role === "host") return this.error(peer, "bad-request", "Already registered");

    let id = msg.deviceId;
    let hostKey = msg.hostKey;
    const stored = id ? this.opts.store.get(id) : undefined;

    if (id && hostKey) {
      if (stored && stored !== sha256(hostKey)) {
        return this.error(peer, "id-claimed", "This device ID belongs to another machine");
      }
      if (!stored) this.opts.store.set(id, sha256(hostKey));
      const existing = this.devices.get(id);
      if (existing && existing.peer !== peer) {
        this.handleClose(existing.peer);
        existing.peer.close();
      }
    } else {
      do {
        id = randomDeviceId();
      } while (this.opts.store.has(id) || this.devices.has(id));
      hostKey = randomToken(32);
      this.opts.store.set(id, sha256(hostKey));
    }

    state.role = "host";
    state.deviceId = id;
    this.devices.set(id!, { id: id!, peer, passwordHash: hashSecret(msg.password) });
    peer.send({ type: "registered", deviceId: id!, hostKey: hostKey!, iceServers: this.opts.iceServers });
  }

  private hostSetPassword(peer: Peer, password: string): void {
    const state = this.peers.get(peer)!;
    const device = state.deviceId ? this.devices.get(state.deviceId) : undefined;
    if (state.role !== "host" || !device) return this.error(peer, "not-registered", "Register first");
    device.passwordHash = hashSecret(password);
  }

  private connect(peer: Peer, msg: Extract<ClientMessage, { type: "connect" }>): void {
    const state = this.peers.get(peer)!;
    if (state.role === "host") return this.error(peer, "bad-request", "Hosts cannot connect to other devices");
    if (state.sessionId) return this.error(peer, "bad-request", "A session is already in progress");
    if (msg.fromDeviceId && msg.fromDeviceId === msg.deviceId) {
      return this.error(peer, "self-connect", "That is this computer's own Device ID. Enter the ID of the other computer.");
    }
    state.role = "viewer";

    const ipLock = this.ipLimiter.check(peer.ip);
    if (!ipLock.allowed) {
      return this.error(peer, "rate-limited", "Too many failed attempts. Try again later.", ipLock.retryAfterSec);
    }
    const idLock = this.idLimiter.check(msg.deviceId);
    if (!idLock.allowed) {
      return this.error(peer, "rate-limited", "Too many failed attempts for this device. Try again later.", idLock.retryAfterSec);
    }

    const device = this.devices.get(msg.deviceId);
    if (!device) {
      this.ipLimiter.fail(peer.ip);
      return this.error(peer, "device-offline", "That device is offline or the ID does not exist");
    }
    if (!verifySecret(msg.password, device.passwordHash)) {
      this.ipLimiter.fail(peer.ip);
      this.idLimiter.fail(msg.deviceId);
      return this.error(peer, "invalid-credentials", "Incorrect password");
    }
    this.idLimiter.reset(msg.deviceId);

    const busy = [...this.sessions.values()].some((s) => s.deviceId === device.id);
    if (busy) return this.error(peer, "device-busy", "That device already has a remote session");

    const session: Session = {
      id: randomToken(16),
      deviceId: device.id,
      host: device.peer,
      viewer: peer,
      state: "pending",
    };
    session.timer = setTimeout(() => {
      if (session.state !== "pending") return;
      session.viewer.send({ type: "session-denied", sessionId: session.id, reason: "timeout" });
      this.dropSession(session, session.host, "ended");
    }, this.opts.consentTimeoutMs);
    session.timer.unref?.();

    this.sessions.set(session.id, session);
    state.sessionId = session.id;
    this.peers.get(device.peer)!.sessionId = session.id;
    device.peer.send({ type: "incoming-request", sessionId: session.id, viewerName: msg.viewerName,
      viewerIp: peer.ip,
      sameNetwork: peer.ip === device.peer.ip,
    });
    peer.send({ type: "awaiting-consent", sessionId: session.id });
  }

  private consent(peer: Peer, sessionId: string, allow: boolean): void {
    const session = this.sessions.get(sessionId);
    if (!session || session.host !== peer || session.state !== "pending") return;
    if (!allow) {
      session.viewer.send({ type: "session-denied", sessionId, reason: "denied" });
      this.dropSession(session, null, "ended");
      return;
    }
    clearTimeout(session.timer);
    session.state = "active";
    session.host.send({ type: "session-accepted", sessionId, role: "host", iceServers: this.opts.iceServers });
    session.viewer.send({ type: "session-accepted", sessionId, role: "viewer", iceServers: this.opts.iceServers });
  }

  private signal(peer: Peer, msg: Extract<ClientMessage, { type: "signal" }>): void {
    const session = this.sessions.get(msg.sessionId);
    if (!session || session.state !== "active") return;
    const target = session.host === peer ? session.viewer : session.viewer === peer ? session.host : null;
    target?.send({ type: "signal", sessionId: session.id, data: msg.data });
  }

  private end(peer: Peer, sessionId: string, reason: "ended"): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    if (session.host !== peer && session.viewer !== peer) return;
    const other = session.host === peer ? session.viewer : session.host;
    this.dropSession(session, other, session.state === "pending" ? "peer-left" : reason);
  }

  private dropSession(session: Session, notify: Peer | null, reason: "peer-left" | "ended" | "host-offline"): void {
    clearTimeout(session.timer);
    this.sessions.delete(session.id);
    for (const p of [session.host, session.viewer]) {
      const st = this.peers.get(p);
      if (st?.sessionId === session.id) st.sessionId = undefined;
    }
    notify?.send({ type: "session-ended", sessionId: session.id, reason });
  }
}
