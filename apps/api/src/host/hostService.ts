import { prisma } from "../db.js";
import { env } from "../env.js";

export interface HostClaimResult {
  kind: "created" | "taken_over" | "already_host";
  userId: string;
  userName: string;
}

export interface HostConflict {
  kind: "conflict";
}

export type HostOutcome = HostClaimResult | HostConflict;

export function isHostName(name: string): boolean {
  return name.trim().toLowerCase() === env.HOST_USER_NAME.trim().toLowerCase();
}

export function isStale(lastHeartbeat: Date | null | undefined, now = new Date()): boolean {
  if (!lastHeartbeat) return true;
  const ageSec = (now.getTime() - lastHeartbeat.getTime()) / 1000;
  return ageSec > env.HOST_STALE_SECONDS;
}

export async function claimOrConflict(name: string): Promise<HostOutcome> {
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    const existingHost = await tx.user.findFirst({
      where: { name },
    });

    const playback = await tx.playbackState.findUnique({ where: { id: 1 } });
    const currentHostStale = isStale(playback?.hostLastHeartbeatAt ?? null, now);

    if (existingHost) {
      if (currentHostStale) {
        await tx.user.update({
          where: { id: existingHost.id },
          data: { isHost: true, lastSeenAt: now },
        });
        await tx.playbackState.update({
          where: { id: 1 },
          data: {
            hostUserId: existingHost.id,
            hostLastHeartbeatAt: now,
          },
        });
        return {
          kind: "taken_over",
          userId: existingHost.id,
          userName: existingHost.name,
        } as const;
      }
      if (playback?.hostUserId === existingHost.id) {
        return {
          kind: "already_host",
          userId: existingHost.id,
          userName: existingHost.name,
        } as const;
      }
      return { kind: "conflict" } as const;
    }

    const created = await tx.user.create({
      data: { name, isHost: true, lastSeenAt: now },
    });
    await tx.playbackState.update({
      where: { id: 1 },
      data: { hostUserId: created.id, hostLastHeartbeatAt: now },
    });
    return { kind: "created", userId: created.id, userName: created.name } as const;
  });
}

export async function heartbeat(userId: string): Promise<void> {
  const now = new Date();
  await prisma.user.update({ where: { id: userId }, data: { lastSeenAt: now } });
  const playback = await prisma.playbackState.findUnique({ where: { id: 1 } });
  if (playback?.hostUserId === userId) {
    await prisma.playbackState.update({
      where: { id: 1 },
      data: { hostLastHeartbeatAt: now },
    });
  }
}
