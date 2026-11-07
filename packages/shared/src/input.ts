import { z } from "zod";

const unit = z.number().min(0).max(1);
const button = z.union([z.literal(0), z.literal(1), z.literal(2)]);

export const inputEventSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("mousemove"), x: unit, y: unit }),
  z.object({ t: z.literal("mousedown"), x: unit, y: unit, button }),
  z.object({ t: z.literal("mouseup"), x: unit, y: unit, button }),
  z.object({ t: z.literal("wheel"), dx: z.number().min(-10_000).max(10_000), dy: z.number().min(-10_000).max(10_000) }),
  z.object({ t: z.literal("keydown"), code: z.string().max(32) }),
  z.object({ t: z.literal("keyup"), code: z.string().max(32) }),
]);
export type InputEvent = z.infer<typeof inputEventSchema>;

export const QUALITY_PRESETS = {
  low: { maxBitrate: 1_000_000, maxFramerate: 15 },
  balanced: { maxBitrate: 4_000_000, maxFramerate: 30 },
  high: { maxBitrate: 10_000_000, maxFramerate: 60 },
} as const;
export type QualityPreset = keyof typeof QUALITY_PRESETS;

export const screenInfoSchema = z.object({ id: z.string(), name: z.string(), width: z.number(), height: z.number(), primary: z.boolean() });
export type ScreenInfo = z.infer<typeof screenInfoSchema>;

/** Messages the viewer sends on the "control" data channel (in addition to input events). */
export const viewerControlSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("list-screens") }),
  z.object({ t: z.literal("select-screen"), id: z.string().max(128) }),
  z.object({ t: z.literal("set-quality"), preset: z.enum(["low", "balanced", "high"]) }),
  z.object({ t: z.literal("clipboard-set"), text: z.string().max(1_000_000) }),
  z.object({ t: z.literal("clipboard-get") }),
]);
export type ViewerControl = z.infer<typeof viewerControlSchema>;

/** Messages the host sends back on the "control" data channel. */
export const hostControlSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("screens"), screens: z.array(screenInfoSchema), selected: z.string() }),
  z.object({ t: z.literal("clipboard"), text: z.string() }),
  z.object({ t: z.literal("input-disabled"), reason: z.string() }),
  z.object({ t: z.literal("notice"), message: z.string() }),
]);
export type HostControl = z.infer<typeof hostControlSchema>;

/** File transfer on the "files" data channel: JSON header, binary chunks, JSON footer. */
export const fileMessageSchema = z.discriminatedUnion("t", [
  z.object({ t: z.literal("file-start"), name: z.string().min(1).max(255), size: z.number().int().min(0) }),
  z.object({ t: z.literal("file-end") }),
  z.object({ t: z.literal("file-saved"), name: z.string(), path: z.string().optional() }),
  z.object({ t: z.literal("file-error"), message: z.string() }),
]);
export type FileMessage = z.infer<typeof fileMessageSchema>;

export const MAX_FILE_SIZE = 200 * 1024 * 1024;
export const FILE_CHUNK_SIZE = 16 * 1024;
