const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { newConversation } = require('./conversation_service');

const APP_ROOT = path.resolve(__dirname, '..', '..');
const APP_DATA_DIR = path.join(APP_ROOT, '.codexdesk');
const LEGACY_STATE_PATH = path.join(os.homedir(), '.codexdesk', 'state.electron.json');
const DEFAULT_STATE_PATH = path.join(APP_DATA_DIR, 'state.electron.json');
const DEFAULT_COMMAND_TEXT = 'codex exec --skip-git-repo-check';

function normalizeCommandText(raw) {
  const text = String(raw || '').trim();
  if (!text) {
    return DEFAULT_COMMAND_TEXT;
  }
  // Backward-compatible cleanup: remove legacy `--color never` from codex exec defaults.
  return text.replace(/\s--color(?:=|\s+)never\b/g, '').replace(/\s+/g, ' ').trim();
}

function normalizeWorkdir(candidate) {
  const fallback = path.resolve(APP_ROOT);
  const homeRoot = path.resolve(os.homedir());
  const tmpRoot = path.resolve('/tmp');
  const resolved = path.resolve(String(candidate || '').trim() || fallback);

  if (
    resolved === homeRoot
    || resolved.startsWith(`${homeRoot}${path.sep}`)
    || resolved === tmpRoot
    || resolved.startsWith(`${tmpRoot}${path.sep}`)
  ) {
    return resolved;
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
      result.push({ role, text });
    }
  }
  return result;
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
      conversations.push(conv);
    }

    if (!conversations.length) {
      const fallbackMessages = parseMessages(data.messages);
      const fallbackSessionId = String(data.sessionId || data.session_id || '').trim();
      if (fallbackMessages.length || fallbackSessionId) {
        const conv = newConversation();
        conv.messages = fallbackMessages;
        conv.sessionId = fallbackSessionId;
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
        messages: Array.isArray(item.messages) ? item.messages.slice(-200) : [],
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
