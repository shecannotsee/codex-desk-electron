# Core Flows

## A. Send Message

1. Renderer calls `codexdesk.sendMessage` from `composer_controller.ts`.
2. IPC `chat:send` reaches `AppController.sendMessage` in `methods_chat.ts`.
3. Controller validates active conversation, message text, attachments, and workdir.
4. If same conversation is running, message is appended to queue.
5. Runner is selected:
   - `CodexAppServerRunner` when native app-server mode is allowed and no image attachment exists.
   - `CodexRunner` otherwise.
6. `chat_runner_events.ts` binds status/event/raw/meta/delta/update/plan/step/finished.
7. Runtime events are emitted to renderer.
8. On finish, assistant reply and usage are persisted; runner is released.
9. Successful completion starts next queued message.

## B. Streaming Preview

1. Runner emits `assistant_delta` or `assistant_update`.
2. `chat_runner_events.ts` updates per-runner assistant buffer.
3. `chat_stream_preview.ts` throttles preview updates.
4. Runtime workflow/structured assistant update is replaced in place.
5. Final result removes running preview and writes final assistant message.

## C. Queue

1. `sendMessage` sees `_isConversationRunning(targetId)`.
2. Message enters `pendingQueueByConversation`.
3. Renderer receives `queue-updated`.
4. On successful finish, `_startNextQueuedMessage(targetId)` sends next item.
5. On failure, queue is preserved and auto-drain stops.

## D. Codex Runner

1. `codex_runner_command.ts` normalizes `codex exec` args.
2. `codex_runner.ts` spawns subprocess.
3. stdout/stderr lines are stripped and stored as raw lines.
4. JSON events go through `codex_runner_output.ts` helpers.
5. usage metadata goes through `codex_runner_usage.ts`.
6. model/version metadata goes through `codex_runner_metadata.ts`.

## E. App Server Runner

1. `codex_app_server_command.ts` parses command settings.
2. `codex_app_server_runner.ts` starts `codex app-server`.
3. JSON-RPC initialize/thread/start messages are sent.
4. notifications are mapped to status, plan, step, assistant updates, usage.
5. `turn/completed` resolves the pending turn.

## F. Telegram Notification

1. Finished runner calls `notifyConversationResult` in `runtime_settings.ts`.
2. `NotificationCenter` resolves active provider.
3. `TelegramBotModule` formats summary/detail pages.
4. `telegram_sender.ts` sends message.
5. Expand/page callbacks are handled by update polling and `telegram_notification_registry.ts`.

## G. Telegram Remote Control

1. `RemoteControlCenter` subscribes to Telegram updates.
2. Commands are parsed in `remote_control_bridge.ts`.
3. Handlers call `methods_remote_control.ts` on AppController.
4. Selected chat-to-conversation binding is persisted in remote-control settings.
5. `/chat` calls the same `sendMessage` path as the UI.

## H. Credential Vault

1. Settings can set/unlock/lock master password via IPC.
2. `runtime_security.ts` calls `stateStorage` vault APIs.
3. `security/integration_secrets.ts` handles hash, key derivation, encryption and decryption.
4. Locked state clears in-memory Telegram tokens.
5. Unlock re-applies decrypted secrets to notification and remote-control settings.

## I. Workdir Open/Copy

1. `composer_renderer.ts` renders current conversation workdir into `data-open-path` and `data-copy-text`.
2. Left-click is handled by `bootstrap.ts` global `[data-open-path]` handler.
3. Main IPC `shell:open-path` calls `local_path_opener.ts`.
4. Right-click on the workdir control copies `data-copy-text`.

## J. Docs Capture

1. Run `cd src && npm run capture:docs`.
2. Electron starts with `CODEX_DESK_DOC_CAPTURE=1 --docs-capture`.
3. `docs_capture_sequence.ts` injects deterministic state.
4. Main `docs_capture_main.ts` writes screenshots to `docs/assets/`.
5. App exits automatically.
