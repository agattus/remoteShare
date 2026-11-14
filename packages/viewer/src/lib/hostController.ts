import {
  QUALITY_PRESETS,
  fileMessageSchema,
  inputEventSchema,
  viewerControlSchema,
  type HostControl,
  type IceServer,
  type ServerMessage,
  type SignalData,
} from "@remotedesk/shared";
import { desktop, type HostConfig } from "./desktop";
import { SignalingClient } from "./signaling";
import { Store } from "./store";
import { getServerUrl, toWebSocketUrl } from "./settings";

export interface HostSnapshot {
  status: "offline" | "connecting" | "online" | "error";
  error?: string;
  config: HostConfig | null;
  session: { id: string; viewerName: string; phase: "pending" | "connected" } | null;
  screens: { id: string; name: string; width: number; height: number; primary: boolean }[];
  selectedScreen: string | null;
}

const ICE_FALLBACK: IceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

export function generatePassword(length = 10): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

export class HostController {
  readonly store = new Store<HostSnapshot>({
    status: "offline",
    config: null,
    session: null,
    screens: [],
    selectedScreen: null,
  });

  private signaling = new SignalingClient();
  private running = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private attempt = 0;
  private iceServers: IceServer[] = ICE_FALLBACK;
  private pc: RTCPeerConnection | null = null;
  private control: RTCDataChannel | null = null;
  private stream: MediaStream | null = null;
  private signalQueue: Promise<void> = Promise.resolve();
  private sessionId: string | null = null;
  private transferId: string | null = null;
  private fileQueue: Promise<void> = Promise.resolve();
  private unsubscribeDisconnect: (() => void) | null = null;

  async start(): Promise<void> {
    const bridge = desktop();
    if (!bridge || this.running) return;
    this.running = true;
    const config = await bridge.loadConfig();
    this.store.set({ config });
    await this.refreshScreens();
    this.unsubscribeDisconnect = bridge.onDisconnectRequest(() => this.endSession());
    void this.connect();
  }

  stop(): void {
    this.running = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.unsubscribeDisconnect?.();
    this.endSession();
    this.signaling.close();
    this.store.set({ status: "offline" });
  }

  restart(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.endSession();
    this.signaling.close();
    this.attempt = 0;
    if (this.running) void this.connect();
  }

  async updateConfig(patch: Partial<HostConfig>): Promise<void> {
    const bridge = desktop();
    if (!bridge) return;
    const config = await bridge.saveConfig(patch);
    this.store.set({ config });
    if (patch.password && this.signaling.isOpen) {
      this.signaling.send({ type: "host-set-password", password: patch.password });
    }
  }

  async chooseScreen(id: string): Promise<void> {
    const bridge = desktop();
    if (!bridge) return;
    await bridge.selectScreen(id);
    await this.refreshScreens();
    if (this.pc && this.stream) await this.swapCapture();
  }

  async refreshScreens(): Promise<void> {
    const bridge = desktop();
    if (!bridge) return;
    const { screens, selected } = await bridge.listScreens();
    this.store.set({ screens, selectedScreen: selected });
  }

  endSession(): void {
    if (this.sessionId) this.signaling.send({ type: "end", sessionId: this.sessionId });
    this.closePeer();
  }

  private async connect(): Promise<void> {
    if (!this.running) return;
    const bridge = desktop()!;
    const config = this.store.get().config ?? (await bridge.loadConfig());
    this.store.set({ status: "connecting", error: undefined });
    this.signaling.onMessage = (m) => void this.onMessage(m);
    this.signaling.onClose = () => {
      this.closePeer();
      if (!this.running) return;
      this.store.set({ status: "connecting" });
      this.scheduleReconnect();
    };
    try {
      await this.signaling.connect(toWebSocketUrl(config.serverUrl || getServerUrl()));
    } catch (err) {
      this.store.set({ status: "error", error: err instanceof Error ? err.message : "Could not reach the server" });
      this.scheduleReconnect();
      return;
    }
    this.attempt = 0;
    this.signaling.send({
      type: "host-register",
      deviceId: config.deviceId,
      hostKey: config.hostKey,
      password: config.password,
    });
  }

  private scheduleReconnect(): void {
    if (!this.running || this.reconnectTimer) return;
    const delay = Math.min(30_000, 1000 * 2 ** this.attempt++);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
  }

