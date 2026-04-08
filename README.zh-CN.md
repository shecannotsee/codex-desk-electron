# codex-desk-electron（中文）

`codex-desk-electron` 是 Codex CLI 的 Electron 桌面端，提供多会话管理、运行可视化和 GUI 增强能力。

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
- 大模型快速代码地图: [llm-readable/README.md](./llm-readable/README.md)

## 当前验证状态

- 已验证：`Ubuntu 22.04`
- 未验证：`Windows`、`macOS`

## 目录结构

- `src/main/`：TypeScript 主进程源码、状态编排、运行控制
- `src/renderer/`：TypeScript 渲染进程源码与页面骨架
- `src/app/`：`npm run build` 生成的编译产物
- `llm-readable/`：面向任意大模型的快速阅读索引
- `docs/`：项目文档
- `start.sh`：一键启动脚本

## 快速启动

### 方式一：根目录脚本启动

```bash
cd /home/shecannotsee/Desktop/projects/codex-desk-electron
./start.sh
```

### 方式二：手动开发启动

```bash
cd /home/shecannotsee/Desktop/projects/codex-desk-electron/src
npm install
npm run check
npm start
```

## Ubuntu DEB 打包

```bash
cd /home/shecannotsee/Desktop/projects/codex-desk-electron/src
npm run dist:deb
```

## 文档截图自动生成

```bash
cd /home/shecannotsee/Desktop/projects/codex-desk-electron/src
npm run capture:docs
```

## 文档维护约定

- 每次发版前必须更新：
  - `docs/cli-vs-gui.md`
  - `CHANGELOG.md`
- PR 必须勾选文档更新状态：
  - `.github/pull_request_template.md`

## 当前交互补充

- 主进程与渲染层源码已迁移到 `TypeScript`，开发校验统一走 `cd src && npm run check`。
- Renderer 不再依赖按顺序注入的全局脚本，改为 `ES Module` 方式加载。
- `src/renderer/app/types.ts` 集中定义 Renderer 共享状态、事件和渲染选项类型。
- 设置抽屉中的“界面缩放”已改为 `10%` 一档的滑杆。
- 拖动缩放时会即时生效，并在设置中同步显示当前百分比。
- 使用主键区快捷键缩放时，顶部会弹出百分比提示并自动消失。
- 快捷键使用主键区：
  - `Alt+=`：放大
  - `Alt+-`：缩小
  - `Alt+0`：恢复实际大小
- 切换会话时会自动定位到该会话底部，直接看到最新消息。
- 在聊天区和右侧运行面板选中文字后右键，可直接复制。
- 回复中的外部链接会使用系统默认浏览器打开，不再在应用内部弹窗。
