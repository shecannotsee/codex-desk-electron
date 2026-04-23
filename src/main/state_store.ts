const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const { newConversation, nowTs, sortedConversations } = require('./conversation_service');
const { resolveRepoRoot } = require('./project_paths');

const APP_ROOT = resolveRepoRoot(__dirname);
const DEFAULT_WORKDIR = path.join(APP_ROOT, 'codex-workspace');
const APP_DATA_DIR = path.join(APP_ROOT, '.codexdesk');
const LEGACY_STATE_PATH = path.join(os.homedir(), '.codexdesk', 'state.electron.json');
const DEFAULT_STATE_PATH = path.join(APP_DATA_DIR, 'state.electron.json');
const LEGACY_DEFAULT_COMMAND_TEXT = 'codex exec --skip-git-repo-check';
const DEFAULT_COMMAND_TEXT = 'codex exec --skip-git-repo-check --dangerously-bypass-approvals-and-sandbox';
const MAX_PERSISTED_MESSAGES = 2000;
const DEFAULT_DEVICE_IDENTITY = '';
const DEFAULT_NOTIFICATION_PROVIDER = 'telegram';
const DEFAULT_SECRETS_PATH = path.join(APP_DATA_DIR, 'secrets.electron.json');

function normalizeIdentity(raw) {
  return String(raw || '').trim();
}

