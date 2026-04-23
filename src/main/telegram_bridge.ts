const {
  normalizeIdentity,
  normalizeTelegramSettings,
} = require('./state_store');
const { spawn } = require('node:child_process');

const TELEGRAM_API_BASE = 'https://api.telegram.org';

function resolveSystemProxyUrl() {
  const keys = [
    'HTTPS_PROXY',
    'https_proxy',
    'ALL_PROXY',
    'all_proxy',
    'HTTP_PROXY',
    'http_proxy',
  ];
  for (const key of keys) {
    const value = String(process.env[key] || '').trim();
    if (value) {
      return value;
    }
  }
  return '';
}

function normalizeTelegramText(text, limit = 1200) {
  const value = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit).trimEnd()}...`;
}

function buildTelegramApiUrl(botToken, method = '') {
  const token = String(botToken || '').trim();
  if (!token) {
    return '';
  }
  const suffix = String(method || '').trim();
  return `${TELEGRAM_API_BASE}/bot${token}${suffix ? `/${suffix}` : ''}`;
}

async function postTelegram(settings, method, payload, timeoutMs = 15000) {
  const url = buildTelegramApiUrl(settings?.botToken, method);
  if (!url) {
    throw new Error('Telegram Bot Token 未配置');
  }
  const resolvedTimeoutMs = Math.max(1000, Number(timeoutMs) || 15000);
  const systemProxyUrl = resolveSystemProxyUrl();
  if (systemProxyUrl) {
    return postTelegramViaCurl(url, payload, resolvedTimeoutMs);
  }
  try {
    return await postTelegramViaFetch(url, payload, resolvedTimeoutMs);
  } catch (error) {
    return postTelegramViaCurl(url, payload, resolvedTimeoutMs, error);
  }
}

async function postTelegramViaFetch(url, payload, timeoutMs) {
  const controller = new AbortController();
  const resolvedTimeoutMs = Math.max(1000, Number(timeoutMs) || 15000);
  const timer = setTimeout(() => controller.abort(), resolvedTimeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload || {}),
      signal: controller.signal,
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data?.ok) {
      throw new Error(String(data?.description || response.statusText || 'Telegram API error').trim());
    }
    return data;
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Telegram 请求超时（${Math.round(resolvedTimeoutMs / 1000)}s）。请检查当前网络是否能访问 api.telegram.org，必要时为应用启用代理或 VPN。`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function postTelegramViaCurl(url, payload, timeoutMs, fetchError = null) {
  return new Promise((resolve, reject) => {
    const maxTimeSeconds = Math.max(1, Math.ceil(Math.max(1000, Number(timeoutMs) || 15000) / 1000));
    const args = [
      '--silent',
      '--show-error',
      '--location',
      '--max-time',
      String(maxTimeSeconds),
      '--request',
      'POST',
      '--header',
      'Content-Type: application/json',
      '--data',
      JSON.stringify(payload || {}),
      url,
    ];

    const child = spawn('curl', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const done = (handler, value) => {
      if (settled) {
        return;
      }
      settled = true;
      handler(value);
    };

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk || '');
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk || '');
    });

    child.on('error', (error) => {
      const fetchMessage = fetchError?.message ? `fetch: ${fetchError.message}` : '';
      const curlMessage = error?.message ? `curl: ${error.message}` : '';
      done(reject, new Error([fetchMessage, curlMessage].filter(Boolean).join(' | ') || 'Telegram 请求失败'));
    });

    child.on('close', (code) => {
      if (Number(code || 0) !== 0) {
        const fetchMessage = fetchError?.message ? `fetch: ${fetchError.message}` : '';
        const curlMessage = String(stderr || '').trim() ? `curl: ${String(stderr || '').trim()}` : '';
        done(reject, new Error([fetchMessage, curlMessage].filter(Boolean).join(' | ') || `curl exited with code ${code}`));
        return;
      }
      try {
        const data = JSON.parse(String(stdout || '{}'));
        if (!data?.ok) {
          throw new Error(String(data?.description || 'Telegram API error').trim());
        }
        done(resolve, data);
      } catch (error) {
        const fetchMessage = fetchError?.message ? `fetch: ${fetchError.message}` : '';
        const curlMessage = String(stderr || '').trim() ? `curl: ${String(stderr || '').trim()}` : '';
        const parseMessage = error?.message ? `response: ${error.message}` : '';
        done(reject, new Error([fetchMessage, curlMessage, parseMessage].filter(Boolean).join(' | ') || 'Telegram 响应解析失败'));
      }
    });
  });
}

