# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Changed

- 按“GPT 易读”拆分大文件：
  - `src/main/app_controller.js` -> `src/main/app_controller/index.js` + `methods_*`
  - `src/renderer/renderer.js` -> `src/renderer/app/*.js`（按状态/渲染/事件绑定分层）

### Docs

- 建立分层文档体系：`README` + `docs/*` + `CHANGELOG`。
- 新增 `docs/cli-vs-gui.md`，沉淀 CLI 与 GUI 对照。
- 新增 PR 模板文档检查项。
- 新增 `gpt-readable/` 目录，沉淀代码功能划分与主链路说明。

## [0.1.0] - 2026-03-05

### Added

- Electron GUI 主体（会话列表、聊天区、运行日志区）。
- 三种运行可视化：结构化事件 / 运行步骤 / 原始 JSON。
- 会话管理：新建、重命名、关闭、清空内容。
- 对话增强：运行中排队发送、失败后一键重试上一条。
- 运行控制：停止任务、清空运行日志。
- 元信息探测：Codex 版本、模型信息。
- 视图控制：语言切换、中英菜单、面板显隐、字号调整。
- 运行步骤可折叠（默认折叠）。
- 关闭窗口保护（检测运行中任务并确认）。

### Notes

- 已验证平台：`Ubuntu 22.04`
- 未验证平台：`Windows`、`macOS`
