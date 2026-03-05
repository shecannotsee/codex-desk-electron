# CLI 与 GUI 对照（核心）

## 1. 为什么需要 GUI

Codex CLI 足够强，但在长期、多轮、多会话使用中，常见痛点是：

1. 会话与历史管理分散。
2. 运行过程可观测性不足（只看终端滚动输出）。
3. 高频操作（重试、排队、清理日志、视图切换）重复且易出错。

本项目的 GUI 目标不是替代 CLI，而是给 CLI 增加“可视化编排层”。

## 2. 功能对照表

| 功能 | CLI 原生 | GUI 状态 | 说明 |
|---|---|---|---|
| 发送提示词执行 | 支持 | 支持 | GUI 底层仍调用 `codex exec` |
| 会话续聊（resume） | 支持 | 支持 | GUI 自动管理 sessionId |
| 多会话列表管理 | 弱支持 | 增强 | GUI 提供会话创建/重命名/切换/关闭 |
| 运行中继续发送（排队） | 不支持 | 增强 | 按会话串行队列执行 |
| 失败后一键重试上一条 | 不支持 | 增强 | GUI 自动回放上一条用户消息 |
| 结构化事件面板 | 不支持 | 仅 GUI | 把运行状态提炼为可读事件 |
| 运行步骤面板 | 不支持 | 仅 GUI | 步骤默认折叠，可按条展开 |
| 原始 JSON 事件面板 | 部分支持 | 增强 | CLI 有 JSON 输出，GUI 做归档与浏览 |
| 版本/模型快速探测 | 手动 | 增强 | GUI 提供菜单入口和元信息显示 |
| 关闭窗口保护 | 不支持 | 仅 GUI | 有运行任务时弹确认框 |
| 语言切换（中/英） | 不支持 | 仅 GUI | 菜单与界面联动切换 |
| 字号与界面显隐控制 | 不支持 | 仅 GUI | 适配不同阅读密度 |

## 3. 等价命令与差异

### 基本等价

- GUI 发送消息：

```bash
codex exec <PROMPT>
```

### 关键差异

1. GUI 自动附加和清洗部分参数（例如 `--json`、`resume` 处理）。
2. GUI 可从命令、配置文件、运行输出中多路推断模型信息。
3. GUI 维护本地状态（会话、元数据、运行日志），CLI 默认不维护这些结构化视图。

## 4. 典型工作流（从输入到结果）

1. 用户在 GUI 输入消息。
2. Renderer 通过 IPC 调用主进程 `chat:send`。
3. 主进程创建 `CodexRunner` 并启动子进程。
4. 运行事件实时回传：
   - 结构化事件
   - 运行步骤
   - 原始 JSON 行
5. 结束后写回 assistant 消息，更新会话与状态。

### 流程图占位

- 流程图（占位）：[docs/assets/flow-input-to-result.svg](./assets/flow-input-to-result.svg)

### 关键截图占位

- 输入并发送（占位）：[docs/assets/workflow-step-1-input.png](./assets/workflow-step-1-input.png)
- 运行中观察日志（占位）：[docs/assets/workflow-step-2-runtime.png](./assets/workflow-step-2-runtime.png)
- 完成后结果与会话状态（占位）：[docs/assets/workflow-step-3-result.png](./assets/workflow-step-3-result.png)

## 5. 兼容性说明

- 当前已验证：`Ubuntu 22.04`
- 当前未验证：`Windows`、`macOS`

## 6. 维护体验增强（GUI 项目侧）

相较于纯 CLI 脚本化组织，当前 GUI 工程新增了 GPT 友好结构：

1. 大文件按职责拆分（main controller / renderer 分层）。
2. 根目录新增 `gpt-readable/`，沉淀代码地图、主链路、提问模板。
3. 更适合让 GPT 或新同学进行“定点阅读 + 定点修改”。
