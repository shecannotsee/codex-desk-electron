# Changelog

All notable changes to this project are documented in this file.

## [Unreleased]

### Changed

- 主界面升级为 Telegram 风格：聊天区、会话区与设置入口统一视觉语言。
- 会话列表改为“圆形头像 + 会话名 + 状态标签”，并支持拖拽调整左侧宽度。
- 左侧会话操作改为右键菜单（新建/重命名/关闭），减少常驻按钮噪音。
- 右上角设置改为多级菜单（一级分组 -> 二级功能页），整合原顶部菜单操作。
- 原生菜单栏默认隐藏，仍保留快捷键和主进程菜单能力。
- 运行步骤支持折叠/展开，且默认折叠。
- 对话消息支持折叠/展开，字号输入支持滑杆和数字输入双通道。
- 深色/浅色主题覆盖聊天区、运行步骤、右键菜单、滚动条等组件。

### Added

- 新增“排队消息可视化”：在运行步骤标签展示待执行消息内容、顺序、入队时间。
- 新增窗口关闭保护：检测运行中任务并提供三选确认（取消/停止并关闭/直接关闭）。
- 新增 Ubuntu 22.04 DEB 打包配置（`src/electron-builder.yml`）。
- 新增 DEB 安装后脚本（`src/scripts/deb/postinst`、`src/scripts/deb/postrm`）。
- 新增部署文档（`docs/deploy-ubuntu.md`）与卸载文档（`docs/uninstall.md`）。

### Docs

- 文档同步到当前 UI 结构：右键会话、多级设置、队列预览、默认折叠、主题与布局控制。
- `gpt-readable/` 重命名为 `llm-readable/`，并重写为大模型优先快速摄入结构：
  - `llm-readable/system-map.md`
  - `llm-readable/core-flows.md`
  - `llm-readable/change-hotspots.md`
  - `llm-readable/task-prompts.md`
- README / 架构 / 开发指南 / CLI 对照 / FAQ 全量更新到最新功能行为。

## [0.1.0] - 2026-03-05

### Added

- Electron GUI 主体（会话列表、聊天区、运行日志区）。
- 三种运行可视化：结构化事件 / 运行步骤 / 原始 JSON。
- 会话管理：新建、重命名、关闭、清空内容。
- 对话增强：运行中排队发送、失败后一键重试上一条。
- 运行控制：停止任务、清空运行日志。
- 元信息探测：Codex 版本、模型信息。
- 视图控制：中英切换、面板显隐、字号调整。

### Notes

- 已验证平台：`Ubuntu 22.04`
- 未验证平台：`Windows`、`macOS`
