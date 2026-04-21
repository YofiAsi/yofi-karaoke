import type { Server as HttpServer } from "http";
import { Server } from "socket.io";
import { QueueState } from "@prisma/client";
import { env } from "../env.js";
import { prisma } from "../db.js";
import { PgNotifyChannels, SocketEvents, type PlaybackStateView } from "@karaoke/shared";

let io: Server;

/**
 * After the 3s grace period following `playback:ended`, check whether the
 * queue item that ended is still the current one (host may have already skipped).
 * If unchanged: mark it played, promote the next ready item, and broadcast.
 */
async function autoAdvanceIfStill(itemIdAtEnd: string | null): Promise<void> {
  const state = await prisma.playbackState.findUnique({ where: { id: 1 } });
  if (!state) return;

  // Host already skipped — nothing to do
  if (state.currentQueueItemId !== itemIdAtEnd) return;

  // Mark current item as played
  if (state.currentQueueItemId) {
    await prisma.queueItem.update({
      where: { id: state.currentQueueItemId },
      data: { state: QueueState.played, playedAt: new Date() },
    });
  }

  // Find next ready item (skip-if-not-ready: only state=ready items are candidates)
  const nextItem = await prisma.queueItem.findFirst({
    where: { state: QueueState.ready },
    orderBy: { position: "asc" },
  });

  await prisma.playbackState.update({
    where: { id: 1 },
    data: {
      currentQueueItemId: nextItem?.id ?? null,
      positionSeconds: 0,
      isPlaying: nextItem ? true : false,
    },
  });

  // Broadcast updated playback state
  const updated = await prisma.playbackState.findUniqueOrThrow({ where: { id: 1 } });
  const payload: PlaybackStateView = {
    currentQueueItemId: updated.currentQueueItemId ?? null,
    positionSeconds: updated.positionSeconds,
    isPlaying: updated.isPlaying,
    hostUserId: updated.hostUserId ?? null,
    playerUserId: updated.playerUserId ?? null,
  };
  io.emit(SocketEvents.playbackState, payload);

  // Also notify via PgNotify (for SSE listeners)
  await prisma.$executeRawUnsafe(
    `SELECT pg_notify($1, $2)`,
    PgNotifyChannels.playbackState,
    JSON.stringify(payload),
  );
  await prisma.$executeRawUnsafe(
    `SELECT pg_notify($1, $2)`,
    PgNotifyChannels.queueUpdated,
    JSON.stringify({ reason: "auto-advance" }),
  );
}

export function setupSocketIO(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: {
      origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN.split(","),
      credentials: true,
    },
    cookie: false,
  });

  io.on("connection", (socket) => {
    // Read cookie from handshake for identity (viewer mode allowed)
    const rawCookie = socket.handshake.headers.cookie ?? "";
    const cookieName = env.COOKIE_NAME.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const match = rawCookie.match(new RegExp(`(?:^|;\\s*)${cookieName}=([^;]+)`));
    const userId = match ? decodeURIComponent(match[1]) : null;
    socket.data.userId = userId;

    // Player phone signals audio has ended; server auto-advances after a 3s grace period.
    // If the host already skipped (currentQueueItemId changed), we no-op.
    socket.on(SocketEvents.playbackEnded, () => {
      const emitterId = socket.data.userId as string | null;
      if (!emitterId) return;

      // Snapshot currentQueueItemId synchronously is not possible (DB is async),
      // so we read it immediately and then schedule the grace-period check.
      prisma.playbackState
        .findUnique({ where: { id: 1 } })
        .then((state) => {
          // Verify the emitter is actually the current player
          if (!state || state.playerUserId !== emitterId) return;

          const itemIdAtEnd = state.currentQueueItemId ?? null;
          const timer = setTimeout(() => {
            autoAdvanceIfStill(itemIdAtEnd).catch(console.error);
          }, 3000);
          socket.once("disconnect", () => clearTimeout(timer));
        })
        .catch(console.error);
    });
  });

  return io;
}

/**
 * Returns the initialised Socket.IO Server instance.
 * This is the canonical export of `io` — consumers import `getIO` because
 * `io` is lazily initialised and cannot be a static named export.
 */
export function getIO(): Server {
  if (!io) throw new Error("Socket.IO not initialised — call setupSocketIO first");
  return io;
}
