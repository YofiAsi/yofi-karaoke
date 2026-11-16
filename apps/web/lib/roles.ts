// Host, player and queue item permissions derived from the server's playback state.
import type { PlaybackStateView, QueueItem, User } from "@karaoke/shared";

type Identity = Pick<User, "id"> | null;
type Roles = Pick<PlaybackStateView, "hostUserId" | "playerUserId"> | null;

export function isCurrentHost(user: Identity, playback: Roles): boolean {
  return !!user && !!playback && playback.hostUserId === user.id;
}

export function isPlayerDevice(user: Identity, playback: Roles): boolean {
  return !!user && !!playback && playback.playerUserId === user.id;
}

export function canRemoveItem(user: Identity, item: Pick<QueueItem, "requestedByUserId">, isHost: boolean): boolean {
  return isHost || (!!user && item.requestedByUserId === user.id);
}

export function canControlVocals(
  user: Identity,
  isHost: boolean,
  current: Pick<QueueItem, "requestedByUserId"> | null,
): boolean {
  if (!current || !user) return false;
  return isHost || current.requestedByUserId === user.id;
}
