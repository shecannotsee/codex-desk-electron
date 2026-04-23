const {
  normalizeIdentity,
  normalizeNotificationSettings,
  normalizeRemoteControlSettings,
} = require('./state_store');
const { postTelegram, sendTelegramMessage } = require('./telegram_bridge');

function resolveAllowedChatId(controlSettings, telegramSettings) {
  const explicitChatId = String(controlSettings?.allowedChatId || '').trim();
  if (explicitChatId) {
    return explicitChatId;
  }
  return String(telegramSettings?.chatId || '').trim();
}

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

function commandUsage() {
  return [
    'Telegram 远程控制命令:',
    '/help 查看帮助',
    '/list 查看最近对话',
    '/use <序号或会话ID> 绑定当前对话',
    '/new 新建并绑定一个对话',
    '/current 查看当前绑定对话',
    '/stop 停止当前绑定对话',
    '直接发送文本: 转发到当前绑定对话',
  ].join('\n');
}

function renderConversationList(items = [], selectedConversationId = '') {
  if (!Array.isArray(items) || !items.length) {
    return '当前没有可用对话。先使用 /new 创建一个。';
  }
  const lines = ['最近对话:'];
  items.forEach((item, index) => {
    const isSelected = String(item?.id || '') === String(selectedConversationId || '');
    lines.push(
      `${index + 1}. ${isSelected ? '[当前] ' : ''}${truncateText(item?.title || '-', 32)} [${String(item?.id || '-').trim() || '-'}]`,
    );
    lines.push(`状态: ${String(item?.phase || '空闲').trim() || '空闲'} | 排队: ${Math.max(0, Number(item?.queuedCount || 0) || 0)}`);
  });
  lines.push('使用 /use <序号或会话ID> 切换。');
  return lines.join('\n');
}

class TelegramRemoteControlService {
  [key: string]: any;

  constructor(options: any = {}) {
    this.handlers = options.handlers && typeof options.handlers === 'object' ? options.handlers : {};
    this.telegramSettings = normalizeNotificationSettings(options.telegramSettings || {}).telegram;
    this.controlSettings = normalizeRemoteControlSettings(options.controlSettings || {}).telegram;
    this.deviceIdentity = normalizeIdentity(options.deviceIdentity || '');
    this.pollTimer = null;
    this.started = false;
    this.isPolling = false;
  }

