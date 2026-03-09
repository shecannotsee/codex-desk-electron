# Source Directory

This directory contains the Electron source code and Node package files.

- `main/`: main process
  - `main/app_controller/`: AppController split modules
- `renderer/`: renderer process
  - `renderer/app/`: renderer split scripts
- `shared/`: shared modules
- `package.json`: scripts and dependencies
- `electron-builder.yml`: Ubuntu DEB packaging config
- `scripts/sync-logo.js`: trim + round-mask `../resource/logo.png` to `build/icon.png`

For project-level documentation, see:

- [../README.md](../README.md)
- [../README.zh-CN.md](../README.zh-CN.md)
- [../README.en.md](../README.en.md)
- [../docs/quick-start.md](../docs/quick-start.md)
- [../docs/user-guide.md](../docs/user-guide.md)
- [../docs/cli-vs-gui.md](../docs/cli-vs-gui.md)
- [../llm-readable/README.md](../llm-readable/README.md)
- [../CHANGELOG.md](../CHANGELOG.md)
