import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { app } from "electron";
import { MAX_FILE_SIZE } from "@remotedesk/shared";

interface Transfer {
  stream: fs.WriteStream;
  target: string;
  expected: number;
  received: number;
  failed?: Error;
}

const transfers = new Map<string, Transfer>();

function safeName(name: string): string {
  const base = path.basename(name.replace(/\\/g, "/")).replace(/[<>:"|?*\u0000-\u001f]/g, "_").trim();
  return base && base !== "." && base !== ".." ? base.slice(0, 200) : "file";
}

function uniquePath(dir: string, name: string): string {
  const ext = path.extname(name);
  const stem = path.basename(name, ext);
  let candidate = path.join(dir, name);
  for (let n = 1; fs.existsSync(candidate); n++) candidate = path.join(dir, `${stem} (${n})${ext}`);
  return candidate;
}

function downloadsDir(): string {
  const conventional = path.join(app.getPath("home"), "Downloads");
  return fs.existsSync(conventional) ? conventional : app.getPath("downloads");
}

export function fileBegin(name: string, size: number): string {
  if (!Number.isFinite(size) || size < 0 || size > MAX_FILE_SIZE) throw new Error("File is too large");
  const dir = path.join(downloadsDir(), "Orbit");
  fs.mkdirSync(dir, { recursive: true });
  const target = uniquePath(dir, safeName(name));
  const stream = fs.createWriteStream(target, { flags: "wx", mode: 0o600 });
  const transfer: Transfer = { stream, target, expected: size, received: 0 };
  stream.on("error", (err) => {
    transfer.failed = err;
  });
  const id = crypto.randomBytes(8).toString("hex");
  transfers.set(id, transfer);
  return id;
}

export function fileChunk(id: string, chunk: Buffer): void {
  const transfer = transfers.get(id);
  if (!transfer) return;
  transfer.received += chunk.length;
  if (transfer.received > transfer.expected) {
    transfer.failed = new Error("Received more data than announced");
    return;
  }
  transfer.stream.write(chunk);
}

export function fileEnd(id: string): Promise<string> {
  const transfer = transfers.get(id);
  if (!transfer) return Promise.reject(new Error("Unknown transfer"));
  transfers.delete(id);
  return new Promise((resolve, reject) => {
    transfer.stream.end(() => {
      if (transfer.failed || transfer.received !== transfer.expected) {
        fs.rm(transfer.target, { force: true }, () => reject(transfer.failed ?? new Error("Transfer was incomplete")));
      } else {
        resolve(transfer.target);
      }
    });
  });
}

export function fileAbort(id: string): void {
  const transfer = transfers.get(id);
  if (!transfer) return;
  transfers.delete(id);
  transfer.stream.destroy();
  fs.rm(transfer.target, { force: true }, () => {});
}
