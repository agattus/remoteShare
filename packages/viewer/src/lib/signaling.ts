import { type ClientMessage, type ServerMessage } from "@remotedesk/shared";

export class SignalingClient {
  private socket: WebSocket | null = null;
  onMessage: (message: ServerMessage) => void = () => {};
  onClose: () => void = () => {};

  connect(url: string, timeoutMs = 10_000): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      let socket: WebSocket;
      try {
        socket = new WebSocket(url);
      } catch (err) {
        reject(err);
        return;
      }
      this.socket = socket;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        socket.close();
        reject(new Error("Timed out connecting to the server"));
      }, timeoutMs);

      socket.onopen = () => {
        settled = true;
        clearTimeout(timer);
        resolve();
      };
      socket.onmessage = (event) => {
        try {
          this.onMessage(JSON.parse(String(event.data)) as ServerMessage);
        } catch {
          /* ignore malformed frames */
        }
      };
      socket.onclose = () => {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(new Error("Could not reach the server"));
        }
        if (this.socket === socket) this.socket = null;
        this.onClose();
      };
      socket.onerror = () => {};
    });
  }

  send(message: ClientMessage): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }

  get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  close(): void {
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onclose = null;
      socket.close();
    }
  }
}
