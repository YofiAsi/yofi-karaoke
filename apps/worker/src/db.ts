import pg from "pg";
import { env } from "./env.js";

export const pool = new pg.Pool({ connectionString: env.DATABASE_URL });

export async function notify(channel: string, payload: object): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_notify($1, $2)", [channel, JSON.stringify(payload)]);
  } finally {
    client.release();
  }
}