function buildConversationCompletedMessage({
  deviceIdentity = '',
  conversationId = '',
  sessionId = '',
  conversationTitle = '',
  userText = '',
  assistantText = '',
}) {
  const lines = [
    `Codex Desk${deviceIdentity ? ` [${String(deviceIdentity).trim()}]` : ''} 对话完成`,
    `对话ID: ${String(conversationId || '').trim() || '-'}`,
    `原生会话ID: ${String(sessionId || '').trim() || '-'}`,
    `名称: ${String(conversationTitle || '').trim() || '-'}`,
    `用户: ${normalizeTelegramText(userText, 320) || '-'}`,
    `回复: ${normalizeTelegramText(assistantText, 700) || '-'}`,
  ];
  return lines.join('\n');
}

async function sendTelegramMessage(settings, messageText) {
  const normalizedSettings = normalizeTelegramSettings(settings);
  const chatId = String(normalizedSettings.chatId || '').trim();
  if (!chatId) {
    return { ok: false, error: 'Telegram Chat ID 未配置' };
  }
  try {
    const result = await postTelegram(normalizedSettings, 'sendMessage', {
      chat_id: chatId,
      text: normalizeTelegramText(messageText, 3900),
      disable_web_page_preview: true,
    });
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

async function sendConversationCompletedNotification(settings, payload) {
  const message = buildConversationCompletedMessage(payload || {});
  return sendTelegramMessage(settings, message);
}

async function testTelegramConnection(settings, deviceIdentity = '') {
  return sendConversationCompletedNotification(settings, {
    deviceIdentity,
    conversationId: 'test-conversation',
    sessionId: 'test-session',
    conversationTitle: 'Telegram 测试通知',
    userText: '这是一条测试消息',
    assistantText: 'Telegram 通知配置已生效',
  });
}

class TelegramBotModule {
  [key: string]: any;

  constructor(options: any = {}) {
    this.settings = normalizeTelegramSettings(options.settings);
    this.deviceIdentity = normalizeIdentity(options.deviceIdentity || '');
  }

  updateConfig(options: any = {}) {
    if (Object.prototype.hasOwnProperty.call(options, 'settings')) {
      this.settings = normalizeTelegramSettings({
        ...this.settings,
        ...(options.settings && typeof options.settings === 'object' ? options.settings : {}),
      });
    }
    if (Object.prototype.hasOwnProperty.call(options, 'deviceIdentity')) {
      this.deviceIdentity = normalizeIdentity(options.deviceIdentity || '');
    }
    return this.snapshot({ includeSecrets: true });
  }

  getSettings() {
    return normalizeTelegramSettings(this.settings);
  }

  getDeviceIdentity() {
    return normalizeIdentity(this.deviceIdentity || '');
  }

  snapshot(options: any = {}) {
    const includeSecrets = Boolean(options.includeSecrets);
    const settings = this.getSettings();
    return {
      enabled: Boolean(settings.enabled),
      botToken: includeSecrets ? settings.botToken : '',
      chatId: String(settings.chatId || '').trim(),
      hasBotToken: Boolean(String(settings.botToken || '').trim()),
      deviceIdentity: this.getDeviceIdentity(),
    };
  }

  async sendMessage(messageText, settingsOverride = null) {
    const settings = settingsOverride ? normalizeTelegramSettings(settingsOverride) : this.getSettings();
    if (!settings.enabled) {
      return { ok: false, skipped: true, reason: 'disabled' };
    }
    return sendTelegramMessage(settings, messageText);
  }

  async sendConversationCompleted(payload: any = {}, settingsOverride = null) {
    const settings = settingsOverride ? normalizeTelegramSettings(settingsOverride) : this.getSettings();
    if (!settings.enabled) {
      return { ok: false, skipped: true, reason: 'disabled' };
    }
    return sendConversationCompletedNotification(settings, {
      ...payload,
      deviceIdentity: normalizeIdentity(payload?.deviceIdentity || this.deviceIdentity),
    });
  }

  async testConnection(options: any = {}) {
    const settings = normalizeTelegramSettings({
      ...(options.settings ? options.settings : this.getSettings()),
      enabled: true,
    });
    const deviceIdentity = normalizeIdentity(options.deviceIdentity || this.deviceIdentity);
    return testTelegramConnection(settings, deviceIdentity);
  }
}

module.exports = {
  TELEGRAM_API_BASE,
  TelegramBotModule,
  buildConversationCompletedMessage,
  buildTelegramApiUrl,
  normalizeTelegramText,
  resolveSystemProxyUrl,
  postTelegram,
  sendTelegramMessage,
  sendConversationCompletedNotification,
  testTelegramConnection,
};
