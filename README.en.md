# codex-desk-electron (English)

`codex-desk-electron` is an Electron desktop client for Codex CLI, with multi-conversation management and GUI runtime observability.

## Documentation

- Quick Start: [docs/quick-start.md](./docs/quick-start.md)
- User Guide (scenario-based): [docs/user-guide.md](./docs/user-guide.md)
- CLI vs GUI (core): [docs/cli-vs-gui.md](./docs/cli-vs-gui.md)
- Architecture: [docs/architecture.md](./docs/architecture.md)
- Dev Guide: [docs/dev-guide.md](./docs/dev-guide.md)
- Ubuntu DEB Deploy: [docs/deploy-ubuntu.md](./docs/deploy-ubuntu.md)
- Uninstall Guide: [docs/uninstall.md](./docs/uninstall.md)
- FAQ: [docs/faq.md](./docs/faq.md)
- Changelog: [CHANGELOG.md](./CHANGELOG.md)
- GPT Readable Map: [gpt-readable/README.md](./gpt-readable/README.md)

## Validation Status

- Verified: `Ubuntu 22.04`
- Not yet verified: `Windows`, `macOS`

## Project Layout

- `src/main/`: main process, state orchestration, runtime control
- `src/renderer/`: renderer UI and interaction logic
- `gpt-readable/`: GPT-first module map and workflow notes
- `src/shared/`: shared modules
- `docs/`: project documentation
- `start_electron.sh`: one-command launcher

## Quick Start

### Option A: launch from project root

```bash
cd /home/shecannotsee/Desktop/projects/codex-desk-electron
./start_electron.sh
```

### Option B: manual dev launch

```bash
cd /home/shecannotsee/Desktop/projects/codex-desk-electron/src
npm install
npm run check
npm start
```

## Ubuntu DEB Build

```bash
cd /home/shecannotsee/Desktop/projects/codex-desk-electron/src
npm run dist:deb
```

## Documentation Maintenance Rule

- Must update before each release:
  - `docs/cli-vs-gui.md`
  - `CHANGELOG.md`
- PR should include doc update status:
  - `.github/pull_request_template.md`
