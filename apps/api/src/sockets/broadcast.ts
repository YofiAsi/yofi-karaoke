// Bridges Postgres LISTEN/NOTIFY to socket.io, reconnecting with one pending retry at a time.
import pg from "pg";
import type { Server } from "socket.io";
import { PgNotifyChannels, SocketEvents } from "@karaoke/shared";
import { env } from "../env.js";
import { loadPlaybackStateView } from "../playback/notify.js";

const { Client } = pg;

const INITIAL_RETRY_MS = 1000;
const MAX_RETRY_MS = 30_000;

const channelToEvent: Record<string, string> = {
  [PgNotifyChannels.queueUpdated]: SocketEvents.queueUpdated,
  [PgNotifyChannels.songProgress]: SocketEvents.songProgress,
  [PgNotifyChannels.playbackState]: SocketEvents.playbackState,
  [PgNotifyChannels.hostChanged]: SocketEvents.hostChanged,
  [PgNotifyChannels.playerChanged]: SocketEvents.playerChanged,
};

let reconnectPending = false;

function parsePayload(raw: string | undefined): unknown {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

function forwardNotification(io: Server, msg: pg.Notification): void {
  const eventName = channelToEvent[msg.channel];
  if (eventName) io.emit(eventName, parsePayload(msg.payload));
}

async function resyncClients(io: Server): Promise<void> {
  io.emit(SocketEvents.queueUpdated, { reason: "resync" });
  io.emit(SocketEvents.playbackState, await loadPlaybackStateView());
}

function nextRetryDelay(delayMs: number): number {
  return Math.min(delayMs * 2, MAX_RETRY_MS);
}

function scheduleReconnect(io: Server, delayMs: number): void {
  if (reconnectPending) return;
  reconnectPending = true;
  setTimeout(() => {
    reconnectPending = false;
    void connectBridge(io, nextRetryDelay(delayMs), true);
  }, delayMs);
}

async function listenToAllChannels(client: pg.Client): Promise<void> {
  for (const channel of Object.values(PgNotifyChannels)) {
    await client.query(`LISTEN "${channel}"`);
  }
}

async function connectBridge(io: Server, retryDelayMs: number, isReconnect: boolean): Promise<void> {
  const client = new Client({ connectionString: env.DATABASE_URL });
  let connected = false;
  let lost = false;

  const handleLoss = (err: Error) => {
    if (lost) return;
    lost = true;
    const delayMs = connected ? INITIAL_RETRY_MS : retryDelayMs;
    console.error("[broadcast-bridge] connection lost, retrying in", delayMs, "ms:", err.message);
    client.end().catch(() => {});
    scheduleReconnect(io, delayMs);
  };

  client.on("error", handleLoss);
  client.on("end", () => handleLoss(new Error("connection ended")));

  try {
    await client.connect();
    await listenToAllChannels(client);
  } catch (err) {
    handleLoss(err instanceof Error ? err : new Error(String(err)));
    return;
  }

  connected = true;
  client.on("notification", (msg) => forwardNotification(io, msg));
  if (isReconnect) {
    await resyncClients(io).catch((err) => console.error("[broadcast-bridge] resync failed", err));
  }
}

export async function startBroadcastBridge(io: Server): Promise<void> {
  await connectBridge(io, INITIAL_RETRY_MS, false);
}
