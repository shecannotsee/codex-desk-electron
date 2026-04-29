# CLI 与 GUI 对照

Codex Desk 不替代 Codex CLI。它是桌面编排层，负责会话、状态、日志、通知和系统交互。

| 能力 | Codex CLI | Codex Desk GUI |
|---|---|---|
| 执行 prompt | `codex exec` | 支持，底层仍调用 Codex |
| 原生会话 resume | 支持 | 自动保存并续用 sessionId |
| fork 导入会话 | 手动 | 导入 JSONL 时可选择 resume/fork |
| 多会话列表 | 弱 | 左侧列表、置顶、重命名、关闭 |
| 会话工作目录 | 命令行 cwd | 每会话保存；底部左键打开、右键复制 |
| 运行中继续发消息 | 手动等待 | 会话级队列，完成后自动执行下一条 |
| 图片附件 | `--image` | 附件选择器，自动切换兼容路径 |
| 运行步骤 | 原始输出 | 工作流视图，默认折叠，可展开 |
| 结构化事件 | JSON 输出 | 单独事件面板 |
| 原始 JSON | 终端输出 | 单独 raw 面板并保留 sent/received |
| usage/model 元数据 | 输出里查 | 顶部元信息和消息 usage |
| Telegram 通知 | 无 | 完成/失败通知，支持展开/分页 |
| Telegram 远程控制 | 无 | `/list`、`/use`、`/chat`、`/stop` 等命令 |
| 凭据保护 | 依赖环境 | 主密码 vault 保护 token |
| 系统文件打开 | 终端/编辑器 | 本地链接和会话目录走系统打开 |
| 外部链接 | 终端处理 | 系统默认浏览器 |
| UI 主题/缩放 | 终端能力 | GUI 主题、字号、窗口缩放、侧栏拖拽 |

## GUI 发送等价命令

基本等价：

```bash
codex exec <PROMPT>
```

实际 GUI 会做额外处理：

1. 规范化 `codex exec` 参数，保证 JSON 事件可解析。
2. 根据会话 `sessionId` 决定 start/resume/fork。
3. 有图片附件时附加 `--image` 参数。
4. 将 stdout/stderr、JSON-RPC 或 app-server 事件归一化为 UI runtime 事件。
5. 完成后保存 assistant 消息、usage 和会话元数据。

## 什么时候仍然用 CLI

- 只跑一次短任务。
- 需要直接观察原始终端行为。
- 在非桌面环境使用。

## 什么时候用 GUI

- 长期多会话工作。
- 需要排队、重试、运行步骤、原始事件留档。
- 需要 Telegram 通知/远程控制。
- 需要稳定复制、打开本地路径、导入/导出会话。
