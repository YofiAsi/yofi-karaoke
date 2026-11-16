// Readable messages for the errors the api returns when a guest adds a song.
import { ApiError } from "./api";

const MESSAGES: Record<string, string> = {
  queue_limit: "You have reached your song limit. Add more once one of yours has been sung.",
  already_queued: "That song is already in the queue.",
  video_unavailable: "That video is unavailable or private.",
  song_not_processed: "That song is not ready yet.",
};

export function isAlreadyQueued(err: unknown): boolean {
  return err instanceof ApiError && err.code === "already_queued";
}

export function addSongErrorMessage(err: unknown): string {
  const code = err instanceof ApiError ? err.code : "";
  return MESSAGES[code] ?? "Could not add to queue.";
}