  private async onMessage(m: ServerMessage): Promise<void> {
    const bridge = desktop()!;
    switch (m.type) {
      case "registered": {
        this.iceServers = m.iceServers;
        const config = await bridge.saveConfig({ deviceId: m.deviceId, hostKey: m.hostKey });
        this.store.set({ status: "online", config, error: undefined });
        break;
      }
      case "error":
        if (m.code === "id-claimed") {
          const config = await bridge.saveConfig({ deviceId: undefined, hostKey: undefined });
          this.store.set({ config, status: "connecting" });
          this.signaling.close();
          void this.connect();
        } else {
          this.store.set({ status: "error", error: m.message });
        }
        break;
      case "incoming-request": {
        const config = this.store.get().config;
        this.store.set({ session: { id: m.sessionId, viewerName: m.viewerName, phase: "pending" } });
        const allow = config?.unattended ? true : await bridge.requestConsent({ viewerName: m.viewerName, viewerIp: m.viewerIp, sameNetwork: m.sameNetwork });
        if (this.store.get().session?.id !== m.sessionId) return;
        this.signaling.send({ type: "consent", sessionId: m.sessionId, allow });
        if (!allow) this.store.set({ session: null });
        break;
      }
      case "session-accepted":
        if (m.role === "host") await this.startPeer(m.sessionId, m.iceServers);
        break;
      case "signal":
        if (m.sessionId === this.sessionId) this.enqueueSignal(m.data);
        break;
      case "session-ended":
        if (m.sessionId === this.sessionId || this.store.get().session?.id === m.sessionId) this.closePeer();
        break;
      default:
        break;
    }
  }

  private async startPeer(sessionId: string, iceServers: IceServer[]): Promise<void> {
    const bridge = desktop()!;
    const session = this.store.get().session;
    this.sessionId = sessionId;
    try {
      this.stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
    } catch (err) {
      this.store.set({ error: err instanceof Error ? err.message : "Screen capture failed" });
      this.signaling.send({ type: "end", sessionId });
      this.closePeer();
      return;
    }
    const pc = new RTCPeerConnection({ iceServers: iceServers.length ? iceServers : this.iceServers });
    this.pc = pc;
    const track = this.stream.getVideoTracks()[0]!;
    track.contentHint = "detail";
    pc.addTrack(track, this.stream);

    const control = pc.createDataChannel("control", { ordered: true });
    const files = pc.createDataChannel("files", { ordered: true });
    this.control = control;
    control.onmessage = (event) => void this.onControlMessage(event.data);
    files.binaryType = "arraybuffer";
    files.onmessage = (event) => {
      this.fileQueue = this.fileQueue.then(() => this.onFileMessage(files, event.data));
    };

    pc.onicecandidate = (event) => {
      this.signaling.send({
        type: "signal",
        sessionId,
        data: { kind: "candidate", candidate: event.candidate ? event.candidate.toJSON() : null },
      });
    };
    pc.onconnectionstatechange = () => {
      if (pc !== this.pc) return;
      if (pc.connectionState === "connected") {
        const current = this.store.get().session;
        this.store.set({ session: { id: sessionId, viewerName: current?.viewerName ?? session?.viewerName ?? "Viewer", phase: "connected" } });
        bridge.sessionStarted({ viewerName: current?.viewerName ?? "Viewer" });
        void this.applyQuality("balanced");
      } else if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        this.endSession();
      }
    };
    track.onended = () => this.endSession();

    const permissions = await bridge.getPermissions();
    if (!permissions.inputAvailable) {
      control.onopen = () =>
        this.sendControl({ t: "input-disabled", reason: "Remote input is unavailable on this device, so the session is view-only." });
    }

