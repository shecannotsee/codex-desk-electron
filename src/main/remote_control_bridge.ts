const {
  normalizeIdentity,
  normalizeRemoteControlSettings,
} = require('./state_store');
const {
  appendTelegramLog,
  formatTelegramLogs,
  listTelegramLogs,
} = require('./telegram_log_store');
const { postTelegram, sendTelegramMessage } = require('./telegram_bridge');

function normalizeIncomingText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\u00a0/g, ' ')
    .trim();
}

function truncateText(text, limit = 72) {
  const value = String(text || '').replace(/\s+/g, ' ').trim();
  if (value.length <= limit) {
    return value;
  }
  return `${value.slice(0, limit).trimEnd()}...`;
}

function resolveConversationDisplayId(item: any = {}) {
  return String(item?.sessionId || item?.displayId || item?.id || '').trim() || '-';
}

function commandUsage() {
  return [
    'Telegram 远程控制命令:',
    '/help 查看帮助',
    '/list 查看对话列表',
    '/use <序号或会话ID> 绑定当前对话',
    '/new 新建并绑定一个对话',
    '/current 查看当前绑定对话',
    '/history [轮数] 查看当前对话最近几轮',
    '/chat <内容> 发送消息到当前绑定对话',
    '/logs [条数] 查看 Telegram 相关日志',
    '/stop 停止当前绑定对话',
  ].join('\n');
}

function renderConversationList({
  items = [],
  selectedConversationId = '',
  selectedDisplayId = '',
  selectedTitle = '',
  page = 1,
  totalPages = 1,
  total = 0,
  pageSize = 10,
} = {}) {
  if (!Array.isArray(items) || !items.length) {
    return '当前没有可用对话。先使用 /new 创建一个。';
  }
  const currentPage = Math.max(1, Number(page) || 1);
  const resolvedPageSize = Math.max(1, Number(pageSize) || 10);
  const startIndex = (currentPage - 1) * resolvedPageSize;
  const lines = [`对话列表（第 ${currentPage}/${Math.max(1, Number(totalPages) || 1)} 页，共 ${Math.max(items.length, Number(total) || 0)} 个）`];
  if (selectedConversationId) {
    lines.push(`当前: ${truncateText(selectedTitle || '-', 28)} [${selectedDisplayId || selectedConversationId}]`);
  }
  if ((Number(totalPages) || 1) > 1) {
    lines.push('可点击下方按钮翻页。');
  }
  lines.push('可点击下方按钮切换对话。');
  return lines.join('\n');
}

function buildConversationListKeyboard({
  items = [],
  selectedConversationId = '',
  page = 1,
  totalPages = 1,
  pageSize = 10,
} = {}) {
  const rows = [];
  const currentPage = Math.max(1, Number(page) || 1);
  const resolvedPageSize = Math.max(1, Number(pageSize) || 10);
  const startIndex = (currentPage - 1) * resolvedPageSize;
  items.forEach((item, index) => {
    const displayIndex = startIndex + index + 1;
    const selected = String(item?.id || '') === String(selectedConversationId || '');
    rows.push([{
      text: `${selected ? '✓ ' : ''}${displayIndex}. ${truncateText(item?.title || item?.id || '-', 20)}`,
      callback_data: `use:${String(item?.id || '').trim()}:${currentPage}`,
    }]);
  });
  const navRow = [];
  if (currentPage > 1) {
    navRow.push({ text: '‹ 上一页', callback_data: `list:${currentPage - 1}` });
  }
  if (currentPage < Math.max(1, Number(totalPages) || 1)) {
    navRow.push({ text: '下一页 ›', callback_data: `list:${currentPage + 1}` });
  }
  if (navRow.length) {
    rows.push(navRow);
  }
  return rows.length ? { inline_keyboard: rows } : null;
}

function renderConversationHistory(selected, items = [], total = 0) {
  if (!selected?.conversationId) {
    return '当前未绑定对话。使用 /list 查看对话，或 /new 新建一个。';
  }
  const lines = [
    `当前对话: ${truncateText(selected.title || selected.conversationId, 40)} [${selected.displayId || selected.conversationId}]`,
  ];
  if (!Array.isArray(items) || !items.length) {
    lines.push('当前对话还没有历史对话。');
    return lines.join('\n');
  }
  lines.push(`最近对话 (${items.length}/${Math.max(items.length, Number(total || 0) || 0)} 轮):`);
  items.forEach((item, index) => {
    const userText = truncateText(String(item?.userText || '').replace(/\s+/g, ' ').trim() || '-', 220);
    const assistantText = truncateText(String(item?.assistantText || '').replace(/\s+/g, ' ').trim() || '-', 220);
    lines.push(`${index + 1}. 你: ${userText}`);
    lines.push(`   Codex: ${assistantText}`);
  });
  return lines.join('\n');
}

