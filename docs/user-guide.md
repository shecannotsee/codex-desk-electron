# 用户指南

## 1. 会话与工作目录

- 左侧列表展示所有会话。
- 右键会话可重命名、置顶、关闭、导入或导出。
- 新建会话时选择 CLI（Codex 或 Claude）和工作目录；每个会话保存自己的 CLI 与目录。
- 底部“会话目录”显示当前会话目录：
  - 左键：用系统文件管理器打开目录。
  - 右键：复制完整路径。

## 2. 发送、插入、重试与停止

- 输入框中 `Ctrl+Enter` 发送。
- 会话 CLI 可使用 `codex exec ...` 或 `claude ...`；Conductor 会按会话自动选择 Codex runner 或 Claude runner。
- 当前会话正在运行时，再发送会进入该会话队列。
- app-server 可用且当前轮次支持 steer 时，“插入对话”会把新指令插入当前任务；Claude Code print 模式没有 mid-turn steer 等价能力，会按普通发送/排队处理。
- “重试上一条”会重新发送最近一条用户消息。
- “停止”会请求停止当前 runner，并标记对应用户消息为中断。

## 3. 附件

- 可添加图片附件。
- 有图片附件时，Codex GUI 会走兼容 `codex exec --image` 的执行路径。
- Claude Code CLI 没有 `codex exec --image` 等价参数，GUI 会把附件文件路径追加到提示词，由 Claude 按需读取。
- app-server 当前不处理图片附件，检测到图片会回退到 exec 模式。

## 4. 运行面板

右侧包含三个标签：

- 运行步骤：按轮次和步骤展示，默认折叠。
- 结构化事件：展示成功、警告、错误、提示等事件。
- 事件原文：保存 sent/received JSON 行，便于调试。

运行中聊天区会显示临时 assistant 预览和当前步骤，最终回复落地后临时项会被替换。

## 5. 队列

- 队列按会话隔离。
- 当前任务成功结束后自动执行下一条。
- 当前任务异常结束时，不会继续自动执行剩余队列，避免连锁失败。
- 可取消单条排队消息，也可清空当前会话队列。

## 6. 导入/导出会话文件

- 导入/导出使用 Conductor 会话文件（`.jsonl`）。JSONL 是当前实际文件格式，因为会话记录天然按行追加，便于保存消息、模型、CLI 版本、provider 和工作目录。
- 导入支持带 provider 元数据的 Codex / Claude 会话文件；没有 provider 时会根据来源字段推断，默认按 Codex 处理。
- 导入时选择工作目录来源：导入文件目录、默认目录或手动选择。
- 有 sessionId 时可选择继续原会话 resume 或分叉 fork。这里的 resume/fork 是 Conductor 的跨 CLI 抽象：Codex 和 Claude 的 UI 语义一致，但底层参数和会话协议不同。
- Codex resume/fork 使用 Codex 原生会话恢复/分叉语义；Claude resume 使用 `--resume <session-id>`，Claude fork 使用 `--resume <session-id> --fork-session`。
- 导出会写入包含消息、模型、CLI 版本、provider 和工作目录的 `.jsonl` 文件。

## 7. Telegram 通知

在设置中配置 Telegram bot token 和 chat id 后，可发送：

- 任务完成通知。
- 任务失败通知。
- 摘要消息，必要时可点击展开全文和翻页。

启用主密码后，token 会从 UI 中清空，解锁后才会重新注入运行时。

## 8. Telegram 远程控制

远程控制支持使用 Telegram 命令操作会话：

- `/help` 查看帮助。
- `/list` 查看会话。
- `/use <序号或会话ID>` 绑定会话。
- `/new` 新建并绑定会话。
- `/current` 查看当前绑定。
- `/history [轮数]` 查看最近历史。
- `/chat <内容>` 发送消息。
- `/stop` 停止当前绑定会话。
- `/logs [条数]` 查看 Telegram 日志。

## 9. 设置与外观

设置入口集中管理：

- 语言：中文 / English。
- 主题：浅色 / 深色。
- 窗口缩放：10% 分档，快捷键 `Alt+=`、`Alt+-`、`Alt+0`。
- 对话字号。
- 左侧会话区和右侧运行区显示/隐藏。
- Telegram 通知、远程控制和主密码。

## 10. 复制与打开链接

- 聊天区或运行面板选中文本后右键，可复制。
- 回复中的 HTTP/HTTPS 链接用系统默认浏览器打开。
- 本地文件链接用系统打开；如果检测到 VS Code `code` 命令，带行号的文件会优先跳转到行。
- 底部会话目录右键复制路径。

## 11. 关闭窗口保护

如果仍有任务运行，关闭窗口会弹出确认：

1. 取消。
2. 停止任务并关闭。
3. 直接关闭。

建议优先选择“停止任务并关闭”。
