const os = require('node:os');

const { splitShellArgs } = require('./codex_cli_gateway');

function normalizeApprovalPolicy(value) {
  return {
    untrusted: 'untrusted',
    'on-failure': 'on-failure',
    'on-request': 'on-request',
    never: 'never',
  }[String(value || '').trim()] || 'never';
}

function resolveSandboxPolicy(sandboxMode, writableRoots) {
  if (sandboxMode === 'read-only') {
    return { type: 'readOnly', networkAccess: false };
  }
  if (sandboxMode === 'workspace-write') {
    return {
      type: 'workspaceWrite',
      writableRoots,
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    };
  }
  return { type: 'dangerFullAccess' };
}

function parseConfigModel(token) {
  const match = /^--config=(.+)$/.exec(String(token || ''));
  const configValue = String(match?.[1] || '').trim();
  const modelFromConfig = /^model\s*=\s*(.+)$/i.exec(configValue);
  return String(modelFromConfig?.[1] || '').replace(/^['"]|['"]$/g, '').trim();
}

function parseAppServerCommandSettings(commandText, workdir) {
  const parts = splitShellArgs(commandText);
  if (parts.length < 2 || String(parts[1] || '') !== 'exec') {
    throw new Error('当前命令不是 `codex exec`，无法使用 fork 导入模式');
  }

  const args = parts.slice(2);
  const rootArgs = [];
  const addDirs = new Set();
  let model = '';
  let approvalPolicy = '';
  let sandboxMode = '';
  let dangerousBypass = false;
  let fullAuto = false;
  let skipGitRepoCheck = false;

  const keepWithValue = new Set(['--config', '-c', '--enable', '--disable']);
  for (let index = 0; index < args.length; index += 1) {
    const token = String(args[index] || '');
    if (keepWithValue.has(token) && index + 1 < args.length) {
      rootArgs.push(token, String(args[index + 1] || ''));
      index += 1;
      continue;
    }
    if (token.startsWith('--config=')) {
      rootArgs.push(token);
      model = parseConfigModel(token) || model;
      continue;
    }
    if ((token === '--model' || token === '-m') && index + 1 < args.length) {
      model = String(args[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (token.startsWith('--model=')) {
      model = token.split('=', 2)[1].trim();
      continue;
    }
    if ((token === '--ask-for-approval' || token === '-a') && index + 1 < args.length) {
      approvalPolicy = String(args[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (token.startsWith('--ask-for-approval=')) {
      approvalPolicy = token.split('=', 2)[1].trim();
      continue;
    }
    if ((token === '--sandbox' || token === '-s') && index + 1 < args.length) {
      sandboxMode = String(args[index + 1] || '').trim();
      index += 1;
      continue;
    }
    if (token.startsWith('--sandbox=')) {
      sandboxMode = token.split('=', 2)[1].trim();
      continue;
    }
    if (token === '--add-dir' && index + 1 < args.length) {
      addDirs.add(String(args[index + 1] || '').trim());
      index += 1;
      continue;
    }
    if (token.startsWith('--add-dir=')) {
      addDirs.add(token.split('=', 2)[1].trim());
      continue;
    }
    if (token === '--dangerously-bypass-approvals-and-sandbox') {
      dangerousBypass = true;
      continue;
    }
    if (token === '--skip-git-repo-check') {
      skipGitRepoCheck = true;
      continue;
    }
    if (token === '--full-auto') {
      fullAuto = true;
    }
  }

  const writableRoots = Array.from(new Set([
    String(workdir || '').trim(),
    String(os.homedir() || '').trim(),
    ...Array.from(addDirs),
  ].filter(Boolean)));

  let resolvedApproval = approvalPolicy;
  let resolvedSandbox = sandboxMode;
  if (dangerousBypass) {
    resolvedApproval = 'never';
    resolvedSandbox = 'danger-full-access';
  } else if (fullAuto) {
    resolvedApproval = resolvedApproval || 'on-request';
    resolvedSandbox = resolvedSandbox || 'workspace-write';
  } else {
    resolvedApproval = resolvedApproval || 'never';
    resolvedSandbox = resolvedSandbox || 'danger-full-access';
  }

  return {
    codexBin: String(parts[0] || 'codex'),
    rootArgs,
    model,
    approvalPolicy: normalizeApprovalPolicy(resolvedApproval),
    sandboxMode: resolvedSandbox,
    sandboxPolicy: resolveSandboxPolicy(resolvedSandbox, writableRoots),
    skipGitRepoCheck,
    dangerousBypass,
  };
}

function buildAppServerCommand(settings) {
  return [settings.codexBin, 'app-server', ...settings.rootArgs];
}

module.exports = {
  buildAppServerCommand,
  parseAppServerCommandSettings,
};
