# FAQ

## 1. 为什么提示“未找到 codex 命令”？

系统 PATH 中没有可执行 `codex`。先在终端确认：

```bash
codex --version
which codex
```

Codex Desk 会尽量导入登录 shell 环境，但如果桌面环境没有正确 PATH，仍可能失败。

## 2. 为什么发送时报“目录不存在”？

当前会话的工作目录不存在或不可访问。底部“会话目录”会显示当前目录：

- 左键打开目录。
- 右键复制路径。

如果目录被删除，请新建会话或导入时选择新的工作目录。

## 3. Codex Desk 会提交 `codex-workspace/` 吗？

不会。`codex-workspace/` 是默认临时工作目录，已在 `.gitignore` 中忽略，不应提交。

## 4. 模型显示未知怎么办？

模型来源包括命令参数、Codex 配置、运行 JSON 和主动 probe。建议：

1. 在命令里显式加 `--model` 或 `-m`。
2. 在设置/元信息里刷新模型。
3. 查看右侧 raw JSON 是否包含模型字段。

## 5. 运行中继续发送会怎样？

同一会话内会进入队列。当前任务成功完成后自动执行下一条；失败时停止自动继续，避免错误扩散。

## 6. 为什么有时可以“插入对话”，有时只能排队？

插入依赖 app-server runner 的 steer 能力。当前 runner 不支持 steer 时，会提示并把后续轮次切到可插入策略或按正常发送/排队处理。

## 7. 图片附件走哪条链路？

图片附件会使用兼容 `codex exec --image` 的路径。app-server 当前不承接图片附件。

## 8. Telegram token 存在哪里？

启用主密码后，token 会被加密保存到 `.codexdesk/secrets.electron.json`，运行时解锁后才注入通知/远程控制模块。

## 9. Telegram 通知和远程控制是同一个配置吗？

不是。通知和远程控制各自有 Telegram 配置，但都可以受同一个主密码 vault 保护。

## 10. 为什么 Telegram 通知有展开/翻页？

长回复会被拆成摘要和详情页。通知消息上的 inline keyboard 可以展开全文、翻页或收起摘要。

## 11. 右键复制在哪些地方可用？

- 聊天区选中文本。
- 运行步骤/结构化事件/raw 面板选中文本。
- 底部会话目录右键复制完整路径。

## 12. 为什么点击链接不在应用里打开？

这是刻意设计。HTTP/HTTPS 链接交给系统默认浏览器，避免 Electron 内部新窗口带来权限和导航问题。

## 13. 数据存在哪里？

- 状态：`.codexdesk/state.electron.json`
- 加密 token：`.codexdesk/secrets.electron.json`
- Telegram 日志：`.codexdesk/telegram.logs.json`
- UI 偏好：Renderer localStorage
- 兼容旧状态读取：`~/.codexdesk/state.electron.json`

## 14. 怎么完整卸载？

见 [uninstall.md](./uninstall.md)。卸载 Codex Desk 不会卸载 Codex CLI。

## 15. Windows/macOS 支持吗？

当前已验证 Ubuntu 22.04。Windows/macOS 未验证，路径打开、打包、系统托盘和 shell 环境导入可能需要单独测试。
