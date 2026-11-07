import crypto from "node:crypto";

const SCRYPT_KEYLEN = 32;

export function hashSecret(secret: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(secret, salt, SCRYPT_KEYLEN);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifySecret(secret: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = crypto.scryptSync(secret, Buffer.from(saltHex, "hex"), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function randomToken(bytes = 16): string {
  return crypto.randomBytes(bytes).toString("hex");
}

export function randomDeviceId(): string {
  return String(crypto.randomInt(100_000_000, 1_000_000_000));
}

export interface RateLimiterOptions {
  maxFailures: number;
  windowMs: number;
  lockMs: number;
  now?: () => number;
}

interface Entry {
  failures: number[];
  lockedUntil: number;
}

export class RateLimiter {
  private entries = new Map<string, Entry>();
  private now: () => number;

  constructor(private opts: RateLimiterOptions) {
    this.now = opts.now ?? Date.now;
  }

  check(key: string): { allowed: true } | { allowed: false; retryAfterSec: number } {
    const entry = this.entries.get(key);
    if (!entry) return { allowed: true };
    const now = this.now();
    if (entry.lockedUntil > now) {
      return { allowed: false, retryAfterSec: Math.ceil((entry.lockedUntil - now) / 1000) };
    }
    return { allowed: true };
  }

  fail(key: string): void {
    const now = this.now();
    this.prune(now);
    const entry = this.entries.get(key) ?? { failures: [], lockedUntil: 0 };
    entry.failures = entry.failures.filter((t) => now - t < this.opts.windowMs);
    entry.failures.push(now);
    if (entry.failures.length >= this.opts.maxFailures) {
      entry.lockedUntil = now + this.opts.lockMs;
      entry.failures = [];
    }
    this.entries.set(key, entry);
  }

  reset(key: string): void {
    this.entries.delete(key);
  }

  private prune(now: number): void {
    if (this.entries.size < 5000) return;
    for (const [key, entry] of this.entries) {
      const stale = entry.lockedUntil <= now && entry.failures.every((t) => now - t >= this.opts.windowMs);
      if (stale) this.entries.delete(key);
    }
  }
}
