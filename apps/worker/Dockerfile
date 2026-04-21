FROM node:22-bookworm-slim AS node-builder
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-workspace.yaml ./
COPY apps/worker/package.json ./apps/worker/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter worker build

FROM ubuntu:22.04 AS runner
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y \
  curl \
  gnupg \
  ca-certificates \
  python3.11 \
  python3-pip \
  ffmpeg \
  clinfo \
  && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://repositories.intel.com/graphics/intel-graphics.key \
  | gpg --dearmor -o /usr/share/keyrings/intel-graphics.gpg && \
  echo "deb [arch=amd64 signed-by=/usr/share/keyrings/intel-graphics.gpg] \
  https://repositories.intel.com/graphics/ubuntu jammy arc" \
  > /etc/apt/sources.list.d/intel-graphics.list && \
  apt-get update && apt-get install -y \
  intel-opencl-icd \
  intel-level-zero-gpu \
  level-zero \
  libze1 \
  libze-intel-gpu1 \
  && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
  apt-get install -y nodejs && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=node-builder /app/apps/worker/dist ./apps/worker/dist
COPY --from=node-builder /app/node_modules ./node_modules
COPY --from=node-builder /app/apps/worker/node_modules ./apps/worker/node_modules
COPY apps/worker/python ./apps/worker/python

RUN pip3 install --no-cache-dir -r /app/apps/worker/python/requirements.txt

CMD clinfo -l && node apps/worker/dist/index.js
