# Change Hotspots

## Add or change Codex output handling

Start here:

- `src/main/codex/codex_runner_output.ts`
- `src/main/codex/codex_runner.ts`
- `src/main/codex/codex_app_server_runner.ts`
- `src/main/app_controller/chat_runner_events.ts`

Regression:

```bash
cd src && npm run check
```

If JSON event shape changes, update docs architecture and LLM flows.

## Change send/queue behavior

Start here:

- `src/main/app_controller/methods_chat.ts`
- `src/main/app_controller/methods_runtime_queue.ts`
- `src/main/app_controller/chat_runner_events.ts`
- `src/renderer/app/queue_popover_controller.ts`
- `src/renderer/app/runtime_renderer.ts`

Watch for:

- preserving per-conversation queue isolation
- not auto-draining after failed runner unless explicitly intended
- keeping user message interruption markers correct

## Change Telegram notification or remote control

Start here:

- `src/main/telegram/telegram_bridge.ts`
- `src/main/telegram/telegram_sender.ts`
- `src/main/telegram/telegram_updates.ts`
- `src/main/remote_control_bridge.ts`
- `src/main/app_controller/methods_remote_control.ts`
- `src/renderer/app/integration_settings.ts`

Watch for:

- locked credential vault behavior
- chat id / allowed chat id separation
- callback query ownership checks

## Change credential storage

Start here:

- `src/main/security/integration_secrets.ts`
- `src/main/state_store.ts`
- `src/main/app_controller/runtime_security.ts`
- `src/renderer/app/integration_settings.ts`

Do not log raw tokens. Keep `.codexdesk/secrets.electron.json` out of Git.

## Change bottom workdir behavior

Start here:

- `src/renderer/app/composer_renderer.ts`
- `src/renderer/app/bootstrap.ts`
- `src/main/local_path_opener.ts`
- `src/renderer/styles.css`

Existing contract:

- left-click opens system path
- right-click copies full path
- UI remains visually text-like, no button frame

## Change renderer layout/theme

Start here:

- `src/renderer/styles.css`
- `src/renderer/app/state_i18n.ts`
- `src/renderer/app/shell_renderer.ts`
- `src/renderer/app/settings_renderer.ts`
- `src/renderer/app/renderers.ts`

Run screenshot capture if visual docs are affected.

## Move files or domain boundaries

Start here:

- domain `index.ts` entry files
- all `require('../codex')`, `require('./telegram')`, `require('./security')`
- `docs/architecture.md`
- `llm-readable/system-map.md`

Run:

```bash
cd src && npm run build
node -e "require('./app/main/codex'); require('./app/main/telegram'); require('./app/main/security')"
```
