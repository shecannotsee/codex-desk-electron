#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR/src"

if [[ ! -d node_modules ]]; then
  echo "[CodexDesk Electron] installing dependencies..."
  npm install
fi

npm start
