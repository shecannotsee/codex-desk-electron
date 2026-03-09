# codex-desk-electron

Electron desktop client for Codex CLI, focused on multi-conversation workflow and runtime observability.

## Language

- 中文文档: [README.zh-CN.md](./README.zh-CN.md)
- English docs: [README.en.md](./README.en.md)

## Documentation

- Quick Start: [docs/quick-start.md](./docs/quick-start.md)
- User Guide: [docs/user-guide.md](./docs/user-guide.md)
- CLI vs GUI: [docs/cli-vs-gui.md](./docs/cli-vs-gui.md)
- Architecture: [docs/architecture.md](./docs/architecture.md)
- Dev Guide: [docs/dev-guide.md](./docs/dev-guide.md)
- Ubuntu DEB Deploy: [docs/deploy-ubuntu.md](./docs/deploy-ubuntu.md)
- Uninstall Guide: [docs/uninstall.md](./docs/uninstall.md)
- FAQ: [docs/faq.md](./docs/faq.md)
- Changelog: [CHANGELOG.md](./CHANGELOG.md)
- LLM Readable Map: [llm-readable/README.md](./llm-readable/README.md)

## Current Validation Scope

- Verified: `Ubuntu 22.04`
- Not yet verified: `Windows`, `macOS`

## Quick Run

```bash
cd /home/shecannotsee/Desktop/projects/codex-desk-electron
./start.sh
```

`start.sh` auto-installs missing dependencies, syncs logo resources, then launches app.

## Ubuntu DEB Build

```bash
cd /home/shecannotsee/Desktop/projects/codex-desk-electron/src
npm run dist:deb
```

## License

MIT, see [LICENSE](./LICENSE).
