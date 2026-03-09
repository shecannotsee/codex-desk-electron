# Core Flows (LLM)

## A. Send Message -> Assistant Output

1. Renderer click `btn-send` (`bootstrap.js`)
2. IPC call `chat:send`
3. `methods_chat.sendMessage` validates + starts runner
4. `codex_runner` parses stdout/stderr/json lines
5. Main emits runtime/workflow/raw events
6. Renderer `applyEvent` mutates state + `renderAll`
7. On finish, assistant message persisted to conversation

## B. Send While Running -> Queue

1. second send arrives while conversation running
2. `methods_chat.sendMessage` appends queue item (`queuedAt`, `preview`, `fromRetry`)
3. emits `queue-updated`
4. current task finishes
5. `methods_runtime._startNextQueuedMessage` dequeues next and re-enters flow A

## C. Retry Last Message

1. Renderer triggers `chat:retry-last`
2. `methods_chat.retryLastMessage` finds last user text
3. sends with fresh session semantics (`forceFreshSession`)
4. follows flow A

## D. Runtime Panel Rendering

1. renderer receives runtime/workflow/raw events
2. `renderers.renderRuntime`
3. workflow tab prepends queued preview panel
4. each workflow step uses collapse toggle
5. default collapse from `conversation_runtime.isWorkflowStepCollapsed` => `true`

## E. Settings Multi-level Menu

1. click quick settings button
2. root categories displayed
3. category click opens detail pane
4. action button dispatches mapped action
5. non-language/theme actions auto-close menu

## F. Sidebar Context Menu

1. right click on sidebar list
2. open custom themed context menu
3. menu action optionally switches target conversation
4. trigger underlying standard buttons for consistency

## G. Window Close Guard

1. user closes window
2. `main.handleWindowCloseGuard` checks running count
3. if running > 0, show confirm dialog:
   - cancel
   - stop then close (wait up to ~3s)
   - force close (send stop then close)

## H. Theme / Language / Font / Width Persistence

1. update UI value in renderer state
2. apply CSS variable / data-theme / document lang
3. save to localStorage `codexdesk.ui-prefs.v1`
4. menu language sync via IPC `ui:set-menu-language`

## I. Docs Screenshot Auto Capture

1. run `cd src && npm run capture:docs`
2. app starts with `CODEX_DESK_DOC_CAPTURE=1 --docs-capture`
3. renderer `bootstrap.runDocsCaptureSequence` checks `docs:capture-enabled`
4. renderer prepares deterministic UI state + mock data
5. renderer invokes `docs:capture-page` for each target image
6. main writes png files into `docs/assets/`
7. renderer calls `docs:capture-finish`, app exits automatically
