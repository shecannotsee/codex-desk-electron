# 技术架构

## 1. 总体分层

本项目采用 Electron 的经典三层结构：

1. Main 进程（`src/main/`）
   - 业务编排、状态管理、子进程调用、菜单、窗口生命周期
2. Preload（`src/main/preload.js`）
   - 受控暴露 IPC API 给 Renderer
3. Renderer（`src/renderer/`）
   - 界面渲染、交互状态、事件展示

## 2. 目录说明

- `src/main/main.js`：应用入口、窗口创建、IPC 注册、菜单与关闭保护。
- `src/main/app_controller/index.js`：`AppController` 主类与方法聚合入口。
- `src/main/app_controller/methods_runtime.js`：运行态、队列、会话基础管理。
- `src/main/app_controller/methods_meta.js`：版本/模型探测与命令解析。
- `src/main/app_controller/methods_chat.js`：发送、重试、停止、清理等对话操作。
- `src/main/codex_runner.js`：对子进程 `codex` 的封装，解析输出事件。
- `src/main/state_store.js`：持久化状态读写与迁移。
- `src/main/runtime_store.js`：运行态（步骤/事件/raw）内存存储。
- `src/renderer/app/state_i18n.js`：前端状态、I18N、偏好和基础工具。
- `src/renderer/app/conversation_runtime.js`：会话状态选择器与折叠逻辑。
- `src/renderer/app/renderers.js`：各视图渲染函数。
- `src/renderer/app/bootstrap.js`：事件绑定、IPC 回推处理、初始化。
- `src/renderer/index.html` + `src/renderer/styles.css`：页面结构与样式。
- `gpt-readable/`：面向 GPT 的代码功能划分与链路说明。

## 3. 关键数据结构

### 会话

- `id`
- `title`
- `sessionId`
- `messages[]`
- `createdAt` / `updatedAt`

### 运行态

- `workflow[]`
- `events[]`
- `raw[]`
- `phase`
- `startedAt`

### UI 偏好

- `language`
- `chatFontSize`
- `runtimePanelHidden`
- `settingsPanelHidden`
- `sidebarHidden`

## 4. 通信模型（IPC）

Renderer 通过 preload 暴露接口调用主进程：

- 会话：创建、切换、重命名、关闭
- 对话：发送、重试、停止
- 运行日志：清空
- 元信息：刷新版本/模型
- UI：菜单语言同步

主进程通过事件回推：

- `runtime-event-append`
- `runtime-workflow-append`
- `runtime-raw-append`
- `runner-state`
- `meta-updated`
- `queue-updated`
- `conversation-updated/removed`

## 5. 运行链路

1. 发送消息 -> `AppController.sendMessage`
2. 构建并启动 `CodexRunner`
3. 解析 stdout/stderr 与 JSON 事件
4. 增量写入运行态并回推前端
5. 完成后写入 assistant 消息并持久化

## 6. 状态持久化

- 默认路径：`<repo>/.codexdesk/state.electron.json`
- 兼容迁移：支持从 `~/.codexdesk/state.electron.json` 读取旧状态
- 会话消息存储有上限截断（保留最近 200 条）

## 7. GPT 可读性拆分

- 主进程将 `AppController` 拆为 `index + methods_*`，按职责阅读。
- 渲染进程将单文件拆为 `state/conversation/render/bootstrap` 四段脚本。
- 详细功能落点见：`gpt-readable/code-map.md`。

## 8. 架构图占位

- 架构图（占位）：[docs/assets/architecture-overview.svg](./assets/architecture-overview.svg)
- IPC 序列图（占位）：[docs/assets/sequence-send-message.svg](./assets/sequence-send-message.svg)
