const os = require('node:os');

function normalizeBaseOptions(baseCmd): [string[], boolean] {
  if (baseCmd.length >= 2 && baseCmd[0] === 'codex' && baseCmd[1] === 'exec') {
    const args = baseCmd.slice(2);
    const opts = [];
    let hasAddDir = false;
    let hasPermissionMode = false;
    const optionsWithValueKeep = new Set([
      '--config', '-c', '--model', '-m', '--profile', '-p', '--sandbox', '-s',
      '--cd', '-C', '--add-dir', '--output-schema', '--enable', '--disable',
    ]);

    for (let i = 0; i < args.length; i += 1) {
      const token = args[i];

      // The runner owns native session selection; preserving a user-supplied resume target would leak prior turns.
      if (token === 'resume') {
        if (i + 1 < args.length && !String(args[i + 1]).startsWith('-')) {
          i += 1;
        }
        continue;
      }

      // Output mode is normalized so the parser always receives newline-delimited JSON events.
      if (token === '--json' || token === '--last' || token === '--all') {
        continue;
      }

      // These flags can suppress event streaming or duplicate the final answer, so the UI controls them instead.
      if (token === '--color' || token === '--output-last-message' || token === '-o') {
        if (i + 1 < args.length) {
          i += 1;
        }
        continue;
      }

      if (token === '--add-dir' || String(token).startsWith('--add-dir=')) {
        hasAddDir = true;
      }

      if (
        token === '--dangerously-bypass-approvals-and-sandbox'
        || token === '--full-auto'
        || token === '--sandbox'
        || token === '-s'
        || String(token).startsWith('--sandbox=')
      ) {
        hasPermissionMode = true;
      }

      if (optionsWithValueKeep.has(token) && i + 1 < args.length) {
        opts.push(token, args[i + 1]);
        i += 1;
        continue;
      }

      opts.push(token);
    }

    if (!hasAddDir) {
      const homeDir = String(os.homedir() || '').trim();
      if (homeDir) {
        // Desktop users often attach files outside the project; adding HOME keeps those paths readable by Codex.
        opts.push('--add-dir', homeDir);
      }
    }

    if (!hasPermissionMode) {
      // Electron already gates permissions at the app layer, so the child CLI should not re-prompt invisibly.
      opts.push('--dangerously-bypass-approvals-and-sandbox');
    }

    opts.push('--json');
    return [['codex', 'exec', ...opts], true];
  }

  return [[...baseCmd], false];
}

module.exports = {
  normalizeBaseOptions,
};
