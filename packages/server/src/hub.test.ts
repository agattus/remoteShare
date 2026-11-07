import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerMessage } from "@remotedesk/shared";
import { Hub, type Peer } from "./hub";
import { DeviceStore } from "./store";
import { RateLimiter, hashSecret, verifySecret } from "./security";

class FakePeer implements Peer {
  messages: ServerMessage[] = [];
  closed = false;
  constructor(public ip = "10.0.0.1") {}
  send(m: ServerMessage) {
    this.messages.push(m);
  }
  close() {
    this.closed = true;
  }
  last<T extends ServerMessage["type"]>(type: T) {
    return [...this.messages].reverse().find((m) => m.type === type) as Extract<ServerMessage, { type: T }> | undefined;
  }
}

const ice = [{ urls: "stun:example.org" }];
const register = (hub: Hub, peer: FakePeer, password = "secret123") => {
  hub.handle(peer, { type: "host-register", password });
  return peer.last("registered")!;
};
const connect = (hub: Hub, viewer: FakePeer, deviceId: string, password: string) =>
  hub.handle(viewer, { type: "connect", deviceId, password, viewerName: "Tester" });

describe("Hub", () => {
  let hub: Hub;
  beforeEach(() => {
    vi.useFakeTimers();
    hub = new Hub({ store: new DeviceStore(null), iceServers: ice, consentTimeoutMs: 1000 });
  });
  afterEach(() => vi.useRealTimers());

  it("registers a host with a 9 digit id and reclaims it with the host key", () => {
    const host = new FakePeer();
    const reg = register(hub, host);
    expect(reg.deviceId).toMatch(/^\d{9}$/);
    hub.handleClose(host);
    expect(hub.onlineHosts).toBe(0);

    const host2 = new FakePeer();
    hub.handle(host2, { type: "host-register", deviceId: reg.deviceId, hostKey: reg.hostKey, password: "another1" });
    expect(host2.last("registered")?.deviceId).toBe(reg.deviceId);
  });

  it("refuses to claim an id with the wrong host key", () => {
    const reg = register(hub, new FakePeer());
    const thief = new FakePeer();
    hub.handle(thief, { type: "host-register", deviceId: reg.deviceId, hostKey: "x".repeat(32), password: "another1" });
    expect(thief.last("error")?.code).toBe("id-claimed");
  });

  it("runs the full consent and signaling flow", () => {
    const host = new FakePeer();
    const viewer = new FakePeer("10.0.0.2");
    const { deviceId } = register(hub, host);
    connect(hub, viewer, deviceId, "secret123");

    const request = host.last("incoming-request")!;
    expect(request.viewerName).toBe("Tester");
    expect(viewer.last("awaiting-consent")).toBeDefined();

    hub.handle(host, { type: "consent", sessionId: request.sessionId, allow: true });
    expect(host.last("session-accepted")?.role).toBe("host");
    expect(viewer.last("session-accepted")?.role).toBe("viewer");

    hub.handle(host, {
      type: "signal",
      sessionId: request.sessionId,
      data: { kind: "description", description: { type: "offer", sdp: "v=0" } },
    });
    expect(viewer.last("signal")).toBeDefined();

    hub.handleClose(viewer);
    expect(host.last("session-ended")?.reason).toBe("peer-left");
    expect(hub.activeSessions).toBe(0);
  });

  it("rejects wrong passwords, offline devices and a busy device", () => {
    const host = new FakePeer();
    const { deviceId } = register(hub, host);

    const v1 = new FakePeer("10.0.0.3");
    connect(hub, v1, deviceId, "wrong-password");
    expect(v1.last("error")?.code).toBe("invalid-credentials");

    const v2 = new FakePeer("10.0.0.4");
    connect(hub, v2, "123456789", "secret123");
    expect(v2.last("error")?.code).toBe("device-offline");

    const v3 = new FakePeer("10.0.0.5");
    connect(hub, v3, deviceId, "secret123");
    const v4 = new FakePeer("10.0.0.6");
    connect(hub, v4, deviceId, "secret123");
    expect(v4.last("error")?.code).toBe("device-busy");
  });

  it("notifies the viewer when consent is denied or times out", () => {
    const host = new FakePeer();
    const { deviceId } = register(hub, host);

    const v1 = new FakePeer("10.0.0.7");
    connect(hub, v1, deviceId, "secret123");
    hub.handle(host, { type: "consent", sessionId: host.last("incoming-request")!.sessionId, allow: false });
    expect(v1.last("session-denied")?.reason).toBe("denied");

    const v2 = new FakePeer("10.0.0.8");
    connect(hub, v2, deviceId, "secret123");
    vi.advanceTimersByTime(1500);
    expect(v2.last("session-denied")?.reason).toBe("timeout");
    expect(hub.activeSessions).toBe(0);
  });

  it("locks a device after repeated failures", () => {
    const host = new FakePeer();
    const { deviceId } = register(hub, host);
    for (let i = 0; i < 5; i++) connect(hub, new FakePeer(`10.1.0.${i}`), deviceId, "nope-nope");
    const attacker = new FakePeer("10.1.1.1");
    connect(hub, attacker, deviceId, "secret123");
    expect(attacker.last("error")?.code).toBe("rate-limited");
  });

  it("does not relay signals from outsiders", () => {
    const host = new FakePeer();
    const viewer = new FakePeer("10.0.0.2");
    const outsider = new FakePeer("10.0.0.9");
    const { deviceId } = register(hub, host);
    connect(hub, viewer, deviceId, "secret123");
    const { sessionId } = host.last("incoming-request")!;
    hub.handle(host, { type: "consent", sessionId, allow: true });
    hub.handle(outsider, {
      type: "signal",
      sessionId,
      data: { kind: "candidate", candidate: null },
    });
    expect(host.messages.filter((m) => m.type === "signal")).toHaveLength(0);
    expect(viewer.messages.filter((m) => m.type === "signal")).toHaveLength(0);
  });
});

describe("security", () => {
  it("hashes and verifies secrets", () => {
    const stored = hashSecret("hunter22");
    expect(verifySecret("hunter22", stored)).toBe(true);
    expect(verifySecret("hunter23", stored)).toBe(false);
  });

  it("rate limiter locks and expires", () => {
    let now = 0;
    const rl = new RateLimiter({ maxFailures: 2, windowMs: 1000, lockMs: 5000, now: () => now });
    rl.fail("a");
    expect(rl.check("a").allowed).toBe(true);
    rl.fail("a");
    expect(rl.check("a").allowed).toBe(false);
    now = 6000;
    expect(rl.check("a").allowed).toBe(true);
  });
});
