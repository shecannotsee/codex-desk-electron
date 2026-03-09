# Ubuntu 22.04 部署（DEB）

> 目标：产出可直接安装的 `.deb`，不再依赖手工执行启动脚本。

## 0. 平台范围

- 已验证：`Ubuntu 22.04`
- 未验证：`Windows`、`macOS`

## 1. 打包前准备

确认 logo 文件存在（运行与部署统一使用该文件）：

```bash
ls -la /home/shecannotsee/Desktop/projects/codex-desk-electron/resource/logo.png
```

在打包机安装基础依赖：

```bash
sudo apt update
sudo apt install -y build-essential fakeroot dpkg rpm
```

进入源码目录：

```bash
cd /home/shecannotsee/Desktop/projects/codex-desk-electron/src
npm install
npm run check
```

说明：

- `npm run start` / `npm run dist:deb` 会自动执行 `sync:logo`
- 自动把 `resource/logo.png` 裁白边并做圆形遮罩后输出为 `src/build/icon.png`
- 旧的白边原图已归档为 `resource/logo_with_white_border.png`

## 2. 生成 DEB 安装包

```bash
cd /home/shecannotsee/Desktop/projects/codex-desk-electron/src
npm run dist:deb
```

产物位置：

- `src/dist/*.deb`

## 3. 安装与启动

推荐安装方式（自动拉取系统依赖）：

```bash
sudo apt install ./dist/Codex\ Desk-*.deb
```

安装后可通过以下方式启动：

1. 应用菜单搜索 `Codex Desk`
2. 命令行执行：`codex-desk`

## 4. “依赖都塞进去”说明

`.deb` 会打包：

- Electron 运行时
- 应用代码
- Node 运行依赖

`.deb` 不会完全静态打包系统级共享库（如 `libgtk`、`libnss3`），这类依赖通过 `Depends` 由 APT 安装。

另外，`codex` 命令属于外部 CLI，不会内置进本项目安装包。安装后请确保：

```bash
codex --version
```

## 5. 卸载

请使用独立文档：

- `docs/uninstall.md`

## 6. 常见问题

1. 安装时报缺少依赖：
   - 用 `sudo apt install ./xxx.deb`，不要用 `dpkg -i` 直接装。
2. 能启动但无法对话：
   - 通常是 `codex` 未安装或未登录。
3. 无法联网下载构建依赖：
   - 需先修复 npm 代理配置（例如 `127.0.0.1:7890` 不可达）。
