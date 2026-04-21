import pg from "pg";
import type { Server } from "socket.io";
import { PgNotifyChannels, SocketEvents } from "@karaoke/shared";
import { env } from "../env.js";

const { Client } = pg;

// Map Postgres NOTIFY channel names → Socket.IO event names
const channelToEvent: Record<string, string> = {
  [PgNotifyChannels.queueUpdated]: SocketEvents.queueUpdated,
  [PgNotifyChannels.songProgress]: SocketEvents.songProgress,
  [PgNotifyChannels.playbackState]: SocketEvents.playbackState,
  [PgNotifyChannels.hostChanged]: SocketEvents.hostChanged,
  [PgNotifyChannels.playerChanged]: SocketEvents.playerChanged,
};

export async function startBroadcastBridge(io: Server): Promise<void> {
  const client = new Client({ connectionString: env.DATABASE_URL });
  await client.connect();

  for (const channel of Object.values(PgNotifyChannels)) {
    await client.query(`LISTEN "${channel}"`);
  }

  client.on("notification", (msg) => {
    const eventName = channelToEvent[msg.channel];
    if (!eventName) return;

    let payload: unknown = {};
    if (msg.payload) {
      try {
        payload = JSON.parse(msg.payload);
      } catch {
        payload = { raw: msg.payload };
      }
    }

    io.emit(eventName, payload);
  });

  client.on("error", (err) => {
    console.error("[broadcast-bridge] pg client error", err);
  });
}
