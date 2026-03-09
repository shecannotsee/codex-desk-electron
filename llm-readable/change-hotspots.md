# Change Hotspots (LLM)

## Task -> Files Map

- Add/modify conversation behavior
  - `src/main/app_controller/methods_chat.js`
  - `src/main/app_controller/methods_runtime.js`
  - `src/renderer/app/bootstrap.js`
  - `src/renderer/app/renderers.js`

- Add/modify queue behavior
  - `src/main/app_controller/methods_chat.js`
  - `src/main/app_controller/methods_runtime.js`
  - `src/renderer/app/conversation_runtime.js`
  - `src/renderer/app/renderers.js`

- Add/modify runtime step rendering/collapse
  - `src/renderer/app/conversation_runtime.js`
  - `src/renderer/app/renderers.js`
  - `src/renderer/styles.css`

- Add/modify settings menu tree/actions
  - `src/renderer/index.html`
  - `src/renderer/app/bootstrap.js`
  - `src/renderer/app/state_i18n.js`
  - `src/main/main.js` (for main-process actions)

- Add/modify menu language / i18n text
  - `src/renderer/app/state_i18n.js`
  - `src/main/main.js`

- Add/modify sidebar layout / drag resize / context menu
  - `src/renderer/index.html`
  - `src/renderer/app/bootstrap.js`
  - `src/renderer/styles.css`

- Add/modify close-window behavior
  - `src/main/main.js`
  - optionally `src/main/app_controller/methods_runtime.js`

- Add/modify codex version/model detection
  - `src/main/app_controller/methods_meta.js`
  - `src/renderer/app/renderers.js` (display)

- Add/modify packaging / icon
  - `src/scripts/sync-logo.js`
  - `src/electron-builder.yml`
  - `resource/logo.png`
  - `start.sh`

- Add/modify docs screenshot automation
  - `src/main/main.js`
  - `src/main/preload.js`
  - `src/renderer/app/bootstrap.js`
  - `src/package.json`
  - `docs/assets/*`

## Required Validation after code change

1. `cd src && npm run check`
2. run app and verify manually:
   - create/switch conversation
   - send + queue send
   - workflow default collapsed
   - queued preview visible
   - settings multi-level navigation
   - light/dark switch affects runtime tabs and scrollbars
   - sidebar width drag and hide/show
   - close-window guard when running

## Regression Risks

- IPC action name drift between renderer and main
- i18n key mismatch causing mixed-language UI
- queue counter mismatch between snapshot and event updates
- collapse-state memory leak after conversation removal
- theme vars not applied to newly introduced nodes
