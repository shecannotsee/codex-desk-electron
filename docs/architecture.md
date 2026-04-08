# 技术架构

## 1. 总体分层

1. Main 进程（`src/main/`）
   - TypeScript 主进程源码
   - 业务编排、状态管理、子进程调用、窗口生命周期、菜单动作分发
2. Preload（`src/main/preload.ts`）
   - 受控暴露 IPC API 给 Renderer
3. Renderer（`src/renderer/`）
   - TypeScript ES Module 界面渲染、交互状态、运行可视化
4. Build Output（`src/app/`）
   - `tsc` 编译后的 Electron 运行时代码

## 2. 目录说明

- `src/main/main.ts`：应用入口、IPC 注册、窗口关闭保护、隐藏系统菜单。
- `src/main/app_controller.ts`：主进程组合入口与模块装配。
- `src/main/app_controller/index.ts`：`AppController` 核心类型与入口。
- `src/main/app_controller/methods_runtime.ts`：运行态、队列、会话快照。
- `src/main/app_controller/methods_meta.ts`：Codex 版本/模型探测。
- `src/main/app_controller/methods_chat.ts`：发送、重试、停止、清理、关闭。
- `src/main/codex_runner.ts`：`codex` 子进程封装与事件解析。
- `src/main/codex_app_server_runner.ts`：App Server 模式 runner 封装。
- `src/main/conversation_service.ts`：会话操作与持久化协调。
- `src/main/state_store.ts`：持久化状态读写与迁移。
- `src/main/runtime_store.ts`：运行态内存结构。
- `src/main/preload.ts`：Renderer <-> Main 桥接。
- `src/renderer/index.html`：页面骨架（会话区/聊天区/运行区/设置菜单）。
- `src/renderer/app/types.ts`：Renderer 共享类型中心（状态、事件、渲染选项、DOM 引用）。
- `src/renderer/app/codexdesk.ts`：预加载桥接的 Renderer 侧类型封装。
- `src/renderer/app/state_i18n.ts`：全局状态、I18N、UI 偏好。
- `src/renderer/app/conversation_runtime.ts`：会话状态与折叠逻辑。
- `src/renderer/app/renderers.ts`：各区域渲染器。
- `src/renderer/app/bootstrap.ts`：事件绑定、动作路由、初始化。
- `src/renderer/styles.css`：Telegram 风格 UI + 主题变量。
- `src/app/`：编译产物，Electron 运行时实际加载这里的 JS。
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
- `zoomFactor`
- `chatFontSize`
- `sidebarWidth`
- `runtimePanelHidden`
- `settingsPanelHidden`
- `sidebarHidden`

### Renderer 共享类型

- `AppState`
- `AppSnapshot`
- `AppEvent`
- `RenderJobs`
- `UiElementRefs`
- `RendererCallbacks`

## 4. IPC 通信模型

Renderer -> Main（示例）：

- 会话：创建、切换、重命名、关闭、置顶
- 对话：发送、重试、停止
- 运行日志：清空
- 元信息：刷新版本/模型
- UI：菜单语言同步、窗口级动作调用、缩放控制

Main -> Renderer 事件：

- `runtime-event-append`
- `runtime-workflow-append`
- `runtime-raw-append`
- `runtime-phase`
- `runtime-started-at`
- `runtime-reset`
- `runner-state`
- `meta-updated`
- `queue-updated`
- `conversation-updated` / `conversation-removed`

## 5. 主运行链路（输入到结果）

1. Renderer 发送消息 -> `chat:send`
2. Main `AppController.sendMessage`
3. `CodexRunner` 解析 stdout/stderr/JSON
4. 增量写入运行态并回推前端
5. Renderer `bootstrap.ts` 消费事件并调度局部刷新
6. `renderers.ts` 更新聊天区、运行区、队列提示
7. 完成后写入 assistant 消息并持久化

## 6. 关键交互链路

1. 运行中再次发送：进入会话队列，串行执行。
2. 运行步骤：默认折叠，按条展开。
3. 左侧会话：右键菜单处理新建/重命名/关闭/置顶。
4. 设置面板：Telegram 风格多级菜单分发动作。
5. 关闭窗口：若有任务运行，弹出三选确认。
6. 缩放与字体：界面缩放和对话字号分别持久化。
7. 文本复制：聊天区和运行区通过自定义右键菜单复制选中文本。

## 7. 状态持久化

- 会话状态：`<repo>/.codexdesk/state.electron.json`
- 兼容读取旧路径：`~/.codexdesk/state.electron.json`
- UI 偏好：`localStorage['codexdesk.ui-prefs.v1']`
- 草稿缓存：`localStorage['codexdesk.drafts.v1']`
- 编译产物：`src/app/`

## 8. 大模型快速阅读

优先阅读：

1. `llm-readable/system-map.md`
2. `llm-readable/core-flows.md`
3. `llm-readable/change-hotspots.md`
