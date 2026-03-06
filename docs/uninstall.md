# Ubuntu 22.04 卸载指南

> 目标：完整卸载 Codex Desk，并按需清理本地数据。

## 0. 平台范围

- 已验证：`Ubuntu 22.04`
- 未验证：`Windows`、`macOS`

## 1. 确认已安装包名

先确认实际包名（不同构建配置下包名可能略有差异）：

```bash
dpkg -l | rg -i "codex|desk|codexdesk"
```

常见包名通常是：

- `codexdesk-electron`
- `codex-desk`

## 2. 卸载应用（保留配置）

```bash
sudo apt remove codexdesk-electron
```

如果你的包名是 `codex-desk`，改成：

```bash
sudo apt remove codex-desk
```

## 3. 完整卸载（包含系统配置）

```bash
sudo apt purge codexdesk-electron
sudo apt autoremove -y
```

## 4. 可选：清理应用数据

如果你还想清除本项目运行状态与会话数据：

```bash
rm -rf /home/shecannotsee/Desktop/projects/codex-desk-electron/.codexdesk
rm -rf ~/.codexdesk
```

说明：

1. 第一行是当前仓库内状态文件（项目级）。
2. 第二行是兼容读取的历史状态目录（用户级）。

## 5. 验证卸载结果

```bash
which codex-desk || true
dpkg -l | rg -i "codexdesk-electron|codex-desk" || true
```

如果没有输出或显示 `no packages found`，表示应用已卸载。

## 6. 与 Codex CLI 的关系

卸载 Codex Desk 不会自动卸载 `codex` CLI。  
如果你也要移除 CLI，请按 Codex CLI 的安装方式分别卸载。
