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
  pin: z.string().min(1).max(64).optional(),
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

export const YoutubeVideoIdSchema = z.string().regex(/^[A-Za-z0-9_-]{11}$/);

export const AddQueueBodySchema = z.object({
  youtubeVideoId: YoutubeVideoIdSchema,
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
  hasVocals: z.boolean(),
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
  queueItemId: z.string().uuid(),
  positionSeconds: z.number().nonnegative(),
});
export type PositionBody = z.infer<typeof PositionBodySchema>;

export const PlaybackStateSchema = z.object({
  currentQueueItemId: z.string().uuid().nullable(),
  positionSeconds: z.number().nonnegative(),
  isPlaying: z.boolean(),
  hostUserId: z.string().uuid().nullable(),
  playerUserId: z.string().uuid().nullable(),
  vocalsGain: z.number().min(0).max(1),
});
export type PlaybackStateView = z.infer<typeof PlaybackStateSchema>;

export const VocalsGainBodySchema = z.object({
  gain: z.number().min(0).max(1),
  queueItemId: z.string().uuid(),
});
export type VocalsGainBody = z.infer<typeof VocalsGainBodySchema>;

export const QueueItemParamsSchema = z.object({
  queueItemId: z.string().uuid(),
});
export type QueueItemParams = z.infer<typeof QueueItemParamsSchema>;

export const MoveDirectionSchema = z.enum(["up", "down"]);
export type MoveDirection = z.infer<typeof MoveDirectionSchema>;

export const MoveQueueItemBodySchema = z.object({
  direction: MoveDirectionSchema,
});
export type MoveQueueItemBody = z.infer<typeof MoveQueueItemBodySchema>;

export const PlaybackTransitionBodySchema = z.object({
  expectedQueueItemId: z.string().uuid().nullable(),
});
export type PlaybackTransitionBody = z.infer<typeof PlaybackTransitionBodySchema>;

export const PlaybackTransitionResultSchema = z.object({
  changed: z.boolean(),
  currentQueueItemId: z.string().uuid().nullable(),
});
export type PlaybackTransitionResult = z.infer<typeof PlaybackTransitionResultSchema>;
