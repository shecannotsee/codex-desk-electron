# Ubuntu 22.04 部署（DEB）

## 1. 范围

当前打包流程已在 Ubuntu 22.04 验证。Windows/macOS 未验证。

## 2. 前置条件

```bash
sudo apt update
sudo apt install -y build-essential fakeroot dpkg rpm
codex --version
```

Codex CLI 不会被打包进 Conductor，安装后的系统仍需要可执行 `codex`。

## 3. 构建 DEB

```bash
cd /home/shecannotsee/Desktop/projects/conductor/src
npm install
npm run check
npm run dist:deb
```

产物位于：

```text
src/dist/*.deb
```

## 4. 安装

推荐使用 `apt install`，让 APT 处理系统共享库依赖：

```bash
cd /home/shecannotsee/Desktop/projects/conductor/src
sudo apt install ./dist/Codex\ Desk-*.deb
```

安装后启动：

- 应用菜单搜索 `Conductor`
- 或执行 `conductor`

## 5. 包含与不包含

包含：

- Electron 运行时。
- 编译后的应用代码。
- Node 运行依赖。
- 应用图标和桌面入口。

不包含：

- Codex CLI。
- `.conductor/` 本地状态。
- `conductor-workspace/` 临时工作目录。

## 6. 常见问题

- `dpkg -i` 报缺依赖：改用 `sudo apt install ./xxx.deb`。
- 应用能启动但无法对话：检查 `codex --version`、PATH 和登录状态。
- Telegram 不工作：检查 token/chat id、主密码是否锁定、`.conductor/telegram.logs.json`。
