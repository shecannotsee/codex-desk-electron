# Source Directory

This directory contains the Electron TypeScript source, build config, and package files.

## Main Process

- `main/main.ts`: Electron app lifecycle, BrowserWindow, close guard, menu dispatch.
- `main/ipc_registration.ts`: IPC handlers.
- `main/preload.ts`: safe renderer bridge.
- `main/app_controller/`: AppController mixins.
- `main/codex/`: Codex CLI/app-server bridge and output parsing.
- `main/telegram/`: Telegram notifications, sender, updates, and notification state.
- `main/security/`: credential vault and encryption helpers.
- `main/storage/`: state-store adapter.

## Renderer

- `renderer/index.html`: DOM shell.
- `renderer/app/`: TypeScript renderer modules.
- `renderer/styles.css`: layout, themes, Telegram-like visual style.

## Generated Files

- `app/`: build output from `npm run build`; ignored.
- `build/icon.png`: synced icon; ignored.
- `node_modules/`: dependencies; ignored.

## Commands

```bash
npm run check
npm run build
npm start
npm run capture:docs
npm run dist:deb
```

Project-level docs live in `../README.md` and `../docs/`.