    await pc.setLocalDescription();
    if (pc.localDescription) {
      this.signaling.send({
        type: "signal",
        sessionId,
        data: { kind: "description", description: { type: "offer", sdp: pc.localDescription.sdp } },
      });
    }
  }

  private enqueueSignal(data: SignalData): void {
    this.signalQueue = this.signalQueue.then(async () => {
      const pc = this.pc;
      if (!pc) return;
      try {
        if (data.kind === "description") await pc.setRemoteDescription(data.description);
        else if (data.candidate) await pc.addIceCandidate(data.candidate);
        else await pc.addIceCandidate();
      } catch (err) {
        console.warn("Signal handling failed", err);
      }
    });
  }

  private sendControl(message: HostControl): void {
    if (this.control?.readyState === "open") this.control.send(JSON.stringify(message));
  }

  private async onControlMessage(raw: unknown): Promise<void> {
    const bridge = desktop()!;
    if (typeof raw !== "string") return;
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      return;
    }
    const input = inputEventSchema.safeParse(json);
    if (input.success) {
      bridge.injectInput(input.data);
      return;
    }
    const control = viewerControlSchema.safeParse(json);
    if (!control.success) return;
    const msg = control.data;
    switch (msg.t) {
      case "list-screens": {
        await this.refreshScreens();
        const { screens, selectedScreen } = this.store.get();
        this.sendControl({ t: "screens", screens, selected: selectedScreen ?? "" });
        break;
      }
      case "select-screen":
        await this.chooseScreen(msg.id);
        this.sendControl({ t: "screens", screens: this.store.get().screens, selected: this.store.get().selectedScreen ?? "" });
        break;
      case "set-quality":
        await this.applyQuality(msg.preset);
        break;
      case "clipboard-set":
        await bridge.writeClipboard(msg.text);
        break;
      case "clipboard-get":
        this.sendControl({ t: "clipboard", text: await bridge.readClipboard() });
        break;
    }
  }

  private async onFileMessage(channel: RTCDataChannel, data: unknown): Promise<void> {
    const bridge = desktop()!;
    const reply = (message: unknown) => channel.readyState === "open" && channel.send(JSON.stringify(message));
    try {
      if (typeof data === "string") {
        const parsed = fileMessageSchema.safeParse(JSON.parse(data));
        if (!parsed.success) return;
        if (parsed.data.t === "file-start") {
          if (this.transferId) bridge.fileAbort(this.transferId);
          this.transferId = await bridge.fileBegin(parsed.data.name, parsed.data.size);
        } else if (parsed.data.t === "file-end" && this.transferId) {
          const id = this.transferId;
          this.transferId = null;
          const savedPath = await bridge.fileEnd(id);
          reply({ t: "file-saved", name: savedPath.split(/[\\/]/).pop() ?? "file", path: savedPath });
        }
      } else if (data instanceof ArrayBuffer && this.transferId) {
        bridge.fileChunk(this.transferId, data);
      }
    } catch (err) {
      if (this.transferId) bridge.fileAbort(this.transferId);
      this.transferId = null;
      reply({ t: "file-error", message: err instanceof Error ? err.message : "Could not save the file" });
    }
  }

  private async applyQuality(preset: keyof typeof QUALITY_PRESETS): Promise<void> {
    const sender = this.pc?.getSenders().find((s) => s.track?.kind === "video");
    if (!sender) return;
    const params = sender.getParameters();
    if (!params.encodings?.length) params.encodings = [{}];
    params.encodings[0]!.maxBitrate = QUALITY_PRESETS[preset].maxBitrate;
    params.encodings[0]!.maxFramerate = QUALITY_PRESETS[preset].maxFramerate;
    try {
      await sender.setParameters(params);
    } catch (err) {
      console.warn("Could not apply quality", err);
    }
  }

  private async swapCapture(): Promise<void> {
    const sender = this.pc?.getSenders().find((s) => s.track?.kind === "video");
    if (!sender) return;
    const next = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false });
    const track = next.getVideoTracks()[0]!;
    track.contentHint = "detail";
    track.onended = () => this.endSession();
    await sender.replaceTrack(track);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = next;
  }

  private closePeer(): void {
    const hadSession = this.sessionId !== null || this.store.get().session !== null;
    if (this.transferId) desktop()?.fileAbort(this.transferId);
    this.transferId = null;
    this.fileQueue = Promise.resolve();
    this.stream?.getTracks().forEach((t) => {
      t.onended = null;
      t.stop();
    });
    this.stream = null;
    this.control?.close();
    this.pc?.close();
    this.pc = null;
    this.control = null;
    this.sessionId = null;
    this.signalQueue = Promise.resolve();
    if (hadSession) {
      this.store.set({ session: null });
      desktop()?.sessionEnded();
    }
  }
}
