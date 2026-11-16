import type {
  PlaybackStateView,
  ProcessingStep,
  QueueView,
} from "./schemas.js";

export const SocketEvents = {
  queueUpdated: "queue:updated",
  songProgress: "song:progress",
  playbackState: "playback:state",
  playbackTick: "playback:tick",
  hostChanged: "host:changed",
  playerChanged: "player:changed",
} as const;

export const PgNotifyChannels = {
  queueUpdated: "queue_updated",
  songProgress: "song_progress",
  playbackState: "playback_state",
  hostChanged: "host_changed",
  playerChanged: "player_changed",
} as const;

export interface QueueUpdatedEvent extends QueueView {}

export interface SongProgressEvent {
  songId: string;
  step: ProcessingStep;
  progressPct: number;
  errorMessage?: string | null;
}

export interface PlaybackStateEvent extends PlaybackStateView {}

export interface PlaybackTickEvent {
  positionSeconds: number;
}

export interface HostChangedEvent {
  hostUserId: string | null;
  hostUserName: string | null;
}

export interface PlayerChangedEvent {
  playerUserId: string | null;
  playerUserName: string | null;
}
