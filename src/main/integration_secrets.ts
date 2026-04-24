const crypto = require('node:crypto');

const VAULT_VERSION = 1;

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

module.exports = {
  VAULT_VERSION,
  hashSecret,
  toSecretFingerprint,
  defaultCredentialVault,
  normalizeCredentialVault,
  hasCredentialVaultPassword,
  createCredentialVaultKey,
  verifyCredentialVaultPassword,
  buildCredentialVault,
  defaultEncryptedNotificationSecrets,
  normalizeEncryptedNotificationSecrets,
  defaultNotificationSecrets,
  normalizeNotificationSecrets,
  encryptNotificationSecrets,
  decryptNotificationSecrets,
};
