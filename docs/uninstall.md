# 卸载指南

## 1. 卸载应用

先确认包名：

```bash
dpkg -l | rg -i "codex|desk|codexdesk"
```

常见卸载命令：

```bash
sudo apt remove codexdesk-electron
```

或：

```bash
sudo apt remove codex-desk
```

## 2. 清理系统配置

```bash
sudo apt purge codexdesk-electron
sudo apt autoremove -y
```

如包名不同，替换为实际包名。

## 3. 可选：删除本地数据

谨慎执行。会删除会话、加密 token、Telegram 日志和本地状态：

```bash
rm -rf /home/shecannotsee/Desktop/projects/codex-desk-electron/.codexdesk
rm -rf ~/.codexdesk
```

临时工作目录如不再需要也可以删除：

```bash
rm -rf /home/shecannotsee/Desktop/projects/codex-desk-electron/codex-workspace
```

## 4. Codex CLI

卸载 Codex Desk 不会卸载 Codex CLI。若要移除 CLI，请按 Codex CLI 的安装方式单独卸载。
