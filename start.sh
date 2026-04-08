#!/usr/bin/env bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
PACKAGE_DIR="$PROJECT_DIR/src"
cd "$PACKAGE_DIR"

BUILD_MARKER="$PACKAGE_DIR/app/main/main.js"
RENDERER_MARKER="$PACKAGE_DIR/app/renderer/index.html"
LOGO_TARGET="$PACKAGE_DIR/build/icon.png"
ELECTRON_BIN="$PACKAGE_DIR/node_modules/.bin/electron"

SOURCE_LOGO=""
if [[ -f "$PROJECT_DIR/resource/logo.png" ]]; then
  SOURCE_LOGO="$PROJECT_DIR/resource/logo.png"
elif [[ -f "$PROJECT_DIR/resource/logo_with_white_border.png" ]]; then
  SOURCE_LOGO="$PROJECT_DIR/resource/logo_with_white_border.png"
fi

needs_build() {
  if [[ ! -f "$BUILD_MARKER" || ! -f "$RENDERER_MARKER" ]]; then
    return 0
  fi

  local tracked_files=(
    "$PACKAGE_DIR/package.json"
    "$PACKAGE_DIR/package-lock.json"
    "$PACKAGE_DIR/tsconfig.main.json"
    "$PACKAGE_DIR/tsconfig.renderer.json"
  )

  local file
  for file in "${tracked_files[@]}"; do
    if [[ -f "$file" && "$file" -nt "$BUILD_MARKER" ]]; then
      return 0
    fi
  done

  if find "$PACKAGE_DIR/main" "$PACKAGE_DIR/renderer" "$PACKAGE_DIR/scripts" -type f -newer "$BUILD_MARKER" -print -quit | grep -q .; then
    return 0
  fi

  return 1
}

needs_logo_sync() {
  if [[ -z "$SOURCE_LOGO" ]]; then
    return 1
  fi
  if [[ ! -f "$LOGO_TARGET" ]]; then
    return 0
  fi
  [[ "$SOURCE_LOGO" -nt "$LOGO_TARGET" ]]
}

if [[ ! -d node_modules ]]; then
  echo "[CodexDesk Electron] installing dependencies..."
  npm install
fi

if needs_build; then
  echo "[CodexDesk Electron] source changed, rebuilding app ..."
  npm run build
else
  echo "[CodexDesk Electron] build outputs are up to date, skip rebuild."
fi

if needs_logo_sync; then
  echo "[CodexDesk Electron] syncing logo ..."
  node app/scripts/sync-logo.js
elif [[ -n "$SOURCE_LOGO" ]]; then
  echo "[CodexDesk Electron] logo is up to date, skip sync."
else
  echo "[CodexDesk Electron] warning: resource/logo.png not found, keep existing app icon."
fi

if [[ ! -x "$ELECTRON_BIN" ]]; then
  echo "[CodexDesk Electron] error: electron binary not found: $ELECTRON_BIN" >&2
  exit 1
fi

exec "$ELECTRON_BIN" .
