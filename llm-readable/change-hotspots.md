# Change Hotspots (LLM)

## Task -> Files Map

- Add/modify conversation behavior
  - `src/main/app_controller/methods_chat.ts`
  - `src/main/app_controller/methods_runtime.ts`
  - `src/renderer/app/bootstrap.ts`
  - `src/renderer/app/renderers.ts`

- Add/modify queue behavior
  - `src/main/app_controller/methods_chat.ts`
  - `src/main/app_controller/methods_runtime.ts`
  - `src/renderer/app/conversation_runtime.ts`
  - `src/renderer/app/renderers.ts`

- Add/modify runtime step rendering/collapse
  - `src/renderer/app/conversation_runtime.ts`
  - `src/renderer/app/renderers.ts`
  - `src/renderer/styles.css`

- Add/modify settings menu tree/actions
  - `src/renderer/index.html`
  - `src/renderer/app/bootstrap.ts`
  - `src/renderer/app/state_i18n.ts`
  - `src/main/main.ts` (for main-process actions)

- Add/modify menu language / i18n text
  - `src/renderer/app/state_i18n.ts`
  - `src/main/main.ts`

- Add/modify sidebar layout / drag resize / context menu
  - `src/renderer/index.html`
  - `src/renderer/app/bootstrap.ts`
  - `src/renderer/styles.css`

- Add/modify selection copy / external link behavior
  - `src/main/main.ts`
  - `src/renderer/index.html`
  - `src/renderer/app/bootstrap.ts`
  - `src/renderer/app/renderers.ts`
  - `src/renderer/app/state_i18n.ts`

- Add/modify zoom shortcut HUD / conversation switch scroll behavior
  - `src/renderer/index.html`
  - `src/renderer/app/bootstrap.ts`
  - `src/renderer/app/renderers.ts`
  - `src/renderer/app/state_i18n.ts`
  - `src/renderer/styles.css`

- Add/modify close-window behavior
  - `src/main/main.ts`
  - optionally `src/main/app_controller/methods_runtime.ts`

- Add/modify codex version/model detection
  - `src/main/app_controller/methods_meta.ts`
  - `src/renderer/app/renderers.ts` (display)

- Add/modify renderer shared typing / module boundaries
  - `src/renderer/app/types.ts`
  - `src/renderer/app/codexdesk.ts`
  - `src/renderer/app/state_i18n.ts`
  - `src/renderer/app/renderers.ts`
  - `src/renderer/app/bootstrap.ts`

- Add/modify packaging / icon
  - `src/scripts/sync-logo.ts`
  - `src/scripts/postbuild-copy.ts`
  - `src/electron-builder.yml`
  - `resource/logo.png`
  - `start.sh`

- Add/modify docs screenshot automation
  - `src/main/main.ts`
  - `src/main/preload.ts`
  - `src/renderer/app/bootstrap.ts`
  - `src/package.json`
  - `docs/assets/*`

## Required Validation after code change

1. `cd src && npm run check`
2. if source/build boundary changed, also run `cd src && npm run build`
3. run app and verify manually:
   - create/switch conversation
   - send + queue send
   - workflow default collapsed
   - queued preview visible
   - settings multi-level navigation
   - light/dark switch affects runtime tabs and scrollbars
   - zoom shortcut HUD appears and auto-hides
   - conversation switch lands at latest message
   - selected text can be copied via context menu in chat/runtime panels
   - external links open in default browser
   - sidebar width drag and hide/show
   - close-window guard when running

## Regression Risks

- IPC action name drift between renderer and main
- type drift between preload contract and renderer assumptions
- queue counter mismatch between snapshot and event updates
- collapse-state memory leak after conversation removal
- theme vars not applied to newly introduced nodes
- compiled `src/app/` output stale relative to `.ts` sources
