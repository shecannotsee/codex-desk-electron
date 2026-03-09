# codex-desk-electron（中文）

`codex-desk-electron` 是面向 Codex CLI 的 Electron 桌面客户端，提供多会话管理、运行可视化与 GUI 增强能力。

## 文档导航

- 5 分钟上手: [docs/quick-start.md](./docs/quick-start.md)
- 用户指南（按场景）: [docs/user-guide.md](./docs/user-guide.md)
- CLI 与 GUI 对照（核心）: [docs/cli-vs-gui.md](./docs/cli-vs-gui.md)
- 技术架构: [docs/architecture.md](./docs/architecture.md)
- 开发/调试/打包: [docs/dev-guide.md](./docs/dev-guide.md)
- Ubuntu DEB 部署: [docs/deploy-ubuntu.md](./docs/deploy-ubuntu.md)
- 卸载指南: [docs/uninstall.md](./docs/uninstall.md)
- 常见问题: [docs/faq.md](./docs/faq.md)
- 版本变更: [CHANGELOG.md](./CHANGELOG.md)
- GPT 快速上手代码地图: [gpt-readable/README.md](./gpt-readable/README.md)

## 当前验证状态

- 已验证：`Ubuntu 22.04`
- 未验证：`Windows`、`macOS`

## 目录结构

- `src/main/`：主进程、状态管理、运行控制
- `src/renderer/`：渲染进程 UI 与交互逻辑
- `gpt-readable/`：面向 GPT 的功能划分与调用路径说明
- `src/shared/`：共享模块
- `docs/`：项目文档
- `start.sh`：一键启动脚本

## 快速启动

### 方式一：项目根目录一键启动

```bash
cd /home/shecannotsee/Desktop/projects/codex-desk-electron
./start.sh
```

`start.sh` 会在启动前自动安装依赖（如缺失），并对 `resource/logo.png` 自动裁白边 + 圆形化后再应用。

### 方式二：手动开发启动

```bash
cd /home/shecannotsee/Desktop/projects/codex-desk-electron/src
npm install
npm run check
npm start
```

说明：`npm start` 同样会先执行 logo 同步。

## Ubuntu DEB 打包

```bash
cd /home/shecannotsee/Desktop/projects/codex-desk-electron/src
npm run dist:deb
```

## 文档维护约定

- 每次发版前必须更新：
  - `docs/cli-vs-gui.md`
  - `CHANGELOG.md`
- PR 必须勾选是否更新文档：
  - `.github/pull_request_template.md`
