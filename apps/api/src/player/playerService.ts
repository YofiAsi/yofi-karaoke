import { PgNotifyChannels } from "@karaoke/shared";
import { prisma } from "../db.js";
import { env } from "../env.js";

export interface PlayerClaimResult {
  userId: string;
  userName: string;
}

export function isPlayerStale(lastHeartbeat: Date | null | undefined, now = new Date()): boolean {
  if (!lastHeartbeat) return true;
  const ageSec = (now.getTime() - lastHeartbeat.getTime()) / 1000;
  return ageSec > env.PLAYER_STALE_SECONDS;
}

async function notify(channel: string, payload: object): Promise<void> {
  await prisma.$executeRawUnsafe(`SELECT pg_notify($1, $2)`, channel, JSON.stringify(payload));
}

export async function claim(userId: string): Promise<PlayerClaimResult> {
  const now = new Date();
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  await prisma.playbackState.update({
    where: { id: 1 },
    data: {
      playerUserId: userId,
      playerLastHeartbeatAt: now,
    },
  });
  await notify(PgNotifyChannels.playerChanged, {
    playerUserId: userId,
    playerUserName: user.name,
  });
  return { userId, userName: user.name };
}

export async function release(userId: string): Promise<void> {
  const playback = await prisma.playbackState.findUnique({ where: { id: 1 } });
  if (playback?.playerUserId !== userId) return;
  await prisma.playbackState.update({
    where: { id: 1 },
    data: {
      playerUserId: null,
      playerLastHeartbeatAt: null,
    },
  });
  await notify(PgNotifyChannels.playerChanged, {
    playerUserId: null,
    playerUserName: null,
  });
}

export async function heartbeat(userId: string): Promise<void> {
  const now = new Date();
  const playback = await prisma.playbackState.findUnique({ where: { id: 1 } });
  if (playback?.playerUserId !== userId) return;
  await prisma.playbackState.update({
    where: { id: 1 },
    data: { playerLastHeartbeatAt: now },
  });
}
