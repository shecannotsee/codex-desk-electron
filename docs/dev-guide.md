# 开发 / 调试 / 打包指南

## 1. 开发环境

- Node.js `18+`（建议）
- npm
- Electron `37.x`（以 `src/package.json` 为准）
- 可执行的 `codex` 命令

平台现状：

- 已验证：`Ubuntu 22.04`
- 未验证：`Windows`、`macOS`

## 2. 安装与启动

推荐根目录脚本：

```bash
cd /home/shecannotsee/Desktop/projects/codex-desk-electron
./start.sh
```

或手动方式：

```bash
cd /home/shecannotsee/Desktop/projects/codex-desk-electron/src
npm install
npm run check
npm start
```

## 3. 调试建议

1. 用 `Ctrl+Shift+I` 打开 DevTools。
2. 优先检查右侧“结构化事件 / 运行步骤 / 事件原文(JSON)”。
3. 核查 `src/main/codex_runner.js` 的输出解析是否匹配当前 CLI。
4. 先看 `llm-readable/system-map.md` 和 `llm-readable/core-flows.md` 再下钻源码。

## 4. 代码检查

```bash
cd /home/shecannotsee/Desktop/projects/codex-desk-electron/src
npm run check
```

可选快速语法检查：

```bash
cd /home/shecannotsee/Desktop/projects/codex-desk-electron
node --check src/main/app_controller/index.js
node --check src/main/app_controller/methods_runtime.js
node --check src/main/app_controller/methods_meta.js
node --check src/main/app_controller/methods_chat.js
node --check src/renderer/app/state_i18n.js
node --check src/renderer/app/conversation_runtime.js
node --check src/renderer/app/renderers.js
node --check src/renderer/app/bootstrap.js
```

## 5. 文档截图自动化

用于批量更新 `docs/assets/*.png`：

```bash
cd /home/shecannotsee/Desktop/projects/codex-desk-electron/src
npm run capture:docs
```

自动生成文件：

- `docs/assets/screenshot-main.png`
- `docs/assets/screenshot-settings-menu.png`
- `docs/assets/screenshot-settings-nested.png`
- `docs/assets/screenshot-runtime-tabs.png`
- `docs/assets/screenshot-conversation-context-menu.png`
- `docs/assets/workflow-step-1-input.png`
- `docs/assets/workflow-step-2-runtime.png`
- `docs/assets/workflow-step-3-result.png`

说明：

1. 截图由 Electron 内置 `capturePage` 实现，不依赖外部截图工具。
2. 建议在已验证的平台 `Ubuntu 22.04` 上执行，确保字体、窗口装饰和主题表现与文档一致。

## 6. 打包说明（Ubuntu DEB）

- 配置文件：`src/electron-builder.yml`
- 命令：`cd src && npm run dist:deb`
- 产物：`src/dist/`

说明：

1. `.deb` 会打包 Electron、应用代码和 Node 依赖。
2. 系统共享库依赖由 APT 安装。
3. `codex` CLI 是外部依赖，不内置进安装包。
4. 打包前会自动同步 `resource/logo.png` 到图标资源。

## 7. 发布流程（建议）

每次发版前至少执行：

1. `cd src && npm run check`
2. `cd src && npm run dist:deb`
3. 更新 `docs/cli-vs-gui.md`
4. 更新 `CHANGELOG.md`
5. 更新 `llm-readable/`（系统图、流程、热点）
6. 回归关键流程：
   - 新建会话 -> 发送 -> 查看运行日志
   - 运行中排队发送 -> 查看待执行队列
   - 运行中临时状态区 -> 最终回复后自动消失
   - 设置多级菜单 + 主题切换
   - 关闭窗口保护

## 8. PR 要求

PR 模板包含文档检查项：

- `是否更新文档（README/docs/CHANGELOG）`

模板文件：

- `.github/pull_request_template.md`
