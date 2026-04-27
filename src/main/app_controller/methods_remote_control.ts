const { getConversation, sortedConversations } = require('../conversation_service');
const { RemoteControlCenter } = require('../remote_control_bridge');
const { normalizeRemoteControlSettings } = require('../state_store');

const remoteControlMethods = {
  _remoteControlHandlers() {
    return {
      updateState: async (patch = {}) => this._updateRemoteControlTelegramState(patch),
      listConversations: async (page = 1, pageSize = 10) => this._listRemoteControlConversations(page, pageSize),
      getSelectedConversation: async (chatId, options = {}) => this._getRemoteControlSelectedConversation(chatId, options),
      getConversationHistory: async (chatId, limit = 8) => this._getRemoteControlConversationHistory(chatId, limit),
      selectConversation: async (chatId, ref) => this._selectRemoteControlConversation(chatId, ref),
      createConversation: async (chatId) => this._createRemoteControlConversation(chatId),
      stopCurrentConversation: async (chatId) => this._stopRemoteControlConversation(chatId),
      sendMessageToSelectedConversation: async (chatId, text) => this._sendRemoteControlMessage(chatId, text),
    };
  },

  _syncRemoteControlCenter() {
    const normalizedRemoteControl = normalizeRemoteControlSettings(this.remoteControl);
    this.remoteControl = normalizedRemoteControl;
    if (!this.remoteControlCenter) {
      this.remoteControlCenter = new RemoteControlCenter({
        settings: normalizedRemoteControl,
        deviceIdentity: this.deviceIdentity,
        handlers: this._remoteControlHandlers(),
      });
      return this.remoteControlCenter;
    }
    this.remoteControlCenter.updateConfig({
      settings: normalizedRemoteControl,
      deviceIdentity: this.deviceIdentity,
      handlers: this._remoteControlHandlers(),
    });
    return this.remoteControlCenter;
  },

  _remoteControlConversationEntries() {
    return sortedConversations(this.conversations).map((conv) => {
      const runtime = this.runtimeStore.ensure(conv.id);
      return {
        id: conv.id,
        sessionId: String(conv.sessionId || '').trim(),
        displayId: String(conv.sessionId || conv.id || '').trim(),
        title: conv.title,
        phase: String(runtime?.phase || '空闲').trim() || '空闲',
        queuedCount: this._pendingQueueSize(conv.id),
        updatedAt: Number(conv.updatedAt || 0) || 0,
      };
    });
  },

  _resolveRemoteControlConversationRef(ref) {
    const raw = String(ref || '').trim();
    if (!raw) {
      return null;
    }
    const entries = this._remoteControlConversationEntries();
    const exact = entries.find((item) => item.id === raw);
    if (exact) {
      return exact;
    }
    const byDisplayId = entries.find((item) => item.displayId === raw);
    if (byDisplayId) {
      return byDisplayId;
    }
    const index = Number(raw);
    if (Number.isInteger(index) && index >= 1 && index <= entries.length) {
      return entries[index - 1];
    }
    return null;
  },

  async _updateRemoteControlTelegramState(patch = {}) {
    const control = normalizeRemoteControlSettings(this.remoteControl);
    control.telegram = {
      ...control.telegram,
      ...(patch && typeof patch === 'object' ? patch : {}),
    };
    this.remoteControl = control;
    this._syncRemoteControlCenter();
    this._schedulePersist(40);
    return control.telegram;
  },

  _getRemoteControlSelectedConversationId(chatId, { allowFallback = false } = {}) {
    const normalizedChatId = String(chatId || '').trim();
    const control = normalizeRemoteControlSettings(this.remoteControl);
    const selectedMap = control.telegram.selectedConversationByChat || {};
    const selectedId = String(selectedMap[normalizedChatId] || '').trim();
    if (selectedId && getConversation(this.conversations, selectedId)) {
      return selectedId;
    }
    if (!allowFallback) {
      return '';
    }
    const activeId = String(this.activeConversationId || '').trim();
    if (activeId && getConversation(this.conversations, activeId)) {
      return activeId;
    }
    return '';
  },

  async _bindRemoteControlConversation(chatId, conversationId) {
    const normalizedChatId = String(chatId || '').trim();
    const normalizedConversationId = String(conversationId || '').trim();
    if (!normalizedChatId || !normalizedConversationId) {
      return false;
    }
    const control = normalizeRemoteControlSettings(this.remoteControl);
    control.telegram.selectedConversationByChat = {
      ...(control.telegram.selectedConversationByChat || {}),
      [normalizedChatId]: normalizedConversationId,
    };
    this.remoteControl = control;
    this._syncRemoteControlCenter();
    this._schedulePersist(30);
    return true;
  },

  async _getRemoteControlSelectedConversation(chatId, { allowFallback = false } = {}) {
    const conversationId = this._getRemoteControlSelectedConversationId(chatId, { allowFallback });
    if (!conversationId) {
      return null;
    }
    const conv = getConversation(this.conversations, conversationId);
    if (!conv) {
      return null;
    }
    if (allowFallback) {
      await this._bindRemoteControlConversation(chatId, conversationId);
    }
    const runtime = this.runtimeStore.ensure(conversationId);
    return {
      conversationId: conv.id,
      displayId: String(conv.sessionId || conv.id || '').trim(),
      title: conv.title,
      phase: String(runtime?.phase || '空闲').trim() || '空闲',
      queuedCount: this._pendingQueueSize(conv.id),
    };
  },

  async _listRemoteControlConversations(page = 1, pageSize = 10) {
    const entries = this._remoteControlConversationEntries();
    const resolvedPageSize = Math.max(1, Math.min(20, Number(pageSize) || 10));
    const total = entries.length;
    const totalPages = Math.max(1, Math.ceil(total / resolvedPageSize));
    const resolvedPage = Math.max(1, Math.min(totalPages, Number(page) || 1));
    const startIndex = (resolvedPage - 1) * resolvedPageSize;
    return {
      items: entries.slice(startIndex, startIndex + resolvedPageSize),
      total,
      page: resolvedPage,
      pageSize: resolvedPageSize,
      totalPages,
    };
  },

  async _selectRemoteControlConversation(chatId, ref) {
    const matched = this._resolveRemoteControlConversationRef(ref);
    if (!matched) {
      return { ok: false, error: '未找到对应对话。先使用 /list 查看可选项。' };
    }
    await this._bindRemoteControlConversation(chatId, matched.id);
    return {
      ok: true,
      conversationId: matched.id,
      displayId: matched.displayId,
      title: matched.title,
    };
  },

  async _createRemoteControlConversation(chatId) {
    const snapshot = this.createConversation();
    const conversationId = String(snapshot?.activeConversationId || this.activeConversationId || '').trim();
    const conv = getConversation(this.conversations, conversationId);
    if (!conversationId || !conv) {
      return { ok: false, error: '新建对话失败' };
    }
    await this._bindRemoteControlConversation(chatId, conversationId);
    return {
      ok: true,
      conversationId,
      displayId: String(conv.sessionId || conv.id || '').trim(),
      title: conv.title,
    };
  },

  async _stopRemoteControlConversation(chatId) {
    const selected = await this._getRemoteControlSelectedConversation(chatId, { allowFallback: true });
    if (!selected?.conversationId) {
      return { ok: false, error: '当前未绑定对话。使用 /list 或 /new。' };
    }
    this.stopConversation(selected.conversationId);
    return {
      ok: true,
      conversationId: selected.conversationId,
      displayId: selected.displayId,
      title: selected.title,
    };
  },

  _buildRemoteControlConversationTurns(messages = []) {
    const turns = [];
    let currentTurn = null;
    messages.forEach((item) => {
      const role = item?.role === 'assistant' ? 'assistant' : 'user';
      const text = String(item?.text || '').trim();
      if (!text) {
        return;
      }
      if (role === 'user') {
        currentTurn = {
          userText: text,
          assistantParts: [],
        };
        turns.push(currentTurn);
        return;
      }
      if (!currentTurn) {
        currentTurn = {
          userText: '',
          assistantParts: [],
        };
        turns.push(currentTurn);
      }
      currentTurn.assistantParts.push(text);
    });
    return turns.map((turn) => ({
      userText: String(turn?.userText || '').trim(),
      assistantText: Array.isArray(turn?.assistantParts) ? turn.assistantParts.join('\n\n').trim() : '',
    }));
  },

  async _getRemoteControlConversationHistory(chatId, limit = 8) {
    const selected = await this._getRemoteControlSelectedConversation(chatId, { allowFallback: true });
    if (!selected?.conversationId) {
      return { ok: false, error: '当前未绑定对话。使用 /list 查看对话，或 /new 新建一个。' };
    }
    const conv = getConversation(this.conversations, selected.conversationId);
    if (!conv) {
      return { ok: false, error: '未找到对应对话。先使用 /list 查看可选项。' };
    }
    const resolvedLimit = Math.max(1, Math.min(10, Number(limit) || 2));
    const messages = Array.isArray(conv.messages) ? conv.messages : [];
    const turns = this._buildRemoteControlConversationTurns(messages);
    return {
      ok: true,
      conversationId: conv.id,
      displayId: String(conv.sessionId || conv.id || '').trim(),
      title: conv.title,
      total: turns.length,
      items: turns.slice(-resolvedLimit).reverse(),
    };
  },

  async _sendRemoteControlMessage(chatId, text) {
    const existingSelectedId = this._getRemoteControlSelectedConversationId(chatId, { allowFallback: false });
    const selected = await this._getRemoteControlSelectedConversation(chatId, { allowFallback: true });
    if (!selected?.conversationId) {
      return { ok: false, error: '当前未绑定对话。使用 /list 查看会话，或 /new 新建一个。' };
    }
    const result = await this.sendMessage({
      conversationId: selected.conversationId,
      text,
    });
    if (result?.error) {
      return { ok: false, error: String(result.error || '发送失败') };
    }
    return {
      ok: true,
      conversationId: selected.conversationId,
      displayId: selected.displayId,
      title: selected.title,
      queued: Boolean(result?.queued),
      autoBound: !existingSelectedId,
    };
  },

};

module.exports = {
  remoteControlMethods,
};
