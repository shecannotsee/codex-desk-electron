const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { newConversation } = require('./conversation_service');
const {
  DEFAULT_NOTIFICATION_PROVIDER,
  defaultNotificationSettings,
  defaultRemoteControlSettings,
  defaultTelegramRemoteControlSettings,
  defaultTelegramSettings,
  normalizeConversationBindings,
  normalizeNotificationProvider,
  normalizeNotificationSettings,
  normalizeRemoteControlSettings,
  normalizeTelegramRemoteControlSettings,
  normalizeTelegramSettings,
} = require('./integration_state');
const {
  buildCredentialVault,
  createCredentialVaultKey,
  defaultCredentialVault,
  defaultNotificationSecrets,
  decryptNotificationSecrets,
  defaultEncryptedNotificationSecrets,
  encryptNotificationSecrets,
  hashSecret,
  hasCredentialVaultPassword,
  normalizeCredentialVault,
  normalizeEncryptedNotificationSecrets,
  normalizeNotificationSecrets,
  toSecretFingerprint,
  verifyCredentialVaultPassword,
} = require('./security');
const { resolveRepoRoot } = require('./project_paths');
const {
  DEFAULT_CLAUDE_COMMAND_TEXT,
  DEFAULT_COMMAND_TEXT,
  defaultCommandTextForProvider,
  fillMissingMessageCreatedAt,
  normalizeCliProvider,
  normalizeCommandText,
  normalizeMeta,
  parseMessages,
  resolveActiveConversationId,
  toNumber,
} = require('./state_store_codec');

const APP_ROOT = resolveRepoRoot(__dirname);
const DEFAULT_WORKDIR = path.join(APP_ROOT, 'conductor-workspace');
const APP_DATA_DIR = path.join(APP_ROOT, '.conductor');
const LEGACY_PROJECT_DATA_DIR = path.join(APP_ROOT, '.codexdesk');
const LEGACY_HOME_DATA_DIR = path.join(os.homedir(), '.codexdesk');
const LEGACY_STATE_PATHS = [
  path.join(LEGACY_PROJECT_DATA_DIR, 'state.electron.json'),
  path.join(LEGACY_HOME_DATA_DIR, 'state.electron.json'),
];
const LEGACY_SECRETS_PATHS = [
  path.join(LEGACY_PROJECT_DATA_DIR, 'secrets.electron.json'),
  path.join(LEGACY_HOME_DATA_DIR, 'secrets.electron.json'),
];
const DEFAULT_STATE_PATH = path.join(APP_DATA_DIR, 'state.electron.json');
const MAX_PERSISTED_MESSAGES = 2000;
const DEFAULT_DEVICE_IDENTITY = '';
const DEFAULT_SECRETS_PATH = path.join(APP_DATA_DIR, 'secrets.electron.json');

function normalizeIdentity(raw) {
  return String(raw || '').trim();
}

function normalizeWorkdir(candidate) {
  const fallback = path.resolve(DEFAULT_WORKDIR);
  const raw = String(candidate || '').trim();
  const legacyDefaultWorkdir = path.resolve(APP_ROOT, 'codex-workspace');
  let nextPath = raw ? path.resolve(raw) : fallback;
  if (nextPath === legacyDefaultWorkdir) {
    nextPath = fallback;
  }

  if (nextPath === fallback) {
    fs.mkdirSync(nextPath, { recursive: true });
  }
  return nextPath;
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

  _readFirstExistingJson(filePaths) {
    for (const filePath of filePaths || []) {
      const data = this._readStateFile(filePath);
      if (data && typeof data === 'object') {
        return data;
      }
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

    // Backward-compatible migration: use legacy Codex Desk paths when the new
    // Conductor project-local path is absent.
    if (!data && this.path === DEFAULT_STATE_PATH) {
      data = this._readFirstExistingJson(LEGACY_STATE_PATHS);
    }
    if (!secretData && this.secretsPath === DEFAULT_SECRETS_PATH) {
      secretData = this._readFirstExistingJson(LEGACY_SECRETS_PATHS);
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
      conv.provider = normalizeCliProvider(item.provider || item.cliProvider || item.cli_provider, item.commandText || item.command_text || commandText);
      const rawConversationCommand = String(item.commandText || item.command_text || '').trim();
      conv.commandText = rawConversationCommand
        ? normalizeCommandText(rawConversationCommand)
        : defaultCommandTextForProvider(conv.provider);
      conv.sessionContinuationMode = String(
        item.sessionContinuationMode || item.session_continuation_mode || '',
      ).trim();
      conv.goalObjective = String(item.goalObjective || item.goal_objective || '').trim();
      conv.goalMode = Boolean(item.goalMode ?? item.goal_mode) || Boolean(conv.goalObjective);
      conv.messages = parseMessages(item.messages);
      if (!conv.goalObjective) {
        const latestGoalMessage = [...conv.messages]
          .reverse()
          .find((message) => message?.role === 'user' && String(message.goalObjective || '').trim());
        conv.goalObjective = String(latestGoalMessage?.goalObjective || '').trim();
        conv.goalMode = conv.goalMode || Boolean(conv.goalObjective);
      }
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
        conv.provider = normalizeCliProvider('', commandText);
        conv.commandText = normalizeCommandText(commandText || defaultCommandTextForProvider(conv.provider));
        conv.workdir = workdir;
        fillMissingMessageCreatedAt(conv.messages, conv.createdAt, conv.updatedAt);
        conversations.push(conv);
        metaByConversation[conv.id] = normalizeMeta(null, conv.sessionId);
      }
    }

    const activeConversationId = resolveActiveConversationId(
      conversations,
      data.activeConversationId || data.active_conversation_id,
    );

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

    const activeConversationId = resolveActiveConversationId(conversations, state.activeConversationId);

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
        provider: normalizeCliProvider(item.provider || item.cliProvider, item.commandText || state.commandText),
        commandText: normalizeCommandText(item.commandText || defaultCommandTextForProvider(
          normalizeCliProvider(item.provider || item.cliProvider, item.commandText || state.commandText),
        )),
        sessionId: item.sessionId || '',
        sessionContinuationMode: item.sessionContinuationMode || '',
        goalMode: Boolean(item.goalMode) || Boolean(String(item.goalObjective || '').trim()),
        goalObjective: String(item.goalObjective || '').trim(),
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
  DEFAULT_CLAUDE_COMMAND_TEXT,
  DEFAULT_COMMAND_TEXT,
  APP_DATA_DIR,
  LEGACY_STATE_PATHS,
  DEFAULT_STATE_PATH,
  DEFAULT_SECRETS_PATH,
  DEFAULT_NOTIFICATION_PROVIDER,
  defaultCommandTextForProvider,
  normalizeCliProvider,
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
