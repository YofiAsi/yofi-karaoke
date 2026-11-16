FROM denoland/deno:bin-2.9.8 AS deno

FROM node:22-bookworm-slim AS node-builder
RUN corepack enable
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/worker/package.json apps/worker/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @karaoke/shared build
RUN pnpm --filter worker build

FROM ubuntu:22.04 AS runner
ENV DEBIAN_FRONTEND=noninteractive
ENV VENV_DIR=/opt/venv
ENV PATH=/opt/venv/bin:$PATH
ENV PYTHON_BIN=/opt/venv/bin/python

RUN apt-get update && apt-get install -y \
  curl \
  gnupg \
  ca-certificates \
  procps \
  build-essential \
  python3.11 \
  python3.11-dev \
  python3.11-venv \
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
  && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
  apt-get install -y nodejs && rm -rf /var/lib/apt/lists/*

COPY --from=deno /deno /usr/local/bin/deno

COPY apps/worker/python/requirements.txt /tmp/requirements.txt
RUN python3.11 -m venv /opt/venv \
  && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
  && /opt/venv/bin/pip install --no-cache-dir -r /tmp/requirements.txt

WORKDIR /app
COPY --from=node-builder /app /app
COPY scripts/docker/entrypoint.sh /usr/local/bin/karaoke-entrypoint.sh

WORKDIR /app/apps/worker
ENTRYPOINT ["sh", "/usr/local/bin/karaoke-entrypoint.sh"]
CMD ["sh", "-c", "clinfo -l && exec node dist/index.js"]
