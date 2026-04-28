const ANSI_PATTERN = /\x1B\[[0-?]*[ -/]*[@-~]/g;

function stripAnsi(text) {
  return String(text || '').replace(ANSI_PATTERN, '');
}

function splitShellArgs(commandText) {
  const input = String(commandText || '').trim();
  if (!input) {
    return [];
  }
  const result = [];
  const re = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|([^\s]+)/g;
  let match = null;
  while ((match = re.exec(input)) !== null) {
    const token = match[1] ?? match[2] ?? match[3] ?? '';
    result.push(token.replace(/\\(["'\\])/g, '$1'));
  }
  return result;
}

function isUsageLikeObject(node) {
  if (!node || typeof node !== 'object') {
    return false;
  }
  const keys = [
    'input_tokens',
    'inputTokens',
    'prompt_tokens',
    'promptTokens',
    'cached_input_tokens',
    'cachedInputTokens',
    'cached_tokens',
    'cachedTokens',
    'output_tokens',
    'outputTokens',
    'completion_tokens',
    'completionTokens',
    'total_tokens',
    'totalTokens',
  ];
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(node, key)) {
      return true;
    }
  }
  return false;
}

function parseUsagePayload(payload, maxNodes = 200) {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const queue = [payload];
  const visited = new Set();
  let scanned = 0;
  while (queue.length) {
    const node = queue.shift();
    if (!node || typeof node !== 'object') {
      continue;
    }
    if (visited.has(node)) {
      continue;
    }
    visited.add(node);
    scanned += 1;
    if (scanned > maxNodes) {
      break;
    }
    if (isUsageLikeObject(node)) {
      return node;
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === 'object') {
        queue.push(value);
      }
    }
  }
  return null;
}

function resolveUsageTokenFields(usage) {
  const inputTokensRaw = usage?.input_tokens
    ?? usage?.inputTokens
    ?? usage?.prompt_tokens
    ?? usage?.promptTokens;
  const cachedInputTokensRaw = usage?.cached_input_tokens
    ?? usage?.cachedInputTokens
    ?? usage?.input_tokens_details?.cached_tokens
    ?? usage?.inputTokensDetails?.cachedTokens
    ?? usage?.prompt_tokens_details?.cached_tokens
    ?? usage?.promptTokensDetails?.cachedTokens
    ?? usage?.cached_tokens
    ?? usage?.cachedTokens;
  const outputTokensRaw = usage?.output_tokens
    ?? usage?.outputTokens
    ?? usage?.completion_tokens
    ?? usage?.completionTokens;
  const totalTokensRaw = usage?.total_tokens ?? usage?.totalTokens ?? usage?.total;
  return {
    inputTokensRaw,
    cachedInputTokensRaw,
    outputTokensRaw,
    totalTokensRaw,
  };
}

function normalizeExecOptionsForProbe(parts) {
  if (!Array.isArray(parts) || parts.length < 2 || parts[0] !== 'codex' || parts[1] !== 'exec') {
    const bin = Array.isArray(parts) && parts.length ? String(parts[0] || 'codex') : 'codex';
    const rest = Array.isArray(parts) ? parts.slice(1) : [];
    return [bin, ...rest];
  }

  const args = parts.slice(2);
  const opts = [];
  const optionsWithValueKeep = new Set([
    '--config', '-c', '--model', '-m', '--profile', '-p', '--sandbox', '-s',
    '--cd', '-C', '--add-dir', '--output-schema', '--enable', '--disable',
  ]);

  for (let i = 0; i < args.length; i += 1) {
    const token = String(args[i] || '');

    if (token === 'resume') {
      if (i + 1 < args.length && !String(args[i + 1] || '').startsWith('-')) {
        i += 1;
      }
      continue;
    }

    if (token === '--json' || token === '--last' || token === '--all') {
      continue;
    }

    if (token === '--color' || token === '--output-last-message' || token === '-o') {
      if (i + 1 < args.length) {
        i += 1;
      }
      continue;
    }

    if (optionsWithValueKeep.has(token) && i + 1 < args.length) {
      opts.push(token, String(args[i + 1] || ''));
      i += 1;
      continue;
    }

    opts.push(token);
  }

  return ['codex', 'exec', ...opts];
}

module.exports = {
  stripAnsi,
  splitShellArgs,
  parseUsagePayload,
  resolveUsageTokenFields,
  normalizeExecOptionsForProbe,
};