class TelegramRemoteControlService {
  [key: string]: any;

  constructor(options: any = {}) {
    this.handlers = options.handlers && typeof options.handlers === 'object' ? options.handlers : {};
    this.controlSettings = normalizeRemoteControlSettings(options.controlSettings || {}).telegram;
    this.deviceIdentity = normalizeIdentity(options.deviceIdentity || '');
    this.pollTimer = null;
    this.started = false;
    this.isPolling = false;
  }

  updateConfig(options: any = {}) {
    if (Object.prototype.hasOwnProperty.call(options, 'controlSettings')) {
      const normalizedRemoteControl = normalizeRemoteControlSettings({
        telegram: options.controlSettings,
      });
      this.controlSettings = normalizedRemoteControl.telegram;
    }
    if (Object.prototype.hasOwnProperty.call(options, 'handlers') && options.handlers && typeof options.handlers === 'object') {
      this.handlers = options.handlers;
    }
    if (Object.prototype.hasOwnProperty.call(options, 'deviceIdentity')) {
      this.deviceIdentity = normalizeIdentity(options.deviceIdentity || '');
    }
    if (this.isReady()) {
      this.start();
    } else {
      this.stop();
    }
  }

  isReady() {
    return Boolean(
      this.controlSettings.enabled
      && String(this.controlSettings?.botToken || '').trim()
      && String(this.controlSettings?.allowedChatId || '').trim(),
    );
  }

  start() {
    this.started = true;
    this._schedulePoll(0);
  }

  stop() {
    this.started = false;
    if (this.pollTimer) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
  }

