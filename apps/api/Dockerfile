FROM node:22-alpine AS base
RUN corepack enable

FROM base AS builder
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm --filter api build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=builder /app /app
EXPOSE 4000
WORKDIR /app/apps/api
CMD ["sh", "-c", "pnpm prisma migrate deploy && node dist/index.js"]
