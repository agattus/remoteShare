import {
  FILE_CHUNK_SIZE,
  MAX_FILE_SIZE,
  fileMessageSchema,
  hostControlSchema,
  normalizeDeviceId,
  type ErrorCode,
  type IceServer,
  type InputEvent,
  type QualityPreset,
  type ScreenInfo,
  type ServerMessage,
  type SignalData,
  type ViewerControl,
} from "@remotedesk/shared";
import { SignalingClient } from "./signaling";
import { Store } from "./store";
import { getServerUrl, getViewerName, rememberDevice, toWebSocketUrl } from "./settings";

export type EndReason = "denied" | "timeout" | "host-offline" | "peer-left" | "ended" | "connection-lost";

export type ViewerState =
  | { status: "idle" }
  | { status: "signaling" }
  | { status: "awaiting-consent" }
  | { status: "negotiating" }
  | { status: "connected" }
  | { status: "ended"; reason: EndReason }
  | { status: "error"; code: ErrorCode | "network"; message: string; retryAfterSec?: number };

export interface ViewerSnapshot {
  state: ViewerState;
  stream: MediaStream | null;
  unstable: boolean;
  screens: ScreenInfo[];
  selectedScreen: string | null;
  quality: QualityPreset;
  stats: { rttMs?: number; fps?: number; kbps?: number };
  inputDisabledReason: string | null;
  transfer: { name: string; progress: number; status: "sending" | "done" | "error"; message?: string } | null;
}

const initial: ViewerSnapshot = {
  state: { status: "idle" },
  stream: null,
  unstable: false,
  screens: [],
  selectedScreen: null,
  quality: "balanced",
  stats: {},
  inputDisabledReason: null,
  transfer: null,
};

export class ViewerSession {
  readonly store = new Store<ViewerSnapshot>(initial);
  private signaling = new SignalingClient();
  private pc: RTCPeerConnection | null = null;
  private control: RTCDataChannel | null = null;
  private files: RTCDataChannel | null = null;
  private sessionId: string | null = null;
  private signalQueue: Promise<void> = Promise.resolve();
  private statsTimer: ReturnType<typeof setInterval> | null = null;
  private lastBytes = 0;
  private lastStatsAt = 0;
  private clipboardWaiters: Array<(text: string) => void> = [];
  private disposed = false;
  private finished = false;

  async connect(deviceIdInput: string, password: string): Promise<void> {
    this.reset();
    const deviceId = normalizeDeviceId(deviceIdInput);
    this.store.set({ state: { status: "signaling" } });

    this.signaling.onMessage = (m) => this.onServerMessage(m);
    this.signaling.onClose = () => {
      if (this.finished || this.disposed) return;
      this.fail({ status: "error", code: "network", message: "Lost connection to the server" });
    };

    try {
      await this.signaling.connect(toWebSocketUrl(getServerUrl()));
    } catch (err) {
      this.fail({
        status: "error",
        code: "network",
        message: err instanceof Error ? err.message : "Could not reach the server",
      });
      return;
    }
    rememberDevice(deviceId);
    this.signaling.send({ type: "connect", deviceId, password, viewerName: getViewerName() });
  }

  disconnect(): void {
    if (this.sessionId) this.signaling.send({ type: "end", sessionId: this.sessionId });
    const status = this.store.get().state.status;
    this.teardown();
    this.store.set({ state: status === "connected" || status === "negotiating" ? { status: "ended", reason: "ended" } : { status: "idle" }, stream: null });
  }

  dispose(): void {
    this.disposed = true;
    this.teardown();
  }

  reset(): void {
    this.teardown();
    this.finished = false;
    this.store.set({ ...initial });
  }

  sendInput(event: InputEvent): void {
    if (this.control?.readyState === "open") this.control.send(JSON.stringify(event));
  }

  private sendControl(message: ViewerControl): void {
    if (this.control?.readyState === "open") this.control.send(JSON.stringify(message));
  }

  selectScreen(id: string): void {
    this.sendControl({ t: "select-screen", id });
  }

