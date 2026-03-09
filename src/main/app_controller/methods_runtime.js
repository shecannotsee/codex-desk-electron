const { nowTs, newConversation, getConversation, sortedConversations } = require('../conversation_service');
const { normalizePreview, tsLabel } = require('./shared');

const runtimeMethods = {
  _emit(event) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }
    this.mainWindow.webContents.send('app:event', event);
  },

  _persist() {
    this.stateStore.save({
      commandText: this.commandText,
      workdir: this.workdir,
      useNativeMemory: this.useNativeMemory,
      activeConversationId: this.activeConversationId,
      conversations: this.conversations,
    });
  },

  _ensureMeta(conversationId) {
    if (!this.metaByConversation[conversationId]) {
      this.metaByConversation[conversationId] = {
        'Codex版本': '-',
        '模型': '-',
        '会话ID': '-',
      };
    }
    return this.metaByConversation[conversationId];
  },

  _isConversationRunning(conversationId) {
    if (!conversationId) {
      return false;
    }
    return this.runners.has(conversationId);
  },

  _anyConversationRunning() {
    return this.runners.size > 0;
  },

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
      return {
        id: `q-${conversationId}-${queuedAt || Date.now()}-${index + 1}`,
        index: index + 1,
        text: rawText,
        preview: normalizePreview(rawText, 200),
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
      appendUserMessage: Boolean(next.appendUserMessage),
      forceFreshSession: Boolean(next.forceFreshSession),
      fromRetry: Boolean(next.fromRetry),
    }).then((result) => {
      if (result?.error) {
        this._appendStructuredEvent(conversationId, 'error', `排队消息启动失败: ${result.error}`);
      }
    }).catch((error) => {
      this._appendStructuredEvent(conversationId, 'error', `排队消息启动异常: ${error?.message || String(error)}`);
    });
  },

  _syncConversationUpdated(conversation) {
    this._emit({ type: 'conversation-updated', conversation });
  },

  _setPhase(conversationId, phase) {
    const runtime = this.runtimeStore.ensure(conversationId);
    runtime.phase = phase;
    this._emit({ type: 'runtime-phase', conversationId, phase });
  },

  _appendStructuredEvent(conversationId, level, message) {
    this.structuredEventSeq += 1;
    const runtime = this.runtimeStore.ensure(conversationId);
    const item = {
      id: `evt-${Date.now()}-${this.structuredEventSeq}`,
      level,
      message: String(message || ''),
      timestamp: tsLabel(),
    };
    runtime.events.push(item);
    this._emit({ type: 'runtime-event-append', conversationId, item });
  },

  _appendWorkflowRoundHeader(conversationId, roundIndex, userText) {
    const runtime = this.runtimeStore.ensure(conversationId);
    const item = {
      type: 'round',
      roundIndex,
      preview: normalizePreview(userText),
      timestamp: tsLabel(),
    };
    runtime.workflow.push(item);
    this._emit({ type: 'runtime-workflow-append', conversationId, item });
  },

  _appendWorkflowStep(conversationId, stepText) {
    const text = String(stepText || '').trim();
    if (!text) {
      return;
    }

    let title = '步骤';
    let body = text;
    let roundIndex = 0;
    let stepIndex = 0;

    let match = /^R(\d+)-S(\d+)\.\s*([\s\S]+)$/.exec(text);
    if (match) {
      roundIndex = Number(match[1]);
      stepIndex = Number(match[2]);
      title = `R${roundIndex}-S${stepIndex}`;
      body = String(match[3]).trim();
    } else {
      match = /^(\d+)\.\s*([\s\S]+)$/.exec(text);
      if (match) {
        stepIndex = Number(match[1]);
        title = `步骤 ${stepIndex}`;
        body = String(match[2]).trim();
      }
    }

    let tag = 'INFO';
    if (body.startsWith('思考:')) {
      tag = 'THINK';
    } else if (body.includes('执行命令:')) {
      tag = 'RUN';
    } else if (body.includes('命令执行完成')) {
      tag = 'DONE';
    } else if (body.startsWith('请求')) {
      tag = 'ROUND';
    }

    const runtime = this.runtimeStore.ensure(conversationId);
    const item = {
      type: 'step',
      roundIndex,
      stepIndex,
      title,
      tag,
      body,
      timestamp: tsLabel(),
    };
    runtime.workflow.push(item);
    this._emit({ type: 'runtime-workflow-append', conversationId, item });
  },

  _appendRawJsonLine(conversationId, line) {
    if (!String(line || '').trimStart().startsWith('{')) {
      return;
    }
    const runtime = this.runtimeStore.ensure(conversationId);
    runtime.raw.push(line);
    this._emit({ type: 'runtime-raw-append', conversationId, line });
  },

  _setStartedAt(conversationId, startedAt) {
    const runtime = this.runtimeStore.ensure(conversationId);
    runtime.startedAt = startedAt;
    this._emit({ type: 'runtime-started-at', conversationId, startedAt });
  },

  _buildLocalPrompt(conversation) {
    const lines = ['请继续下面的中文对话，保持简洁准确。', ''];
    const history = Array.isArray(conversation.messages) ? conversation.messages.slice(-20) : [];
    for (const item of history) {
      const roleName = item.role === 'user' ? '用户' : '助手';
      lines.push(`${roleName}: ${item.text}`);
    }
    lines.push('\n请直接回复下一句助手内容。');
    return lines.join('\n');
  },

  _releaseRunner(conversationId, runner) {
    const mapped = this.runners.get(conversationId);
    if (mapped === runner) {
      this.runners.delete(conversationId);
      this._emit({ type: 'runner-state', conversationId, running: false });
    }

    this.assistantBufferByRunner.delete(runner);
    this.userMessageByRunner.delete(runner);
    this.stepIndexByRunner.delete(runner);
    this.roundIndexByRunner.delete(runner);
  },

  _markRunnerUserMessageInterrupted(runner, reason = 'user-stop') {
    if (!runner) {
      return false;
    }
    const target = this.userMessageByRunner.get(runner);
    if (!target || typeof target !== 'object') {
      return false;
    }
    const conversationId = String(target.conversationId || '');
    const message = target.message;
    if (!message || message.role !== 'user') {
      return false;
    }
    if (message.interrupted) {
      return false;
    }

    message.interrupted = true;
    message.interruptedReason = String(reason || 'user-stop');
    message.interruptedAt = nowTs();

    const conv = getConversation(this.conversations, conversationId);
    if (conv) {
      conv.updatedAt = nowTs();
      this._syncConversationUpdated(conv);
    }
    return true;
  },

  snapshot() {
    return {
      settings: {
        commandText: this.commandText,
        workdir: this.workdir,
        useNativeMemory: this.useNativeMemory,
      },
      activeConversationId: this.activeConversationId,
      conversations: sortedConversations(this.conversations),
      runtimeByConversation: this.runtimeStore.toObject(),
      metaByConversation: this.metaByConversation,
      runningConversationIds: Array.from(this.runners.keys()),
      queuedCountByConversation: this._queuedCountSnapshot(),
      queuedMessagesByConversation: this._queuedMessagesSnapshot(),
    };
  },

  runningConversationCount() {
    return this.runners.size;
  },

  stopAllRunningConversations() {
    const ids = Array.from(this.runners.keys());
    let markedAny = false;
    for (const id of ids) {
      const runner = this.runners.get(id);
      if (!runner) {
        continue;
      }
      if (this._markRunnerUserMessageInterrupted(runner, 'app-closing')) {
        markedAny = true;
      }
      runner.stop();
      this._appendStructuredEvent(id, 'warn', '应用正在关闭，已请求停止当前对话任务');
    }
    if (markedAny) {
      this._persist();
    }
    return ids.length;
  },

  updateSettings(input) {
    if (typeof input.commandText === 'string') {
      this.commandText = input.commandText;
    }
    if (typeof input.workdir === 'string') {
      this.workdir = input.workdir;
    }
    this.useNativeMemory = true;
    this._persist();
    return this.snapshot();
  },

  switchConversation(conversationId) {
    const target = getConversation(this.conversations, conversationId);
    if (!target) {
      return this.snapshot();
    }
    if (target.id !== this.activeConversationId) {
      this.activeConversationId = target.id;
      this._persist();
    }
    return this.snapshot();
  },

  createConversation() {
    const conv = newConversation();
    this.conversations.push(conv);
    this.runtimeStore.ensure(conv.id);
    this._ensureMeta(conv.id);

    this.activeConversationId = conv.id;
    this._appendStructuredEvent(conv.id, 'success', `已新建对话: ${conv.title}`);
    this._persist();
    this._autoRefreshMetaForConversation(conv.id);
    return this.snapshot();
  },

  async _autoRefreshMetaForConversation(conversationId) {
    const id = String(conversationId || '').trim();
    if (!id) {
      return;
    }

    try {
      const versionResult = this.refreshCodexVersion(id);
      if (versionResult?.error) {
        this._appendStructuredEvent(id, 'warn', `自动获取 Codex 版本失败: ${versionResult.error}`);
      }
    } catch (error) {
      this._appendStructuredEvent(id, 'warn', `自动获取 Codex 版本异常: ${error?.message || String(error)}`);
    }

    try {
      const modelResult = await this.refreshModelInfo(id);
      if (modelResult?.error) {
        this._appendStructuredEvent(id, 'warn', `自动获取模型失败: ${modelResult.error}`);
      }
    } catch (error) {
      this._appendStructuredEvent(id, 'warn', `自动获取模型异常: ${error?.message || String(error)}`);
    }
  },

  renameConversation(conversationId, title) {
    const conv = getConversation(this.conversations, conversationId || this.activeConversationId);
    if (!conv) {
      return { error: '会话不存在', snapshot: this.snapshot() };
    }
    const nextTitle = String(title || '').trim();
    if (!nextTitle) {
      return { error: '会话名称不能为空', snapshot: this.snapshot() };
    }
    conv.title = nextTitle;
    conv.updatedAt = nowTs();
    this._syncConversationUpdated(conv);
    this._appendStructuredEvent(conv.id, 'hint', `已重命名对话: ${nextTitle}`);
    this._persist();
    return this.snapshot();
  },
};

module.exports = {
  runtimeMethods,
};
