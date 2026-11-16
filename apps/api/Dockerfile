FROM node:22-alpine3.24 AS base
ENV VENV_DIR=/opt/venv
ENV PATH=/opt/venv/bin:$PATH
RUN corepack enable && apk add --no-cache python3 ffmpeg openssl deno \
  && python3 -m venv /opt/venv \
  && /opt/venv/bin/pip install --no-cache-dir "yt-dlp[default]"

FROM base AS builder
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter @karaoke/shared build
RUN pnpm --filter api build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app /app
COPY scripts/docker/entrypoint.sh /usr/local/bin/karaoke-entrypoint.sh
EXPOSE 4000
WORKDIR /app/apps/api
ENTRYPOINT ["sh", "/usr/local/bin/karaoke-entrypoint.sh"]
CMD ["sh", "-c", "pnpm prisma migrate deploy && exec node dist/index.js"]
