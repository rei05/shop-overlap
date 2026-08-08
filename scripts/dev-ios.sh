#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
api_url="${SHOP_OVERLAP_API_URL:-http://127.0.0.1:8787}"
health_url="$api_url/api/chains?q="
api_pid=""
owns_api=false

cleanup() {
  if [[ "$owns_api" == true && -n "$api_pid" ]] && kill -0 "$api_pid" 2>/dev/null; then
    kill "$api_pid" 2>/dev/null || true
    wait "$api_pid" 2>/dev/null || true
  fi
  api_pid=""
}
trap cleanup EXIT INT TERM

if curl -fsS --connect-timeout 1 --max-time 2 "$health_url" >/dev/null 2>&1; then
  echo "Using the API Worker already running at $api_url."
else
  vars_file="$repo_root/apps/api/.dev.vars"
  if [[ ! -s "$vars_file" ]]; then
    echo "Missing $vars_file. Copy .dev.vars.example and configure GOOGLE_MAPS_API_KEY." >&2
    exit 1
  fi
  if ! grep -Eq '^GOOGLE_MAPS_API_KEY=[[:space:]]*[^[:space:]]+' "$vars_file" ||
     grep -Eq '^GOOGLE_MAPS_API_KEY=[[:space:]]*replace-' "$vars_file"; then
    echo "Configure GOOGLE_MAPS_API_KEY in $vars_file before launching the app." >&2
    exit 1
  fi

  echo "Starting the API Worker at $api_url..."
  npm --prefix "$repo_root" run api:dev &
  api_pid=$!
  owns_api=true

  for _ in $(seq 1 60); do
    if curl -fsS --connect-timeout 1 --max-time 2 "$health_url" >/dev/null 2>&1; then
      break
    fi
    if ! kill -0 "$api_pid" 2>/dev/null; then
      wait "$api_pid"
      exit 1
    fi
    sleep 0.5
  done
  if ! curl -fsS --connect-timeout 1 --max-time 2 "$health_url" >/dev/null 2>&1; then
    echo "The API Worker did not become ready at $api_url." >&2
    exit 1
  fi
fi

bash "$repo_root/apps/ios/Scripts/run-simulator.sh"

if [[ "$owns_api" == true ]]; then
  echo "The API Worker remains active for Simulator testing. Press Ctrl+C to stop it."
  wait "$api_pid"
fi
