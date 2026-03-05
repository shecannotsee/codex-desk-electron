# codex-desk-electron（中文）

`codex-desk-electron` 是基于 Electron 的 Codex CLI 桌面客户端。

## 目录结构

- `src/main/`：主进程、会话状态与运行控制
- `src/renderer/`：渲染进程 UI 与交互逻辑
- `src/shared/`：共享逻辑（如有）
- `src/package.json`：Electron 脚本与依赖
- `start_electron.sh`：一键启动脚本

## 使用说明

1. 确保已安装并可在 `PATH` 中调用 `codex` 命令。
2. 进入项目目录并启动：

```bash
cd /home/shecannotsee/Desktop/projects/codex-desk-electron
./start_electron.sh
```

3. 首次运行会自动安装 `src/node_modules` 依赖。
4. 启动后可在界面中管理会话并发送消息。

## 部署说明

### 本地开发运行

```bash
cd /home/shecannotsee/Desktop/projects/codex-desk-electron/src
npm install
npm start
```

### 代码检查

```bash
cd /home/shecannotsee/Desktop/projects/codex-desk-electron/src
npm run check
```

### 新仓库初始化（后续可接入 GitHub）

```bash
cd /home/shecannotsee/Desktop/projects/codex-desk-electron
git init
git add .
git commit -m "chore: initialize codex-desk-electron"
```

## 许可证

MIT，详见 [LICENSE](./LICENSE)。
