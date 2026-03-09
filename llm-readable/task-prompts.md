# Model Task Prompts (Generic)

Use these prompts with any LLM. Replace placeholders.

## 1) Feature Change Prompt

```
目标：在不改变现有行为边界的前提下实现 <feature>。
请先读取：llm-readable/system-map.md, llm-readable/core-flows.md, llm-readable/change-hotspots.md。
输出格式：
1. 影响文件清单（按必要性排序）
2. 最小补丁方案
3. 回归验证步骤（可执行）
约束：保持 IPC 名称兼容，不引入未使用依赖。
```

## 2) Bug Triage Prompt

```
现象：<bug symptom>
请按以下顺序定位：
1. 流程定位（对应 core flow）
2. 可疑模块（至少 3 个，按概率降序）
3. 每个可疑点的验证步骤与预期日志
4. 最小修复补丁
5. 风险与回归点
```

## 3) Refactor Prompt

```
请对 <file> 做可读性重构：
- 保持外部接口与行为不变
- 拆分为 <N> 个职责模块
- 增加必要注释（仅复杂逻辑）
- 更新 llm-readable/system-map.md 与 docs/architecture.md
输出：补丁 + 迁移说明 + 校验结果
```

## 4) Docs Sync Prompt

```
请将本次代码改动同步到 README/docs/CHANGELOG，并满足：
- 只写可验证步骤
- 标注已验证平台与未验证平台
- CLI vs GUI 差异必须更新
- LLM 快速阅读目录引用必须有效
```
