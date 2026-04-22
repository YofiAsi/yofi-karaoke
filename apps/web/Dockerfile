FROM node:22-alpine AS base
RUN corepack enable

FROM base AS builder
WORKDIR /app
ARG NEXT_PUBLIC_WS_URL=""
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL
COPY . .
RUN pnpm install
RUN pnpm --filter @karaoke/shared build
RUN pnpm --filter web build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
