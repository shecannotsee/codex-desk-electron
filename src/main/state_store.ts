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
const VAULT_VERSION = 1;

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

function normalizeVaultPassword(raw) {
  return String(raw || '');
}

function defaultCredentialVault() {
  return {
    version: VAULT_VERSION,
    passwordHash: '',
    passwordSalt: '',
  };
}

function normalizeCredentialVault(rawVault) {
  const base = defaultCredentialVault();
  if (!rawVault || typeof rawVault !== 'object') {
    return base;
  }
  base.version = Math.max(1, Number(rawVault.version || VAULT_VERSION) || VAULT_VERSION);
  base.passwordHash = String(rawVault.passwordHash || rawVault.password_hash || '').trim().toLowerCase();
  base.passwordSalt = String(rawVault.passwordSalt || rawVault.password_salt || '').trim().toLowerCase();
  return base;
}

function hasCredentialVaultPassword(vault) {
  const normalizedVault = normalizeCredentialVault(vault);
  return Boolean(normalizedVault.passwordHash && normalizedVault.passwordSalt);
}

function createCredentialVaultKey(password, salt) {
  const resolvedPassword = normalizeVaultPassword(password);
  const resolvedSalt = String(salt || '').trim().toLowerCase();
  if (!resolvedPassword) {
    throw new Error('主密码不能为空');
  }
  if (!/^[a-f0-9]{32,}$/i.test(resolvedSalt)) {
    throw new Error('主密码盐值无效');
  }
  return crypto.scryptSync(resolvedPassword, Buffer.from(resolvedSalt, 'hex'), 32);
}

function verifyCredentialVaultPassword(password, vault) {
  const normalizedVault = normalizeCredentialVault(vault);
  if (!hasCredentialVaultPassword(normalizedVault)) {
    throw new Error('当前还没有设置主密码');
  }
  const key = createCredentialVaultKey(password, normalizedVault.passwordSalt);
  const expected = Buffer.from(String(normalizedVault.passwordHash || '').trim(), 'hex');
  if (!expected.length || expected.length !== key.length || !crypto.timingSafeEqual(key, expected)) {
    throw new Error('主密码错误');
  }
  return key;
}

function buildCredentialVault(password) {
  const resolvedPassword = normalizeVaultPassword(password);
  if (!resolvedPassword) {
    throw new Error('主密码不能为空');
  }
  const passwordSalt = crypto.randomBytes(16).toString('hex');
  const key = createCredentialVaultKey(resolvedPassword, passwordSalt);
  return {
    vault: {
      version: VAULT_VERSION,
      passwordHash: key.toString('hex'),
      passwordSalt,
    },
    key,
  };
}

function defaultEncryptedSecretValue() {
  return {
    iv: '',
    authTag: '',
    ciphertext: '',
  };
}

function normalizeEncryptedSecretValue(rawValue) {
  const base = defaultEncryptedSecretValue();
  if (!rawValue || typeof rawValue !== 'object') {
    return base;
  }
  base.iv = String(rawValue.iv || '').trim().toLowerCase();
  base.authTag = String(rawValue.authTag || rawValue.auth_tag || '').trim().toLowerCase();
  base.ciphertext = String(rawValue.ciphertext || rawValue.cipher_text || '').trim();
  return base;
}

function defaultEncryptedNotificationSecrets() {
  return {
    notifications: {
      telegram: {
        botToken: defaultEncryptedSecretValue(),
      },
    },
    remoteControl: {
      telegram: {
        botToken: defaultEncryptedSecretValue(),
      },
    },
  };
}

