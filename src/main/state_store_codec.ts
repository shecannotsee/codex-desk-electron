const { nowTs, sortedConversations } = require('./conversation_service');

const LEGACY_DEFAULT_COMMAND_TEXT = 'codex exec --skip-git-repo-check';
const DEFAULT_COMMAND_TEXT = 'codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox';
const DEFAULT_CLAUDE_COMMAND_TEXT = 'claude --permission-mode bypassPermissions';

function normalizeCliProvider(rawProvider = '', commandText = '') {
  const provider = String(rawProvider || '').trim().toLowerCase();
  if (provider === 'claude' || provider === 'codex') {
    return provider;
  }
  const command = String(commandText || '').trim().toLowerCase();
  if (command.includes('claude')) {
    return 'claude';
  }
  return 'codex';
}

function defaultCommandTextForProvider(provider = 'codex') {
  return normalizeCliProvider(provider) === 'claude'
    ? DEFAULT_CLAUDE_COMMAND_TEXT
    : DEFAULT_COMMAND_TEXT;
}

function normalizeCommandText(raw) {
  const text = String(raw || '').trim();
  if (!text) {
    return DEFAULT_COMMAND_TEXT;
  }
  // Backward-compatible cleanup: remove legacy `--color never` from codex exec defaults.
  const normalized = text.replace(/\s--color(?:=|\s+)never\b/g, '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return DEFAULT_COMMAND_TEXT;
  }
  if (normalized === LEGACY_DEFAULT_COMMAND_TEXT) {
    return DEFAULT_COMMAND_TEXT;
  }
  const parts = normalized.split(/\s+/).filter(Boolean);
  const execBin = String(parts[0] || '').toLowerCase();
  if (parts.length < 2 || !execBin.includes('codex') || parts[1] !== 'exec') {
    if (execBin.includes('claude')) {
      return normalizeClaudeCommandText(normalized);
    }
    return normalized;
  }
  if (
    normalized.includes('--dangerously-bypass-approvals-and-sandbox')
    || normalized.includes('--full-auto')
    || normalized.includes('--sandbox ')
    || normalized.includes('--sandbox=')
    || /\s-s\s+\S+/.test(normalized)
  ) {
    return normalized;
  }
  return `${normalized} --dangerously-bypass-approvals-and-sandbox`.trim();
}

function normalizeClaudeCommandText(commandText) {
  const normalized = String(commandText || '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return DEFAULT_CLAUDE_COMMAND_TEXT;
  }
  const parts = normalized.split(/\s+/).filter(Boolean);
  const hasPermissionMode = parts.some((token, index) => {
    const text = String(token || '');
    return text === '--dangerously-skip-permissions'
      || text === '--allow-dangerously-skip-permissions'
      || text.startsWith('--permission-mode=')
      || (text === '--permission-mode' && index + 1 < parts.length);
  });
  if (hasPermissionMode) {
    return normalized;
  }
  return `${normalized} --permission-mode bypassPermissions`;
}

function toNumber(value, fallback) {
  const num = Number(value);
  if (Number.isFinite(num)) {
    return num;
  }
  return fallback;
}

function parseMessages(rawMessages) {
  if (!Array.isArray(rawMessages)) {
    return [];
  }
  const result = [];
  for (const item of rawMessages) {
    if (!item || typeof item !== 'object') {
      continue;
    }
    const role = String(item.role || '').trim();
    const text = String(item.text || '');
    if ((role === 'user' || role === 'assistant') && text) {
      const message: any = { role, text };
      const rawUsage = item.usage;
      if (rawUsage && typeof rawUsage === 'object') {
        const inputTokens = toNumber(rawUsage.inputTokens ?? rawUsage.input_tokens, 0);
        const cachedInputTokens = toNumber(rawUsage.cachedInputTokens ?? rawUsage.cached_input_tokens, 0);
        const outputTokens = toNumber(rawUsage.outputTokens ?? rawUsage.output_tokens, 0);
        const totalTokens = toNumber(rawUsage.totalTokens ?? rawUsage.total_tokens, 0);
        const model = String(rawUsage.model || '').trim();
        if (inputTokens > 0 || cachedInputTokens > 0 || outputTokens > 0 || totalTokens > 0) {
          message.usage = {
            ...(model ? { model } : {}),
            inputTokens,
            cachedInputTokens,
            outputTokens,
            ...(totalTokens > 0 ? { totalTokens } : {}),
          };
        }
      }
      const createdAt = toNumber(item.createdAt ?? item.created_at ?? item.timestamp ?? item.time, 0);
      if (createdAt > 0) {
        message.createdAt = createdAt;
      }
      if (item.interrupted) {
        message.interrupted = true;
      }
      if (typeof item.interruptedReason === 'string' && item.interruptedReason.trim()) {
        message.interruptedReason = item.interruptedReason.trim();
      }
      const interruptedAt = toNumber(item.interruptedAt ?? item.interrupted_at, 0);
      if (interruptedAt > 0) {
        message.interruptedAt = interruptedAt;
      }
      result.push(message);
    }
  }
  return result;
}

function fillMissingMessageCreatedAt(messages, conversationCreatedAt, conversationUpdatedAt) {
  if (!Array.isArray(messages) || !messages.length) {
    return messages;
  }
  const start = toNumber(conversationCreatedAt, 0);
  const endRaw = toNumber(conversationUpdatedAt, start);
  const end = endRaw >= start ? endRaw : start;
  const total = messages.length;
  const span = Math.max(0, end - start);

  for (let index = 0; index < total; index += 1) {
    const item = messages[index];
    if (!item || typeof item !== 'object') {
      continue;
    }
    if (toNumber(item.createdAt, 0) > 0) {
      continue;
    }
    if (total <= 1) {
      item.createdAt = end || start || nowTs();
      continue;
    }
    const ratio = index / (total - 1);
    item.createdAt = (start || nowTs()) + span * ratio;
  }
  return messages;
}

function defaultMeta(sessionId = '') {
  return {
    'Codex版本': '-',
    'Claude版本': '-',
    '模型': '-',
    '会话ID': String(sessionId || '').trim() || '-',
    '输入Tokens': '-',
    '缓存输入Tokens': '-',
    '输出Tokens': '-',
  };
}

function normalizeMeta(rawMeta, sessionId = '') {
  const base = defaultMeta(sessionId);
  if (!rawMeta || typeof rawMeta !== 'object') {
    return base;
  }
  for (const [key, value] of Object.entries(rawMeta)) {
    const normalizedKey = String(key || '').trim();
    if (!normalizedKey) {
      continue;
    }
    base[normalizedKey] = String(value ?? '').trim() || '-';
  }
  if (!String(base['会话ID'] || '').trim() || String(base['会话ID']) === '-') {
    base['会话ID'] = String(sessionId || '').trim() || '-';
  }
  return base;
}

function resolveActiveConversationId(conversations, requestedId = '') {
  const nextId = String(requestedId || '').trim();
  if (!Array.isArray(conversations) || !conversations.length) {
    return '';
  }
  if (nextId && conversations.some((item) => item.id === nextId)) {
    return nextId;
  }
  return sortedConversations(conversations)[0].id;
}

module.exports = {
  DEFAULT_COMMAND_TEXT,
  DEFAULT_CLAUDE_COMMAND_TEXT,
  LEGACY_DEFAULT_COMMAND_TEXT,
  defaultCommandTextForProvider,
  normalizeCliProvider,
  normalizeClaudeCommandText,
  normalizeCommandText,
  parseMessages,
  fillMissingMessageCreatedAt,
  normalizeMeta,
  resolveActiveConversationId,
  toNumber,
};
