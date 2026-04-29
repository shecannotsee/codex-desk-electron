# 技术架构

## 1. 总体边界

Codex Desk 是一个 Electron 应用，但业务逻辑不直接堆在窗口代码里。当前主进程按领域组织：

- `src/main/main.ts`：Electron app 生命周期、BrowserWindow、菜单动作、关闭保护。
- `src/main/ipc_registration.ts`：Renderer 到 Main 的 IPC 注册。
- `src/main/preload.ts`：安全暴露 `window.codexdesk` API。
- `src/main/app_controller/`：应用状态编排、会话、队列、运行态、设置和安全 mixin。
- `src/main/codex/`：Codex CLI/app-server 对接层。
- `src/main/telegram/`：Telegram 通知和远程控制底层能力。
- `src/main/security/`：凭据保险箱、hash、加密/解密。
- `src/renderer/app/`：Renderer 状态、渲染、事件绑定和交互控制。

## 2. 主进程领域模块

### `src/main/codex/`

- `codex_runner.ts`：`codex exec` 子进程 runner。
- `codex_app_server_runner.ts`：app-server JSON-RPC runner。
- `codex_app_server_command.ts`：从 `codex exec` 配置解析 app-server 启动策略。
- `codex_cli_gateway.ts`：shell 参数、usage payload、探测参数规范化。
- `codex_runner_output.ts`：事件文本、步骤、计划状态、最终文本抽取。
- `codex_runner_metadata.ts`：Codex 版本与模型元数据探测。
- `codex_runner_usage.ts`：usage token 元数据事件。
- `index.ts`：领域入口，外部优先 `require('../codex')`。

### `src/main/telegram/`

- `telegram_bridge.ts`：通知 provider 主类。
- `telegram_sender.ts`：发送消息、编辑消息、callback answer、连接测试。
- `telegram_updates.ts`：Telegram update 轮询与 coordinator offset。
- `telegram_notification_registry.ts`：通知展开/翻页状态缓存。
- `telegram_message_format.ts`：通知正文、摘要、分页和 HTML 转义。
- `telegram_log_store.ts`：Telegram 相关日志文件。
- `index.ts`：领域入口，外部优先 `require('./telegram')`。

### `src/main/security/`

- `integration_secrets.ts`：主密码、vault、AES-GCM 加密、token 指纹。
- `index.ts`：安全领域入口，外部优先 `require('./security')`。

### `src/main/app_controller/`

AppController 使用 mixin 组合，避免单文件承担全部职责：

- `methods_chat.ts`：发送、插入、重试、停止、清空聊天。
- `chat_runner_events.ts`：runner 事件绑定和完成处理。
- `chat_stream_preview.ts`：流式 assistant 预览节流。
- `methods_runtime.ts`：核心会话操作：创建、切换、重命名、置顶。
- `runtime_persistence.ts`：持久化、默认目录、通知中心同步。
- `runtime_security.ts`：主密码锁定/解锁、凭据清理。
- `runtime_session_files.ts`：session JSONL 导入/导出。
- `runtime_runner_lifecycle.ts`：runner 释放、停止、运行数。
- `runtime_events.ts`：runtime phase、raw JSON、startedAt 事件。
- `runtime_settings.ts`：设置更新、通知结果、provider 测试。
- `runtime_snapshot.ts`：全量快照和切会话 payload。
- `methods_meta.ts`：Codex 版本/模型刷新。
- `methods_remote_control.ts`：Telegram 远程控制回调到会话操作。

## 3. Renderer 分层

- `index.html`：静态 DOM 骨架。
- `state_i18n.ts`：全局状态、i18n、主题、缩放、UI 偏好。
- `bootstrap.ts`：初始化、事件绑定、动作路由、菜单桥接。
- `renderers.ts`：统一导出各区域渲染器。
- `conversation_runtime.ts`：会话选择器、折叠状态、运行态选择器。
- `chat_renderer.ts`、`runtime_renderer.ts`、`conversation_list_renderer.ts`、`composer_renderer.ts`、`settings_renderer.ts`：具体区域渲染。
- `context_menu_controller.ts`：会话右键菜单、选区复制菜单。
- `integration_settings.ts` 与 `integration_settings_bindings.ts`：通知/远程控制/安全设置。
- `docs_capture_sequence.ts`：文档截图专用自动流程。

## 4. IPC 模型

Renderer 通过 preload 暴露的 `codexdesk` 调用 Main：

- 应用：`app:get-snapshot`、`app:update-settings`、`app:test-notification-provider`。
- 安全：`app:set-master-password`、`app:unlock-master-password`、`app:lock-master-password`。
- 会话：创建、切换、重命名、置顶、关闭、导入、导出。
- 对话：发送、插入、重试、停止、取消队列。
- 元信息：刷新 Codex 版本和模型。
- 系统：`shell:open-path` 打开文件/目录。
- 文档：`docs:capture-*` 截图自动化。

Main 通过 `app:event` 推送运行态更新：

- `runtime-event-append`
- `runtime-workflow-append`
- `runtime-raw-append`
- `runtime-phase`
- `runtime-started-at`
- `runtime-reset`
- `runner-state`
- `meta-updated`
- `queue-updated`
- `conversation-updated`
- `conversation-removed`

## 5. 发送消息主链路

1. Renderer 调用 `chat:send`。
2. `AppController.sendMessage` 校验会话、消息、工作目录和运行状态。
3. 若当前会话运行中，消息进入会话队列。
4. 根据配置选择 `CodexRunner` 或 `CodexAppServerRunner`。
5. `chat_runner_events.ts` 绑定 status、event、raw、meta、delta、step、finished。
6. 运行态事件实时推送给 Renderer。
7. 完成后写入 assistant 消息、usage、workflow，释放 runner。
8. 成功时启动同会话下一条排队消息。

## 6. 状态与文件

- 应用状态：`.codexdesk/state.electron.json`
- Telegram 日志：`.codexdesk/telegram.logs.json`
- UI 偏好：`localStorage['codexdesk.ui-prefs.v1']`
- 草稿：`localStorage['codexdesk.drafts.v1']`
- 编译产物：`src/app/`，不提交。
- 临时工作目录：`codex-workspace/`，不提交。

## 7. 文档截图

`cd src && npm run capture:docs` 会启动独立 Electron 文档截图窗口。Renderer 准备模拟会话数据，Main 用 `capturePage()` 写入 `docs/assets/*.png`，完成后自动退出。
