const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { newConversation, nowTs } = require('./conversation_service');

const APP_ROOT = path.resolve(__dirname, '..', '..');
const APP_DATA_DIR = path.join(APP_ROOT, '.codexdesk');
const LEGACY_STATE_PATH = path.join(os.homedir(), '.codexdesk', 'state.electron.json');
const DEFAULT_STATE_PATH = path.join(APP_DATA_DIR, 'state.electron.json');
const LEGACY_DEFAULT_COMMAND_TEXT = 'codex exec --skip-git-repo-check';
const DEFAULT_COMMAND_TEXT = 'codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox';
const MAX_PERSISTED_MESSAGES = 2000;

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

function normalizeWorkdir(candidate) {
  const fallback = path.resolve(APP_ROOT);
  const raw = String(candidate || '').trim();
  if (!raw) {
    return fallback;
  }
  return path.resolve(raw);
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
      const message = { role, text };
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

function toNumber(value, fallback) {
  const num = Number(value);
  if (Number.isFinite(num)) {
    return num;
  }
  return fallback;
}

class StateStore {
  constructor(statePath = DEFAULT_STATE_PATH) {
    this.path = statePath;
  }

  _defaultState() {
    return {
      commandText: DEFAULT_COMMAND_TEXT,
      workdir: APP_ROOT,
      useNativeMemory: true,
      activeConversationId: '',
      conversations: [],
    };
  }

  _readStateFile(filePath) {
    if (!fs.existsSync(filePath)) {
      return null;
    }
    try {
      const text = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(text);
      if (data && typeof data === 'object') {
        return data;
      }
    } catch {
      // ignore
    }
    return null;
  }

  load() {
    let data = this._readStateFile(this.path);

    // Backward-compatible migration: use legacy home path when new project-local path is absent.
    if (!data && this.path === DEFAULT_STATE_PATH) {
      data = this._readStateFile(LEGACY_STATE_PATH);
    }

    if (!data || typeof data !== 'object') {
      return this._defaultState();
    }

    const commandText = normalizeCommandText(data.commandText || DEFAULT_COMMAND_TEXT);
    const workdir = normalizeWorkdir(data.workdir);
    const useNativeMemory = true;

    const conversations = [];
    const rawConversations = Array.isArray(data.conversations) ? data.conversations : [];
    for (let index = 0; index < rawConversations.length; index += 1) {
      const item = rawConversations[index];
      if (!item || typeof item !== 'object') {
        continue;
      }
      const conv = newConversation();
      conv.id = String(item.id || conv.id).trim() || conv.id;
      conv.title = String(item.title || '').trim() || conv.title;
      conv.sessionId = String(item.sessionId || item.session_id || '').trim();
      conv.messages = parseMessages(item.messages);
      conv.createdAt = toNumber(item.createdAt ?? item.created_at, conv.createdAt);
      conv.updatedAt = toNumber(item.updatedAt ?? item.updated_at, conv.updatedAt);
      fillMissingMessageCreatedAt(conv.messages, conv.createdAt, conv.updatedAt);
      conversations.push(conv);
    }

    if (!conversations.length) {
      const fallbackMessages = parseMessages(data.messages);
      const fallbackSessionId = String(data.sessionId || data.session_id || '').trim();
      if (fallbackMessages.length || fallbackSessionId) {
        const conv = newConversation();
        conv.messages = fallbackMessages;
        conv.sessionId = fallbackSessionId;
        fillMissingMessageCreatedAt(conv.messages, conv.createdAt, conv.updatedAt);
        conversations.push(conv);
      }
    }

    let activeConversationId = String(data.activeConversationId || data.active_conversation_id || '').trim();
    if (conversations.length && (!activeConversationId || !conversations.some((item) => item.id === activeConversationId))) {
      activeConversationId = conversations[0].id;
    } else if (!conversations.length) {
      activeConversationId = '';
    }

    return {
      commandText,
      workdir,
      useNativeMemory,
      activeConversationId,
      conversations,
    };
  }

  save(state) {
    const parent = path.dirname(this.path);
    fs.mkdirSync(parent, { recursive: true });

    const conversations = Array.isArray(state.conversations) ? state.conversations : [];

    let activeConversationId = String(state.activeConversationId || '').trim();
    if (conversations.length && (!activeConversationId || !conversations.some((item) => item.id === activeConversationId))) {
      activeConversationId = conversations[0].id;
    } else if (!conversations.length) {
      activeConversationId = '';
    }

    const payload = {
      commandText: normalizeCommandText(state.commandText || ''),
      workdir: normalizeWorkdir(state.workdir),
      useNativeMemory: Boolean(state.useNativeMemory),
      activeConversationId,
      conversations: conversations.map((item) => ({
        id: item.id,
        title: item.title,
        sessionId: item.sessionId || '',
        createdAt: Number(item.createdAt || 0),
        updatedAt: Number(item.updatedAt || 0),
        messages: Array.isArray(item.messages) ? item.messages.slice(-MAX_PERSISTED_MESSAGES) : [],
      })),
    };

    fs.writeFileSync(this.path, JSON.stringify(payload, null, 2), 'utf-8');
  }
}

module.exports = {
  APP_ROOT,
  APP_DATA_DIR,
  LEGACY_STATE_PATH,
  DEFAULT_STATE_PATH,
  StateStore,
};
