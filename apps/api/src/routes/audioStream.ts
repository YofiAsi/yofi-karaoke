/* Streams a stored audio object with single byte range support, ETag and immutable caching. */
import type { FastifyReply, FastifyRequest } from "fastify";
import { getObjectStream, isMissingObjectError, statObject, type ObjectInfo } from "../minio.js";

const RANGE_RE = /^bytes=(\d*)-(\d*)$/;
const CACHE_CONTROL = "public, max-age=31536000, immutable";

export type RangeRequest =
  | { kind: "full" }
  | { kind: "partial"; start: number; end: number }
  | { kind: "unsatisfiable" };

export function parseRange(header: string | undefined, total: number): RangeRequest {
  const match = typeof header === "string" ? RANGE_RE.exec(header.trim()) : null;
  if (!match) return { kind: "full" };
  const [, first, last] = match;
  if (first === "" && last === "") return { kind: "full" };
  if (first === "") return suffixRange(Number(last), total);
  return boundedRange(Number(first), last === "" ? total - 1 : Number(last), total);
}

function suffixRange(length: number, total: number): RangeRequest {
  if (length === 0 || total === 0) return { kind: "unsatisfiable" };
  return { kind: "partial", start: Math.max(0, total - length), end: total - 1 };
}

function boundedRange(start: number, end: number, total: number): RangeRequest {
  if (start >= total || end < start) return { kind: "unsatisfiable" };
  return { kind: "partial", start, end: Math.min(end, total - 1) };
}

function sendMissing(reply: FastifyReply): FastifyReply {
  return reply.code(404).send({ error: "audio_missing" });
}

function setCommonHeaders(reply: FastifyReply, info: ObjectInfo): void {
  reply
    .header("Content-Type", info.contentType)
    .header("Accept-Ranges", "bytes")
    .header("Cache-Control", CACHE_CONTROL);
  if (info.etag) reply.header("ETag", info.etag);
}

async function openStream(key: string, range?: { start: number; end: number }) {
  try {
    return (await getObjectStream(key, range)).body;
  } catch (err) {
    if (isMissingObjectError(err)) return null;
    throw err;
  }
}

export async function streamAudioObject(
  req: FastifyRequest,
  reply: FastifyReply,
  key: string,
): Promise<FastifyReply> {
  const info = await statObject(key);
  if (!info) return sendMissing(reply);

  const total = info.contentLength;
  const range = parseRange(req.headers.range, total);

  if (range.kind === "unsatisfiable") {
    return reply.code(416).header("Content-Range", `bytes */${total}`).send();
  }

  const partial = range.kind === "partial" ? { start: range.start, end: range.end } : undefined;
  const body = await openStream(key, partial);
  if (!body) return sendMissing(reply);

  setCommonHeaders(reply, info);
  if (!partial) {
    return reply.header("Content-Length", String(total)).send(body);
  }
  return reply
    .code(206)
    .header("Content-Length", String(partial.end - partial.start + 1))
    .header("Content-Range", `bytes ${partial.start}-${partial.end}/${total}`)
    .send(body);
}
