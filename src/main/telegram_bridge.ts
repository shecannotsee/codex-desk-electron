const {
  hashSecret,
  normalizeIdentity,
  normalizeTelegramSettings,
  toSecretFingerprint,
} = require('./state_store');
const { appendTelegramLog } = require('./telegram_log_store');
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

function normalizeTelegramApiError(message = '', statusCode = 0) {
  const text = String(message || '').trim();
  const lower = text.toLowerCase();
  if (!text) {
    return 'Telegram API error';
  }
  if (statusCode === 404 || lower === 'not found' || lower.endsWith(': not found') || lower.includes('response: not found')) {
    return 'Telegram Bot Token 无效，接口返回 Not Found';
  }
  if (lower.includes('chat not found')) {
    return 'Telegram Chat ID 无效，或该聊天还没有和 Bot 建立会话';
  }
  if (lower.includes('bot was blocked by the user')) {
    return 'Telegram Bot 已被对方屏蔽，请先解除屏蔽后再测试';
  }
  return text;
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
      throw new Error(normalizeTelegramApiError(
        String(data?.description || response.statusText || 'Telegram API error').trim(),
        response.status,
      ));
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
      const fetchMessage = fetchError?.message ? `fetch: ${normalizeTelegramApiError(fetchError.message)}` : '';
      const curlMessage = error?.message ? `curl: ${error.message}` : '';
      done(reject, new Error([fetchMessage, curlMessage].filter(Boolean).join(' | ') || 'Telegram 请求失败'));
    });

    child.on('close', (code) => {
      if (Number(code || 0) !== 0) {
        const fetchMessage = fetchError?.message ? `fetch: ${normalizeTelegramApiError(fetchError.message)}` : '';
        const curlMessage = String(stderr || '').trim() ? `curl: ${String(stderr || '').trim()}` : '';
        done(reject, new Error([fetchMessage, curlMessage].filter(Boolean).join(' | ') || `curl exited with code ${code}`));
        return;
      }
      try {
        const data = JSON.parse(String(stdout || '{}'));
        if (!data?.ok) {
          throw new Error(normalizeTelegramApiError(String(data?.description || 'Telegram API error').trim()));
        }
        done(resolve, data);
      } catch (error) {
        const fetchMessage = fetchError?.message ? `fetch: ${normalizeTelegramApiError(fetchError.message)}` : '';
        const curlMessage = String(stderr || '').trim() ? `curl: ${String(stderr || '').trim()}` : '';
        const parseMessage = error?.message ? `response: ${normalizeTelegramApiError(error.message)}` : '';
        done(reject, new Error([fetchMessage, curlMessage, parseMessage].filter(Boolean).join(' | ') || 'Telegram 响应解析失败'));
      }
    });
  });
}

function buildConversationResultMessage({
  deviceIdentity = '',
  status = 'completed',
  conversationId = '',
  conversationTitle = '',
  userText = '',
  assistantText = '',
  errorText = '',
  exitCode = '',
}) {
  const normalizedStatus = String(status || '').trim().toLowerCase() === 'failed'
    ? 'failed'
    : 'completed';
  const title = normalizedStatus === 'failed' ? '对话失败' : '对话完成';
  const resolvedConversationId = String(conversationId || '').trim() || '-';
  const resolvedConversationTitle = normalizeTelegramText(conversationTitle, 80) || '';
  const conversationLabel = resolvedConversationTitle && resolvedConversationTitle !== resolvedConversationId
    ? `${resolvedConversationTitle} [${resolvedConversationId}]`
    : resolvedConversationId;
  const lines = [
    `Codex Desk${deviceIdentity ? ` [${String(deviceIdentity).trim()}]` : ''} ${title}`,
    `对话: ${conversationLabel}`,
    `用户: ${normalizeTelegramText(userText, 320) || '-'}`,
  ];
  if (normalizedStatus === 'failed') {
    lines.push(`退出码: ${String(exitCode || '').trim() || '-'}`);
    lines.push(`错误: ${normalizeTelegramText(errorText, 700) || '-'}`);
  } else {
    lines.push(`回复: ${normalizeTelegramText(assistantText, 700) || '-'}`);
  }
  return lines.join('\n');
}

function sleepMs(ms = 0) {
  return new Promise((resolve) => {
    setTimeout(resolve, Math.max(0, Number(ms) || 0));
  });
}

function isRetryableTelegramError(errorText = '') {
  const text = String(errorText || '').trim().toLowerCase();
  if (!text) {
    return false;
  }
  return [
    'timeout',
    'timed out',
    'unexpected eof',
    'eof while reading',
    'connection reset',
    'empty reply from server',
    'network is unreachable',
    'temporarily unavailable',
    'tls',
    'ssl',
    'socket hang up',
    'econnreset',
    'etimedout',
  ].some((item) => text.includes(item));
}

