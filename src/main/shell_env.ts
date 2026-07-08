const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { spawnSyncCommand } = require('./child_process_helper');

let cachedShellEnv = null;

function parseEnvBuffer(buffer) {
  const raw = Buffer.isBuffer(buffer) ? buffer.toString('utf-8') : String(buffer || '');
  const result = {};
  for (const chunk of raw.split('\0')) {
    const line = String(chunk || '').trim();
    if (!line) {
      continue;
    }
    const pivot = line.indexOf('=');
    if (pivot <= 0) {
      continue;
    }
    const key = line.slice(0, pivot).trim();
    if (!key) {
      continue;
    }
    result[key] = line.slice(pivot + 1);
  }
  return result;
}

function loadLoginShellEnv() {
  if (process.platform === 'win32') {
    const result = { ...process.env };
    const pathKey = Object.prototype.hasOwnProperty.call(result, 'Path') ? 'Path' : 'PATH';
    const entries = String(result[pathKey] || '')
      .split(path.delimiter)
      .map((item) => item.trim())
      .filter(Boolean);
    const extraEntries = [
      process.env.APPDATA ? path.join(process.env.APPDATA, 'npm') : '',
      path.join(os.homedir(), 'AppData', 'Roaming', 'npm'),
    ].filter(Boolean);

    for (const entry of extraEntries) {
      if (fs.existsSync(entry) && !entries.some((item) => item.toLowerCase() === entry.toLowerCase())) {
        entries.push(entry);
      }
    }
    result[pathKey] = entries.join(path.delimiter);
    return result;
  }

  const shell = String(process.env.SHELL || '').trim() || '/bin/bash';
  const candidates = Array.from(new Set([shell, '/bin/bash', '/bin/sh']));

  for (const candidate of candidates) {
    const result = spawnSyncCommand(candidate, ['-lc', 'env -0'], {
      encoding: null,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (result.status !== 0) {
      continue;
    }
    const parsed = parseEnvBuffer(result.stdout);
    if (Object.keys(parsed).length > 0) {
      return parsed;
    }
  }

  return {};
}

function getShellEnv() {
  if (!cachedShellEnv) {
    cachedShellEnv = loadLoginShellEnv();
  }
  return cachedShellEnv;
}

function getCodexChildEnv() {
  return {
    ...process.env,
    ...getShellEnv(),
  };
}

module.exports = {
  getCodexChildEnv,
};
