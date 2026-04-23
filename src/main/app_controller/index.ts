const { createAppStateStorage } = require('../storage');
const { RuntimeStore } = require('../runtime_store');
const { nowTs } = require('../conversation_service');
const { TelegramBotModule } = require('../telegram_bridge');

const { runtimeMethods } = require('./methods_runtime');
const { metaMethods } = require('./methods_meta');
const { chatMethods } = require('./methods_chat');

function usageFromMeta(meta) {
  if (!meta || typeof meta !== 'object') {
    return null;
  }
  const inputTokens = Number(meta['输入Tokens'] ?? 0) || 0;
  const cachedInputTokens = Number(meta['缓存输入Tokens'] ?? 0) || 0;
  const outputTokens = Number(meta['输出Tokens'] ?? 0) || 0;
  const model = String(meta['模型'] || '').trim();
  if (inputTokens <= 0 && cachedInputTokens <= 0 && outputTokens <= 0) {
    return null;
  }
  return {
    ...(model && model !== '-' ? { model } : {}),
    inputTokens,
    cachedInputTokens,
    outputTokens,
  };
}

function backfillLatestAssistantUsage(conversation, meta) {
  const messages = Array.isArray(conversation?.messages) ? conversation.messages : [];
  const usage = usageFromMeta(meta);
  if (!usage) {
    return false;
  }
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const item = messages[index];
    if (item?.role !== 'assistant') {
      continue;
    }
    if (item.usage && typeof item.usage === 'object') {
      return false;
    }
    item.usage = usage;
    return true;
  }
  return false;
}

class AppController {
  [key: string]: any;

  constructor(mainWindow, options: any = {}) {
    this.mainWindow = mainWindow;
    this.stateStorage = options.stateStorage || createAppStateStorage(options.stateStorageOptions);

    const loaded = this.stateStorage.loadState();
    this.commandText = loaded.commandText;
    this.workdir = loaded.workdir;
    this.useNativeMemory = true;
    this.deviceIdentity = String(loaded.deviceIdentity || '').trim();
    this.telegram = loaded.telegram && typeof loaded.telegram === 'object'
      ? { ...loaded.telegram }
      : {
        enabled: false,
        botToken: '',
        chatId: '',
      };
    this.telegramBot = new TelegramBotModule({
      settings: this.telegram,
      deviceIdentity: this.deviceIdentity,
    });

    this.conversations = Array.isArray(loaded.conversations) ? loaded.conversations : [];

    let renamedFromTest = false;
    let backfilledUsage = false;
    for (let index = 0; index < this.conversations.length; index += 1) {
      const conv = this.conversations[index];
      if (String(conv.title || '').trim() === '测试重命名') {
        conv.title = `会话 ${index + 1}`;
        conv.updatedAt = nowTs();
        renamedFromTest = true;
      }
    }

    this.activeConversationId = String(loaded.activeConversationId || '').trim();
    if (!this.conversations.some((item) => item.id === this.activeConversationId)) {
      this.activeConversationId = '';
    }

    this.runtimeStore = new RuntimeStore();
    this.metaByConversation = {};
    this.runners = new Map();
    this.preferAppServerByConversation = {};
    this.pendingQueueByConversation = new Map();
    this.pendingQueueItemSeq = 0;
    this.assistantBufferByRunner = new Map();
    this.assistantStreamPreviewByRunner = new Map();
    this.userMessageByRunner = new Map();
    this.requestWaitNoticeByRunner = new Map();
    this.stepIndexByRunner = new Map();
    this.roundIndexByRunner = new Map();
    this.structuredEventSeq = 0;
    this.persistTimer = null;

    for (const conv of this.conversations) {
      this.runtimeStore.ensure(conv.id);
      const restoredMeta = loaded.metaByConversation?.[conv.id];
      this.metaByConversation[conv.id] = {
        'Codex版本': '-',
        '模型': '-',
        '会话ID': conv.sessionId || '-',
        '输入Tokens': '-',
        '缓存输入Tokens': '-',
        '输出Tokens': '-',
        ...(restoredMeta && typeof restoredMeta === 'object' ? restoredMeta : {}),
      };
      if (!String(this.metaByConversation[conv.id]['会话ID'] || '').trim() || this.metaByConversation[conv.id]['会话ID'] === '-') {
        this.metaByConversation[conv.id]['会话ID'] = conv.sessionId || '-';
      }
      if (backfillLatestAssistantUsage(conv, this.metaByConversation[conv.id])) {
        backfilledUsage = true;
      }
    }

    if (renamedFromTest || backfilledUsage) {
      this._persist();
    }
  }
}

Object.assign(
  AppController.prototype,
  runtimeMethods,
  metaMethods,
  chatMethods,
);

module.exports = {
  AppController,
};
