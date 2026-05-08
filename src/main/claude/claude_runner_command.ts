const os = require('node:os');

function isClaudeCommand(commandTextOrParts) {
  const parts = Array.isArray(commandTextOrParts) ? commandTextOrParts : [];
  const bin = String(parts[0] || '').trim().toLowerCase();
  return Boolean(bin) && (bin === 'claude' || bin.endsWith('/claude') || bin.includes('claude'));
}

function optionTakesValue(token) {
  return new Set([
    '--agent',
    '--agents',
    '--append-system-prompt',
    '--betas',
    '--debug',
    '--debug-file',
    '--effort',
    '--fallback-model',
    '--input-format',
    '--json-schema',
    '--max-budget-usd',
    '--mcp-config',
    '--model',
    '--name',
    '--output-format',
    '--permission-mode',
    '--plugin-dir',
    '--resume',
    '-r',
    '--session-id',
    '--setting-sources',
    '--settings',
    '--system-prompt',
    '--tools',
    '--worktree',
    '-w',
  ]).has(token);
}

function optionTakesVariadicValue(token) {
  return new Set([
    '--add-dir',
    '--allowedTools',
    '--allowed-tools',
    '--disallowedTools',
    '--disallowed-tools',
    '--file',
  ]).has(token);
}

function normalizeClaudeBaseOptions(baseCmd) {
  const bin = baseCmd[0] || 'claude';
  const args = baseCmd.slice(1);
  const opts = [];
  let hasAddDir = false;
  let hasPermissionMode = false;
  let hasVerbose = false;
  let hasPartialMessages = false;
  let explicitResume = false;
  let skipPromptLikeValue = false;

  for (let i = 0; i < args.length; i += 1) {
    const token = String(args[i] || '');
    if (!token) {
      continue;
    }

    if (skipPromptLikeValue) {
      skipPromptLikeValue = false;
      continue;
    }

    if (token === '-p' || token === '--print') {
      continue;
    }
    if (token === '--output-format') {
      if (i + 1 < args.length) {
        i += 1;
      }
      continue;
    }
    if (token.startsWith('--output-format=')) {
      continue;
    }
    if (token === '--input-format') {
      if (i + 1 < args.length) {
        i += 1;
      }
      continue;
    }
    if (token.startsWith('--input-format=')) {
      continue;
    }
    if (token === '--verbose') {
      hasVerbose = true;
      continue;
    }
    if (token === '--include-partial-messages') {
      hasPartialMessages = true;
      continue;
    }
    if (token === '--resume' || token === '-r' || token === '--continue' || token === '-c' || token === '--session-id') {
      explicitResume = true;
      if ((token === '--resume' || token === '-r' || token === '--session-id') && i + 1 < args.length && !String(args[i + 1] || '').startsWith('-')) {
        i += 1;
      }
      continue;
    }
    if (token.startsWith('--resume=') || token.startsWith('--session-id=')) {
      explicitResume = true;
      continue;
    }
    if (token === '--fork-session') {
      continue;
    }
    if (token === '--permission-mode') {
      hasPermissionMode = true;
      if (i + 1 < args.length) {
        opts.push(token, args[i + 1]);
        i += 1;
      }
      continue;
    }
    if (token.startsWith('--permission-mode=')) {
      hasPermissionMode = true;
      opts.push(token);
      continue;
    }
    if (token === '--dangerously-skip-permissions' || token === '--allow-dangerously-skip-permissions') {
      hasPermissionMode = true;
      opts.push(token);
      continue;
    }
    if (token === '--add-dir') {
      hasAddDir = true;
      opts.push(token);
      while (i + 1 < args.length && !String(args[i + 1] || '').startsWith('-')) {
        opts.push(args[i + 1]);
        i += 1;
      }
      continue;
    }
    if (token.startsWith('--add-dir=')) {
      hasAddDir = true;
      opts.push(token);
      continue;
    }

    if (optionTakesVariadicValue(token)) {
      opts.push(token);
      while (i + 1 < args.length && !String(args[i + 1] || '').startsWith('-')) {
        opts.push(args[i + 1]);
        i += 1;
      }
      continue;
    }
    if (optionTakesValue(token)) {
      opts.push(token);
      if (i + 1 < args.length) {
        opts.push(args[i + 1]);
        i += 1;
      }
      continue;
    }
    if (!token.startsWith('-')) {
      // The GUI owns the prompt. A prompt embedded in the configured command
      // would otherwise be prepended before the user's current message.
      skipPromptLikeValue = false;
      continue;
    }
    opts.push(token);
  }

  if (!hasVerbose) {
    opts.push('--verbose');
  }
  if (!hasPartialMessages) {
    opts.push('--include-partial-messages');
  }
  if (!hasAddDir) {
    const homeDir = String(os.homedir() || '').trim();
    if (homeDir) {
      opts.push('--add-dir', homeDir);
    }
  }
  if (!hasPermissionMode) {
    opts.push('--permission-mode', 'bypassPermissions');
  }

  return {
    command: [bin, '-p', '--output-format', 'stream-json', ...opts],
    explicitResume,
  };
}

function buildClaudeCommand({ baseCmd, prompt, sessionId = '', useNativeMemory = true, forceFork = false }) {
  const { command, explicitResume } = normalizeClaudeBaseOptions(baseCmd);
  const args = [...command];
  if (!explicitResume && useNativeMemory && sessionId) {
    args.push('--resume', sessionId);
    if (forceFork) {
      args.push('--fork-session');
    }
  }
  args.push('--', String(prompt || ''));
  return args;
}

module.exports = {
  buildClaudeCommand,
  isClaudeCommand,
  normalizeClaudeBaseOptions,
};