  _schedulePoll(delayMs = 1500) {
    if (!this.started || this.pollTimer || this.isPolling || !this.isReady()) {
      return;
    }
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      this._pollOnce().catch(() => {}).finally(() => {
        if (this.started) {
          this._schedulePoll(400);
        }
      });
    }, Math.max(0, Number(delayMs) || 0));
  }

  async _pollOnce() {
    if (!this.started || this.isPolling || !this.isReady()) {
      return;
    }
    this.isPolling = true;
    try {
      const lastUpdateId = Math.max(0, Number(this.controlSettings.lastUpdateId || 0) || 0);
      const response = await postTelegram(this.controlSettings, 'getUpdates', {
        offset: lastUpdateId + 1,
        timeout: 25,
        allowed_updates: ['message', 'callback_query'],
      }, 30000);
      const updates = Array.isArray(response?.result) ? response.result : [];
      let highestUpdateId = lastUpdateId;
      for (const update of updates) {
        const updateId = Math.max(0, Number(update?.update_id || 0) || 0);
        if (updateId > highestUpdateId) {
          highestUpdateId = updateId;
        }
        const callbackQuery = update?.callback_query;
        if (callbackQuery && typeof callbackQuery === 'object') {
          try {
            await this._handleCallbackQuery(callbackQuery);
          } catch (error) {
            const chatId = String(callbackQuery?.message?.chat?.id || callbackQuery?.from?.id || '').trim();
            if (chatId) {
              await this._sendReply(chatId, `远程控制处理失败: ${error?.message || String(error)}`);
            }
          }
          continue;
        }
        const message = update?.message;
        if (!message || typeof message !== 'object') {
          continue;
        }
        try {
          await this._handleMessage(message);
        } catch (error) {
          const chatId = String(message?.chat?.id || '').trim();
          if (chatId) {
            await this._sendReply(chatId, `远程控制处理失败: ${error?.message || String(error)}`);
          }
        }
      }
      if (highestUpdateId > lastUpdateId) {
        this.controlSettings.lastUpdateId = highestUpdateId;
        await this.handlers.updateState?.({
          lastUpdateId: highestUpdateId,
        });
      }
    } finally {
      this.isPolling = false;
    }
  }

  async _handleMessage(message) {
    const chatId = String(message?.chat?.id || '').trim();
    const allowedChatId = String(this.controlSettings?.allowedChatId || '').trim();
    if (!chatId || !allowedChatId || chatId !== allowedChatId) {
      return;
    }
    const text = normalizeIncomingText(message?.text || '');
    if (!text) {
      await this._sendReply(chatId, '暂只支持文本消息。\n\n' + commandUsage());
      return;
    }
    const normalizedText = text.replace(/^@\S+\s*/, '');
    const response = normalizedText.startsWith('/')
      ? await this._handleCommand(chatId, normalizedText)
      : await this._handlePlainText(chatId, normalizedText);
    if (!response) {
      return;
    }
    if (typeof response === 'string') {
      await this._sendReply(chatId, response);
      return;
    }
    if (response?.text) {
      await this._sendReply(chatId, response.text, {
        replyMarkup: response.replyMarkup || null,
      });
    }
  }

  async _handleCallbackQuery(callbackQuery) {
    const callbackQueryId = String(callbackQuery?.id || '').trim();
    const data = String(callbackQuery?.data || '').trim();
    const chatId = String(callbackQuery?.message?.chat?.id || callbackQuery?.from?.id || '').trim();
    const messageId = Math.max(0, Number(callbackQuery?.message?.message_id || 0) || 0);
    const allowedChatId = String(this.controlSettings?.allowedChatId || '').trim();
    if (!callbackQueryId || !chatId || !allowedChatId || chatId !== allowedChatId) {
      return;
    }
    if (!data) {
      await this._answerCallbackQuery(callbackQueryId, '无效操作');
      return;
    }
    if (data.startsWith('list:')) {
      const page = Math.max(1, Number(data.split(':')[1] || 1) || 1);
      const selected = await this.handlers.getSelectedConversation?.(chatId, { allowFallback: true });
      const result = await this.handlers.listConversations?.(page, 10) || {};
      const text = renderConversationList({
        items: result.items || [],
        selectedConversationId: selected?.conversationId || '',
        selectedDisplayId: selected?.displayId || '',
        selectedTitle: selected?.title || '',
        page: result.page || page,
        totalPages: result.totalPages || 1,
        total: result.total || 0,
        pageSize: result.pageSize || 10,
      });
      const replyMarkup = buildConversationListKeyboard({
        items: result.items || [],
        selectedConversationId: selected?.conversationId || '',
        page: result.page || page,
        totalPages: result.totalPages || 1,
        pageSize: result.pageSize || 10,
      });
      await this._editReply(chatId, messageId, text, { replyMarkup });
      appendTelegramLog('info', `远程控制切换列表页: 第 ${result.page || page} 页`);
      await this._answerCallbackQuery(callbackQueryId, `第 ${result.page || page} 页`);
      return;
    }
    if (data.startsWith('use:')) {
      const [, conversationId = '', pageRaw = '1'] = data.split(':');
      const result = await this.handlers.selectConversation?.(chatId, conversationId);
      if (!result?.ok) {
        await this._answerCallbackQuery(callbackQueryId, String(result?.error || '切换会话失败'));
        return;
      }
      const page = Math.max(1, Number(pageRaw || 1) || 1);
      const selected = await this.handlers.getSelectedConversation?.(chatId, { allowFallback: true });
      const listResult = await this.handlers.listConversations?.(page, 10) || {};
      const text = renderConversationList({
        items: listResult.items || [],
        selectedConversationId: selected?.conversationId || '',
        selectedDisplayId: selected?.displayId || '',
        selectedTitle: selected?.title || '',
        page: listResult.page || page,
        totalPages: listResult.totalPages || 1,
        total: listResult.total || 0,
        pageSize: listResult.pageSize || 10,
      });
      const replyMarkup = buildConversationListKeyboard({
        items: listResult.items || [],
        selectedConversationId: selected?.conversationId || '',
        page: listResult.page || page,
        totalPages: listResult.totalPages || 1,
        pageSize: listResult.pageSize || 10,
      });
      await this._editReply(chatId, messageId, text, { replyMarkup });
      appendTelegramLog('info', `远程控制切换对话: ${result.conversationId}`);
      await this._answerCallbackQuery(callbackQueryId, `已切换到 ${truncateText(result.title || result.conversationId, 24)}`);
      return;
    }
    await this._answerCallbackQuery(callbackQueryId, '未知操作');
  }

  async _handleCommand(chatId, text) {
    const [commandRaw, ...args] = text.split(/\s+/);
    const command = String(commandRaw || '').trim().toLowerCase().split('@')[0];
    if (command === '/start' || command === '/help') {
      const selected = await this.handlers.getSelectedConversation?.(chatId, { allowFallback: true });
      const currentLine = selected?.conversationId
        ? `\n\n当前对话: ${truncateText(selected.title || selected.conversationId, 40)} [${selected.displayId || selected.conversationId}]`
        : '\n\n当前未绑定对话。';
      return commandUsage() + currentLine;
    }
    if (command === '/list' || command === '/conversations') {
      const selected = await this.handlers.getSelectedConversation?.(chatId, { allowFallback: true });
      const page = Math.max(1, Number(args[0] || 1) || 1);
      const result = await this.handlers.listConversations?.(page, 10) || {};
      return {
        text: renderConversationList({
          items: result.items || [],
          selectedConversationId: selected?.conversationId || '',
          selectedDisplayId: selected?.displayId || '',
          selectedTitle: selected?.title || '',
          page: result.page || page,
          totalPages: result.totalPages || 1,
          total: result.total || 0,
          pageSize: result.pageSize || 10,
        }),
        replyMarkup: buildConversationListKeyboard({
          items: result.items || [],
          selectedConversationId: selected?.conversationId || '',
          page: result.page || page,
          totalPages: result.totalPages || 1,
          pageSize: result.pageSize || 10,
        }),
      };
    }
    if (command === '/use') {
      const ref = String(args.join(' ') || '').trim();
      if (!ref) {
        return '请提供序号或会话 ID，例如 `/use 1`。';
      }
      const result = await this.handlers.selectConversation?.(chatId, ref);
      if (!result?.ok) {
        return String(result?.error || '切换会话失败');
      }
      return `已切换到: ${truncateText(result.title || result.conversationId, 48)} [${result.displayId || result.conversationId}]`;
    }
    if (command === '/new') {
      const result = await this.handlers.createConversation?.(chatId);
      if (!result?.ok) {
        return String(result?.error || '新建对话失败');
      }
      return `已新建并绑定对话: ${truncateText(result.title || result.conversationId, 48)} [${result.displayId || result.conversationId}]`;
    }
    if (command === '/current' || command === '/status') {
      const selected = await this.handlers.getSelectedConversation?.(chatId, { allowFallback: true });
      if (!selected?.conversationId) {
        return '当前未绑定对话。使用 /list 查看对话，或 /new 新建一个。';
      }
      return [
        `当前对话: ${truncateText(selected.title || selected.conversationId, 48)} [${selected.displayId || selected.conversationId}]`,
        `状态: ${String(selected.phase || '空闲').trim() || '空闲'}`,
        `排队: ${Math.max(0, Number(selected.queuedCount || 0) || 0)}`,
      ].join('\n');
    }
    if (command === '/history') {
      const requestedLimit = Math.max(1, Math.min(10, Number(args[0] || 2) || 2));
      const result = await this.handlers.getConversationHistory?.(chatId, requestedLimit);
      if (!result?.ok) {
        return String(result?.error || '查看历史失败');
      }
      return renderConversationHistory({
        conversationId: result.conversationId,
        displayId: result.displayId,
        title: result.title,
      }, result.items, result.total);
    }
    if (command === '/logs') {
      const limit = Math.max(1, Math.min(30, Number(args[0] || 12) || 12));
      return formatTelegramLogs(listTelegramLogs(limit));
    }
    if (command === '/chat') {
      const messageText = String(text.replace(/^\/chat(?:@\S+)?\s*/i, '') || '').trim();
      if (!messageText) {
        return '请在 /chat 后面输入要发送的内容，例如 `/chat 帮我总结一下当前问题`。';
      }
      return this._handleChatCommand(chatId, messageText);
    }
    if (command === '/stop') {
      const result = await this.handlers.stopCurrentConversation?.(chatId);
      if (!result?.ok) {
        return String(result?.error || '停止对话失败');
      }
      return `已请求停止: ${truncateText(result.title || result.conversationId, 48)} [${result.displayId || result.conversationId}]`;
    }
    return '未知命令。\n\n' + commandUsage();
  }

  async _handlePlainText(chatId, text) {
    return [
      '普通文本不会直接发送到 Codex Desk，避免误发。',
      '如需发送，请使用 `/chat 你的消息`。',
      '',
      commandUsage(),
    ].join('\n');
  }

  async _handleChatCommand(chatId, text) {
    const result = await this.handlers.sendMessageToSelectedConversation?.(chatId, text);
    if (!result?.ok) {
      return String(result?.error || '发送失败');
    }
    const header = `已发送到: ${truncateText(result.title || result.conversationId, 48)} [${result.displayId || result.conversationId}]`;
    if (result.queued) {
      return `${header}\n当前会话仍在处理中，消息已加入排队。`;
    }
    const suffix = result.autoBound
      ? '\n未显式选择对话，已默认绑定当前活跃对话。可用 /list 与 /use 切换。'
      : '';
    return `${header}\n消息已开始执行，完成或失败后会继续通过 Telegram 返回。${suffix}`;
  }

  async _sendReply(chatId, text, options: any = {}) {
    await sendTelegramMessage({
      ...this.controlSettings,
      chatId,
    }, text, {
      chatId,
      logLabel: 'Telegram 远程回复',
      ...(options.replyMarkup ? { replyMarkup: options.replyMarkup } : {}),
    });
  }

  async _editReply(chatId, messageId, text, options: any = {}) {
    if (!chatId || !messageId) {
      return;
    }
    try {
      await postTelegram({
        ...this.controlSettings,
        chatId,
      }, 'editMessageText', {
        chat_id: chatId,
        message_id: messageId,
        text,
        disable_web_page_preview: true,
        ...(options.replyMarkup ? { reply_markup: options.replyMarkup } : {}),
      }, 15000);
    } catch (error) {
      appendTelegramLog('warn', `远程控制编辑消息失败: ${error?.message || String(error)}`);
      await this._sendReply(chatId, text, options);
    }
  }

  async _answerCallbackQuery(callbackQueryId, text = '') {
    try {
      await postTelegram(this.controlSettings, 'answerCallbackQuery', {
        callback_query_id: callbackQueryId,
        ...(text ? { text: truncateText(text, 180) } : {}),
      }, 10000);
    } catch (error) {
      appendTelegramLog('warn', `远程控制回调确认失败: ${error?.message || String(error)}`);
    }
  }
}

