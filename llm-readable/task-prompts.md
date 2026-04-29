# Task Prompts

## Feature

```text
Implement <feature> with minimal behavior change outside the requested area.
Read llm-readable/system-map.md and llm-readable/core-flows.md first.
Return: impacted files, patch strategy, validation commands, docs to update.
Preserve IPC names and domain entry exports unless there is a strong reason.
```

## Bug

```text
Bug: <symptom>.
Trace the matching flow in llm-readable/core-flows.md.
List the top 3 likely modules, add verification steps, then apply the smallest fix.
Do not change unrelated behavior.
```

## Refactor

```text
Refactor <module/path>.
Keep public API and IPC behavior stable.
Prefer domain modules under src/main/codex, src/main/telegram, src/main/security, or app_controller mixins.
Update docs/architecture.md and llm-readable/*.md if boundaries change.
Run cd src && npm run check.
```

## Docs Sync

```text
Sync documentation to current code.
Update README.md, README.zh-CN.md, README.en.md, docs/*, llm-readable/* as needed.
Remove stale notes that are not project-local.
Regenerate screenshots with cd src && npm run capture:docs when UI changed.
Run cd src && npm run check before commit.
```
