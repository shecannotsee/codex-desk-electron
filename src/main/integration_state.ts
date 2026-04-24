const {
  hashSecret,
  toSecretFingerprint,
} = require('./integration_secrets');

const DEFAULT_NOTIFICATION_PROVIDER = 'telegram';

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

module.exports = {
  DEFAULT_NOTIFICATION_PROVIDER,
  defaultTelegramSettings,
  normalizeTelegramSettings,
  normalizeNotificationProvider,
  defaultNotificationSettings,
  normalizeNotificationSettings,
  normalizeConversationBindings,
  defaultTelegramRemoteControlSettings,
  normalizeTelegramRemoteControlSettings,
  defaultRemoteControlSettings,
  normalizeRemoteControlSettings,
};
