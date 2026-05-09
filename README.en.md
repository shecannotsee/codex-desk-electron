# conductor (English)

`conductor` is an Electron desktop client for Codex CLI and Claude Code. Electron owns windows, rendering, IPC, menus, and system integration; main-process business code is organized into CLI bridges, Telegram, security, app-controller, and renderer domains.

## Features

- Multi-conversation workspace with per-conversation working directories.
- `codex exec` execution with native resume/fork support; app-server path when available.
- Claude Code execution through `claude -p --output-format stream-json`, with native resume/fork support.
- Runtime observability: workflow steps, structured events, raw JSON, phase, elapsed time, and queued messages.
- Per-conversation queued follow-up messages.
- Image attachments for compatible Codex CLI flows.
- Conductor session file (`.jsonl`) import/export with Codex/Claude provider metadata.
- Telegram notifications and Telegram remote control.
- Master-password credential vault for Telegram tokens.
- Quick settings for language, theme, layout, zoom, side panels, notification, and remote control.
- Bottom conversation directory: left-click opens the folder; right-click copies the path.
- Local file links and external links are delegated to the system.

## Documentation

- Quick Start: [docs/quick-start.md](./docs/quick-start.md)
- User Guide: [docs/user-guide.md](./docs/user-guide.md)
- CLI vs GUI: [docs/cli-vs-gui.md](./docs/cli-vs-gui.md)
- Architecture: [docs/architecture.md](./docs/architecture.md)
- Dev Guide: [docs/dev-guide.md](./docs/dev-guide.md)
- Ubuntu DEB Deploy: [docs/deploy-ubuntu.md](./docs/deploy-ubuntu.md)
- Uninstall Guide: [docs/uninstall.md](./docs/uninstall.md)
- FAQ: [docs/faq.md](./docs/faq.md)
- Changelog: [CHANGELOG.md](./CHANGELOG.md)

## Layout

```text
src/main/              Electron main process and domain modules
src/main/codex/        Codex bridge, output parsing, usage metadata
src/main/claude/       Claude Code print-mode bridge, stream-json parsing, usage metadata
src/main/telegram/     Telegram API, sender, updates, notification state
src/main/security/     Credential vault and encryption helpers
src/main/app_controller/ AppController mixins and runtime orchestration
src/renderer/          HTML/CSS and TypeScript renderer modules
docs/                  User, architecture, deployment and development docs
notes/                 Project-local notes only
```

Generated/runtime folders such as `src/app/`, `conductor-workspace/`, `.conductor/`, and `src/node_modules/` are ignored.

## Quick Run

```bash
cd /home/shecannotsee/Desktop/projects/conductor
./start.sh
```

Manual development run:

```bash
cd /home/shecannotsee/Desktop/projects/conductor/src
npm install
npm run check
npm start
```

## Validation and Screenshots

```bash
cd /home/shecannotsee/Desktop/projects/conductor/src
npm run check
npm run build
npm run capture:docs
```

`capture:docs` opens a dedicated Electron capture window and does not use the currently active client window.

## Platform Status

- Verified: Ubuntu 22.04
- Not yet verified: Windows, macOS