  updateConfig(options: any = {}) {
    if (Object.prototype.hasOwnProperty.call(options, 'telegramSettings')) {
      const normalizedNotifications = normalizeNotificationSettings({
        telegram: options.telegramSettings,
      });
      this.telegramSettings = normalizedNotifications.telegram;
    }
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
      && String(this.telegramSettings?.botToken || '').trim()
      && resolveAllowedChatId(this.controlSettings, this.telegramSettings),
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
      const response = await postTelegram(this.telegramSettings, 'getUpdates', {
        offset: lastUpdateId + 1,
        timeout: 25,
        allowed_updates: ['message'],
      }, 30000);
      const updates = Array.isArray(response?.result) ? response.result : [];
      let highestUpdateId = lastUpdateId;
      for (const update of updates) {
        const updateId = Math.max(0, Number(update?.update_id || 0) || 0);
        if (updateId > highestUpdateId) {
          highestUpdateId = updateId;
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
    const allowedChatId = resolveAllowedChatId(this.controlSettings, this.telegramSettings);
    if (!chatId || !allowedChatId || chatId !== allowedChatId) {
      return;
    }
    const text = normalizeIncomingText(message?.text || '');
    if (!text) {
      await this._sendReply(chatId, '暂只支持文本消息。\n\n' + commandUsage());
      return;
    }
    const normalizedText = text.replace(/^@\S+\s*/, '');
    const responseText = normalizedText.startsWith('/')
      ? await this._handleCommand(chatId, normalizedText)
      : await this._handlePlainText(chatId, normalizedText);
    if (responseText) {
      await this._sendReply(chatId, responseText);
    }
  }

  async _handleCommand(chatId, text) {
    const [commandRaw, ...args] = text.split(/\s+/);
    const command = String(commandRaw || '').trim().toLowerCase().split('@')[0];
    if (command === '/start' || command === '/help') {
      const selected = await this.handlers.getSelectedConversation?.(chatId, { allowFallback: true });
      const currentLine = selected?.conversationId
        ? `\n\n当前对话: ${truncateText(selected.title || selected.conversationId, 40)} [${selected.conversationId}]`
        : '\n\n当前未绑定对话。';
      return commandUsage() + currentLine;
    }
    if (command === '/list' || command === '/conversations') {
      const selected = await this.handlers.getSelectedConversation?.(chatId, { allowFallback: true });
      const items = await this.handlers.listConversations?.(10) || [];
      return renderConversationList(items, selected?.conversationId || '');
    }
    if (command === '/use') {
      const ref = String(args.join(' ') || '').trim();
      if (!ref) {
        return '请提供序号或会话 ID，例如 `/use 1` 或 `/use conv-xxx`。';
      }
      const result = await this.handlers.selectConversation?.(chatId, ref);
      if (!result?.ok) {
        return String(result?.error || '切换会话失败');
      }
      return `已切换到: ${truncateText(result.title || result.conversationId, 48)} [${result.conversationId}]`;
    }
    if (command === '/new') {
      const result = await this.handlers.createConversation?.(chatId);
      if (!result?.ok) {
        return String(result?.error || '新建对话失败');
      }
      return `已新建并绑定对话: ${truncateText(result.title || result.conversationId, 48)} [${result.conversationId}]`;
    }
    if (command === '/current' || command === '/status') {
      const selected = await this.handlers.getSelectedConversation?.(chatId, { allowFallback: true });
      if (!selected?.conversationId) {
        return '当前未绑定对话。使用 /list 查看对话，或 /new 新建一个。';
      }
      return [
        `当前对话: ${truncateText(selected.title || selected.conversationId, 48)} [${selected.conversationId}]`,
        `状态: ${String(selected.phase || '空闲').trim() || '空闲'}`,
        `排队: ${Math.max(0, Number(selected.queuedCount || 0) || 0)}`,
      ].join('\n');
    }
    if (command === '/stop') {
      const result = await this.handlers.stopCurrentConversation?.(chatId);
      if (!result?.ok) {
        return String(result?.error || '停止对话失败');
      }
      return `已请求停止: ${truncateText(result.title || result.conversationId, 48)} [${result.conversationId}]`;
    }
    return '未知命令。\n\n' + commandUsage();
  }

  async _handlePlainText(chatId, text) {
    const result = await this.handlers.sendMessageToSelectedConversation?.(chatId, text);
    if (!result?.ok) {
      return String(result?.error || '发送失败');
    }
    const header = `已发送到: ${truncateText(result.title || result.conversationId, 48)} [${result.conversationId}]`;
    if (result.queued) {
      return `${header}\n当前会话仍在处理中，消息已加入排队。`;
    }
    const suffix = result.autoBound
      ? '\n未显式选择对话，已默认绑定当前活跃对话。可用 /list 与 /use 切换。'
      : '';
    return `${header}\n消息已开始执行，完成或失败后会继续通过 Telegram 返回。${suffix}`;
  }

  async _sendReply(chatId, text) {
    await sendTelegramMessage({
      ...this.telegramSettings,
      chatId,
    }, text);
  }
}

class RemoteControlCenter {
  [key: string]: any;

  constructor(options: any = {}) {
    this.deviceIdentity = normalizeIdentity(options.deviceIdentity || '');
    this.telegramSettings = normalizeNotificationSettings(options.telegramSettings || {}).telegram;
    this.settings = normalizeRemoteControlSettings(options.settings);
    this.handlers = options.handlers && typeof options.handlers === 'object' ? options.handlers : {};
    this.telegramService = new TelegramRemoteControlService({
      telegramSettings: this.telegramSettings,
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
    if (Object.prototype.hasOwnProperty.call(options, 'telegramSettings')) {
      this.telegramSettings = normalizeNotificationSettings({
        telegram: options.telegramSettings,
      }).telegram;
    }
    if (Object.prototype.hasOwnProperty.call(options, 'settings')) {
      this.settings = normalizeRemoteControlSettings(options.settings);
    }
    if (Object.prototype.hasOwnProperty.call(options, 'handlers') && options.handlers && typeof options.handlers === 'object') {
      this.handlers = options.handlers;
    }
    this.telegramService.updateConfig({
      telegramSettings: this.telegramSettings,
      controlSettings: this.settings.telegram,
      handlers: this.handlers,
      deviceIdentity: this.deviceIdentity,
    });
    return this.snapshot();
  }

  stop() {
    this.telegramService.stop();
  }

  snapshot() {
    const settings = normalizeRemoteControlSettings(this.settings);
    const allowedChatId = resolveAllowedChatId(settings.telegram, this.telegramSettings);
    return {
      activeProvider: settings.activeProvider,
      providers: {
        telegram: {
          enabled: Boolean(settings.telegram.enabled),
          allowedChatId: String(settings.telegram.allowedChatId || '').trim(),
          effectiveAllowedChatId: allowedChatId,
          usesNotificationChatId: !String(settings.telegram.allowedChatId || '').trim(),
        },
      },
    };
  }
}

module.exports = {
  RemoteControlCenter,
};
