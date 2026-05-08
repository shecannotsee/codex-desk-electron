# 卸载指南

## 1. 卸载应用

先确认包名：

```bash
dpkg -l | rg -i "conductor|codex"
```

常见卸载命令：

```bash
sudo apt remove conductor
```

## 2. 清理系统配置

```bash
sudo apt purge conductor
sudo apt autoremove -y
```

如包名不同，替换为实际包名。

## 3. 可选：删除本地数据

谨慎执行。会删除会话、加密 token、Telegram 日志和本地状态：

```bash
rm -rf /home/shecannotsee/Desktop/projects/conductor/.conductor
rm -rf ~/.conductor
```

临时工作目录如不再需要也可以删除：

```bash
rm -rf /home/shecannotsee/Desktop/projects/conductor/conductor-workspace
```

## 4. Codex CLI

卸载 Conductor 不会卸载 Codex CLI。若要移除 CLI，请按 Codex CLI 的安装方式单独卸载。
