const { getConversation } = require('../conversation_service');
const { normalizePreview } = require('./shared');

const runtimeQueueMethods = {
  _getPendingQueue(conversationId) {
    if (!this.pendingQueueByConversation.has(conversationId)) {
      this.pendingQueueByConversation.set(conversationId, []);
    }
    return this.pendingQueueByConversation.get(conversationId);
  },

  _pendingQueueSize(conversationId) {
    return this._getPendingQueue(conversationId).length;
  },

  _queuedCountSnapshot() {
    const map = {};
    for (const conv of this.conversations) {
      map[conv.id] = this._pendingQueueSize(conv.id);
    }
    return map;
  },

  _queuedItemsForUi(conversationId) {
    const queue = this._getPendingQueue(conversationId);
    return queue.map((item, index) => {
      const rawText = String(item?.text || '');
      const queuedAt = Number(item?.queuedAt || 0);
      const queuedMessageId = String(item?.id || '').trim();
      return {
        id: queuedMessageId || `q-${conversationId}-${queuedAt || Date.now()}-${index + 1}`,
        index: index + 1,
        text: rawText,
        preview: normalizePreview(rawText, 200),
        attachments: Array.isArray(item?.attachments) ? item.attachments : [],
        goalMode: Boolean(item?.goalMode),
        queuedAt,
        fromRetry: Boolean(item?.fromRetry),
      };
    });
  },

  _queuedMessagesSnapshot() {
    const map = {};
    for (const conv of this.conversations) {
      map[conv.id] = this._queuedItemsForUi(conv.id);
    }
    return map;
  },

  _emitQueueUpdated(conversationId) {
    this._emit({
      type: 'queue-updated',
      conversationId,
      count: this._pendingQueueSize(conversationId),
      items: this._queuedItemsForUi(conversationId),
    });
  },

  cancelQueuedMessage(conversationId, queuedMessageId, queuedIndex) {
    const id = String(conversationId || this.activeConversationId || '').trim();
    if (!id) {
      return { error: '请先新建对话。', snapshot: this.snapshot() };
    }
    const queue = this._getPendingQueue(id);
    if (!queue.length) {
      return { error: '当前没有排队消息。', snapshot: this.snapshot() };
    }

    const targetMessageId = String(queuedMessageId || '').trim();
    let targetIndex = targetMessageId
      ? queue.findIndex((item) => String(item?.id || '').trim() === targetMessageId)
      : -1;
    if (targetIndex < 0) {
      const fallbackIndex = Number(queuedIndex);
      if (Number.isInteger(fallbackIndex) && fallbackIndex > 0 && fallbackIndex <= queue.length) {
        targetIndex = fallbackIndex - 1;
      }
    }
    if (targetIndex < 0 || targetIndex >= queue.length) {
      return { error: '未找到要撤销的排队消息。', snapshot: this.snapshot() };
    }

    const [removed] = queue.splice(targetIndex, 1);
    this._emitQueueUpdated(id);
    if (removed && String(removed.text || '').trim()) {
      this._appendStructuredEvent(
        id,
        'hint',
        `已撤销排队消息: ${normalizePreview(String(removed.text || ''), 120)}`,
      );
    } else {
      this._appendStructuredEvent(id, 'hint', '已撤销一条排队消息');
    }
    this._persist();
    return { ok: true, snapshot: this.snapshot() };
  },

  cancelAllQueuedMessages(conversationId) {
    const id = String(conversationId || this.activeConversationId || '').trim();
    if (!id) {
      return { error: '请先新建对话。', snapshot: this.snapshot() };
    }
    const queue = this._getPendingQueue(id);
    if (!queue.length) {
      return { error: '当前没有排队消息。', snapshot: this.snapshot() };
    }

    const removedCount = queue.length;
    queue.length = 0;
    this._emitQueueUpdated(id);
    this._appendStructuredEvent(id, 'hint', `已撤销全部排队消息（${removedCount} 条）`);
    this._persist();
    return { ok: true, snapshot: this.snapshot() };
  },

  _startNextQueuedMessage(conversationId) {
    if (!conversationId || this._isConversationRunning(conversationId)) {
      return;
    }
    const conv = getConversation(this.conversations, conversationId);
    if (!conv) {
      return;
    }

    const queue = this._getPendingQueue(conversationId);
    if (!queue.length) {
      return;
    }

    const next = queue.shift();
    this._emitQueueUpdated(conversationId);

    if (!next || !String(next.text || '').trim()) {
      return;
    }

    if (queue.length > 0) {
      this._appendStructuredEvent(
        conversationId,
        'hint',
        `开始处理排队消息（剩余 ${queue.length} 条）`,
      );
    } else {
      this._appendStructuredEvent(conversationId, 'hint', '开始处理排队消息');
    }

    this.sendMessage({
      conversationId,
      text: String(next.text || ''),
      attachments: Array.isArray(next.attachments) ? next.attachments : [],
      appendUserMessage: Boolean(next.appendUserMessage),
      forceFreshSession: Boolean(next.forceFreshSession),
      fromRetry: Boolean(next.fromRetry),
      goalMode: Boolean(next.goalMode),
    }).then((result) => {
      if (result?.error) {
        this._appendStructuredEvent(conversationId, 'error', `排队消息启动失败: ${result.error}`);
      }
    }).catch((error) => {
      this._appendStructuredEvent(conversationId, 'error', `排队消息启动异常: ${error?.message || String(error)}`);
    });
  },
};

module.exports = {
  runtimeQueueMethods,
};
