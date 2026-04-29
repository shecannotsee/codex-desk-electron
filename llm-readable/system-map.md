# System Map

## Runtime Layers

- Electron main: `src/main/main.ts`
- IPC registration: `src/main/ipc_registration.ts`
- Preload bridge: `src/main/preload.ts`
- App controller: `src/main/app_controller/`
- Codex domain: `src/main/codex/`
- Telegram domain: `src/main/telegram/`
- Security domain: `src/main/security/`
- Renderer: `src/renderer/app/`, `src/renderer/index.html`, `src/renderer/styles.css`
- Build output: `src/app/` (ignored)

## Main Domain Boundaries

### Codex

Public entry: `src/main/codex/index.ts`

- `codex_runner.ts`: `codex exec` subprocess runner.
- `codex_app_server_runner.ts`: app-server JSON-RPC runner.
- `codex_app_server_command.ts`: converts `codex exec` options to app-server settings.
- `codex_cli_gateway.ts`: shell args, usage parsing, probe option normalization.
- `codex_runner_output.ts`: event text extraction, plan status, step summary, assistant text fallback.
- `codex_runner_metadata.ts`: version/model meta.
- `codex_runner_usage.ts`: token usage meta.

### Telegram

Public entry: `src/main/telegram/index.ts`

- `telegram_bridge.ts`: provider class used by notification center.
- `telegram_sender.ts`: send/edit/callback/test helpers.
- `telegram_updates.ts`: polling coordinator and offsets.
- `telegram_notification_registry.ts`: expandable notification cache and inline keyboard markup.
- `telegram_message_format.ts`: result message formatting.
- `telegram_log_store.ts`: local Telegram logs.

### Security

Public entry: `src/main/security/index.ts`

- `integration_secrets.ts`: vault, password hash, AES-GCM token encryption, fingerprints.

### App Controller

Composition root: `src/main/app_controller/index.ts`

Important mixins:

- Chat: `methods_chat.ts`, `chat_runner_events.ts`, `chat_stream_preview.ts`.
- Runtime: `methods_runtime.ts`, `runtime_events.ts`, `runtime_runner_lifecycle.ts`, `runtime_snapshot.ts`.
- Persistence/security/settings: `runtime_persistence.ts`, `runtime_security.ts`, `runtime_settings.ts`.
- Session files: `runtime_session_files.ts`.
- Remote control: `methods_remote_control.ts`.
- Meta probe: `methods_meta.ts`.

## Renderer Ownership

- `bootstrap.ts`: initialization, global click handlers, local path open, workdir context-copy binding.
- `composer_renderer.ts`: bottom composer area, workdir display attributes.
- `context_menu_controller.ts`: conversation menu and selected-text copy menu.
- `integration_settings.ts`: Telegram/security settings UI.
- `runtime_renderer.ts`: workflow/events/raw rendering.
- `docs_capture_sequence.ts`: screenshot automation.
- `types.ts`: shared renderer types.

## Ignored Runtime/Generated Paths

- `.codexdesk/`
- `codex-workspace/`
- `src/app/`
- `src/build/icon.png`
- `src/node_modules/`
