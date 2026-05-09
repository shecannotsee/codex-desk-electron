# conductor（中文）

`conductor` 是 Codex CLI 和 Claude Code 的 Electron 桌面端。Electron 负责窗口、渲染、IPC、菜单和系统集成；主进程内部按领域拆分为 CLI 对接、Telegram 集成、凭据安全、应用控制器和渲染层模块。

## 核心能力

- 多会话工作台，每个会话可绑定独立工作目录。
- 通过 `codex exec` 执行任务，支持原生会话 resume/fork；可用时支持 app-server 运行链路。
- 通过 `claude -p --output-format stream-json` 执行 Claude Code 任务，支持原生会话 resume/fork。
- 三类运行可观测信息：运行步骤、结构化事件、事件原文 JSON。
- 会话级排队：运行中继续发送会进入队列并串行执行。
- 图片附件：兼容 `codex exec --image` 流程。
- Conductor 会话文件（`.jsonl`）导入/导出，保留 Codex/Claude provider 元数据。
- Telegram 通知和 Telegram 远程控制。
- 主密码保护的凭据保险箱，用于 Telegram token。
- 快捷设置：语言、主题、布局、缩放、左右面板、通知与远程控制。
- 底部会话目录：左键用系统文件管理器打开，右键复制完整路径。
- Markdown 本地文件链接走系统打开，外部 HTTP 链接走系统默认浏览器。

## 文档导航

- 5 分钟上手: [docs/quick-start.md](./docs/quick-start.md)
- 用户指南: [docs/user-guide.md](./docs/user-guide.md)
- CLI 与 GUI 对照: [docs/cli-vs-gui.md](./docs/cli-vs-gui.md)
- 技术架构: [docs/architecture.md](./docs/architecture.md)
- 开发指南: [docs/dev-guide.md](./docs/dev-guide.md)
- Ubuntu DEB 部署: [docs/deploy-ubuntu.md](./docs/deploy-ubuntu.md)
- 卸载指南: [docs/uninstall.md](./docs/uninstall.md)
- FAQ: [docs/faq.md](./docs/faq.md)
- 版本变更: [CHANGELOG.md](./CHANGELOG.md)

## 目录结构

```text
src/main/                Electron 主进程与领域模块
src/main/codex/          Codex CLI/app-server 对接、输出解析、usage 元数据
src/main/claude/         Claude Code print-mode 对接、stream-json 解析、usage 元数据
src/main/telegram/       Telegram API、发送、更新订阅、通知分页状态
src/main/security/       凭据保险箱和加密辅助函数
src/main/app_controller/ AppController mixin 与运行编排
src/renderer/            HTML/CSS 和 Renderer TypeScript 模块
docs/                    用户、架构、部署和开发文档
notes/                   项目本地备注
```

`src/app/`、`conductor-workspace/`、`.conductor/`、`src/node_modules/` 是生成物或运行态目录，不应提交。

## 快速启动

```bash
cd /home/shecannotsee/Desktop/projects/conductor
./start.sh
```

手动开发启动：

```bash
cd /home/shecannotsee/Desktop/projects/conductor/src
npm install
npm run check
npm start
```

## 校验与截图

```bash
cd /home/shecannotsee/Desktop/projects/conductor/src
npm run check
npm run build
npm run capture:docs
```

`capture:docs` 会新开独立 Electron 截图窗口，不依赖当前正在使用的客户端窗口。

## 平台状态

- 已验证：Ubuntu 22.04
- 未验证：Windows、macOS