class RemoteControlCenter {
  [key: string]: any;

  constructor(options: any = {}) {
    this.deviceIdentity = normalizeIdentity(options.deviceIdentity || '');
    this.settings = normalizeRemoteControlSettings(options.settings);
    this.handlers = options.handlers && typeof options.handlers === 'object' ? options.handlers : {};
    this.telegramService = new TelegramRemoteControlService({
      controlSettings: this.settings.telegram,
      handlers: this.handlers,
      deviceIdentity: this.deviceIdentity,
    });
    this.updateConfig(options);
  }

  updateConfig(options: any = {}) {
    if (Object.prototype.hasOwnProperty.call(options, 'deviceIdentity')) {
      this.deviceIdentity = normalizeIdentity(options.deviceIdentity || '');
    }
    if (Object.prototype.hasOwnProperty.call(options, 'settings')) {
      this.settings = normalizeRemoteControlSettings(options.settings);
    }
    if (Object.prototype.hasOwnProperty.call(options, 'handlers') && options.handlers && typeof options.handlers === 'object') {
      this.handlers = options.handlers;
    }
    this.telegramService.updateConfig({
      controlSettings: this.settings.telegram,
      handlers: this.handlers,
      deviceIdentity: this.deviceIdentity,
    });
    return this.snapshot();
  }

