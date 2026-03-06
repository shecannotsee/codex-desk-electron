# 5 分钟上手

> 适用读者：首次运行本项目的人。

> 如果你要的是“安装版（.deb）而非开发态启动”，请看 `docs/deploy-ubuntu.md`。

## 0. 平台说明

- 已验证：`Ubuntu 22.04`
- 未验证：`Windows`、`macOS`

## 1. 前置条件（1 分钟）

1. 安装 Node.js（建议 `18+`）。
2. 已安装 `codex` 命令并可在终端直接执行。
3. `codex` 已完成登录，且能在终端执行最小命令。

可验证命令：

```bash
node -v
codex --version
```

## 2. 启动项目（1 分钟）

### 方式一：项目根目录一键启动

```bash
cd /home/shecannotsee/Desktop/projects/codex-desk-electron
./start_electron.sh
```

### 方式二：手动启动

```bash
cd /home/shecannotsee/Desktop/projects/codex-desk-electron/src
npm install
npm run check
npm start
```

## 3. 创建第一个会话（1 分钟）

1. 左侧点击“新建对话”。
2. 在输入框输入测试问题（如：`请用三行总结这段项目代码结构`）。
3. 按 `Ctrl+Enter` 发送。

预期结果：

- 中间聊天区出现回复。
- 右侧可看到结构化事件、运行步骤、事件原文（JSON）。

## 4. 快速验证关键能力（2 分钟）

1. 在任务运行中再次发送消息，验证“排队发送”。
2. 切换到“运行步骤”标签，验证默认折叠与手动展开。
3. 通过菜单 `视图 -> 语言` 切换中英文。
4. 通过菜单 `运行` 触发“获取版本/获取模型”。

## 5. 失败时先看哪里

1. 右侧“结构化事件”中是否有 `error/warn`。
2. 右侧“事件原文(JSON)”是否有可读错误。
3. 终端里 `codex --version` 是否可用。
4. `工作目录` 是否存在且有访问权限。

## 6. 演示资源占位

- 快速上手 GIF（占位）：[docs/assets/quick-start.gif](./assets/quick-start.gif)
- 启动后主界面截图（占位）：[docs/assets/screenshot-main.png](./assets/screenshot-main.png)

> 说明：以上文件请你后续补充到 `docs/assets/` 目录。
