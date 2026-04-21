#!/usr/bin/env bash
set -euo pipefail

RENDER_GID=$(getent group render | cut -d: -f3 || echo "109")
VIDEO_GID=$(getent group video | cut -d: -f3 || echo "44")

echo "RENDER_GID=${RENDER_GID}"
echo "VIDEO_GID=${VIDEO_GID}"
