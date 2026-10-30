import { z } from 'zod';

export const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
export const STORAGE_WARNING_BYTES = 7_000_000_000;
export const STORAGE_STOP_BYTES = 9_000_000_000;
export const createVideoInput = z.strictObject({
  questId: z.string().min(1).max(100),
  size: z.number().int().positive().max(MAX_VIDEO_BYTES),
  mimeType: z.enum(['video/mp4', 'video/webm', 'video/quicktime']),
});
export const uploadTicketSchema = z.object({
  id: z.uuid(),
  url: z.url(),
  expiresAt: z.number(),
  headers: z.record(z.string(), z.string()),
});
export const videoRecordSchema = z.object({
  id: z.uuid(),
  questId: z.string(),
  userId: z.string(),
  attemptId: z.string().nullable(),
  size: z.number(),
  createdAt: z.number(),
  status: z.enum(['uploading', 'ready', 'deleting', 'delete_failed', 'deleted']),
});
export const videoListSchema = z.object({
  enabled: z.boolean(),
  videos: z.array(videoRecordSchema),
});
export type VideoRecord = z.infer<typeof videoRecordSchema>;
export const storageSnapshotSchema = z.object({
  startedAt: z.number(),
  completedAt: z.number(),
  prefix: z.string().nullable(),
  currentBytes: z.number(),
  historicalBytes: z.number(),
  unfinishedBytes: z.number(),
  versions: z.number(),
  unfinishedFiles: z.number(),
});
export const storageSummarySchema = z.object({
  reservedBytes: z.number(),
  count: z.number(),
  failedDeletes: z.number(),
  warningBytes: z.number(),
  stopBytes: z.number(),
  actual: storageSnapshotSchema.nullable(),
  effectiveBytes: z.number(),
  stale: z.boolean(),
  scanning: z.boolean(),
  error: z.string().nullable(),
  alerts: z.array(
    z.object({
      kind: z.string(),
      message: z.string(),
      openedAt: z.number(),
      resolvedAt: z.number().nullable(),
    }),
  ),
});