  setQuality(preset: QualityPreset): void {
    this.store.set({ quality: preset });
    this.sendControl({ t: "set-quality", preset });
  }

  pasteToRemote(text: string): void {
    this.sendControl({ t: "clipboard-set", text });
  }

  copyFromRemote(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.control?.readyState !== "open") return reject(new Error("Not connected"));
      const timer = setTimeout(() => reject(new Error("The remote device did not respond")), 5000);
      this.clipboardWaiters.push((text) => {
        clearTimeout(timer);
        resolve(text);
      });
      this.sendControl({ t: "clipboard-get" });
    });
  }

  async sendFile(file: File): Promise<void> {
    const channel = this.files;
    if (!channel || channel.readyState !== "open") {
      this.store.set({ transfer: { name: file.name, progress: 0, status: "error", message: "Not connected" } });
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      this.store.set({ transfer: { name: file.name, progress: 0, status: "error", message: "File is larger than 200 MB" } });
      return;
    }
    this.store.set({ transfer: { name: file.name, progress: 0, status: "sending" } });
    channel.bufferedAmountLowThreshold = 1 << 20;
    channel.send(JSON.stringify({ t: "file-start", name: file.name, size: file.size }));
    try {
      for (let offset = 0; offset < file.size; offset += FILE_CHUNK_SIZE) {
        if (channel.readyState !== "open") throw new Error("Connection closed during transfer");
        if (channel.bufferedAmount > 4 << 20) {
          await new Promise<void>((resolve) => {
            channel.onbufferedamountlow = () => {
              channel.onbufferedamountlow = null;
              resolve();
            };
          });
        }
        const chunk = await file.slice(offset, offset + FILE_CHUNK_SIZE).arrayBuffer();
        channel.send(chunk);
        this.store.set({ transfer: { name: file.name, progress: Math.min(1, (offset + chunk.byteLength) / file.size), status: "sending" } });
      }
      channel.send(JSON.stringify({ t: "file-end" }));
    } catch (err) {
      this.store.set({
        transfer: { name: file.name, progress: 0, status: "error", message: err instanceof Error ? err.message : "Transfer failed" },
      });
    }
  }

  clearTransfer(): void {
    this.store.set({ transfer: null });
  }

  private onServerMessage(m: ServerMessage): void {
    switch (m.type) {
      case "error":
        this.fail({ status: "error", code: m.code, message: m.message, retryAfterSec: m.retryAfterSec });
        break;
      case "awaiting-consent":
        this.sessionId = m.sessionId;
        this.store.set({ state: { status: "awaiting-consent" } });
        break;
      case "session-denied":
        this.finish({ status: "ended", reason: m.reason });
        break;
      case "session-accepted":
        this.store.set({ state: { status: "negotiating" } });
        this.startPeer(m.iceServers);
        break;
      case "signal":
        if (m.sessionId === this.sessionId) this.enqueueSignal(m.data);
        break;
      case "session-ended":
        if (m.sessionId === this.sessionId) this.finish({ status: "ended", reason: m.reason });
        break;
    }
  }

  private startPeer(iceServers: IceServer[]): void {
    const pc = new RTCPeerConnection({ iceServers });
    this.pc = pc;
    const stream = new MediaStream();

    pc.ontrack = (event) => {
      stream.addTrack(event.track);
      this.store.set({ stream });
    };
    pc.onicecandidate = (event) => {
      if (!this.sessionId) return;
      this.signaling.send({
        type: "signal",
        sessionId: this.sessionId,
        data: { kind: "candidate", candidate: event.candidate ? event.candidate.toJSON() : null },
      });
    };
    pc.ondatachannel = (event) => {
      if (event.channel.label === "control") this.setupControl(event.channel);
      if (event.channel.label === "files") this.setupFiles(event.channel);
    };
    pc.onconnectionstatechange = () => {
      if (pc !== this.pc) return;
      const connection = pc.connectionState;
      if (connection === "connected") {
        this.store.set({ state: { status: "connected" }, unstable: false });
        this.startStats();
      } else if (connection === "disconnected") {
        this.store.set({ unstable: true });
      } else if (connection === "failed" || connection === "closed") {
        if (!this.finished) this.finish({ status: "ended", reason: "connection-lost" });
      }
    };
  }

  private setupControl(channel: RTCDataChannel): void {
    this.control = channel;
    channel.onopen = () => {
      this.sendControl({ t: "list-screens" });
      this.sendControl({ t: "set-quality", preset: this.store.get().quality });
    };
    channel.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch {
        return;
      }
      const result = hostControlSchema.safeParse(parsed);
      if (!result.success) return;
      const msg = result.data;
      if (msg.t === "screens") this.store.set({ screens: msg.screens, selectedScreen: msg.selected });
      else if (msg.t === "clipboard") this.clipboardWaiters.splice(0).forEach((resolve) => resolve(msg.text));
      else if (msg.t === "input-disabled") this.store.set({ inputDisabledReason: msg.reason });
    };
  }

  private setupFiles(channel: RTCDataChannel): void {
    this.files = channel;
    channel.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      try {
        const result = fileMessageSchema.safeParse(JSON.parse(event.data));
        if (!result.success) return;
        const current = this.store.get().transfer;
        if (result.data.t === "file-saved") {
          this.store.set({ transfer: { name: result.data.name, progress: 1, status: "done" } });
        } else if (result.data.t === "file-error") {
          this.store.set({ transfer: { name: current?.name ?? "file", progress: 0, status: "error", message: result.data.message } });
        }
      } catch {
        /* ignore */
      }
    };
  }

  private enqueueSignal(data: SignalData): void {
    this.signalQueue = this.signalQueue.then(async () => {
      const pc = this.pc;
      if (!pc) return;
      try {
        if (data.kind === "description") {
          await pc.setRemoteDescription(data.description);
          if (data.description.type === "offer") {
            await pc.setLocalDescription();
            if (this.sessionId && pc.localDescription) {
              this.signaling.send({
                type: "signal",
                sessionId: this.sessionId,
                data: {
                  kind: "description",
                  description: { type: "answer", sdp: pc.localDescription.sdp },
                },
              });
            }
          }
        } else if (data.candidate) {
          await pc.addIceCandidate(data.candidate);
        } else {
          await pc.addIceCandidate();
        }
      } catch (err) {
        console.warn("Signal handling failed", err);
      }
    });
  }

  private startStats(): void {
    if (this.statsTimer) return;
    this.statsTimer = setInterval(async () => {
      const pc = this.pc;
      if (!pc) return;
      try {
        const report = await pc.getStats();
        let rttMs: number | undefined;
        let fps: number | undefined;
        let bytes = 0;
        report.forEach((entry) => {
          if (entry.type === "candidate-pair" && entry.state === "succeeded" && entry.nominated && typeof entry.currentRoundTripTime === "number") {
            rttMs = Math.round(entry.currentRoundTripTime * 1000);
          }
          if (entry.type === "inbound-rtp" && entry.kind === "video") {
            fps = entry.framesPerSecond;
            bytes = entry.bytesReceived;
          }
        });
        const now = performance.now();
        const kbps = this.lastStatsAt ? Math.round(((bytes - this.lastBytes) * 8) / (now - this.lastStatsAt)) : undefined;
        this.lastBytes = bytes;
        this.lastStatsAt = now;
        this.store.set({ stats: { rttMs, fps: fps !== undefined ? Math.round(fps) : undefined, kbps } });
      } catch {
        /* stats are best effort */
      }
    }, 2000);
  }

  private fail(state: Extract<ViewerState, { status: "error" }>): void {
    this.finished = true;
    this.teardown();
    this.store.set({ state });
  }

  private finish(state: Extract<ViewerState, { status: "ended" }>): void {
    this.finished = true;
    this.teardown();
    this.store.set({ state, stream: null });
  }

  private teardown(): void {
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = null;
    this.lastStatsAt = 0;
    this.control?.close();
    this.files?.close();
    this.pc?.close();
    this.control = null;
    this.files = null;
    this.pc = null;
    this.sessionId = null;
    this.clipboardWaiters = [];
    this.signalQueue = Promise.resolve();
    this.signaling.close();
  }
}
