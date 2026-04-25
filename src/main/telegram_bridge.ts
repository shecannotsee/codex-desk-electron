const {
  hashSecret,
  normalizeIdentity,
  normalizeTelegramSettings,
  toSecretFingerprint,
} = require('./state_store');
const { appendTelegramLog } = require('./telegram_log_store');
const { spawn } = require('node:child_process');

const TELEGRAM_API_BASE = 'https://api.telegram.org';
const TELEGRAM_MESSAGE_LIMIT = 3900;
const TELEGRAM_NOTIFICATION_SUMMARY_LIMITS = {
  title: 48,
  user: 90,
  detail: 180,
};
const TELEGRAM_NOTIFICATION_FULL_LIMITS = {
  title: 80,
};
const TELEGRAM_NOTIFICATION_CALLBACK_PREFIX = 'notif';
const TELEGRAM_NOTIFICATION_RETENTION_MS = 12 * 60 * 60 * 1000;
const TELEGRAM_UPDATE_COORDINATORS = new Map();

function compactTelegramText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

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
  const value = compactTelegramText(text);
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

function createTelegramSubscriptionId() {
  return `tgsub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function getTelegramCoordinatorKey(settings: any = {}) {
  return String(settings?.botToken || '').trim();
}

function getTelegramUpdateCoordinator(settings: any = {}) {
  const key = getTelegramCoordinatorKey(settings);
  if (!key) {
    return null;
  }
  let coordinator = TELEGRAM_UPDATE_COORDINATORS.get(key);
  if (!coordinator) {
    coordinator = {
      botToken: key,
      pollTimer: null,
      isPolling: false,
      lastUpdateId: 0,
      subscribers: new Map(),
    };
    TELEGRAM_UPDATE_COORDINATORS.set(key, coordinator);
  }
  return coordinator;
}

function setTelegramCoordinatorOffset(settings: any = {}, lastUpdateId = 0) {
  const coordinator = getTelegramUpdateCoordinator(settings);
  if (!coordinator) {
    return;
  }
  const nextOffset = Math.max(0, Number(lastUpdateId || 0) || 0);
  if (nextOffset > coordinator.lastUpdateId) {
    coordinator.lastUpdateId = nextOffset;
  }
}

function collectCoordinatorAllowedUpdates(coordinator: any = null) {
  if (!coordinator || !(coordinator.subscribers instanceof Map) || !coordinator.subscribers.size) {
    return ['message', 'callback_query'];
  }
  const values = new Set();
  for (const subscriber of coordinator.subscribers.values()) {
    const items = Array.isArray(subscriber?.allowedUpdates) ? subscriber.allowedUpdates : [];
    items.forEach((item) => {
      const value = String(item || '').trim();
      if (value) {
        values.add(value);
      }
    });
  }
  return values.size ? Array.from(values) : ['message', 'callback_query'];
}

function scheduleTelegramCoordinatorPoll(coordinator: any = null, delayMs = 400) {
  if (!coordinator || coordinator.pollTimer || coordinator.isPolling || !coordinator.subscribers.size) {
    return;
  }
  coordinator.pollTimer = setTimeout(() => {
    coordinator.pollTimer = null;
    pollTelegramCoordinator(coordinator).catch(() => {}).finally(() => {
      if (coordinator.subscribers.size) {
        scheduleTelegramCoordinatorPoll(coordinator, 250);
      }
    });
  }, Math.max(0, Number(delayMs) || 0));
}

async function pollTelegramCoordinator(coordinator: any = null) {
  if (!coordinator || coordinator.isPolling || !coordinator.subscribers.size) {
    return;
  }
  coordinator.isPolling = true;
  try {
    const response = await postTelegram({
      botToken: coordinator.botToken,
    }, 'getUpdates', {
      offset: Math.max(0, Number(coordinator.lastUpdateId || 0) || 0) + 1,
      timeout: 25,
      allowed_updates: collectCoordinatorAllowedUpdates(coordinator),
    }, 30000);
    const updates = Array.isArray(response?.result) ? response.result : [];
    let highestUpdateId = Math.max(0, Number(coordinator.lastUpdateId || 0) || 0);
    for (const update of updates) {
      const updateId = Math.max(0, Number(update?.update_id || 0) || 0);
      if (updateId > highestUpdateId) {
        highestUpdateId = updateId;
      }
      for (const subscriber of coordinator.subscribers.values()) {
        if (typeof subscriber?.onUpdate !== 'function') {
          continue;
        }
        try {
          await subscriber.onUpdate(update);
        } catch (error) {
          if (typeof subscriber?.onError === 'function') {
            try {
              await subscriber.onError(error, update);
            } catch {
              // ignore subscriber error handler failures
            }
          }
        }
      }
    }
    if (highestUpdateId > coordinator.lastUpdateId) {
      coordinator.lastUpdateId = highestUpdateId;
      for (const subscriber of coordinator.subscribers.values()) {
        if (typeof subscriber?.onOffsetChange !== 'function') {
          continue;
        }
        try {
          await subscriber.onOffsetChange(highestUpdateId);
        } catch {
          // ignore subscriber offset persistence failures
        }
      }
    }
  } catch (error) {
    for (const subscriber of coordinator.subscribers.values()) {
      if (typeof subscriber?.onError !== 'function') {
        continue;
      }
      try {
        await subscriber.onError(error);
      } catch {
        // ignore subscriber error handler failures
      }
    }
  } finally {
    coordinator.isPolling = false;
  }
}

function subscribeTelegramUpdates(options: any = {}) {
  const settings = normalizeTelegramSettings(options.settings);
  const coordinator = getTelegramUpdateCoordinator(settings);
  if (!coordinator) {
    return () => {};
  }
  const subscriptionId = String(options.subscriptionId || createTelegramSubscriptionId()).trim() || createTelegramSubscriptionId();
  coordinator.subscribers.set(subscriptionId, {
    allowedUpdates: Array.isArray(options.allowedUpdates) ? options.allowedUpdates : ['message', 'callback_query'],
    onUpdate: typeof options.onUpdate === 'function' ? options.onUpdate : null,
    onOffsetChange: typeof options.onOffsetChange === 'function' ? options.onOffsetChange : null,
    onError: typeof options.onError === 'function' ? options.onError : null,
  });
  setTelegramCoordinatorOffset(settings, options.startFrom);
  scheduleTelegramCoordinatorPoll(coordinator, 0);
  return () => {
    const current = TELEGRAM_UPDATE_COORDINATORS.get(coordinator.botToken);
    if (!current) {
      return;
    }
    current.subscribers.delete(subscriptionId);
    if (current.subscribers.size) {
      return;
    }
    if (current.pollTimer) {
      clearTimeout(current.pollTimer);
      current.pollTimer = null;
    }
    TELEGRAM_UPDATE_COORDINATORS.delete(coordinator.botToken);
  };
}

function resolveConversationLabel(conversationId = '', conversationTitle = '', limit = 80) {
  const resolvedConversationId = String(conversationId || '').trim() || '-';
  const resolvedConversationTitle = normalizeTelegramText(conversationTitle, limit) || '';
  return resolvedConversationTitle && resolvedConversationTitle !== resolvedConversationId
    ? `${resolvedConversationTitle} [${resolvedConversationId}]`
    : resolvedConversationId;
}

function buildConversationResultHeaderLines({
  deviceIdentity = '',
  status = 'completed',
  conversationId = '',
  conversationTitle = '',
  titleLimit = 80,
  page = 0,
  totalPages = 0,
}) {
  const normalizedStatus = String(status || '').trim().toLowerCase() === 'failed'
    ? 'failed'
    : 'completed';
  const lines = [
    `Codex Desk${deviceIdentity ? ` [${String(deviceIdentity).trim()}]` : ''} ${normalizedStatus === 'failed' ? '对话失败' : '对话完成'}`,
    `对话: ${resolveConversationLabel(conversationId, conversationTitle, titleLimit)}`,
  ];
  if (totalPages > 1) {
    lines.push(`第 ${Math.max(1, Number(page) || 1)}/${Math.max(1, Number(totalPages) || 1)} 页`);
  }
  return lines;
}

function findTelegramSplitIndex(text = '', limit = 1000) {
  const raw = String(text || '');
  if (raw.length <= limit) {
    return raw.length;
  }
  const minIndex = Math.max(40, Math.floor(limit * 0.55));
  const newlineIndex = raw.lastIndexOf('\n', limit);
  if (newlineIndex >= minIndex) {
    return newlineIndex;
  }
  const spaceIndex = raw.lastIndexOf(' ', limit);
  if (spaceIndex >= minIndex) {
    return spaceIndex;
  }
  return limit;
}

function splitTelegramContent(text = '', limit = 1000) {
  const value = compactTelegramText(text);
  if (!value) {
    return ['-'];
  }
  const parts = [];
  let remaining = value;
  const maxLength = Math.max(80, Number(limit) || 1000);
  while (remaining.length > maxLength) {
    const splitIndex = findTelegramSplitIndex(remaining, maxLength);
    parts.push(remaining.slice(0, splitIndex).trimEnd());
    remaining = remaining.slice(splitIndex).trimStart();
  }
  if (remaining) {
    parts.push(remaining);
  }
  return parts.filter(Boolean);
}

function buildLabeledSectionLines(label = '', text = '', chunkLimit = 1000) {
  const parts = splitTelegramContent(text, chunkLimit);
  if (parts.length <= 1) {
    return [`${label}: ${parts[0] || '-'}`];
  }
  return parts.map((part, index) => (
    `${label}${index === 0 ? '' : `（续 ${index + 1}/${parts.length}）`}: ${part}`
  ));
}

function paginateTelegramNotificationLines(baseLines = [], bodyLines = []) {
  const pages = [];
  const normalizedBaseLines = Array.isArray(baseLines) ? baseLines.filter(Boolean) : [];
  const normalizedBodyLines = Array.isArray(bodyLines) && bodyLines.length ? bodyLines : ['-'];
  let currentPageLines = [];

  normalizedBodyLines.forEach((line) => {
    const candidateLines = currentPageLines.length
      ? [...currentPageLines, line]
      : [line];
    const candidateText = [...normalizedBaseLines, ...candidateLines].join('\n');
    if (candidateText.length <= TELEGRAM_MESSAGE_LIMIT || !currentPageLines.length) {
      currentPageLines = candidateLines;
      return;
    }
    pages.push(currentPageLines);
    currentPageLines = [line];
  });

  if (currentPageLines.length) {
    pages.push(currentPageLines);
  }
  return pages.length ? pages : [['-']];
}

function buildConversationResultSummaryMessage({
  deviceIdentity = '',
  status = 'completed',
  conversationId = '',
  conversationTitle = '',
  userText = '',
  assistantText = '',
  errorText = '',
  exitCode = '',
  expandable = false,
}) {
  const normalizedStatus = String(status || '').trim().toLowerCase() === 'failed'
    ? 'failed'
    : 'completed';
  const lines = buildConversationResultHeaderLines({
    deviceIdentity,
    status: normalizedStatus,
    conversationId,
    conversationTitle,
    titleLimit: TELEGRAM_NOTIFICATION_SUMMARY_LIMITS.title,
  });
  lines.push(`用户: ${normalizeTelegramText(userText, TELEGRAM_NOTIFICATION_SUMMARY_LIMITS.user) || '-'}`);
  if (normalizedStatus === 'failed') {
    lines.push(`退出码: ${String(exitCode || '').trim() || '-'}`);
    lines.push(`错误: ${normalizeTelegramText(errorText, TELEGRAM_NOTIFICATION_SUMMARY_LIMITS.detail) || '-'}`);
  } else {
    lines.push(`回复: ${normalizeTelegramText(assistantText, TELEGRAM_NOTIFICATION_SUMMARY_LIMITS.detail) || '-'}`);
  }
  if (expandable) {
    lines.push('内容已省略，点击下方按钮展开全文。');
  }
  return lines.join('\n');
}

function buildConversationResultDetailPages({
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
  const headerLines = buildConversationResultHeaderLines({
    deviceIdentity,
    status: normalizedStatus,
    conversationId,
    conversationTitle,
    titleLimit: TELEGRAM_NOTIFICATION_FULL_LIMITS.title,
  });
  const detailLines = [
    ...buildLabeledSectionLines('用户', userText, 1400),
  ];
  if (normalizedStatus === 'failed') {
    detailLines.push(`退出码: ${String(exitCode || '').trim() || '-'}`);
    detailLines.push(...buildLabeledSectionLines('错误', errorText, 1800));
  } else {
    detailLines.push(...buildLabeledSectionLines('回复', assistantText, 1800));
  }

  const bodyPages = paginateTelegramNotificationLines(headerLines, detailLines);
  return bodyPages.map((pageLines, index) => {
    const lines = buildConversationResultHeaderLines({
      deviceIdentity,
      status: normalizedStatus,
      conversationId,
      conversationTitle,
      titleLimit: TELEGRAM_NOTIFICATION_FULL_LIMITS.title,
      page: index + 1,
      totalPages: bodyPages.length,
    });
    return normalizeTelegramText([...lines, ...pageLines].join('\n'), TELEGRAM_MESSAGE_LIMIT);
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
  return buildConversationResultSummaryMessage({
    deviceIdentity,
    status,
    conversationId,
    conversationTitle,
    userText,
    assistantText,
    errorText,
    exitCode,
    expandable: false,
  });
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
        text: normalizeTelegramText(messageText, TELEGRAM_MESSAGE_LIMIT),
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

async function editTelegramMessage(settings, chatId, messageId, messageText, options: any = {}) {
  if (!chatId || !messageId) {
    return { ok: false, error: 'Telegram 消息定位信息缺失' };
  }
  try {
    const result = await postTelegram(normalizeTelegramSettings(settings), 'editMessageText', {
      chat_id: String(chatId).trim(),
      message_id: Math.max(0, Number(messageId || 0) || 0),
      text: normalizeTelegramText(messageText, TELEGRAM_MESSAGE_LIMIT),
      disable_web_page_preview: true,
      ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
    }, 15000);
    return { ok: true, result };
  } catch (error) {
    appendTelegramLog('warn', `${String(options.logLabel || 'Telegram').trim() || 'Telegram'} 编辑消息失败: ${error?.message || String(error)}`);
    return { ok: false, error: error?.message || String(error) };
  }
}

async function answerTelegramCallbackQuery(settings, callbackQueryId, text = '', options: any = {}) {
  if (!callbackQueryId) {
    return { ok: false, error: 'Telegram callback_query_id 缺失' };
  }
  try {
    const result = await postTelegram(normalizeTelegramSettings(settings), 'answerCallbackQuery', {
      callback_query_id: String(callbackQueryId).trim(),
      ...(text ? { text: normalizeTelegramText(text, 180) } : {}),
      ...(options.showAlert ? { show_alert: true } : {}),
    }, 10000);
    return { ok: true, result };
  } catch (error) {
    appendTelegramLog('warn', `${String(options.logLabel || 'Telegram').trim() || 'Telegram'} 回调确认失败: ${error?.message || String(error)}`);
    return { ok: false, error: error?.message || String(error) };
  }
}

async function sendConversationCompletedNotification(settings, payload) {
  const message = buildConversationResultSummaryMessage({
    ...(payload || {}),
    status: 'completed',
    deviceIdentity: normalizeIdentity(payload?.deviceIdentity || ''),
    expandable: false,
  });
  return sendTelegramMessage(settings, message, { logLabel: 'Telegram 通知' });
}

async function sendConversationFailedNotification(settings, payload) {
  const message = buildConversationResultSummaryMessage({
    ...(payload || {}),
    status: 'failed',
    deviceIdentity: normalizeIdentity(payload?.deviceIdentity || ''),
    expandable: false,
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
    this.notificationItems = new Map();
    this.updateSubscription = null;
    this.subscriptionKey = '';
    this._syncUpdateSubscription();
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
    this._syncUpdateSubscription();
    return this.snapshot();
  }

  getSettings() {
    return normalizeTelegramSettings(this.settings);
  }

  getDeviceIdentity() {
    return normalizeIdentity(this.deviceIdentity || '');
  }

  isInteractiveReady(settingsOverride = null) {
    const settings = settingsOverride ? normalizeTelegramSettings(settingsOverride) : this.getSettings();
    return Boolean(
      settings.enabled
      && String(settings?.botToken || '').trim()
      && String(settings?.chatId || '').trim(),
    );
  }

  stop() {
    if (typeof this.updateSubscription === 'function') {
      this.updateSubscription();
    }
    this.updateSubscription = null;
    this.subscriptionKey = '';
  }

  _syncUpdateSubscription() {
    const settings = this.getSettings();
    const nextKey = this.isInteractiveReady(settings) ? getTelegramCoordinatorKey(settings) : '';
    if (!nextKey) {
      this.stop();
      return;
    }
    if (this.updateSubscription && this.subscriptionKey === nextKey) {
      return;
    }
    this.stop();
    this.subscriptionKey = nextKey;
    this.updateSubscription = subscribeTelegramUpdates({
      settings,
      allowedUpdates: ['callback_query'],
      onUpdate: async (update) => {
        await this._handleTelegramUpdate(update);
      },
      onError: async (error) => {
        appendTelegramLog('warn', `Telegram 通知回调处理失败: ${error?.message || String(error)}`);
      },
    });
  }

  _pruneNotificationItems() {
    const now = Date.now();
    for (const [key, value] of this.notificationItems.entries()) {
      const createdAt = Math.max(0, Number(value?.createdAt || 0) || 0);
      if (!createdAt || now - createdAt > TELEGRAM_NOTIFICATION_RETENTION_MS) {
        this.notificationItems.delete(key);
      }
    }
    while (this.notificationItems.size > 120) {
      const oldestKey = this.notificationItems.keys().next().value;
      if (!oldestKey) {
        break;
      }
      this.notificationItems.delete(oldestKey);
    }
  }

  _createNotificationId() {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }

  _buildNotificationReplyMarkup(notificationId = '', mode = 'summary', page = 1, totalPages = 1) {
    const safeId = String(notificationId || '').trim();
    if (!safeId) {
      return null;
    }
    if (mode === 'summary') {
      return {
        inline_keyboard: [[{
          text: '展开全文',
          callback_data: `${TELEGRAM_NOTIFICATION_CALLBACK_PREFIX}:${safeId}:page:1`,
        }]],
      };
    }
    const navRow = [];
    if (page > 1) {
      navRow.push({
        text: '‹ 上一页',
        callback_data: `${TELEGRAM_NOTIFICATION_CALLBACK_PREFIX}:${safeId}:page:${page - 1}`,
      });
    }
    if (page < totalPages) {
      navRow.push({
        text: '下一页 ›',
        callback_data: `${TELEGRAM_NOTIFICATION_CALLBACK_PREFIX}:${safeId}:page:${page + 1}`,
      });
    }
    const rows = [];
    if (navRow.length) {
      rows.push(navRow);
    }
    rows.push([{
      text: '收起摘要',
      callback_data: `${TELEGRAM_NOTIFICATION_CALLBACK_PREFIX}:${safeId}:summary`,
    }]);
    return {
      inline_keyboard: rows,
    };
  }

  async _handleTelegramUpdate(update: any = {}) {
    const callbackQuery = update?.callback_query;
    if (!callbackQuery || typeof callbackQuery !== 'object') {
      return;
    }
    await this._handleNotificationCallback(callbackQuery);
  }

  async _handleNotificationCallback(callbackQuery: any = {}) {
    this._pruneNotificationItems();
    const callbackQueryId = String(callbackQuery?.id || '').trim();
    const data = String(callbackQuery?.data || '').trim();
    if (!data.startsWith(`${TELEGRAM_NOTIFICATION_CALLBACK_PREFIX}:`)) {
      return;
    }
    const settings = this.getSettings();
    const chatId = String(callbackQuery?.message?.chat?.id || callbackQuery?.from?.id || '').trim();
    const messageId = Math.max(0, Number(callbackQuery?.message?.message_id || 0) || 0);
    const [, notificationId = '', action = '', pageRaw = '1'] = data.split(':');
    const entry = this.notificationItems.get(notificationId);
    if (!callbackQueryId || !chatId || !messageId || !entry) {
      await answerTelegramCallbackQuery(settings, callbackQueryId, '这条通知已过期', {
        logLabel: 'Telegram 通知',
      });
      return;
    }
    if (
      String(entry.chatId || '').trim() !== chatId
      || (Number(entry.messageId || 0) > 0 && Number(entry.messageId || 0) !== messageId)
    ) {
      await answerTelegramCallbackQuery(settings, callbackQueryId, '这条通知不属于当前消息', {
        logLabel: 'Telegram 通知',
      });
      return;
    }
    if (action === 'summary') {
      await editTelegramMessage(settings, chatId, messageId, entry.summaryText, {
        replyMarkup: this._buildNotificationReplyMarkup(notificationId, 'summary'),
        logLabel: 'Telegram 通知',
      });
      await answerTelegramCallbackQuery(settings, callbackQueryId, '已收起为摘要', {
        logLabel: 'Telegram 通知',
      });
      return;
    }
    if (action === 'page') {
      const page = Math.max(1, Math.min(entry.pages.length, Number(pageRaw || 1) || 1));
      await editTelegramMessage(settings, chatId, messageId, entry.pages[page - 1], {
        replyMarkup: this._buildNotificationReplyMarkup(notificationId, 'page', page, entry.pages.length),
        logLabel: 'Telegram 通知',
      });
      await answerTelegramCallbackQuery(settings, callbackQueryId, entry.pages.length > 1
        ? `第 ${page}/${entry.pages.length} 页`
        : '已展开全文', {
        logLabel: 'Telegram 通知',
      });
      return;
    }
    await answerTelegramCallbackQuery(settings, callbackQueryId, '未知操作', {
      logLabel: 'Telegram 通知',
    });
  }

  async _sendConversationNotification(status = 'completed', payload: any = {}, settingsOverride = null) {
    const settings = settingsOverride ? normalizeTelegramSettings(settingsOverride) : this.getSettings();
    if (!settings.enabled) {
      return { ok: false, skipped: true, reason: 'disabled' };
    }
    const normalizedPayload = {
      ...payload,
      status,
      deviceIdentity: normalizeIdentity(payload?.deviceIdentity || this.deviceIdentity),
    };
    const detailPages = buildConversationResultDetailPages(normalizedPayload);
    const collapsedPreviewText = buildConversationResultSummaryMessage({
      ...normalizedPayload,
      expandable: false,
    });
    const hasExpandableDetail = detailPages.length > 1 || detailPages[0] !== collapsedPreviewText;
    const summaryText = buildConversationResultSummaryMessage({
      ...normalizedPayload,
      expandable: hasExpandableDetail,
    });
    const notificationId = hasExpandableDetail ? this._createNotificationId() : '';
    const replyMarkup = hasExpandableDetail
      ? this._buildNotificationReplyMarkup(notificationId, 'summary')
      : null;
    const result = await sendTelegramMessage(settings, summaryText, {
      logLabel: 'Telegram 通知',
      ...(replyMarkup ? { replyMarkup } : {}),
    });
    if (!result?.ok || !notificationId) {
      return result;
    }
    this._pruneNotificationItems();
    this.notificationItems.set(notificationId, {
      chatId: String(settings.chatId || '').trim(),
      messageId: Math.max(0, Number(result?.result?.result?.message_id || 0) || 0),
      summaryText,
      pages: detailPages,
      createdAt: Date.now(),
    });
    return result;
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
    return this._sendConversationNotification('completed', payload, settingsOverride);
  }

  async sendConversationFailed(payload: any = {}, settingsOverride = null) {
    return this._sendConversationNotification('failed', payload, settingsOverride);
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
  answerTelegramCallbackQuery,
  buildConversationResultMessage,
  buildTelegramApiUrl,
  editTelegramMessage,
  setTelegramCoordinatorOffset,
  normalizeTelegramText,
  resolveSystemProxyUrl,
  postTelegram,
  sendTelegramMessage,
  sendConversationCompletedNotification,
  sendConversationFailedNotification,
  subscribeTelegramUpdates,
  testTelegramConnection,
};
