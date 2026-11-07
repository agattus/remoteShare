import fs from "node:fs";
import path from "node:path";

/** Persists device ID -> hash of the host key, so an ID can only be reclaimed by the machine that owns it. */
export class DeviceStore {
  private data: Record<string, string> = {};

  constructor(private file: string | null) {
    if (file && fs.existsSync(file)) {
      try {
        this.data = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, string>;
      } catch {
        this.data = {};
      }
    }
  }

  get(id: string): string | undefined {
    return this.data[id];
  }

  has(id: string): boolean {
    return id in this.data;
  }

  set(id: string, hostKeyHash: string): void {
    this.data[id] = hostKeyHash;
    this.persist();
  }

  private persist(): void {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}
