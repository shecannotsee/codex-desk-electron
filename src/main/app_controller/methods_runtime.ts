const { nowTs, newConversation, getConversation, sortedConversations } = require('../conversation_service');
const { importSessionJsonl } = require('../session_importer');
const { buildExportFileName, exportConversationJsonl } = require('../session_exporter');
const { normalizeWorkdir } = require('../state_store');
const { normalizePreview, tsLabel } = require('./shared');
const fs = require('node:fs');

function isCompletedPhase(phaseText) {
  const text = String(phaseText || '').trim().toLowerCase();
  if (!text) {
    return false;
  }
  return ['已完成', '完成', 'completed', 'success', 'done'].some((item) => text.includes(item));
}

const runtimeMethods = {
  _emit(event) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }
    this.mainWindow.webContents.send('app:event', event);
  },

  _persist() {
    this.stateStorage.saveState({
      commandText: this.commandText,
      workdir: this.workdir,
      useNativeMemory: this.useNativeMemory,
      activeConversationId: this.activeConversationId,
      conversations: this.conversations,
      metaByConversation: this.metaByConversation,
    });
  },

  _defaultWorkdir() {
    return normalizeWorkdir('');
  },

  _resolveConversationWorkdir(conversationId) {
    const conv = getConversation(this.conversations, conversationId);
    return normalizeWorkdir(conv?.workdir || this._defaultWorkdir());
  },

  _ensureMeta(conversationId) {
    if (!this.metaByConversation[conversationId]) {
      this.metaByConversation[conversationId] = {
        'Codex版本': '-',
        '模型': '-',
        '会话ID': '-',
        '输入Tokens': '-',
        '缓存输入Tokens': '-',
        '输出Tokens': '-',
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
        attachments: Array.isArray(item?.attachments) ? item.attachments : [],
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
      attachments: Array.isArray(next.attachments) ? next.attachments : [],
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

  _appendStructuredAssistantUpdate(conversationId, text) {
    const body = String(text || '').trim();
    if (!body) {
      return;
    }
    this.structuredEventSeq += 1;
    const runtime = this.runtimeStore.ensure(conversationId);
    const item = {
      id: `evt-${Date.now()}-${this.structuredEventSeq}`,
      level: 'info',
      kind: 'assistant-update',
      body,
      message: `运行中回复: ${normalizePreview(body, 180)}`,
      timestamp: tsLabel(),
    };
    runtime.events.push(item);
    this._emit({ type: 'runtime-event-append', conversationId, item });
  },

  _removeLastStructuredEventIf(conversationId, predicate) {
    const runtime = this.runtimeStore.ensure(conversationId);
    if (typeof predicate !== 'function') {
      return false;
    }
    let targetIndex = -1;
    for (let index = runtime.events.length - 1; index >= 0; index -= 1) {
      const item = runtime.events[index];
      if (predicate(item)) {
        targetIndex = index;
        break;
      }
    }
    if (targetIndex < 0) {
      return false;
    }
    runtime.events.splice(targetIndex, 1);
    this._emit({ type: 'runtime-event-pop', conversationId, index: targetIndex });
    return true;
  },

  _appendWorkflowRoundHeader(conversationId, roundIndex, userText) {
    const runtime = this.runtimeStore.ensure(conversationId);
    const item = {
      type: 'round',
      channel: 'progress',
      importance: 'high',
      sourceKind: 'request',
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
    let channel = 'progress';
    let importance = 'normal';
    let sourceKind = 'task';
    if (body.startsWith('思考:')) {
      tag = 'THINK';
      importance = 'high';
      sourceKind = 'reasoning';
    } else if (body.includes('执行命令:')) {
      tag = 'RUN';
      channel = 'detail';
      importance = 'low';
      sourceKind = 'command';
    } else if (body.includes('命令执行完成')) {
      tag = 'DONE';
      channel = 'detail';
      importance = 'low';
      sourceKind = 'command';
    } else if (body.startsWith('开始处理 ')) {
      tag = 'START';
      channel = 'detail';
      importance = 'low';
      sourceKind = 'item';
    } else if (body.startsWith('处理完成 ')) {
      tag = 'DONE';
      channel = 'detail';
      importance = 'low';
      sourceKind = 'item';
    } else if (body.startsWith('请求')) {
      tag = 'ROUND';
      importance = 'high';
      sourceKind = 'request';
    }

    const runtime = this.runtimeStore.ensure(conversationId);
    const item = {
      type: 'step',
      roundIndex,
      stepIndex,
      title,
      tag,
      channel,
      importance,
      sourceKind,
      body,
      timestamp: tsLabel(),
    };
    runtime.workflow.push(item);
    this._emit({ type: 'runtime-workflow-append', conversationId, item });
  },

  _appendWorkflowAssistantMessage(conversationId, roundIndex, text, status = 'success') {
    const body = String(text || '').trim();
    if (!body) {
      return;
    }
    const runtime = this.runtimeStore.ensure(conversationId);
    const item = {
      type: 'assistant',
      roundIndex: Number(roundIndex || 0),
      stepIndex: 999,
      title: status === 'running' ? 'assistant-update' : 'assistant-reply',
      tag: 'REPLY',
      channel: status === 'running' ? 'status' : 'progress',
      importance: 'high',
      sourceKind: 'assistant',
      body,
      status,
      timestamp: tsLabel(),
    };
    runtime.workflow.push(item);
    this._emit({ type: 'runtime-workflow-append', conversationId, item });
  },

  _appendWorkflowAssistantUpdate(conversationId, roundIndex, text) {
    this._appendWorkflowAssistantMessage(conversationId, roundIndex, text, 'running');
  },

  _appendWorkflowAssistantReply(conversationId, roundIndex, text) {
    this._appendWorkflowAssistantMessage(conversationId, roundIndex, text, 'success');
  },

  _removeLastWorkflowItemIf(conversationId, predicate) {
    const runtime = this.runtimeStore.ensure(conversationId);
    if (typeof predicate !== 'function') {
      return false;
    }
    let targetIndex = -1;
    for (let index = runtime.workflow.length - 1; index >= 0; index -= 1) {
      const item = runtime.workflow[index];
      if (predicate(item)) {
        targetIndex = index;
        break;
      }
    }
    if (targetIndex < 0) {
      return false;
    }
    runtime.workflow.splice(targetIndex, 1);
    this._emit({ type: 'runtime-workflow-pop', conversationId, index: targetIndex });
    return true;
  },

  _appendRawJsonLine(conversationId, payload, direction = 'received') {
    const rawText = typeof payload === 'string'
      ? payload
      : String(payload?.line || '');
    if (!String(rawText || '').trimStart().startsWith('{')) {
      return;
    }
    const normalizedDirection = typeof payload === 'object' && payload
      ? String(payload.direction || direction || 'received').trim().toLowerCase() || 'received'
      : String(direction || 'received').trim().toLowerCase() || 'received';
    const item = {
      direction: normalizedDirection === 'sent' ? 'sent' : 'received',
      line: rawText,
      timestamp: tsLabel(),
    };
    const runtime = this.runtimeStore.ensure(conversationId);
    runtime.raw.push(item);
    this._emit({ type: 'runtime-raw-append', conversationId, line: item });
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

    const previewState = this.assistantStreamPreviewByRunner.get(runner);
    if (previewState?.timer) {
      clearTimeout(previewState.timer);
    }
    this.assistantBufferByRunner.delete(runner);
    this.assistantStreamPreviewByRunner.delete(runner);
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
    const activeWorkdir = this.activeConversationId
      ? this._resolveConversationWorkdir(this.activeConversationId)
      : this._defaultWorkdir();
    return {
      settings: {
        commandText: this.commandText,
        workdir: activeWorkdir,
        defaultWorkdir: this._defaultWorkdir(),
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
      this.workdir = normalizeWorkdir(input.workdir);
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
    const runtime = this.runtimeStore.ensure(target.id);
    if (!this._isConversationRunning(target.id) && this._pendingQueueSize(target.id) <= 0 && isCompletedPhase(runtime.phase)) {
      runtime.phase = '空闲';
      this._emit({ type: 'runtime-phase', conversationId: target.id, phase: runtime.phase });
    }
    if (target.id !== this.activeConversationId) {
      this.activeConversationId = target.id;
      this._persist();
    }
    return this.snapshot();
  },

  createConversation(options: { workdir?: string } = {}) {
    const conv = newConversation();
    const selectedWorkdir = typeof options.workdir === 'string' ? options.workdir : '';
    conv.workdir = normalizeWorkdir(selectedWorkdir || this._defaultWorkdir());
    this.conversations.push(conv);
    this.runtimeStore.ensure(conv.id);
    this._ensureMeta(conv.id);

    this.activeConversationId = conv.id;
    this._appendStructuredEvent(conv.id, 'success', `已新建对话: ${conv.title}`);
    this._appendStructuredEvent(conv.id, 'hint', `工作目录: ${conv.workdir}`);
    this._persist();
    this._autoRefreshMetaForConversation(conv.id);
    return this.snapshot();
  },

  previewConversationImportFromSessionFile(filePath) {
    const imported = importSessionJsonl(filePath);
    const importedCwd = String(imported.cwd || '').trim();
    return {
      filePath: imported.filePath,
      title: imported.title,
      sessionId: imported.sessionId || '',
      source: imported.source,
      originator: imported.originator,
      cwd: importedCwd,
      hasImportedWorkdir: Boolean(importedCwd && fs.existsSync(importedCwd) && fs.statSync(importedCwd).isDirectory()),
      model: imported.model || '-',
      cliVersion: imported.cliVersion || '-',
    };
  },

  importConversationFromSessionFile(filePath, { continuationMode = 'resume', workdirMode = 'default', workdir = '' } = {}) {
    const imported = importSessionJsonl(filePath);
    const conv = newConversation(imported.title);
    const importedCwd = String(imported.cwd || '').trim();
    if (workdirMode === 'imported') {
      if (!importedCwd) {
        return { error: '导入文件未提供可用的原工作目录。', snapshot: this.snapshot() };
      }
      if (!fs.existsSync(importedCwd) || !fs.statSync(importedCwd).isDirectory()) {
        return { error: `导入文件中的原工作目录不可用:\n${importedCwd}`, snapshot: this.snapshot() };
      }
      conv.workdir = normalizeWorkdir(importedCwd);
    } else if (workdirMode === 'custom') {
      const customWorkdir = normalizeWorkdir(workdir);
      if (!customWorkdir) {
        return { error: '请选择导入后的新工作目录。', snapshot: this.snapshot() };
      }
      if (!fs.existsSync(customWorkdir) || !fs.statSync(customWorkdir).isDirectory()) {
        return { error: `手动选择的工作目录不可用:\n${customWorkdir}`, snapshot: this.snapshot() };
      }
      conv.workdir = customWorkdir;
    } else {
      conv.workdir = this._defaultWorkdir();
    }
    conv.sessionId = imported.sessionId || '';
    conv.sessionContinuationMode = conv.sessionId
      ? (continuationMode === 'fork' ? 'fork' : 'resume')
      : '';
    conv.messages = imported.messages;
    conv.createdAt = Number(imported.createdAt || nowTs());
    conv.updatedAt = Number(imported.updatedAt || conv.createdAt);

    this.conversations.push(conv);
    this.runtimeStore.ensure(conv.id);

    const meta = this._ensureMeta(conv.id);
    meta['Codex版本'] = imported.cliVersion || '-';
    meta['模型'] = imported.model || '-';
    meta['会话ID'] = conv.sessionId || '-';

    this.activeConversationId = conv.id;
    this._appendStructuredEvent(conv.id, 'success', `已导入会话: ${conv.title}`);
    this._appendStructuredEvent(conv.id, 'hint', `来源: ${imported.source} / ${imported.originator}`);
    this._appendStructuredEvent(conv.id, 'hint', `原工作目录: ${importedCwd || '-'}`);
    this._appendStructuredEvent(
      conv.id,
      'hint',
      workdirMode === 'imported'
        ? `导入工作目录: 使用导入文件目录 ${conv.workdir}`
        : workdirMode === 'custom'
          ? `导入工作目录: 使用手动选择的新目录 ${conv.workdir}`
          : `导入工作目录: 使用默认目录 ${conv.workdir}`,
    );
    this._appendStructuredEvent(conv.id, 'hint', `导入文件: ${imported.filePath}`);
    if (conv.sessionId) {
      this._appendStructuredEvent(
        conv.id,
        'hint',
        conv.sessionContinuationMode === 'fork'
          ? '导入后继续方式: 分叉为新会话（fork）'
          : '导入后继续方式: 继续原会话（resume）',
      );
    }
    this._persist();

    return {
      snapshot: this.snapshot(),
      imported: {
        conversationId: conv.id,
        title: conv.title,
        sessionId: conv.sessionId || '',
        continuationMode: conv.sessionContinuationMode || '',
      },
    };
  },

  previewConversationExport(conversationId) {
    const conv = getConversation(this.conversations, conversationId || this.activeConversationId);
    if (!conv) {
      throw new Error('会话不存在');
    }
    const messages = Array.isArray(conv.messages)
      ? conv.messages.filter((item) => item && String(item.text || '').trim())
      : [];
    if (!messages.length) {
      throw new Error('当前会话没有可导出的消息');
    }
    return {
      conversationId: conv.id,
      title: conv.title,
      sessionId: String(conv.sessionId || '').trim(),
      suggestedFileName: buildExportFileName(conv),
      messageCount: messages.length,
    };
  },

  exportConversationToSessionFile(conversationId, filePath) {
    const conv = getConversation(this.conversations, conversationId || this.activeConversationId);
    if (!conv) {
      return { error: '会话不存在', snapshot: this.snapshot() };
    }

    try {
      const meta = this._ensureMeta(conv.id);
      const exported = exportConversationJsonl(
        filePath,
        conv,
        {
          model: meta['模型'],
          cliVersion: meta['Codex版本'],
        },
        {
          workdir: conv.workdir || this._defaultWorkdir(),
        },
      );
      return {
        snapshot: this.snapshot(),
        exported: {
          conversationId: conv.id,
          title: conv.title,
          filePath: exported.filePath,
          fileName: exported.fileName,
          messageCount: exported.messageCount,
          sessionId: exported.sessionId || '',
        },
      };
    } catch (error) {
      return {
        error: `导出会话失败: ${error?.message || String(error)}`,
        snapshot: this.snapshot(),
      };
    }
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

  toggleConversationPin(conversationId) {
    const conv = getConversation(this.conversations, conversationId || this.activeConversationId);
    if (!conv) {
      return { error: '会话不存在', snapshot: this.snapshot() };
    }
    const nextPinned = !(Number(conv.pinnedAt || 0) > 0);
    conv.pinnedAt = nextPinned ? nowTs() : 0;
    this._syncConversationUpdated(conv);
    this._appendStructuredEvent(conv.id, 'hint', nextPinned ? '已置顶当前对话' : '已取消置顶当前对话');
    this._persist();
    return this.snapshot();
  },
};

module.exports = {
  runtimeMethods,
};
