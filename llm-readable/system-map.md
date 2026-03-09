# System Map (LLM)

## 1) Layer Map

- Main process: `src/main/*`
- Preload bridge: `src/main/preload.js`
- Renderer process: `src/renderer/*`
- Shared util: `src/shared/*`
- Packaging: `src/electron-builder.yml`, `src/scripts/deb/*`

## 2) Main Ownership

- `src/main/main.js`
  - BrowserWindow lifecycle
  - menu i18n + menu actions dispatch
  - close guard
  - IPC registration
- `src/main/app_controller/index.js`
  - class wiring + method composition
- `src/main/app_controller/methods_runtime.js`
  - conversations snapshot
  - runtime logs/workflow/raw append
  - queue snapshots + queue drain start
- `src/main/app_controller/methods_chat.js`
  - send/retry/stop/clear/close
  - runner lifecycle and result writeback
- `src/main/app_controller/methods_meta.js`
  - codex version/model probing
- `src/main/codex_runner.js`
  - child process execution + stream/event parse
- `src/main/state_store.js`
  - durable state read/write + migration
- `src/main/runtime_store.js`
  - in-memory runtime data structures

## 3) Renderer Ownership

- `src/renderer/index.html`
  - DOM skeleton
  - quick settings panes
  - runtime tabs
  - context menu container
- `src/renderer/app/state_i18n.js`
  - global state
  - i18n dictionary
  - ui prefs load/save
  - theme/font/sidebar width application
- `src/renderer/app/conversation_runtime.js`
  - selectors
  - message collapse state
  - workflow collapse state (default collapsed)
  - queue status derivation
- `src/renderer/app/renderers.js`
  - list/header/chat/runtime/settings rendering
  - queued preview block rendering
- `src/renderer/app/bootstrap.js`
  - init lifecycle
  - IPC snapshot/event handling
  - user interaction bindings
  - action router for settings/menu/context-menu
- `src/renderer/styles.css`
  - telegram-like visual tokens
  - light/dark theme vars
  - theme-aware scrollbars

## 4) IPC Contract (renderer -> main)

- `app:get-snapshot`
- `app:update-settings`
- `ui:set-menu-language`
- `ui:invoke-action`
- `conversation:create`
- `conversation:switch`
- `conversation:rename`
- `conversation:close-current`
- `conversation:clear-chat`
- `conversation:clear-runtime`
- `conversation:stop`
- `chat:send`
- `chat:retry-last`
- `meta:refresh-codex-version`
- `meta:refresh-model`

## 5) Event Bus (main -> renderer)

- `app:event` payload `type` includes:
  - `runtime-event-append`
  - `runtime-workflow-append`
  - `runtime-raw-append`
  - `runtime-phase`
  - `runtime-started-at`
  - `runtime-reset`
  - `conversation-updated`
  - `conversation-removed`
  - `meta-updated`
  - `runner-state`
  - `queue-updated`
- `app:menu-action`

## 6) Data Models (minimal)

- conversation:
  - `id,title,sessionId,messages[],createdAt,updatedAt`
- runtime:
  - `workflow[],events[],raw[],phase,startedAt`
- ui prefs:
  - `language,theme,chatFontSize,sidebarWidth,runtimePanelHidden,settingsPanelHidden,sidebarHidden`
