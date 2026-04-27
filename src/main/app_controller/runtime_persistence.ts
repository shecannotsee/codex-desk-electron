const { getConversation } = require('../conversation_service');
const { NotificationCenter } = require('../notification_bridge');
const {
  normalizeIdentity,
  normalizeNotificationSettings,
  normalizeWorkdir,
} = require('../state_store');

const runtimePersistenceMethods = {
  _emit(event) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }
    this.mainWindow.webContents.send('app:event', event);
  },

  _persist() {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this._syncNotificationCenter();
    this._syncRemoteControlCenter();
    this.stateStorage.saveState({
      commandText: this.commandText,
      workdir: this.workdir,
      useNativeMemory: this.useNativeMemory,
      deviceIdentity: this.deviceIdentity,
      notifications: this.notifications,
      remoteControl: this.remoteControl,
      activeConversationId: this.activeConversationId,
      conversations: this.conversations,
      metaByConversation: this.metaByConversation,
    }, {
      vault: this.vault,
      vaultKey: this.vaultKey,
    });
  },

  _schedulePersist(delay = 180) {
    const wait = Math.max(0, Number(delay) || 0);
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this._persist();
    }, wait);
  },

  _defaultWorkdir() {
    return normalizeWorkdir('');
  },

  _resolveConversationWorkdir(conversationId) {
    const conv = getConversation(this.conversations, conversationId);
    return normalizeWorkdir(conv?.workdir || this._defaultWorkdir());
  },

  _syncNotificationCenter() {
    const normalizedIdentity = normalizeIdentity(this.deviceIdentity || '');
    const normalizedNotifications = normalizeNotificationSettings(this.notifications);
    this.deviceIdentity = normalizedIdentity;
    this.notifications = normalizedNotifications;
    if (!this.notificationCenter) {
      this.notificationCenter = new NotificationCenter({
        settings: normalizedNotifications,
        deviceIdentity: normalizedIdentity,
      });
      return this.notificationCenter;
    }
    this.notificationCenter.updateConfig({
      settings: normalizedNotifications,
      deviceIdentity: normalizedIdentity,
    });
    return this.notificationCenter;
  },
};

module.exports = {
  runtimePersistenceMethods,
};
