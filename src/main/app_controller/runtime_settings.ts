const { getConversation } = require('../conversation_service');
const {
  normalizeIdentity,
  normalizeNotificationSettings,
  normalizeRemoteControlSettings,
  normalizeWorkdir,
} = require('../state_store');

const runtimeSettingsMethods = {
  updateSettings(input) {
    if (this._hasLockedCredentialVault()) {
      const nextNotificationToken = String(input?.notifications?.telegram?.botToken || '').trim();
      const nextRemoteToken = String(input?.remoteControl?.telegram?.botToken || '').trim();
      if (nextNotificationToken || nextRemoteToken) {
        return { error: this._lockedCredentialError('Telegram 凭据修改'), snapshot: this.snapshot() };
      }
    }
    if (typeof input.commandText === 'string') {
      this.commandText = input.commandText;
    }
    if (typeof input.workdir === 'string') {
      this.workdir = normalizeWorkdir(input.workdir);
    }
    if (typeof input.deviceIdentity === 'string') {
      this.deviceIdentity = normalizeIdentity(input.deviceIdentity);
    }
    if (input.notifications && typeof input.notifications === 'object') {
      const incomingTelegram = input.notifications.telegram && typeof input.notifications.telegram === 'object'
        ? input.notifications.telegram
        : {};
      const mergedTelegram = {
        ...((this.notifications && this.notifications.telegram && typeof this.notifications.telegram === 'object')
          ? this.notifications.telegram
          : {}),
        ...incomingTelegram,
      };
      if (incomingTelegram.clearBotToken) {
        mergedTelegram.botToken = '';
        mergedTelegram.hasBotToken = false;
        mergedTelegram.botTokenHash = '';
        mergedTelegram.botTokenFingerprint = '';
      }
      this.notifications = normalizeNotificationSettings({
        ...(this.notifications && typeof this.notifications === 'object' ? this.notifications : {}),
        ...input.notifications,
        telegram: mergedTelegram,
      });
    }
    if (input.remoteControl && typeof input.remoteControl === 'object') {
      const incomingTelegram = input.remoteControl.telegram && typeof input.remoteControl.telegram === 'object'
        ? input.remoteControl.telegram
        : {};
      const mergedTelegram = {
        ...((this.remoteControl && this.remoteControl.telegram && typeof this.remoteControl.telegram === 'object')
          ? this.remoteControl.telegram
          : {}),
        ...incomingTelegram,
      };
      if (incomingTelegram.clearBotToken) {
        mergedTelegram.botToken = '';
        mergedTelegram.hasBotToken = false;
        mergedTelegram.botTokenHash = '';
        mergedTelegram.botTokenFingerprint = '';
      }
      this.remoteControl = normalizeRemoteControlSettings({
        ...(this.remoteControl && typeof this.remoteControl === 'object' ? this.remoteControl : {}),
        ...input.remoteControl,
        telegram: mergedTelegram,
      });
    }
    this.useNativeMemory = true;
    this._syncNotificationCenter();
    this._syncRemoteControlCenter();
    this._persist();
    return this.snapshot();
  },

  async notifyConversationResult(conversationId, {
    status = 'completed',
    userText = '',
    assistantText = '',
    errorText = '',
    exitCode = '',
  } = {}) {
    if (this._hasLockedCredentialVault()) {
      return { ok: false, error: this._lockedCredentialError('Telegram 通知') };
    }
    const notificationCenter = this._syncNotificationCenter();
    const targetConv = getConversation(this.conversations, conversationId);
    if (!targetConv) {
      return { ok: false, error: '会话不存在' };
    }
    return notificationCenter.notifyConversationResult({
      status,
      conversationId: String(targetConv.sessionId || targetConv.id || '').trim(),
      sessionId: String(targetConv.sessionId || '').trim(),
      conversationTitle: targetConv.title,
      userText,
      assistantText,
      errorText,
      exitCode,
    });
  },

  testNotificationProvider() {
    if (this._hasLockedCredentialVault()) {
      return { ok: false, error: this._lockedCredentialError('Telegram 通知测试') };
    }
    return this._syncNotificationCenter().testActiveProvider();
  },

  testRemoteControlProvider() {
    if (this._hasLockedCredentialVault()) {
      return { ok: false, error: this._lockedCredentialError('Telegram 远程对话测试') };
    }
    return this._syncRemoteControlCenter().testActiveProvider();
  },

  shutdownServices() {
    if (this.remoteControlCenter && typeof this.remoteControlCenter.stop === 'function') {
      this.remoteControlCenter.stop();
    }
  },
};

module.exports = {
  runtimeSettingsMethods,
};
