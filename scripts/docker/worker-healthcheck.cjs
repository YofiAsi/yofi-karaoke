// Worker container health check: the node worker process must be running and Postgres must answer a query.
const { readdirSync, readFileSync } = require("node:fs");
const { Client } = require("pg");

const WORKER_ENTRY = "dist/index.js";

function readCmdline(pid) {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").split("\0");
  } catch {
    return [];
  }
}

function workerProcessRunning() {
  return readdirSync("/proc")
    .filter((name) => /^\d+$/.test(name) && Number(name) !== process.pid)
    .map(readCmdline)
    .some((argv) => argv[0]?.endsWith("node") && argv.includes(WORKER_ENTRY));
}

async function queryDatabase() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL,
    connectionTimeoutMillis: 5000,
    query_timeout: 5000,
  });
  try {
    await client.connect();
    await client.query("SELECT 1");
  } finally {
    await client.end().catch(() => undefined);
  }
}

async function main() {
  if (!workerProcessRunning()) throw new Error(`no node process running ${WORKER_ENTRY}`);
  await queryDatabase();
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(`worker unhealthy: ${err.message}`);
    process.exit(1);
  },
);
