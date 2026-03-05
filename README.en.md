# codex-desk-electron (English)

`codex-desk-electron` is an Electron desktop client for Codex CLI.

## Project Layout

- `src/main/`: main process, session state, runtime control
- `src/renderer/`: renderer UI and interaction logic
- `src/shared/`: shared modules (if any)
- `src/package.json`: Electron scripts and dependencies
- `start_electron.sh`: one-command startup script

## Usage

1. Ensure `codex` CLI is installed and available in your `PATH`.
2. Enter the project root and launch:

```bash
cd /home/shecannotsee/Desktop/projects/codex-desk-electron
./start_electron.sh
```

3. On first run, dependencies under `src/node_modules` are installed automatically.
4. After launch, manage conversations and send prompts in the app UI.

## Deployment

### Local Development Run

```bash
cd /home/shecannotsee/Desktop/projects/codex-desk-electron/src
npm install
npm start
```

### Code Check

```bash
cd /home/shecannotsee/Desktop/projects/codex-desk-electron/src
npm run check
```

### Initialize as a New Repository (for later GitHub linking)

```bash
cd /home/shecannotsee/Desktop/projects/codex-desk-electron
git init
git add .
git commit -m "chore: initialize codex-desk-electron"
```

## License

MIT. See [LICENSE](./LICENSE).
