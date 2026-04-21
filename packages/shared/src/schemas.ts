import { z } from "zod";

export const QueueStateSchema = z.enum([
  "queued",
  "processing",
  "ready",
  "played",
  "skipped",
  "failed",
]);
export type QueueState = z.infer<typeof QueueStateSchema>;

export const ProcessingStepSchema = z.enum([
  "pending",
  "downloading",
  "separating",
  "fetching_lyrics",
  "done",
  "error",
]);
export type ProcessingStep = z.infer<typeof ProcessingStepSchema>;

export const CreateUserBodySchema = z.object({
  name: z.string().trim().min(1).max(40),
});
export type CreateUserBody = z.infer<typeof CreateUserBodySchema>;

export const UserSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  isHost: z.boolean(),
});
export type User = z.infer<typeof UserSchema>;

export const SearchResultItemSchema = z.object({
  youtubeVideoId: z.string(),
  title: z.string(),
  channel: z.string(),
  durationSeconds: z.number().int().nonnegative(),
  thumbnailUrl: z.string().url(),
});
export type SearchResultItem = z.infer<typeof SearchResultItemSchema>;

export const SearchQuerySchema = z.object({
  q: z.string().trim().min(1).max(200),
});

export const AddQueueBodySchema = z.object({
  youtubeVideoId: z.string().min(1).max(32),
});
export type AddQueueBody = z.infer<typeof AddQueueBodySchema>;

export const SongSchema = z.object({
  id: z.string().uuid(),
  youtubeVideoId: z.string(),
  title: z.string(),
  artist: z.string(),
  channel: z.string(),
  durationSeconds: z.number().int().nonnegative(),
  thumbnailUrl: z.string(),
  hasInstrumental: z.boolean(),
  hasLyrics: z.boolean(),
});
export type Song = z.infer<typeof SongSchema>;

export const QueueItemSchema = z.object({
  id: z.string().uuid(),
  song: SongSchema,
  requestedByUserId: z.string().uuid(),
  requestedByUserName: z.string(),
  position: z.number().int(),
  state: QueueStateSchema,
  progress: z
    .object({
      step: ProcessingStepSchema,
      progressPct: z.number().int().min(0).max(100),
      errorMessage: z.string().nullable(),
    })
    .nullable(),
});
export type QueueItem = z.infer<typeof QueueItemSchema>;

export const QueueViewSchema = z.object({
  current: QueueItemSchema.nullable(),
  upcoming: z.array(QueueItemSchema),
});
export type QueueView = z.infer<typeof QueueViewSchema>;

export const SeekBodySchema = z.object({
  positionSeconds: z.number().nonnegative(),
});

export const PositionBodySchema = z.object({
  positionSeconds: z.number().nonnegative(),
});

export const PlaybackStateSchema = z.object({
  currentQueueItemId: z.string().uuid().nullable(),
  positionSeconds: z.number().nonnegative(),
  isPlaying: z.boolean(),
  hostUserId: z.string().uuid().nullable(),
  playerUserId: z.string().uuid().nullable(),
});
export type PlaybackStateView = z.infer<typeof PlaybackStateSchema>;
