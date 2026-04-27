const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const { shell } = require('electron');

let checkedCodeBinary = false;
let hasCodeBinary = false;

function canUseCodeBinary() {
  if (checkedCodeBinary) {
    return hasCodeBinary;
  }
  checkedCodeBinary = true;
  try {
    const result = spawnSync('code', ['--version'], {
      stdio: 'ignore',
      timeout: 1200,
    });
    hasCodeBinary = !result.error && result.status === 0;
  } catch {
    hasCodeBinary = false;
  }
  return hasCodeBinary;
}

function launchDetached(command, args = []) {
  const child = spawn(command, args, {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
}

function parseLocalOpenTarget(input) {
  const raw = String(input || '').trim();
  if (!raw) {
    return { path: '', line: 0, column: 0 };
  }

  let targetPath = raw;
  let hashPart = '';
  if (/^file:\/\//i.test(raw)) {
    try {
      const url = new URL(raw);
      targetPath = decodeURIComponent(url.pathname || '');
      hashPart = String(url.hash || '').replace(/^#/, '');
    } catch {
      return { path: '', line: 0, column: 0 };
    }
  } else {
    const hashIndex = raw.indexOf('#');
    if (hashIndex >= 0) {
      targetPath = raw.slice(0, hashIndex);
      hashPart = raw.slice(hashIndex + 1);
    }
  }

  targetPath = String(targetPath || '').trim();
  if (!targetPath || !path.isAbsolute(targetPath)) {
    return { path: '', line: 0, column: 0 };
  }

  let line = 0;
  let column = 0;
  const hashMatch = /^L(\d+)(?:C(\d+))?$/i.exec(hashPart)
    || /^(\d+)(?::(\d+))?$/.exec(hashPart);
  if (hashMatch) {
    line = Number(hashMatch[1] || 0) || 0;
    column = Number(hashMatch[2] || 0) || 0;
  }

  if (!fs.existsSync(targetPath)) {
    const suffixMatch = /^(.*):(\d+)(?::(\d+))?$/.exec(targetPath);
    if (suffixMatch) {
      const candidatePath = String(suffixMatch[1] || '').trim();
      if (candidatePath && fs.existsSync(candidatePath)) {
        targetPath = candidatePath;
        if (!line) {
          line = Number(suffixMatch[2] || 0) || 0;
        }
        if (!column) {
          column = Number(suffixMatch[3] || 0) || 0;
        }
      }
    }
  }

  return { path: targetPath, line, column };
}

async function openLocalPath(input) {
  const parsed = parseLocalOpenTarget(input);
  const targetPath = String(parsed.path || '').trim();
  if (!targetPath || !path.isAbsolute(targetPath)) {
    return { ok: false, error: '附件路径无效，已忽略。' };
  }
  if (!fs.existsSync(targetPath)) {
    return { ok: false, error: `路径不存在: ${targetPath}` };
  }
  const stats = fs.statSync(targetPath);
  if (stats.isDirectory()) {
    const result = await shell.openPath(targetPath);
    if (String(result || '').trim()) {
      return { ok: false, error: String(result || '').trim() };
    }
    return { ok: true };
  }

  if (canUseCodeBinary()) {
    const gotoTarget = parsed.line > 0
      ? `${targetPath}:${parsed.line}${parsed.column > 0 ? `:${parsed.column}` : ''}`
      : targetPath;
    try {
      launchDetached('code', parsed.line > 0 ? ['--reuse-window', '--goto', gotoTarget] : ['--reuse-window', gotoTarget]);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: `打开文件失败: ${error?.message || String(error)}` };
    }
  }

  const result = await shell.openPath(targetPath);
  if (String(result || '').trim()) {
    return {
      ok: false,
      error: parsed.line > 0
        ? `系统默认程序打开失败，且当前未检测到可用于跳转行号的编辑器。请安装 VS Code 并确保 \`code\` 在 PATH 中，或配置可打开该文件类型的默认程序。原始错误: ${String(result || '').trim()}`
        : `系统默认程序打开失败。请配置可打开该文件类型的默认程序，或安装 VS Code 并确保 \`code\` 在 PATH 中。原始错误: ${String(result || '').trim()}`,
    };
  }
  return {
    ok: true,
    warning: parsed.line > 0
      ? '未检测到 VS Code，已改用系统默认程序打开，无法自动跳转到指定行号。'
      : '未检测到 VS Code，已改用系统默认程序打开。',
  };
}

module.exports = {
  canUseCodeBinary,
  openLocalPath,
  parseLocalOpenTarget,
};