function hashSecret(raw) {
  const value = String(raw || '').trim();
  if (!value) {
    return '';
  }
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function toSecretFingerprint(rawOrHash) {
  const value = String(rawOrHash || '').trim();
  if (!value) {
    return '';
  }
  const hash = /^[a-f0-9]{64}$/i.test(value) ? value.toLowerCase() : hashSecret(value);
  return hash ? hash.slice(0, 12) : '';
}

function defaultTelegramSettings() {
  return {
    enabled: false,
    botToken: '',
    hasBotToken: false,
    botTokenHash: '',
    botTokenFingerprint: '',
    chatId: '',
  };
}

function normalizeTelegramSettings(rawSettings) {
  const base = defaultTelegramSettings();
  if (!rawSettings || typeof rawSettings !== 'object') {
    return base;
  }
  base.enabled = Boolean(rawSettings.enabled);
  base.botToken = String(rawSettings.botToken || rawSettings.bot_token || '').trim();
  base.botTokenHash = String(rawSettings.botTokenHash || rawSettings.bot_token_hash || '').trim().toLowerCase();
  base.chatId = String(rawSettings.chatId || rawSettings.chat_id || '').trim();
  const derivedHash = base.botToken ? hashSecret(base.botToken) : base.botTokenHash;
  base.botTokenHash = derivedHash;
  base.botTokenFingerprint = toSecretFingerprint(derivedHash);
  base.hasBotToken = Boolean(base.botToken || derivedHash || rawSettings.hasBotToken);
  return base;
}

function normalizeNotificationProvider(rawProvider) {
  const provider = String(rawProvider || '').trim().toLowerCase();
  if (provider === 'telegram') {
    return provider;
  }
  return DEFAULT_NOTIFICATION_PROVIDER;
}

function defaultNotificationSettings() {
  return {
    activeProvider: DEFAULT_NOTIFICATION_PROVIDER,
    telegram: defaultTelegramSettings(),
  };
}

function normalizeNotificationSettings(rawSettings) {
  const base = defaultNotificationSettings();
  if (!rawSettings || typeof rawSettings !== 'object') {
    return base;
  }
  base.activeProvider = normalizeNotificationProvider(
    rawSettings.activeProvider
    || rawSettings.provider
    || rawSettings.kind,
  );
  const rawProviders = rawSettings.providers && typeof rawSettings.providers === 'object'
    ? rawSettings.providers
    : {};
  base.telegram = normalizeTelegramSettings(
    rawSettings.telegram
    || rawProviders.telegram
    || {},
  );
  return base;
}

function defaultNotificationSecrets() {
  return {
    telegram: {
      botToken: '',
    },
  };
}

function normalizeNotificationSecrets(rawSecrets) {
  const base = defaultNotificationSecrets();
  if (!rawSecrets || typeof rawSecrets !== 'object') {
    return base;
  }
  const telegram = rawSecrets.telegram && typeof rawSecrets.telegram === 'object'
    ? rawSecrets.telegram
    : {};
  base.telegram.botToken = String(telegram.botToken || telegram.bot_token || '').trim();
  return base;
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
  const fallback = path.resolve(DEFAULT_WORKDIR);
  const raw = String(candidate || '').trim();
  let nextPath = raw ? path.resolve(raw) : fallback;

  if (nextPath === fallback) {
    fs.mkdirSync(nextPath, { recursive: true });
  }
  return nextPath;
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

function toNumber(value, fallback) {
  const num = Number(value);
  if (Number.isFinite(num)) {
    return num;
  }
  return fallback;
}

function defaultMeta(sessionId = '') {
  return {
    'Codex版本': '-',
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

class StateStore {
  [key: string]: any;

  constructor(statePath = DEFAULT_STATE_PATH, secretsPath = DEFAULT_SECRETS_PATH) {
    this.path = statePath;
    this.secretsPath = secretsPath;
  }

  _defaultState() {
    return {
      commandText: DEFAULT_COMMAND_TEXT,
      workdir: normalizeWorkdir(''),
      useNativeMemory: true,
      deviceIdentity: DEFAULT_DEVICE_IDENTITY,
      notifications: defaultNotificationSettings(),
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

  _writeJsonFile(filePath, payload, mode = null) {
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf-8');
    if (mode != null) {
      try {
        fs.chmodSync(filePath, mode);
      } catch {
        // ignore chmod failures on unsupported filesystems
      }
    }
  }

  load() {
    let data = this._readStateFile(this.path);
    let secretData = this._readStateFile(this.secretsPath);

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
    const deviceIdentity = normalizeIdentity(data.deviceIdentity || data.deviceId || DEFAULT_DEVICE_IDENTITY);
    const secretNotifications = normalizeNotificationSecrets(
      secretData?.notifications && typeof secretData.notifications === 'object'
        ? secretData.notifications
        : secretData,
    );
    const notifications = normalizeNotificationSettings({
      activeProvider: data.notifications?.activeProvider || data.notificationProvider || data.notification_provider,
      telegram: {
        ...(data.telegram && typeof data.telegram === 'object' ? data.telegram : {}),
        ...(data.notifications?.telegram && typeof data.notifications.telegram === 'object' ? data.notifications.telegram : {}),
        botToken: secretNotifications.telegram.botToken
          || data.notifications?.telegram?.botToken
          || data.telegram?.botToken
          || '',
      },
    });

    const conversations = [];
    const metaByConversation = {};
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
      conv.sessionContinuationMode = String(
        item.sessionContinuationMode || item.session_continuation_mode || '',
      ).trim();
      conv.messages = parseMessages(item.messages);
      conv.pinnedAt = toNumber(item.pinnedAt ?? item.pinned_at, 0);
      conv.createdAt = toNumber(item.createdAt ?? item.created_at, conv.createdAt);
      conv.updatedAt = toNumber(item.updatedAt ?? item.updated_at, conv.updatedAt);
      conv.workdir = normalizeWorkdir(item.workdir || workdir);
      fillMissingMessageCreatedAt(conv.messages, conv.createdAt, conv.updatedAt);
      conversations.push(conv);
      const rawMeta = data.metaByConversation?.[conv.id] || data.meta_by_conversation?.[conv.id];
      metaByConversation[conv.id] = normalizeMeta(rawMeta, conv.sessionId);
    }

    if (!conversations.length) {
      const fallbackMessages = parseMessages(data.messages);
      const fallbackSessionId = String(data.sessionId || data.session_id || '').trim();
      if (fallbackMessages.length || fallbackSessionId) {
        const conv = newConversation();
        conv.messages = fallbackMessages;
        conv.sessionId = fallbackSessionId;
        conv.workdir = workdir;
        fillMissingMessageCreatedAt(conv.messages, conv.createdAt, conv.updatedAt);
        conversations.push(conv);
        metaByConversation[conv.id] = normalizeMeta(null, conv.sessionId);
      }
    }

    let activeConversationId = String(data.activeConversationId || data.active_conversation_id || '').trim();
    if (conversations.length && (!activeConversationId || !conversations.some((item) => item.id === activeConversationId))) {
      activeConversationId = sortedConversations(conversations)[0].id;
    } else if (!conversations.length) {
      activeConversationId = '';
    }

    return {
      commandText,
      workdir,
      useNativeMemory,
      deviceIdentity,
      notifications,
      activeConversationId,
      conversations,
      metaByConversation,
    };
  }

  save(state) {
    const parent = path.dirname(this.path);
    fs.mkdirSync(parent, { recursive: true });

    const conversations = Array.isArray(state.conversations) ? state.conversations : [];

    let activeConversationId = String(state.activeConversationId || '').trim();
    if (conversations.length && (!activeConversationId || !conversations.some((item) => item.id === activeConversationId))) {
      activeConversationId = sortedConversations(conversations)[0].id;
    } else if (!conversations.length) {
      activeConversationId = '';
    }

    const payload = {
      commandText: normalizeCommandText(state.commandText || ''),
      workdir: normalizeWorkdir(state.workdir),
      useNativeMemory: Boolean(state.useNativeMemory),
      deviceIdentity: normalizeIdentity(state.deviceIdentity || ''),
      notifications: normalizeNotificationSettings(
        state.notifications
        || {
          activeProvider: state.notificationProvider,
          telegram: state.telegram,
        },
      ),
      activeConversationId,
      conversations: conversations.map((item) => ({
        id: item.id,
        title: item.title,
        sessionId: item.sessionId || '',
        sessionContinuationMode: item.sessionContinuationMode || '',
        workdir: normalizeWorkdir(item.workdir || state.workdir),
        pinnedAt: Number(item.pinnedAt || 0),
        createdAt: Number(item.createdAt || 0),
        updatedAt: Number(item.updatedAt || 0),
        messages: Array.isArray(item.messages) ? item.messages.slice(-MAX_PERSISTED_MESSAGES) : [],
      })),
      metaByConversation: conversations.reduce((acc, item) => {
        acc[item.id] = normalizeMeta(state.metaByConversation?.[item.id], item.sessionId);
        return acc;
      }, {}),
    };

    const normalizedNotifications = normalizeNotificationSettings(payload.notifications);
    payload.notifications = {
      activeProvider: normalizedNotifications.activeProvider,
      telegram: {
        enabled: Boolean(normalizedNotifications.telegram.enabled),
        botToken: '',
        chatId: String(normalizedNotifications.telegram.chatId || '').trim(),
        hasBotToken: Boolean(normalizedNotifications.telegram.hasBotToken),
        botTokenHash: normalizedNotifications.telegram.botTokenHash,
        botTokenFingerprint: normalizedNotifications.telegram.botTokenFingerprint,
      },
    };

    const secretsPayload = {
      notifications: {
        telegram: {
          botToken: String(normalizedNotifications.telegram.botToken || '').trim(),
        },
      },
    };

    this._writeJsonFile(this.path, payload);
    this._writeJsonFile(this.secretsPath, secretsPayload, 0o600);
  }
}

module.exports = {
  APP_ROOT,
  DEFAULT_WORKDIR,
  APP_DATA_DIR,
  LEGACY_STATE_PATH,
  DEFAULT_STATE_PATH,
  DEFAULT_SECRETS_PATH,
  DEFAULT_NOTIFICATION_PROVIDER,
  normalizeWorkdir,
  normalizeIdentity,
  hashSecret,
  toSecretFingerprint,
  defaultTelegramSettings,
  normalizeTelegramSettings,
  defaultNotificationSettings,
  normalizeNotificationProvider,
  normalizeNotificationSettings,
  defaultNotificationSecrets,
  normalizeNotificationSecrets,
  StateStore,
};
