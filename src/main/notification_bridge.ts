const {
  normalizeIdentity,
  normalizeNotificationProvider,
  normalizeNotificationSettings,
} = require('./state_store');
const { TelegramBotModule } = require('./telegram_bridge');

function createProvider(kind, settings, deviceIdentity) {
  if (kind === 'telegram') {
    return new TelegramBotModule({
      settings,
      deviceIdentity,
    });
  }
  return null;
}

class NotificationCenter {
  [key: string]: any;

  constructor(options: any = {}) {
    this.providers = new Map();
    this.settings = normalizeNotificationSettings(options.settings);
    this.deviceIdentity = normalizeIdentity(options.deviceIdentity || '');
    this.updateConfig(options);
  }

  updateConfig(options: any = {}) {
    if (Object.prototype.hasOwnProperty.call(options, 'settings')) {
      this.settings = normalizeNotificationSettings(options.settings);
    }
    if (Object.prototype.hasOwnProperty.call(options, 'deviceIdentity')) {
      this.deviceIdentity = normalizeIdentity(options.deviceIdentity || '');
    }
    this._syncProviders();
    return this.snapshot();
  }

  _syncProviders() {
    const settings = this.getSettings();
    const deviceIdentity = this.getDeviceIdentity();
    const telegram = this.providers.get('telegram');
    if (telegram) {
      telegram.updateConfig({
        settings: settings.telegram,
        deviceIdentity,
      });
      return;
    }
    const created = createProvider('telegram', settings.telegram, deviceIdentity);
    if (created) {
      this.providers.set('telegram', created);
    }
  }

  getSettings() {
    return normalizeNotificationSettings(this.settings);
  }

  getDeviceIdentity() {
    return normalizeIdentity(this.deviceIdentity || '');
  }

  getActiveProviderKind() {
    return normalizeNotificationProvider(this.getSettings().activeProvider);
  }

  getProvider(kind = '') {
    const normalizedKind = normalizeNotificationProvider(kind || this.getActiveProviderKind());
    return this.providers.get(normalizedKind) || null;
  }

  snapshot() {
    const settings = this.getSettings();
    const telegram = this.getProvider('telegram');
    const telegramSnapshot = telegram
      ? telegram.snapshot()
      : {
        enabled: Boolean(settings.telegram.enabled),
        chatId: String(settings.telegram.chatId || '').trim(),
        hasBotToken: Boolean(settings.telegram.hasBotToken),
        botTokenHash: String(settings.telegram.botTokenHash || '').trim(),
        botTokenFingerprint: String(settings.telegram.botTokenFingerprint || '').trim(),
        deviceIdentity: this.getDeviceIdentity(),
      };
    return {
      activeProvider: settings.activeProvider,
      providers: {
        telegram: telegramSnapshot,
      },
    };
  }

  async notifyConversationResult(payload: any = {}) {
    const provider = this.getProvider();
    if (!provider || typeof provider.sendConversationResult !== 'function') {
      return { ok: false, skipped: true, reason: 'provider-unavailable' };
    }
    return provider.sendConversationResult(payload);
  }

  async testActiveProvider() {
    const provider = this.getProvider();
    if (!provider || typeof provider.testConnection !== 'function') {
      return { ok: false, skipped: true, reason: 'provider-unavailable' };
    }
    return provider.testConnection();
  }
}

module.exports = {
  NotificationCenter,
};
