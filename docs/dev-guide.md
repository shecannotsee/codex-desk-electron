# 开发 / 调试 / 打包指南

## 1. 开发环境

- Node.js `18+`（建议）
- npm
- Electron `37.x`（由 `src/package.json` 锁定）
- 可用的 `codex` 命令

平台现状：

- 已验证：`Ubuntu 22.04`
- 未验证：`Windows`、`macOS`

## 2. 安装与启动

推荐直接使用根目录脚本（已整合依赖检查 + logo 同步）：

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

1. 菜单 `视图 -> 开发者工具` 打开 renderer 调试面板。
2. 优先检查右侧“结构化事件 / 事件原文(JSON)”定位错误。
3. 关注 `src/main/codex_runner.js` 对输出的解析逻辑是否匹配当前 CLI 输出。
4. 先看 `gpt-readable/code-map.md` 再下钻源码，可减少定位时间。

## 4. 代码检查

当前仅包含语法检查：

```bash
cd /home/shecannotsee/Desktop/projects/codex-desk-electron/src
npm run check
```

补充建议（用于拆分后的文件快速自检）：

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

## 5. 打包说明

当前仓库已提供 Ubuntu DEB 打包配置：

- 配置文件：`src/electron-builder.yml`
- 打包命令：`cd src && npm run dist:deb`
- 产物目录：`src/dist/`

说明：

1. `.deb` 会打包 Electron + 应用代码 + Node 依赖。
2. 系统共享库通过 `deb depends` 交给 APT 安装。
3. `codex` CLI 属于外部依赖，不会内置到安装包。
4. 打包前会自动同步 `resource/logo.png`，保证运行/安装图标一致。

## 6. 发布流程（建议）

每次发版前至少执行：

1. `cd src && npm run check`
2. `cd src && npm run dist:deb`
3. 更新 `docs/cli-vs-gui.md`
4. 更新 `CHANGELOG.md`
5. 人工回归关键流程：
   - 新建会话 -> 发送 -> 查看运行日志
   - 失败后重试
   - 关闭窗口保护

## 7. PR 要求（已落地）

已增加 PR 模板文档项：

- `是否更新文档（README/docs/CHANGELOG）`

模板文件：

- `../.github/pull_request_template.md`

## 8. 可复用排障步骤模板

1. 复现步骤（可复制命令）
2. 预期结果 vs 实际结果
3. 右侧结构化事件摘录
4. 原始 JSON 事件摘录
5. 修复后验证步骤
