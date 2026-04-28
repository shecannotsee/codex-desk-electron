const { TELEGRAM_NOTIFICATION_CALLBACK_PREFIX } = require('./telegram_message_format');

const TELEGRAM_NOTIFICATION_RETENTION_MS = 12 * 60 * 60 * 1000;
const TELEGRAM_NOTIFICATION_MAX_ITEMS = 120;

class TelegramNotificationRegistry {
  [key: string]: any;

  constructor(options: any = {}) {
    this.retentionMs = Math.max(1, Number(options.retentionMs || TELEGRAM_NOTIFICATION_RETENTION_MS));
    this.maxItems = Math.max(1, Number(options.maxItems || TELEGRAM_NOTIFICATION_MAX_ITEMS));
    this.items = new Map();
  }

  prune() {
    const now = Date.now();
    for (const [key, value] of this.items.entries()) {
      const createdAt = Math.max(0, Number(value?.createdAt || 0) || 0);
      if (!createdAt || now - createdAt > this.retentionMs) {
        this.items.delete(key);
      }
    }
    while (this.items.size > this.maxItems) {
      const oldestKey = this.items.keys().next().value;
      if (!oldestKey) {
        break;
      }
      this.items.delete(oldestKey);
    }
  }

  createId() {
    return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  }

  get(notificationId) {
    return this.items.get(String(notificationId || '').trim());
  }

  remember(notificationId, entry) {
    const safeId = String(notificationId || '').trim();
    if (!safeId) {
      return;
    }
    this.prune();
    this.items.set(safeId, {
      ...(entry && typeof entry === 'object' ? entry : {}),
      createdAt: Date.now(),
    });
  }

  buildReplyMarkup(notificationId = '', mode = 'summary', page = 1, totalPages = 1) {
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
}

module.exports = {
  TELEGRAM_NOTIFICATION_MAX_ITEMS,
  TELEGRAM_NOTIFICATION_RETENTION_MS,
  TelegramNotificationRegistry,
};