async function sendTelegramMessage(settings, messageText, options: any = {}) {
  const normalizedSettings = normalizeTelegramSettings(settings);
  const chatId = String(
    Object.prototype.hasOwnProperty.call(options, 'chatId')
      ? options.chatId
      : normalizedSettings.chatId,
  ).trim();
  if (!chatId) {
    return { ok: false, error: 'Telegram Chat ID 未配置' };
  }
  const maxAttempts = Math.max(1, Math.min(3, Number(options.maxAttempts) || 3));
  const logLabel = String(options.logLabel || 'Telegram').trim() || 'Telegram';
  let lastError = '';
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const result = await postTelegram(normalizedSettings, 'sendMessage', {
        chat_id: chatId,
        text: normalizeTelegramText(messageText, 3900),
        disable_web_page_preview: true,
        ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
      });
      if (attempt > 1) {
        appendTelegramLog('info', `${logLabel} 第 ${attempt} 次重试发送成功`);
      }
      return { ok: true, result };
    } catch (error) {
      lastError = error?.message || String(error);
      const retryable = isRetryableTelegramError(lastError);
      if (attempt >= maxAttempts || !retryable) {
        appendTelegramLog('error', `${logLabel} 发送失败: ${lastError}`);
        return { ok: false, error: lastError };
      }
      appendTelegramLog('warn', `${logLabel} 第 ${attempt} 次发送失败，准备自动重试: ${lastError}`);
      await sleepMs(700 * attempt);
    }
  }
  return { ok: false, error: lastError || 'Telegram 请求失败' };
}

async function sendConversationCompletedNotification(settings, payload) {
  const message = buildConversationResultMessage({
    ...(payload || {}),
    status: 'completed',
  });
  return sendTelegramMessage(settings, message, { logLabel: 'Telegram 通知' });
}

async function sendConversationFailedNotification(settings, payload) {
  const message = buildConversationResultMessage({
    ...(payload || {}),
    status: 'failed',
  });
  return sendTelegramMessage(settings, message, { logLabel: 'Telegram 通知' });
}

async function testTelegramConnection(settings, deviceIdentity = '') {
  return sendConversationCompletedNotification(settings, {
    deviceIdentity,
    conversationId: 'test-conversation',
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
    return this.snapshot();
  }

  getSettings() {
    return normalizeTelegramSettings(this.settings);
  }

  getDeviceIdentity() {
    return normalizeIdentity(this.deviceIdentity || '');
  }

  snapshot(options: any = {}) {
    const settings = this.getSettings();
    const tokenHash = settings.botToken ? hashSecret(settings.botToken) : String(settings.botTokenHash || '').trim();
    const includeSecrets = Boolean(options.includeSecrets);
    return {
      enabled: Boolean(settings.enabled),
      botToken: includeSecrets ? String(settings.botToken || '').trim() : '',
      chatId: String(settings.chatId || '').trim(),
      hasBotToken: Boolean(tokenHash),
      botTokenHash: tokenHash,
      botTokenFingerprint: toSecretFingerprint(tokenHash),
      deviceIdentity: this.getDeviceIdentity(),
    };
  }

  async sendMessage(messageText, settingsOverride = null) {
    const settings = settingsOverride ? normalizeTelegramSettings(settingsOverride) : this.getSettings();
    if (!settings.enabled) {
      return { ok: false, skipped: true, reason: 'disabled' };
    }
    return sendTelegramMessage(settings, messageText, { logLabel: 'Telegram 消息' });
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

  async sendConversationFailed(payload: any = {}, settingsOverride = null) {
    const settings = settingsOverride ? normalizeTelegramSettings(settingsOverride) : this.getSettings();
    if (!settings.enabled) {
      return { ok: false, skipped: true, reason: 'disabled' };
    }
    return sendConversationFailedNotification(settings, {
      ...payload,
      deviceIdentity: normalizeIdentity(payload?.deviceIdentity || this.deviceIdentity),
    });
  }

  async sendConversationResult(payload: any = {}, settingsOverride = null) {
    const normalizedStatus = String(payload?.status || '').trim().toLowerCase();
    if (normalizedStatus === 'failed') {
      return this.sendConversationFailed(payload, settingsOverride);
    }
    return this.sendConversationCompleted(payload, settingsOverride);
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
  buildConversationResultMessage,
  buildTelegramApiUrl,
  normalizeTelegramText,
  resolveSystemProxyUrl,
  postTelegram,
  sendTelegramMessage,
  sendConversationCompletedNotification,
  sendConversationFailedNotification,
  testTelegramConnection,
};
