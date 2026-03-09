const { StateStore } = require('../state_store');
const { RuntimeStore } = require('../runtime_store');
const { nowTs } = require('../conversation_service');

const { runtimeMethods } = require('./methods_runtime');
const { metaMethods } = require('./methods_meta');
const { chatMethods } = require('./methods_chat');

class AppController {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    this.stateStore = new StateStore();

    const loaded = this.stateStore.load();
    this.commandText = loaded.commandText;
    this.workdir = loaded.workdir;
    this.useNativeMemory = true;

    this.conversations = Array.isArray(loaded.conversations) ? loaded.conversations : [];

    let renamedFromTest = false;
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
    this.pendingQueueByConversation = new Map();
    this.assistantBufferByRunner = new Map();
    this.userMessageByRunner = new Map();
    this.stepIndexByRunner = new Map();
    this.roundIndexByRunner = new Map();
    this.structuredEventSeq = 0;

    for (const conv of this.conversations) {
      this.runtimeStore.ensure(conv.id);
      this.metaByConversation[conv.id] = {
        'Codex版本': '-',
        '模型': '-',
        '会话ID': conv.sessionId || '-',
      };
    }

    if (renamedFromTest) {
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
