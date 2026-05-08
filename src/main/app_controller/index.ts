const { createAppStateStorage } = require('../storage');
const { RuntimeStore } = require('../runtime_store');
const { nowTs } = require('../conversation_service');
const { NotificationCenter } = require('../notification_bridge');
const { RemoteControlCenter } = require('../remote_control_bridge');
const { defaultCredentialVault } = require('../state_store');

const { runtimeMethods } = require('./methods_runtime');
const { remoteControlMethods } = require('./methods_remote_control');
const { metaMethods } = require('./methods_meta');
const { chatMethods } = require('./methods_chat');
const { runtimePersistenceMethods } = require('./runtime_persistence');
const { runtimeEventMethods } = require('./runtime_events');
const { runtimeRunnerLifecycleMethods } = require('./runtime_runner_lifecycle');
const { runtimeSecurityMethods } = require('./runtime_security');
const { runtimeSessionFileMethods } = require('./runtime_session_files');
const { runtimeSettingsMethods } = require('./runtime_settings');
const { runtimeSnapshotMethods } = require('./runtime_snapshot');
const { chatStreamPreviewMethods } = require('./chat_stream_preview');

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
    this.vault = loaded.vault && typeof loaded.vault === 'object'
      ? { ...loaded.vault }
      : defaultCredentialVault();
    this.security = {
      hasMasterPassword: Boolean(loaded.security?.hasMasterPassword),
      unlocked: !Boolean(loaded.security?.hasMasterPassword),
    };
    this.vaultKey = null;
    this.notifications = loaded.notifications && typeof loaded.notifications === 'object'
      ? { ...loaded.notifications }
      : {
        activeProvider: 'telegram',
        telegram: {
          enabled: false,
          botToken: '',
          chatId: '',
        },
      };
    this.remoteControl = loaded.remoteControl && typeof loaded.remoteControl === 'object'
      ? { ...loaded.remoteControl }
      : {
        activeProvider: 'telegram',
        telegram: {
          enabled: false,
          botToken: '',
          allowedChatId: '',
          lastUpdateId: 0,
          selectedConversationByChat: {},
        },
      };
    this.notificationCenter = new NotificationCenter({
      settings: this.notifications,
      deviceIdentity: this.deviceIdentity,
    });
    this.remoteControlCenter = new RemoteControlCenter({
      settings: this.remoteControl,
      deviceIdentity: this.deviceIdentity,
      handlers: this._remoteControlHandlers ? this._remoteControlHandlers() : {},
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
    this.rawEventSeq = 0;
    this.persistTimer = null;

    for (const conv of this.conversations) {
      this.runtimeStore.ensure(conv.id);
      const restoredMeta = loaded.metaByConversation?.[conv.id];
      this.metaByConversation[conv.id] = {
        'Codex版本': '-',
        'Claude版本': '-',
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
  runtimePersistenceMethods,
  runtimeEventMethods,
  runtimeRunnerLifecycleMethods,
  runtimeSecurityMethods,
  runtimeSessionFileMethods,
  runtimeSettingsMethods,
  runtimeSnapshotMethods,
  runtimeMethods,
  remoteControlMethods,
  metaMethods,
  chatStreamPreviewMethods,
  chatMethods,
);

module.exports = {
  AppController,
};