  stop() {
    this.telegramService.stop();
  }

  snapshot(options: any = {}) {
    const settings = normalizeRemoteControlSettings(this.settings);
    const includeSecrets = Boolean(options.includeSecrets);
    return {
      activeProvider: settings.activeProvider,
      providers: {
        telegram: {
          enabled: Boolean(settings.telegram.enabled),
          botToken: includeSecrets ? String(settings.telegram.botToken || '').trim() : '',
          hasBotToken: Boolean(settings.telegram.hasBotToken),
          botTokenHash: String(settings.telegram.botTokenHash || '').trim(),
          botTokenFingerprint: String(settings.telegram.botTokenFingerprint || '').trim(),
          allowedChatId: String(settings.telegram.allowedChatId || '').trim(),
        },
      },
    };
  }

  async testActiveProvider() {
    const settings = normalizeRemoteControlSettings(this.settings);
    const telegram = settings.telegram;
    const botToken = String(telegram?.botToken || '').trim();
    const chatId = String(telegram?.allowedChatId || '').trim();
    if (!botToken) {
      return { ok: false, error: 'Telegram 远程对话 Bot Token 未配置' };
    }
    if (!chatId) {
      return { ok: false, error: 'Telegram 远程对话 Chat ID 未配置' };
    }
    const lines = [
      'Codex Desk Telegram 远程对话测试',
      this.deviceIdentity ? `设备标识: ${this.deviceIdentity}` : '',
      '测试消息发送成功，说明当前远程对话配置可用。',
      '后续可在 Telegram 中发送 /help 查看可用命令。',
    ].filter(Boolean);
    try {
      await postTelegram({ botToken }, 'getMe', {}, 10000);
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
    return sendTelegramMessage({
      enabled: true,
      botToken,
      chatId,
    }, lines.join('\n'));
  }
}

module.exports = {
  RemoteControlCenter,
};
