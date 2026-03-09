# LLM Readable Entry

Purpose: fast project ingestion for any large language model.
Audience: machine readers first.
Human narration is intentionally minimized.

## Read Order (strict)

1. `system-map.md`
2. `core-flows.md`
3. `change-hotspots.md`
4. `task-prompts.md`

## Project Snapshot

- Name: `codex-desk-electron`
- Type: Electron GUI wrapper for Codex CLI
- Verified platform: `Ubuntu 22.04`
- Not yet verified: `Windows`, `macOS`
- Runtime entry: `src/main/main.js`
- Renderer entry: `src/renderer/index.html`
- Main controller facade: `src/main/app_controller/index.js`
- Renderer split modules: `src/renderer/app/*.js`

## Feature Flags / Facts

- Multi-conversation lifecycle: create/switch/rename/close
- Send during running: queued by conversation, serial execution
- Runtime observability tabs: structured/workflow/raw JSON
- Workflow step default state: collapsed
- Queue preview: visible in workflow tab
- UI style: Telegram-like chat and settings pattern
- Settings menu: multi-level in-app menu (root -> category detail)
- Native menubar: hidden by default (`autoHideMenuBar: true`)
- Theme: light/dark (persisted)
- Language: zh-CN / en-US (persisted)
- Sidebar: hide/show + drag resize (persisted)
- Close-window guard: confirms when tasks are running

## State Persistence

- File state: `.codexdesk/state.electron.json`
- UI prefs key: `localStorage['codexdesk.ui-prefs.v1']`

## Build/Run

- Dev quick run: `./start.sh`
- Check: `cd src && npm run check`
- Ubuntu package: `cd src && npm run dist:deb`
