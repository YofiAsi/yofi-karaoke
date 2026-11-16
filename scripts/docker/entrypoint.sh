#!/bin/sh
# Container entrypoint for api and worker: refreshes yt-dlp without blocking startup, logs tool versions, then execs CMD.

VENV_DIR="${VENV_DIR:-/opt/venv}"

refresh_ytdlp() {
  if [ "${YTDLP_AUTO_UPDATE:-true}" != "true" ]; then
    echo "entrypoint: yt-dlp auto update disabled"
    return
  fi
  timeout "${YTDLP_UPDATE_TIMEOUT_SECONDS:-120}" "$VENV_DIR/bin/pip" install \
    --quiet --no-cache-dir --disable-pip-version-check --upgrade "yt-dlp[default]" \
    || echo "entrypoint: yt-dlp update failed, keeping the installed version" >&2
}

log_versions() {
  echo "entrypoint: yt-dlp $(yt-dlp --version 2>/dev/null || echo unavailable)"
  echo "entrypoint: $(command -v deno >/dev/null && deno --version | head -n 1 || echo 'deno unavailable')"
}

refresh_ytdlp
log_versions
exec "$@"