function normalizeEncryptedNotificationSecrets(rawEncrypted) {
  const base = defaultEncryptedNotificationSecrets();
  if (!rawEncrypted || typeof rawEncrypted !== 'object') {
    return base;
  }
  const notificationTelegram = rawEncrypted.notifications?.telegram && typeof rawEncrypted.notifications.telegram === 'object'
    ? rawEncrypted.notifications.telegram
    : {};
  const remoteTelegram = rawEncrypted.remoteControl?.telegram && typeof rawEncrypted.remoteControl.telegram === 'object'
    ? rawEncrypted.remoteControl.telegram
    : {};
  base.notifications.telegram.botToken = normalizeEncryptedSecretValue(notificationTelegram.botToken);
  base.remoteControl.telegram.botToken = normalizeEncryptedSecretValue(remoteTelegram.botToken);
  return base;
}

function encryptSecretValue(rawValue, key) {
  const value = String(rawValue || '').trim();
  if (!value) {
    return defaultEncryptedSecretValue();
  }
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error('凭据密钥无效');
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('hex'),
    authTag: cipher.getAuthTag().toString('hex'),
    ciphertext: ciphertext.toString('base64'),
  };
}

function decryptSecretValue(rawValue, key) {
  const normalizedValue = normalizeEncryptedSecretValue(rawValue);
  if (!normalizedValue.ciphertext) {
    return '';
  }
  if (!normalizedValue.iv || !normalizedValue.authTag) {
    throw new Error('加密凭据格式无效');
  }
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error('凭据密钥无效');
  }
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(normalizedValue.iv, 'hex'),
  );
  decipher.setAuthTag(Buffer.from(normalizedValue.authTag, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(normalizedValue.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8').trim();
}

function encryptNotificationSecrets(rawSecrets, key) {
  const normalizedSecrets = normalizeNotificationSecrets(rawSecrets);
  return {
    notifications: {
      telegram: {
        botToken: encryptSecretValue(normalizedSecrets.notifications.telegram.botToken, key),
      },
    },
    remoteControl: {
      telegram: {
        botToken: encryptSecretValue(normalizedSecrets.remoteControl.telegram.botToken, key),
      },
    },
  };
}

function decryptNotificationSecrets(rawEncrypted, key) {
  const encryptedSecrets = normalizeEncryptedNotificationSecrets(rawEncrypted);
  return {
    notifications: {
      telegram: {
        botToken: decryptSecretValue(encryptedSecrets.notifications.telegram.botToken, key),
      },
    },
    remoteControl: {
      telegram: {
        botToken: decryptSecretValue(encryptedSecrets.remoteControl.telegram.botToken, key),
      },
    },
  };
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

function normalizeConversationBindings(rawBindings) {
  const base = {};
  if (!rawBindings || typeof rawBindings !== 'object') {
    return base;
  }
  for (const [key, value] of Object.entries(rawBindings)) {
    const chatId = String(key || '').trim();
    const conversationId = String(value || '').trim();
    if (!chatId || !conversationId) {
      continue;
    }
    base[chatId] = conversationId;
  }
  return base;
}

function defaultTelegramRemoteControlSettings() {
  return {
    enabled: false,
    botToken: '',
    hasBotToken: false,
    botTokenHash: '',
    botTokenFingerprint: '',
    allowedChatId: '',
    lastUpdateId: 0,
    selectedConversationByChat: {},
  };
}

function normalizeTelegramRemoteControlSettings(rawSettings) {
  const base = defaultTelegramRemoteControlSettings();
  if (!rawSettings || typeof rawSettings !== 'object') {
    return base;
  }
  base.enabled = Boolean(rawSettings.enabled);
  base.botToken = String(rawSettings.botToken || rawSettings.bot_token || '').trim();
  base.botTokenHash = String(rawSettings.botTokenHash || rawSettings.bot_token_hash || '').trim().toLowerCase();
  base.allowedChatId = String(rawSettings.allowedChatId || rawSettings.allowed_chat_id || '').trim();
  base.lastUpdateId = Math.max(0, Number(rawSettings.lastUpdateId ?? rawSettings.last_update_id ?? 0) || 0);
  base.selectedConversationByChat = normalizeConversationBindings(
    rawSettings.selectedConversationByChat || rawSettings.selected_conversation_by_chat,
  );
  const derivedHash = base.botToken ? hashSecret(base.botToken) : base.botTokenHash;
  base.botTokenHash = derivedHash;
  base.botTokenFingerprint = toSecretFingerprint(derivedHash);
  base.hasBotToken = Boolean(base.botToken || derivedHash || rawSettings.hasBotToken);
  return base;
}

function defaultRemoteControlSettings() {
  return {
    activeProvider: DEFAULT_NOTIFICATION_PROVIDER,
    telegram: defaultTelegramRemoteControlSettings(),
  };
}

function normalizeRemoteControlSettings(rawSettings) {
  const base = defaultRemoteControlSettings();
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
  base.telegram = normalizeTelegramRemoteControlSettings(
    rawSettings.telegram
    || rawProviders.telegram
    || {},
  );
  return base;
}

function defaultNotificationSecrets() {
  return {
    vault: defaultCredentialVault(),
    notifications: {
      telegram: {
        botToken: '',
      },
    },
    remoteControl: {
      telegram: {
        botToken: '',
      },
    },
    encrypted: defaultEncryptedNotificationSecrets(),
  };
}

function normalizeNotificationSecrets(rawSecrets) {
  const base = defaultNotificationSecrets();
  if (!rawSecrets || typeof rawSecrets !== 'object') {
    return base;
  }
  const notificationTelegram = rawSecrets.notifications?.telegram && typeof rawSecrets.notifications.telegram === 'object'
    ? rawSecrets.notifications.telegram
    : (rawSecrets.telegram && typeof rawSecrets.telegram === 'object' ? rawSecrets.telegram : {});
  const remoteTelegram = rawSecrets.remoteControl?.telegram && typeof rawSecrets.remoteControl.telegram === 'object'
    ? rawSecrets.remoteControl.telegram
    : {};
  base.vault = normalizeCredentialVault(rawSecrets.vault);
  base.notifications.telegram.botToken = String(notificationTelegram.botToken || notificationTelegram.bot_token || '').trim();
  base.remoteControl.telegram.botToken = String(remoteTelegram.botToken || remoteTelegram.bot_token || '').trim();
  base.encrypted = normalizeEncryptedNotificationSecrets(rawSecrets.encrypted);
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
      remoteControl: defaultRemoteControlSettings(),
      security: {
        hasMasterPassword: false,
      },
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
    const secrets = normalizeNotificationSecrets(secretData);
    const hasMasterPassword = hasCredentialVaultPassword(secrets.vault);
    const notifications = normalizeNotificationSettings({
      activeProvider: data.notifications?.activeProvider || data.notificationProvider || data.notification_provider,
      telegram: {
        ...(data.telegram && typeof data.telegram === 'object' ? data.telegram : {}),
        ...(data.notifications?.telegram && typeof data.notifications.telegram === 'object' ? data.notifications.telegram : {}),
        botToken: hasMasterPassword
          ? ''
          : (secrets.notifications.telegram.botToken
          || data.notifications?.telegram?.botToken
          || data.telegram?.botToken
          || ''),
        },
    });
    const remoteControl = normalizeRemoteControlSettings({
      ...(data.remoteControl || data.remote_control || {}),
      telegram: {
        ...((data.remote_control?.telegram && typeof data.remote_control.telegram === 'object') ? data.remote_control.telegram : {}),
        ...((data.remoteControl?.telegram && typeof data.remoteControl.telegram === 'object') ? data.remoteControl.telegram : {}),
        botToken: hasMasterPassword
          ? ''
          : (secrets.remoteControl.telegram.botToken
          || data.remoteControl?.telegram?.botToken
          || data.remote_control?.telegram?.botToken
          || ''),
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
      remoteControl,
      vault: secrets.vault,
      security: {
        hasMasterPassword,
      },
      activeConversationId,
      conversations,
      metaByConversation,
    };
  }

  unlockSecrets(password) {
    const secretData = normalizeNotificationSecrets(this._readStateFile(this.secretsPath));
    const vault = normalizeCredentialVault(secretData.vault);
    if (!hasCredentialVaultPassword(vault)) {
      return {
        key: null,
        secrets: {
          notifications: {
            telegram: {
              botToken: String(secretData.notifications.telegram.botToken || '').trim(),
            },
          },
          remoteControl: {
            telegram: {
              botToken: String(secretData.remoteControl.telegram.botToken || '').trim(),
            },
          },
        },
      };
    }
    const key = verifyCredentialVaultPassword(password, vault);
    return {
      key,
      secrets: decryptNotificationSecrets(secretData.encrypted, key),
    };
  }

  setVaultPassword(password) {
    const { vault, key } = buildCredentialVault(password);
    return {
      vault,
      key,
    };
  }

  save(state: any, options: any = {}) {
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
      remoteControl: normalizeRemoteControlSettings(
        state.remoteControl
        || {
          activeProvider: state.remoteControlProvider,
          telegram: state.telegramRemoteControl,
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
    const normalizedRemoteControl = normalizeRemoteControlSettings(payload.remoteControl);
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
    payload.remoteControl = {
      activeProvider: normalizedRemoteControl.activeProvider,
      telegram: {
        enabled: Boolean(normalizedRemoteControl.telegram.enabled),
        botToken: '',
        hasBotToken: Boolean(normalizedRemoteControl.telegram.hasBotToken),
        botTokenHash: normalizedRemoteControl.telegram.botTokenHash,
        botTokenFingerprint: normalizedRemoteControl.telegram.botTokenFingerprint,
        allowedChatId: String(normalizedRemoteControl.telegram.allowedChatId || '').trim(),
        lastUpdateId: Math.max(0, Number(normalizedRemoteControl.telegram.lastUpdateId || 0) || 0),
        selectedConversationByChat: normalizeConversationBindings(normalizedRemoteControl.telegram.selectedConversationByChat),
      },
    };

    const currentSecrets = normalizeNotificationSecrets(this._readStateFile(this.secretsPath));
    const requestedVault = normalizeCredentialVault(options.vault);
    const nextVault = hasCredentialVaultPassword(requestedVault)
      ? requestedVault
      : normalizeCredentialVault(currentSecrets.vault);
    const vaultEnabled = hasCredentialVaultPassword(nextVault);
    const nextPlainSecrets = {
      notifications: {
        telegram: {
          botToken: String(normalizedNotifications.telegram.botToken || '').trim(),
        },
      },
      remoteControl: {
        telegram: {
          botToken: String(normalizedRemoteControl.telegram.botToken || '').trim(),
        },
      },
    };
    const encryptedSecrets = vaultEnabled
      ? (Buffer.isBuffer(options.vaultKey) && options.vaultKey.length === 32
        ? encryptNotificationSecrets(nextPlainSecrets, options.vaultKey)
        : normalizeEncryptedNotificationSecrets(currentSecrets.encrypted))
      : defaultEncryptedNotificationSecrets();
    const secretsPayload = {
      vault: vaultEnabled ? nextVault : defaultCredentialVault(),
      notifications: {
        telegram: {
          botToken: vaultEnabled ? '' : nextPlainSecrets.notifications.telegram.botToken,
        },
      },
      remoteControl: {
        telegram: {
          botToken: vaultEnabled ? '' : nextPlainSecrets.remoteControl.telegram.botToken,
        },
      },
      encrypted: encryptedSecrets,
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
  defaultCredentialVault,
  normalizeCredentialVault,
  hasCredentialVaultPassword,
  createCredentialVaultKey,
  verifyCredentialVaultPassword,
  buildCredentialVault,
  defaultTelegramSettings,
  normalizeTelegramSettings,
  defaultNotificationSettings,
  normalizeNotificationProvider,
  normalizeNotificationSettings,
  defaultTelegramRemoteControlSettings,
  normalizeTelegramRemoteControlSettings,
  defaultRemoteControlSettings,
  normalizeRemoteControlSettings,
  defaultNotificationSecrets,
  normalizeNotificationSecrets,
  StateStore,
};
