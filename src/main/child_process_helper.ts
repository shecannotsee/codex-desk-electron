const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

function getPathValue(env) {
  const source = env || process.env;
  return String(source.PATH || source.Path || source.path || '');
}

function getPathExts(env) {
  const source = env || process.env;
  const value = String(source.PATHEXT || source.PathExt || '.COM;.EXE;.BAT;.CMD');
  return value
    .split(';')
    .map((item) => item.trim())
    .filter(Boolean);
}

function hasPathSeparator(command) {
  return /[\\/]/.test(String(command || ''));
}

function candidateNames(command, env) {
  const raw = String(command || '').trim();
  if (!raw || process.platform !== 'win32' || path.extname(raw)) {
    return [raw];
  }
  return [...getPathExts(env).map((ext) => `${raw}${ext}`), raw];
}

function resolveCommand(command, env) {
  const raw = String(command || '').trim();
  if (!raw) {
    return raw;
  }

  const names = candidateNames(raw, env);
  if (hasPathSeparator(raw)) {
    const baseDir = path.dirname(raw);
    for (const name of names) {
      const candidate = path.isAbsolute(name) ? name : path.join(baseDir, path.basename(name));
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
    return raw;
  }

  const pathDirs = getPathValue(env)
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
  for (const dir of pathDirs) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }
  return raw;
}

function requiresWindowsShell(command) {
  return process.platform === 'win32' && /\.(?:cmd|bat)$/i.test(String(command || ''));
}

function quoteCmdArg(value) {
  const raw = String(value ?? '');
  if (!raw) {
    return '""';
  }
  const escaped = raw
    .replace(/"/g, '\\"')
    .replace(/([&|<>()^%])/g, '^$1');
  return `"${escaped}"`;
}

function normalizeSpawnOptions(command, args: any[] = [], options: any = {}) {
  const resolved = resolveCommand(command, options.env);
  if (requiresWindowsShell(resolved)) {
    const commandLine = `"${[resolved, ...args].map(quoteCmdArg).join(' ')}"`;
    return {
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', commandLine],
      options: {
        ...options,
        shell: false,
        windowsVerbatimArguments: true,
      },
    };
  }
  return {
    command: resolved,
    args,
    options: {
      ...options,
    },
  };
}

function spawnCommand(command, args = [], options: any = {}) {
  const normalized = normalizeSpawnOptions(command, args, options);
  return spawn(normalized.command, normalized.args, normalized.options);
}

function spawnSyncCommand(command, args = [], options: any = {}) {
  const normalized = normalizeSpawnOptions(command, args, options);
  return spawnSync(normalized.command, normalized.args, normalized.options);
}

module.exports = {
  resolveCommand,
  spawnCommand,
  spawnSyncCommand,
};
