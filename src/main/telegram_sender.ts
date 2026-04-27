const { normalizeIdentity, normalizeTelegramSettings } = require('./state_store');
const { appendTelegramLog } = require('./telegram_log_store');
const { postTelegram } = require('./telegram_api');
const {
  TELEGRAM_MESSAGE_LIMIT,
  buildConversationResultSummaryMessage,
  normalizeTelegramText,
} = require('./telegram_message_format');

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
        ...(options.parseMode ? { parse_mode: String(options.parseMode).trim() } : {}),
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
      // Telegram 长轮询和消息发送都可能跨代理链路，短退避能吸收临时 TLS/EOF 抖动。
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
      ...(options.parseMode ? { parse_mode: String(options.parseMode).trim() } : {}),
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
  return sendTelegramMessage(settings, message, {
    logLabel: 'Telegram 通知',
    parseMode: 'HTML',
  });
}

async function sendConversationFailedNotification(settings, payload) {
  const message = buildConversationResultSummaryMessage({
    ...(payload || {}),
    status: 'failed',
    deviceIdentity: normalizeIdentity(payload?.deviceIdentity || ''),
    expandable: false,
  });
  return sendTelegramMessage(settings, message, {
    logLabel: 'Telegram 通知',
    parseMode: 'HTML',
  });
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

module.exports = {
  answerTelegramCallbackQuery,
  editTelegramMessage,
  sendConversationCompletedNotification,
  sendConversationFailedNotification,
  sendTelegramMessage,
  testTelegramConnection,
};
