# 技术架构

## 1. 总体分层

1. Main 进程（`src/main/`）
   - 业务编排、状态管理、子进程调用、窗口生命周期、菜单动作分发
2. Preload（`src/main/preload.js`）
   - 受控暴露 IPC API 给 Renderer
3. Renderer（`src/renderer/`）
   - 界面渲染、交互状态、运行可视化

## 2. 目录说明

- `src/main/main.js`：应用入口、IPC 注册、窗口关闭保护、隐藏系统菜单。
- `src/main/app_controller/index.js`：`AppController` 组合入口。
- `src/main/app_controller/methods_runtime.js`：运行态、队列、会话快照。
- `src/main/app_controller/methods_meta.js`：Codex 版本/模型探测。
- `src/main/app_controller/methods_chat.js`：发送、重试、停止、清理、关闭。
- `src/main/codex_runner.js`：`codex` 子进程封装与事件解析。
- `src/main/state_store.js`：持久化状态读写与迁移。
- `src/main/runtime_store.js`：运行态内存结构。
- `src/main/preload.js`：Renderer <-> Main 桥接。
- `src/renderer/index.html`：页面骨架（会话区/聊天区/运行区/设置菜单）。
- `src/renderer/app/state_i18n.js`：全局状态、I18N、UI 偏好。
- `src/renderer/app/conversation_runtime.js`：会话状态与折叠逻辑。
- `src/renderer/app/renderers.js`：各区域渲染器。
- `src/renderer/app/bootstrap.js`：事件绑定、动作路由、初始化。
- `src/renderer/styles.css`：Telegram 风格 UI + 主题变量。
- `llm-readable/`：面向大模型的代码地图与链路索引。

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
- `theme`
- `chatFontSize`
- `sidebarWidth`
- `runtimePanelHidden`
- `settingsPanelHidden`
- `sidebarHidden`

## 4. IPC 通信模型

Renderer -> Main（示例）：

- 会话：创建、切换、重命名、关闭
- 对话：发送、重试、停止
- 运行日志：清空
- 元信息：刷新版本/模型
- UI：菜单语言同步、窗口级动作调用

Main -> Renderer 事件：

- `runtime-event-append`
- `runtime-workflow-append`
- `runtime-raw-append`
- `runner-state`
- `meta-updated`
- `queue-updated`
- `conversation-updated` / `conversation-removed`

## 5. 主运行链路（输入到结果）

1. Renderer 发送消息 -> `chat:send`
2. Main `AppController.sendMessage`
3. `CodexRunner` 解析 stdout/stderr/JSON
4. 增量写入运行态并回推前端
5. 完成后写入 assistant 消息并持久化

## 6. 关键交互链路

1. 运行中再次发送：进入会话队列，串行执行。
2. 运行步骤：默认折叠，按条展开。
3. 左侧会话：右键菜单处理新建/重命名/关闭。
4. 设置面板：Telegram 风格多级菜单分发动作。
5. 关闭窗口：若有任务运行，弹出三选确认。

## 7. 状态持久化

- 会话状态：`<repo>/.codexdesk/state.electron.json`
- 兼容读取旧路径：`~/.codexdesk/state.electron.json`
- UI 偏好：`localStorage['codexdesk.ui-prefs.v1']`

## 8. 大模型快速阅读

优先阅读：

1. `llm-readable/system-map.md`
2. `llm-readable/core-flows.md`
3. `llm-readable/change-hotspots.md`
