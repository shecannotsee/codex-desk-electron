# GPT 快速上手目录

本目录用于让 GPT（以及新开发者）在最短时间内建立项目全貌，避免直接阅读大文件。

## 建议阅读顺序

1. [code-map.md](./code-map.md)：先看模块划分和职责边界。
2. [workflow-chat.md](./workflow-chat.md)：再看“从输入到结果”的主链路。
3. [prompts-for-gpt.md](./prompts-for-gpt.md)：按模板提问，快速定位代码。

## 当前代码拆分结果

- `src/main/app_controller.js` 已拆为多模块（`src/main/app_controller/*`）
- `src/renderer/renderer.js` 已拆为多脚本（`src/renderer/app/*`）

## 适用范围

- 已验证平台：`Ubuntu 22.04`
- 未验证平台：`Windows`、`macOS`
