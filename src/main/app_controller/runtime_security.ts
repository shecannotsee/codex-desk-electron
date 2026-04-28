const {
  normalizeNotificationSettings,
  normalizeRemoteControlSettings,
} = require('../state_store');
const { appendTelegramLog } = require('../telegram');
const { TELEGRAM_VAULT_LOCKED_ERROR } = require('./runtime_helpers');

const runtimeSecurityMethods = {
  _hasLockedCredentialVault() {
    return Boolean(this.security?.hasMasterPassword) && !Boolean(this.security?.unlocked);
  },

  _lockedCredentialError(logLabel = 'Telegram') {
    appendTelegramLog('warn', `${logLabel} 未执行: ${TELEGRAM_VAULT_LOCKED_ERROR}`);
    return TELEGRAM_VAULT_LOCKED_ERROR;
  },

  _clearCredentialSecrets() {
    const nextNotifications = normalizeNotificationSettings(this.notifications);
    nextNotifications.telegram = {
      ...nextNotifications.telegram,
      botToken: '',
    };
    this.notifications = nextNotifications;

    const nextRemoteControl = normalizeRemoteControlSettings(this.remoteControl);
    nextRemoteControl.telegram = {
      ...nextRemoteControl.telegram,
      botToken: '',
    };
    this.remoteControl = nextRemoteControl;
  },

  _applyUnlockedCredentialSecrets(secrets: any = {}) {
    const notificationBotToken = String(secrets?.notifications?.telegram?.botToken || '').trim();
    const remoteBotToken = String(secrets?.remoteControl?.telegram?.botToken || '').trim();
    this.notifications = normalizeNotificationSettings({
      ...(this.notifications && typeof this.notifications === 'object' ? this.notifications : {}),
      telegram: {
        ...((this.notifications?.telegram && typeof this.notifications.telegram === 'object')
          ? this.notifications.telegram
          : {}),
        botToken: notificationBotToken,
      },
    });
    this.remoteControl = normalizeRemoteControlSettings({
      ...(this.remoteControl && typeof this.remoteControl === 'object' ? this.remoteControl : {}),
      telegram: {
        ...((this.remoteControl?.telegram && typeof this.remoteControl.telegram === 'object')
          ? this.remoteControl.telegram
          : {}),
        botToken: remoteBotToken,
      },
    });
  },

  setMasterPassword(password) {
    if (this.security?.hasMasterPassword && !this.security?.unlocked) {
      return { ok: false, error: '请先解锁后再修改主密码', snapshot: this.snapshot() };
    }
    try {
      const result = this.stateStorage.setVaultPassword(password);
      this.vault = result?.vault || this.vault;
      this.security = {
        hasMasterPassword: true,
        unlocked: true,
      };
      this.vaultKey = result?.key || null;
      this._syncNotificationCenter();
      this._syncRemoteControlCenter();
      this._persist();
      return { ok: true, snapshot: this.snapshot() };
    } catch (error) {
      return { ok: false, error: error?.message || String(error), snapshot: this.snapshot() };
    }
  },

  unlockMasterPassword(password) {
    if (!this.security?.hasMasterPassword) {
      return { ok: false, error: '当前还没有设置主密码', snapshot: this.snapshot() };
    }
    try {
      const result = this.stateStorage.unlockSecrets(password);
      this.vaultKey = result?.key || null;
      if (!this.vault?.passwordHash || !this.vault?.passwordSalt) {
        this.vault = this.stateStorage.loadState().vault || this.vault;
      }
      this.security = {
        hasMasterPassword: true,
        unlocked: true,
      };
      this._applyUnlockedCredentialSecrets(result?.secrets || {});
      this._syncNotificationCenter();
      this._syncRemoteControlCenter();
      return { ok: true, snapshot: this.snapshot() };
    } catch (error) {
      return { ok: false, error: error?.message || String(error), snapshot: this.snapshot() };
    }
  },

  lockMasterPassword() {
    if (!this.security?.hasMasterPassword) {
      return { ok: true, snapshot: this.snapshot() };
    }
    this.vaultKey = null;
    this.security = {
      hasMasterPassword: true,
      unlocked: false,
    };
    this._clearCredentialSecrets();
    this._syncNotificationCenter();
    this._syncRemoteControlCenter();
    this._persist();
    return { ok: true, snapshot: this.snapshot() };
  },
};

module.exports = {
  runtimeSecurityMethods,
};
