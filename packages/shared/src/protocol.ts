import { z } from "zod";

export const DEVICE_ID_LENGTH = 9;
export const MIN_PASSWORD_LENGTH = 6;
export const MAX_PASSWORD_LENGTH = 64;

export const deviceIdSchema = z.string().regex(/^\d{9}$/, "Device ID must be 9 digits");
export const passwordSchema = z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH);

export const iceServerSchema = z.object({
  urls: z.union([z.string(), z.array(z.string())]),
  username: z.string().optional(),
  credential: z.string().optional(),
});
export type IceServer = z.infer<typeof iceServerSchema>;

export const signalDataSchema = z.union([
  z.object({ kind: z.literal("description"), description: z.object({ type: z.enum(["offer", "answer"]), sdp: z.string().max(100_000) }) }),
  z.object({ kind: z.literal("candidate"), candidate: z.object({ candidate: z.string().max(4_000).optional(), sdpMid: z.string().nullable().optional(), sdpMLineIndex: z.number().nullable().optional(), usernameFragment: z.string().nullable().optional() }).nullable() }),
]);
export type SignalData = z.infer<typeof signalDataSchema>;

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("host-register"),
    deviceId: deviceIdSchema.optional(),
    hostKey: z.string().min(16).max(128).optional(),
    password: passwordSchema,
  }),
  z.object({ type: z.literal("host-set-password"), password: passwordSchema }),
  z.object({
    type: z.literal("connect"),
    deviceId: deviceIdSchema,
    password: z.string().max(MAX_PASSWORD_LENGTH),
    viewerName: z.string().trim().min(1).max(64),
    fromDeviceId: deviceIdSchema.optional(),
  }),
  z.object({ type: z.literal("consent"), sessionId: z.string().min(8).max(64), allow: z.boolean() }),
  z.object({ type: z.literal("signal"), sessionId: z.string().min(8).max(64), data: signalDataSchema }),
  z.object({ type: z.literal("end"), sessionId: z.string().min(8).max(64) }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

export type ErrorCode =
  | "bad-request"
  | "invalid-credentials"
  | "device-offline"
  | "device-busy"
  | "rate-limited"
  | "id-claimed"
  | "self-connect"
  | "not-registered"
  | "consent-timeout"
  | "server-error";

export type ServerMessage =
  | { type: "registered"; deviceId: string; hostKey: string; iceServers: IceServer[] }
  | { type: "error"; code: ErrorCode; message: string; retryAfterSec?: number }
  | { type: "incoming-request"; sessionId: string; viewerName: string; viewerIp: string; sameNetwork?: boolean }
  | { type: "awaiting-consent"; sessionId: string }
  | { type: "session-accepted"; sessionId: string; role: "host" | "viewer"; iceServers: IceServer[] }
  | { type: "session-denied"; sessionId: string; reason: "denied" | "timeout" }
  | { type: "signal"; sessionId: string; data: SignalData }
  | { type: "session-ended"; sessionId: string; reason: "peer-left" | "ended" | "host-offline" };

export function formatDeviceId(id: string): string {
  const digits = id.replace(/\D/g, "").slice(0, DEVICE_ID_LENGTH);
  return digits.replace(/(\d{3})(?=\d)/g, "$1 ").trim();
}

export function normalizeDeviceId(input: string): string {
  return input.replace(/\D/g, "");
}
