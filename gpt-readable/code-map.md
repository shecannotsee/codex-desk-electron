# 代码功能划分（GPT 友好）

## 1. 主进程（Main）

- `src/main/main.js`
  - Electron 入口
  - 顶部菜单（中英文化、分类）
  - 关闭窗口运行保护
  - IPC 注册

- `src/main/app_controller/index.js`
  - `AppController` 主类与状态初始化
  - 聚合以下方法模块：
    - `methods_runtime.js`
    - `methods_meta.js`
    - `methods_chat.js`

- `src/main/app_controller/methods_runtime.js`
  - 运行态与队列管理
  - 结构化事件 / 运行步骤 / 原始 JSON 的写入与推送
  - 会话创建、切换、重命名、快照构建

- `src/main/app_controller/methods_meta.js`
  - Codex 版本与模型探测
  - 命令参数解析、config.toml 提取、主动 probe

- `src/main/app_controller/methods_chat.js`
  - 发送消息、重试、停止、清空
  - Runner 事件监听与收尾写回

- `src/main/codex_runner.js`
  - 子进程 `codex` 运行封装
  - 事件解析（status/event/meta/step/raw_line/assistant_delta）

- `src/main/state_store.js`
  - 持久化状态读写与迁移

- `src/main/runtime_store.js`
  - 运行时内存数据结构（workflow/events/raw）

- `src/main/conversation_service.js`
  - 会话模型与排序/查询工具

- `src/main/preload.js`
  - 安全暴露 renderer 可调用 API

## 2. 渲染进程（Renderer）

- `src/renderer/index.html`
  - 页面骨架 + 分段脚本加载顺序

- `src/renderer/app/state_i18n.js`
  - 全局状态、DOM 引用、I18N 文案
  - 字号/偏好存储
  - Markdown 渲染与权限摘要解析

- `src/renderer/app/conversation_runtime.js`
  - 会话状态选择器
  - 折叠状态管理（消息/运行步骤）
  - phase 状态判定与展示语义

- `src/renderer/app/renderers.js`
  - 视图渲染函数（会话列表、头部、聊天区、日志区、按钮、布局）

- `src/renderer/app/bootstrap.js`
  - snapshot/event 应用
  - 弹窗交互
  - 按钮与菜单动作绑定
  - 应用初始化 `init()`

- `src/renderer/styles.css`
  - 全部样式定义

- `src/renderer/renderer.js`
  - 兼容占位文件（实际逻辑已拆分到 `app/*`）

## 3. 关键能力与代码落点

- 多会话管理：`methods_runtime.js` + `renderers.js`
- 运行中排队发送：`methods_runtime.js::_startNextQueuedMessage` + `methods_chat.js::sendMessage`
- 失败后一键重试：`methods_chat.js::retryLastMessage`
- 运行步骤默认折叠：`conversation_runtime.js::isWorkflowStepCollapsed`
- 关闭窗口保护：`main.js::handleWindowCloseGuard`
- 菜单中英文化/分类：`main.js::MENU_TEXT` + `applyMenuLanguage`
