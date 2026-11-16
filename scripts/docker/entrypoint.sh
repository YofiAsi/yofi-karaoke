#!/bin/sh
# Container entrypoint for api and worker: refreshes yt-dlp without blocking startup or losing the installed copy, logs tool versions, then execs CMD.

VENV_DIR="${VENV_DIR:-/opt/venv}"
PIP="$VENV_DIR/bin/pip"
YTDLP_SPEC="yt-dlp[default]"

download_ytdlp() {
  timeout "${YTDLP_UPDATE_TIMEOUT_SECONDS:-45}" "$PIP" download \
    --quiet --no-cache-dir --disable-pip-version-check --timeout 10 --retries 1 \
    --dest "$1" "$YTDLP_SPEC"
}

install_ytdlp_from() {
  "$PIP" install --quiet --disable-pip-version-check --no-index \
    --find-links "$1" --upgrade "$YTDLP_SPEC"
}

refresh_ytdlp() {
  if [ "${YTDLP_AUTO_UPDATE:-true}" != "true" ]; then
    echo "entrypoint: yt-dlp auto update disabled"
    return
  fi
  wheel_dir=$(mktemp -d)
  if ! download_ytdlp "$wheel_dir"; then
    echo "entrypoint: yt-dlp download failed or timed out, keeping the installed version" >&2
  elif ! install_ytdlp_from "$wheel_dir"; then
    echo "entrypoint: yt-dlp install failed, keeping the installed version" >&2
  fi
  rm -rf "$wheel_dir"
}

log_versions() {
  echo "entrypoint: yt-dlp $(yt-dlp --version 2>/dev/null || echo unavailable)"
  echo "entrypoint: $(command -v deno >/dev/null && deno --version | head -n 1 || echo 'deno unavailable')"
}

refresh_ytdlp
log_versions
exec "$@"
