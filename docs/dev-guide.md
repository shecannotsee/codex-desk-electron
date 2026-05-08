# 开发 / 调试 / 打包指南

## 1. 环境

- Node.js 18+
- npm
- Electron 37.x（以 `src/package.json` 为准）
- TypeScript 6.x
- 可执行并已登录的 `codex` CLI

已验证平台：Ubuntu 22.04。

## 2. 常用命令

```bash
cd /home/shecannotsee/Desktop/projects/conductor/src
npm install
npm run check
npm run build
npm start
```

说明：

- `npm run check`：主进程和渲染层 TypeScript no-emit 检查。
- `npm run build`：清理并生成 `src/app/`。
- `npm start`：构建、同步 logo、启动 Electron。
- `npm run capture:docs`：打开独立截图窗口并刷新 `docs/assets/*.png`。
- `npm run dist:deb`：生成 Ubuntu `.deb`。

## 3. 源码目录

```text
src/main/main.ts                 Electron app 和窗口生命周期
src/main/ipc_registration.ts     IPC 注册
src/main/preload.ts              Renderer API 暴露
src/main/app_controller/         应用控制器 mixin
src/main/codex/                  Codex CLI/app-server bridge
src/main/telegram/               Telegram 通知和远程控制底层模块
src/main/security/               凭据 vault 和加密模块
src/renderer/index.html          DOM 骨架
src/renderer/app/                Renderer TypeScript 模块
src/renderer/styles.css          样式与主题
```

## 4. 调试入口

- 运行失败：先看 UI 右侧“结构化事件”和“事件原文”。
- Codex 输出解析：看 `src/main/codex/codex_runner_output.ts`。
- `codex exec` 子进程：看 `src/main/codex/codex_runner.ts`。
- app-server：看 `src/main/codex/codex_app_server_runner.ts`。
- 会话发送/完成：看 `src/main/app_controller/methods_chat.ts` 和 `chat_runner_events.ts`。
- Telegram 通知：看 `src/main/telegram/telegram_bridge.ts` 和 `telegram_sender.ts`。
- Telegram 远程控制：看 `src/main/remote_control_bridge.ts` 与 `methods_remote_control.ts`。
- 凭据问题：看 `src/main/security/integration_secrets.ts` 和 `runtime_security.ts`。
- Renderer 交互：看 `src/renderer/app/bootstrap.ts`、对应 controller 和 renderer 文件。

## 5. 运行期目录

不要提交这些目录：

- `src/app/`：编译产物。
- `src/node_modules/`：依赖。
- `src/build/icon.png`：构建同步产物。
- `.conductor/`：本地状态、token 加密文件、Telegram 日志。
- `conductor-workspace/`：默认临时工作目录。

## 6. 文档截图

```bash
cd /home/shecannotsee/Desktop/projects/conductor/src
npm run capture:docs
```

该命令会：

1. 构建应用。
2. 以 `CONDUCTOR_DOC_CAPTURE=1 --docs-capture` 启动独立窗口。
3. Renderer 写入模拟数据。
4. Main 通过 `capturePage()` 保存 PNG 到 `docs/assets/`。
5. 自动退出。

## 7. 提交前检查

至少执行：

```bash
cd src
npm run check
```

涉及文档截图或打包时再执行：

```bash
npm run build
npm run capture:docs
npm run dist:deb
```

## 8. 文档同步要求

影响用户行为时更新：

- `README.md` / `README.zh-CN.md` / `README.en.md`
- `docs/user-guide.md`
- `docs/cli-vs-gui.md`
- `docs/faq.md`

影响架构时更新：

- `docs/architecture.md`
- `llm-readable/*.md`
- `src/README.md`
