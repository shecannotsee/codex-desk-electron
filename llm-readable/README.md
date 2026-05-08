# LLM Readable Index

This directory is a compact maintenance map for LLM-assisted work. It is not user documentation; keep it short, concrete, and synchronized with code boundaries.

Read in this order:

1. [system-map.md](./system-map.md): source ownership and module boundaries.
2. [core-flows.md](./core-flows.md): runtime flows from UI action to main-process behavior.
3. [change-hotspots.md](./change-hotspots.md): where to edit for common changes.
4. [task-prompts.md](./task-prompts.md): reusable prompts for future model sessions.

Validation baseline:

```bash
cd /home/shecannotsee/Desktop/projects/conductor/src
npm run check
```

Use `npm run build` when path moves, preload IPC, static assets, or screenshot docs are touched.
