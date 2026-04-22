import type { FastifyInstance } from "fastify";
import { SearchQuerySchema, type SearchResultItem } from "@karaoke/shared";
import { ytdlpSearch, type YtDlpSearchEntry } from "../ytdlp.js";
import { isYtVideoUnavailableMessage } from "../ytdlp/isVideoUnavailable.js";

const MAX_DURATION_SEC = 600;

function pickThumbnail(entry: YtDlpSearchEntry): string {
  if (entry.thumbnail) return entry.thumbnail;
  const list = entry.thumbnails ?? [];
  if (list.length === 0) return `https://i.ytimg.com/vi/${entry.id}/mqdefault.jpg`;
  const sorted = [...list].sort(
    (a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0),
  );
  return sorted[0].url;
}

export async function registerSearchRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/search", {
    schema: { querystring: SearchQuerySchema },
    handler: async (req, reply) => {
      const { q } = req.query as { q: string };
      try {
        const entries = await ytdlpSearch(q, 10);
        const filtered: SearchResultItem[] = entries
          .filter(
            (e) =>
              !e.is_live &&
              typeof e.duration === "number" &&
              e.duration > 0 &&
              e.duration < MAX_DURATION_SEC,
          )
          .slice(0, 6)
          .map((e) => ({
            youtubeVideoId: e.id,
            title: e.title,
            channel: e.channel ?? e.uploader ?? "Unknown",
            durationSeconds: Math.round(e.duration ?? 0),
            thumbnailUrl: pickThumbnail(e),
          }));
        return reply.send(filtered);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (isYtVideoUnavailableMessage(msg)) {
          return reply.code(422).send({ error: "video_unavailable" });
        }
        req.log.error({ err }, "yt-dlp search failed");
        return reply.code(502).send({ error: "search_failed" });
      }
    },
  });
}
