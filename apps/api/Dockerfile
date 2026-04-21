FROM node:22-alpine AS base
RUN corepack enable && apk add --no-cache python3 py3-pip ffmpeg openssl \
  && pip3 install --no-cache-dir --break-system-packages yt-dlp

FROM base AS builder
WORKDIR /app
COPY . .
RUN pnpm install
RUN pnpm --filter @karaoke/shared build
RUN pnpm --filter api build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app /app
EXPOSE 4000
WORKDIR /app/apps/api
CMD ["sh", "-c", "pnpm prisma migrate deploy && node dist/index.js"]
