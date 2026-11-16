import type { FastifyInstance } from "fastify";
import { SearchQuerySchema } from "@karaoke/shared";
import { requireUser } from "../auth/userCookie.js";
import { ytdlpSearch } from "../ytdlp.js";
import { isYtVideoUnavailableMessage } from "../ytdlp/isVideoUnavailable.js";
import { toSearchResults } from "../search/results.js";
import { createSearchService, SearchBusyError } from "../search/searchService.js";

const YTDLP_SEARCH_COUNT = 10;

const searchService = createSearchService({
  search: async (query) => toSearchResults(await ytdlpSearch(query, YTDLP_SEARCH_COUNT)),
});

export async function registerSearchRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/search", {
    schema: { querystring: SearchQuerySchema },
    handler: async (req, reply) => {
      const user = await requireUser(req);
      const { q } = req.query as { q: string };
      try {
        const outcome = await searchService.search(user.id, q);
        if (outcome.kind === "rate_limited") {
          return reply
            .code(429)
            .header("Retry-After", String(outcome.retryAfterSeconds))
            .send({ error: "rate_limited", retryAfterSeconds: outcome.retryAfterSeconds });
        }
        return reply.send(outcome.results);
      } catch (err) {
        if (err instanceof SearchBusyError) {
          return reply.code(503).header("Retry-After", "5").send({ error: "search_busy" });
        }
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
