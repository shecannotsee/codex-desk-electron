const { spawnSync } = require('node:child_process');

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
  const shell = String(process.env.SHELL || '').trim() || '/bin/bash';
  const candidates = Array.from(new Set([shell, '/bin/bash', '/bin/sh']));

  for (const candidate of candidates) {
    const result = spawnSync(candidate, ['-lc', 'env -0'], {
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
