const { spawnSyncCommand } = require('../child_process_helper');
const { stripAnsi } = require('./codex_cli_gateway');

function emitCodexVersionMeta(runner, cmd) {
  if (!Array.isArray(cmd) || !cmd.length) {
    return;
  }
  const binName = String(cmd[0] || '').toLowerCase();
  if (!binName.includes('codex')) {
    return;
  }

  try {
    const result = spawnSyncCommand(cmd[0], ['--version'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf-8',
      timeout: 6000,
      env: runner.childEnv,
    });
    const output = stripAnsi(String(result.stdout || result.stderr || '').trim());
    const firstLine = output.split(/\r?\n/)[0]?.trim() || '';
    if (firstLine) {
      runner.emit('meta', 'Codex版本', firstLine);
    }
  } catch {
    // Version probing is diagnostic only; command execution must not depend on it.
  }
}

function emitModelMetaFromCommand(runner, cmd) {
  let model = '';
  for (let index = 0; index < cmd.length; index += 1) {
    const token = cmd[index];
    if ((token === '--model' || token === '-m') && index + 1 < cmd.length) {
      model = String(cmd[index + 1]).trim();
    } else if (String(token).startsWith('--model=')) {
      model = String(token).split('=', 2)[1].trim();
    }
  }
  if (model) {
    runner.lastModel = model;
    runner.emit('meta', '模型', model);
  }
}

module.exports = {
  emitCodexVersionMeta,
  emitModelMetaFromCommand,
};
