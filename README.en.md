# codex-desk-electron (English)

`codex-desk-electron` is an Electron desktop client for Codex CLI, with multi-conversation management and runtime observability.

## Documentation

- Quick Start: [docs/quick-start.md](./docs/quick-start.md)
- User Guide (scenario-based): [docs/user-guide.md](./docs/user-guide.md)
- CLI vs GUI (core): [docs/cli-vs-gui.md](./docs/cli-vs-gui.md)
- Architecture: [docs/architecture.md](./docs/architecture.md)
- Dev Guide: [docs/dev-guide.md](./docs/dev-guide.md)
- Ubuntu DEB Deploy: [docs/deploy-ubuntu.md](./docs/deploy-ubuntu.md)
- Uninstall Guide: [docs/uninstall.md](./docs/uninstall.md)
- FAQ: [docs/faq.md](./docs/faq.md)
- Changelog: [CHANGELOG.md](./CHANGELOG.md)
- LLM Readable Map: [llm-readable/README.md](./llm-readable/README.md)

## Validation Status

- Verified: `Ubuntu 22.04`
- Not yet verified: `Windows`, `macOS`

## Project Layout

- `src/main/`: TypeScript main-process sources, orchestration, runtime control
- `src/renderer/`: TypeScript renderer sources and HTML shell
- `src/app/`: compiled output from `npm run build`
- `llm-readable/`: model-first code map and flow index
- `docs/`: project docs
- `start.sh`: one-command launcher

## Quick Start

### Option A: launch from project root

```bash
cd /home/shecannotsee/Desktop/projects/codex-desk-electron
./start.sh
```

### Option B: manual dev launch

```bash
cd /home/shecannotsee/Desktop/projects/codex-desk-electron/src
npm install
npm run check
npm start
```

## Ubuntu DEB Build

```bash
cd /home/shecannotsee/Desktop/projects/codex-desk-electron/src
npm run dist:deb
```

## Docs Screenshot Capture

```bash
cd /home/shecannotsee/Desktop/projects/codex-desk-electron/src
npm run capture:docs
```

## Documentation Maintenance Rule

- Must update before each release:
  - `docs/cli-vs-gui.md`
  - `CHANGELOG.md`
- PR should include doc update status:
  - `.github/pull_request_template.md`

## Current Interaction Notes

- Main and renderer sources are now fully authored in `TypeScript`; local verification is `cd src && npm run check`.
- The renderer no longer depends on ordered global scripts and is loaded as `ES modules`.
- `src/renderer/app/types.ts` centralizes renderer-side state, event, and render option types.
- App zoom in the settings drawer now uses a `10%` stepped slider.
- Dragging the zoom slider applies zoom immediately and keeps the settings drawer open.
- Keyboard zoom shortcuts show a temporary percentage HUD near the top of the window.
- Main keyboard shortcuts:
  - `Alt+=`: zoom in
  - `Alt+-`: zoom out
  - `Alt+0`: reset zoom
- Switching conversations scrolls directly to the latest message.
- Selected text in chat and runtime panels can be copied from the right-click menu.
- External links in replies open in the system default browser.
