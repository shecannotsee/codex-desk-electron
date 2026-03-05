# 主链路：从输入到结果

## 1. 发送消息链路

1. Renderer 点击发送（`src/renderer/app/bootstrap.js`）
2. 调用 preload API `codexdesk.sendMessage(...)`
3. Main IPC `chat:send` 路由到 `AppController.sendMessage`（`methods_chat.js`）
4. 创建 `CodexRunner`，开始流式解析（`src/main/codex_runner.js`）
5. 事件持续回推到 Renderer（`app:event`）
6. Renderer `applyEvent(...)` 增量更新 + `renderAll()` 刷新
7. 结束后写回 assistant 消息并持久化

## 2. 运行中排队链路

1. 会话运行中再次发送消息
2. `sendMessage` 将消息写入会话队列
3. 当前任务完成后 `_startNextQueuedMessage` 自动串行启动下一条

## 3. 失败后重试链路

1. 用户点击“重试上一条”
2. `retryLastMessage` 取最后一条 user 消息
3. `forceFreshSession=true`，清空旧会话 ID 后重发

## 流程图占位

- 发送链路图（占位）：[docs/assets/flow-input-to-result.svg](../docs/assets/flow-input-to-result.svg)
