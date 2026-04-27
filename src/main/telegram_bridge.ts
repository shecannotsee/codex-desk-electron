const {
  hashSecret,
  normalizeIdentity,
  normalizeTelegramSettings,
  toSecretFingerprint,
} = require('./state_store');
const { appendTelegramLog } = require('./telegram_log_store');
const {
  TELEGRAM_API_BASE,
  buildTelegramApiUrl,
  postTelegram,
  resolveSystemProxyUrl,
} = require('./telegram_api');
const {
  TELEGRAM_NOTIFICATION_CALLBACK_PREFIX,
  buildConversationResultDetailPages,
  buildConversationResultMessage,
  buildConversationResultSummaryMessage,
  normalizeTelegramText,
} = require('./telegram_message_format');
const {
  getTelegramCoordinatorKey,
  setTelegramCoordinatorOffset,
  subscribeTelegramUpdates,
} = require('./telegram_updates');
const {
  answerTelegramCallbackQuery,
  editTelegramMessage,
  sendConversationCompletedNotification,
  sendConversationFailedNotification,
  sendTelegramMessage,
  testTelegramConnection,
} = require('./telegram_sender');

const TELEGRAM_NOTIFICATION_RETENTION_MS = 12 * 60 * 60 * 1000;

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
    // Inline keyboard callbacks are accepted only for the exact message that created the entry.
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
        parseMode: 'HTML',
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
        parseMode: 'HTML',
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
      parseMode: 'HTML',
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
