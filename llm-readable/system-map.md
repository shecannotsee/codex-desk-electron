# System Map (LLM)

## 1) Layer Map

- Main process source: `src/main/*`
- Preload bridge source: `src/main/preload.ts`
- Renderer process source: `src/renderer/*`
- Build output: `src/app/*`
- Packaging: `src/electron-builder.yml`, `src/scripts/*`

## 2) Main Ownership

- `src/main/main.ts`
  - BrowserWindow lifecycle
  - menu i18n + menu actions dispatch
  - close guard
  - IPC registration
- `src/main/app_controller.ts`
  - app controller composition root
- `src/main/app_controller/index.ts`
  - controller shape + shared helpers
- `src/main/app_controller/methods_runtime.ts`
  - conversations snapshot
  - runtime logs/workflow/raw append
  - queue snapshots + queue drain start
- `src/main/app_controller/methods_chat.ts`
  - send/retry/stop/clear/close
  - runner lifecycle and result writeback
- `src/main/app_controller/methods_meta.ts`
  - codex version/model probing
- `src/main/codex_runner.ts`
  - child process execution + stream/event parse
- `src/main/codex_app_server_runner.ts`
  - app server mode execution path
- `src/main/conversation_service.ts`
  - conversation mutation helpers
- `src/main/state_store.ts`
  - durable state read/write + migration
- `src/main/runtime_store.ts`
  - in-memory runtime data structures

## 3) Renderer Ownership

- `src/renderer/index.html`
  - DOM skeleton
  - quick settings panes
  - runtime tabs
  - context menu container
- `src/renderer/app/types.ts`
  - renderer shared types
  - app snapshot/event payloads
  - render options and UI element refs
- `src/renderer/app/codexdesk.ts`
  - typed preload bridge wrapper
- `src/renderer/app/state_i18n.ts`
  - global state
  - i18n dictionary
  - ui prefs load/save
  - theme/font/sidebar width application
- `src/renderer/app/conversation_runtime.ts`
  - selectors
  - message collapse state
  - workflow collapse state (default collapsed)
  - queue status derivation
- `src/renderer/app/renderers.ts`
  - list/header/chat/runtime/settings rendering
  - queued preview block rendering
  - transient running status rendering
- `src/renderer/app/bootstrap.ts`
  - init lifecycle
  - IPC snapshot/event handling
  - user interaction bindings
  - action router for settings/menu/context-menu
  - docs screenshot auto-capture flow (`capture:docs`)
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
- `conversation:toggle-pin`
- `conversation:close-current`
- `conversation:clear-chat`
- `conversation:clear-runtime`
- `conversation:stop`
- `chat:send`
- `chat:retry-last`
- `meta:refresh-codex-version`
- `meta:refresh-model`
- `docs:capture-enabled`
- `docs:capture-page`
- `docs:capture-finish`

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
  - `id,title,sessionId,messages[],createdAt,updatedAt,pinnedAt`
- runtime:
  - `workflow[],events[],raw[],phase,startedAt`
- ui prefs:
  - `language,theme,zoomFactor,chatFontSize,sidebarWidth,runtimePanelHidden,settingsPanelHidden,sidebarHidden`
- renderer shared types:
  - `AppState,AppSnapshot,AppEvent,RenderJobs,UiElementRefs`
