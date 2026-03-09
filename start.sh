#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR/src"

if [[ ! -d node_modules ]]; then
  echo "[CodexDesk Electron] installing dependencies..."
  npm install
fi

if [[ -f "$PROJECT_DIR/resource/logo.png" ]]; then
  echo "[CodexDesk Electron] syncing logo from resource/logo.png ..."
  npm run sync:logo
else
  echo "[CodexDesk Electron] warning: resource/logo.png not found, keep existing app icon."
fi

npm run start:app
