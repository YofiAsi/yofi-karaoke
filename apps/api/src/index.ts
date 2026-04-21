import Fastify from "fastify";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from "fastify-type-provider-zod";

import { env } from "./env.js";
import { attachUserHook } from "./auth/userCookie.js";
import { registerUserRoutes } from "./routes/users.js";
import { registerSearchRoutes } from "./routes/search.js";
import { registerQueueRoutes } from "./routes/queue.js";
import { registerAudioRoutes } from "./routes/audio.js";

async function build() {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    trustProxy: true,
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cors, {
    origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN.split(","),
    credentials: true,
  });

  await app.register(cookie, { secret: env.SESSION_SECRET });

  app.addHook("preHandler", attachUserHook);

  app.get("/health", async () => ({ ok: true }));

  await registerUserRoutes(app);
  await registerSearchRoutes(app);
  await registerQueueRoutes(app);
  await registerAudioRoutes(app);

  app.setErrorHandler((err, _req, reply) => {
    const statusCode =
      (err as Error & { statusCode?: number }).statusCode ?? err.statusCode ?? 500;
    reply.log.error({ err }, "request error");
    reply.code(statusCode).send({ error: err.message ?? "internal_error" });
  });

  return app;
}

async function main(): Promise<void> {
  const app = await build();
  try {
    await app.listen({ port: env.PORT, host: env.HOST });
    app.log.info({ port: env.PORT, host: env.HOST }, "api listening");
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

main();
