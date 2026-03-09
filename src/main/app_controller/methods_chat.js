const fs = require('node:fs');

const { nowTs, getConversation, sortedConversations } = require('../conversation_service');
const { CodexRunner } = require('../codex_runner');
const { normalizePreview } = require('./shared');

const chatMethods = {
  closeCurrentConversation() {
    if (!this.conversations.length) {
      return this.snapshot();
    }

    const closeId = this.activeConversationId;
    if (!closeId) {
      return this.snapshot();
    }
    const runningHere = this._isConversationRunning(closeId);

    if (runningHere) {
      const candidates = sortedConversations(this.conversations)
        .map((item) => item.id)
        .filter((item) => item !== closeId);
      if (!candidates.length) {
        this.activeConversationId = '';
        this._appendStructuredEvent(closeId, 'warn', '当前对话正在后台运行，暂无法关闭最后一个运行会话。');
        this._persist();
        return this.snapshot();
      }
      this.activeConversationId = candidates[0];
      this._persist();
      return this.snapshot();
    }

    const targets = sortedConversations(this.conversations)
      .map((item) => item.id)
      .filter((item) => item !== closeId);
    this.activeConversationId = targets.length ? targets[0] : '';
    this.conversations = this.conversations.filter((item) => item.id !== closeId);
    this.runtimeStore.remove(closeId);
    delete this.metaByConversation[closeId];
    this.pendingQueueByConversation.delete(closeId);
    this._emit({ type: 'conversation-removed', conversationId: closeId });
    if (this.activeConversationId) {
      this._appendStructuredEvent(this.activeConversationId, 'hint', '已关闭当前对话');
    }
    this._persist();
    return this.snapshot();
  },

  clearChat(conversationId) {
    const conv = getConversation(this.conversations, conversationId || this.activeConversationId);
    if (!conv) {
      return { error: '请先新建对话。', snapshot: this.snapshot() };
    }
    if (this._isConversationRunning(conv.id)) {
      return { error: '请先停止当前任务。', snapshot: this.snapshot() };
    }

    conv.messages = [];
    conv.updatedAt = nowTs();
    this._syncConversationUpdated(conv);
    this._appendStructuredEvent(conv.id, 'hint', '已清空当前对话内容');
    this._persist();
    return { snapshot: this.snapshot() };
  },

  clearRuntime(conversationId, { silent = false } = {}) {
    const id = conversationId || this.activeConversationId;
    if (!id) {
      return { error: '请先新建对话。', snapshot: this.snapshot() };
    }
    if (this._isConversationRunning(id) && !silent) {
      return { error: '请先停止当前任务。', snapshot: this.snapshot() };
    }

    const runtime = this.runtimeStore.ensure(id);
    runtime.workflow = [];
    runtime.events = [];
    runtime.raw = [];
    runtime.phase = '空闲';
    runtime.startedAt = null;

    this._emit({ type: 'runtime-reset', conversationId: id });
    if (!silent) {
      this._appendStructuredEvent(id, 'hint', '已清空右侧运行日志（结构化事件/运行步骤/事件原文）');
    }

    return { snapshot: this.snapshot() };
  },

  stopConversation(conversationId) {
    const id = conversationId || this.activeConversationId;
    if (!id) {
      return this.snapshot();
    }
    const runner = this.runners.get(id);
    if (runner) {
      const marked = this._markRunnerUserMessageInterrupted(runner, 'user-stop');
      runner.stop();
      this._appendStructuredEvent(id, 'warn', '已请求停止当前对话任务');
      if (marked) {
        this._persist();
      }
    }
    return this.snapshot();
  },

  async retryLastMessage(conversationId) {
    const targetId = conversationId || this.activeConversationId;
    if (!targetId) {
      return { error: '请先新建对话。', snapshot: this.snapshot() };
    }
    const conv = getConversation(this.conversations, targetId);
    if (!conv) {
      return { error: '会话不存在', snapshot: this.snapshot() };
    }
    if (this._isConversationRunning(targetId)) {
      return { error: '当前对话上一条消息还在处理中，请稍候。', snapshot: this.snapshot() };
    }

    const messages = Array.isArray(conv.messages) ? conv.messages : [];
    const lastUser = [...messages].reverse().find((item) => item && item.role === 'user' && String(item.text || '').trim());
    if (!lastUser) {
      return { error: '当前对话没有可重试的用户消息。', snapshot: this.snapshot() };
    }

    return this.sendMessage({
      conversationId: targetId,
      text: String(lastUser.text || ''),
      appendUserMessage: false,
      forceFreshSession: true,
      fromRetry: true,
    });
  },

  async sendMessage({ conversationId, text, appendUserMessage = true, forceFreshSession = false, fromRetry = false }) {
    const targetId = conversationId || this.activeConversationId;
    if (!targetId) {
      return { error: '请先新建对话。', snapshot: this.snapshot() };
    }
    const conv = getConversation(this.conversations, targetId);
    if (!conv) {
      return { error: '会话不存在', snapshot: this.snapshot() };
    }

    const userText = String(text || '').trim();
    if (!userText) {
      return { error: '消息不能为空', snapshot: this.snapshot() };
    }

    if (!this.workdir || !fs.existsSync(this.workdir) || !fs.statSync(this.workdir).isDirectory()) {
      return { error: `目录不存在:\n${this.workdir}`, snapshot: this.snapshot() };
    }

    if (this._isConversationRunning(targetId)) {
      const queue = this._getPendingQueue(targetId);
      queue.push({
        text: userText,
        appendUserMessage: Boolean(appendUserMessage),
        forceFreshSession: Boolean(forceFreshSession),
        fromRetry: Boolean(fromRetry),
        queuedAt: Date.now(),
      });
      this._emitQueueUpdated(targetId);
      this._appendStructuredEvent(targetId, 'hint', `当前仍在处理中，已加入排队（第 ${queue.length} 条）: ${normalizePreview(userText)}`);
      this._persist();
      return { queued: true, snapshot: this.snapshot() };
    }

    if (forceFreshSession) {
      conv.sessionId = '';
      const meta = this._ensureMeta(targetId);
      meta['会话ID'] = '-';
      this._emit({ type: 'meta-updated', conversationId: targetId, key: '会话ID', value: '-' });
      this._appendStructuredEvent(targetId, 'hint', '重试模式：已清空会话ID，将创建新会话');
    }

    let appendedUserMessage = null;
    if (appendUserMessage) {
      conv.messages.push({ role: 'user', text: userText, createdAt: nowTs() });
      appendedUserMessage = conv.messages[conv.messages.length - 1] || null;
    } else if (fromRetry) {
      this._appendStructuredEvent(targetId, 'info', `用户手动重试上一条消息: ${normalizePreview(userText)}`);
    }
    conv.updatedAt = nowTs();
    this._syncConversationUpdated(conv);

    const runtime = this.runtimeStore.ensure(targetId);
    const roundIndex = this.runtimeStore.nextRound(targetId);
    runtime.phase = '准备中...';
    runtime.startedAt = Number(process.hrtime.bigint() / 1000000n);

    this._appendWorkflowRoundHeader(targetId, roundIndex, userText);
    this._appendWorkflowStep(targetId, `R${roundIndex}-S0. 请求: ${userText}`);
    this._appendStructuredEvent(targetId, 'info', '收到新请求，准备执行...');
    this._setPhase(targetId, '准备中...');
    this._setStartedAt(targetId, Date.now());

    this._persist();

    const prompt = userText;
    const runner = new CodexRunner({
      commandText: this.commandText,
      prompt,
      workdir: this.workdir,
      sessionId: conv.sessionId || '',
      useNativeMemory: this.useNativeMemory,
    });

    this.runners.set(targetId, runner);
    this._emit({ type: 'runner-state', conversationId: targetId, running: true });

    this.assistantBufferByRunner.set(runner, '');
    if (appendedUserMessage) {
      this.userMessageByRunner.set(runner, {
        conversationId: targetId,
        message: appendedUserMessage,
      });
    }
    this.stepIndexByRunner.set(runner, 0);
    this.roundIndexByRunner.set(runner, roundIndex);

    runner.on('status', (phase) => {
      this._setPhase(targetId, phase);
    });

    runner.on('event', (level, message) => {
      this._appendStructuredEvent(targetId, level, message);
    });

    runner.on('raw_line', (line) => {
      this._appendRawJsonLine(targetId, line);
    });

    runner.on('meta', (key, value) => {
      const meta = this._ensureMeta(targetId);
      meta[key] = value;

      if (key === '会话ID') {
        const targetConv = getConversation(this.conversations, targetId);
        if (targetConv) {
          targetConv.sessionId = value;
          targetConv.updatedAt = nowTs();
          this._syncConversationUpdated(targetConv);
        }
      }

      this._emit({ type: 'meta-updated', conversationId: targetId, key, value });
      this._appendStructuredEvent(targetId, 'hint', `${key}: ${value}`);
    });

    runner.on('assistant_delta', (delta) => {
      const current = this.assistantBufferByRunner.get(runner) || '';
      this.assistantBufferByRunner.set(runner, current + String(delta || ''));
    });

    runner.on('step', (step) => {
      const currentRound = Math.max(1, this.roundIndexByRunner.get(runner) || 1);
      const stepIndex = (this.stepIndexByRunner.get(runner) || 0) + 1;
      this.stepIndexByRunner.set(runner, stepIndex);

      const textStep = `R${currentRound}-S${stepIndex}. ${String(step || '').trim()}`;
      this._appendWorkflowStep(targetId, textStep);

      let summary = String(step || '').replace(/\s+/g, ' ').trim();
      if (summary.length > 160) {
        summary = `${summary.slice(0, 160).trimEnd()}...`;
      }
      this._appendStructuredEvent(targetId, 'info', `R${currentRound}-S${stepIndex}: ${summary}`);
    });

    runner.on('finished', (result) => {
      const targetConv = getConversation(this.conversations, targetId);
      const runtimeState = this.runtimeStore.ensure(targetId);

      if (targetConv) {
        if (result.sessionId) {
          targetConv.sessionId = result.sessionId;
        } else if (result.sessionResetSuggested) {
          targetConv.sessionId = '';
          this._appendStructuredEvent(targetId, 'warn', '已清空失效会话ID，下一次将自动创建新会话');
        }
      }

      if (result.exitCode === 0) {
        runtimeState.phase = '已完成';
        this._appendStructuredEvent(targetId, 'success', `任务完成，用时 ${result.durationSeconds.toFixed(1)}s`);
      } else {
        runtimeState.phase = '失败';
        this._appendStructuredEvent(
          targetId,
          'error',
          `任务失败，退出码 ${result.exitCode}，用时 ${result.durationSeconds.toFixed(1)}s`,
        );
      }

      const finalText = (this.assistantBufferByRunner.get(runner) || '').trim() || String(result.assistantText || '').trim();
      if (finalText && targetConv) {
        targetConv.messages.push({ role: 'assistant', text: finalText, createdAt: nowTs() });
      } else if (!finalText && targetConv && result.exitCode === 0) {
        this._appendStructuredEvent(targetId, 'warn', 'Codex 未返回可解析内容（请查看右侧运行步骤/事件原文）');
      }

      if (targetConv) {
        targetConv.updatedAt = nowTs();
        this._syncConversationUpdated(targetConv);
      }

      runtimeState.startedAt = null;
      this._emit({ type: 'runtime-started-at', conversationId: targetId, startedAt: null });
      this._setPhase(targetId, runtimeState.phase || '空闲');

      this._releaseRunner(targetId, runner);
      this._persist();
      this._startNextQueuedMessage(targetId);
    });

    runner.run();
    return { snapshot: this.snapshot() };
  },
};

module.exports = {
  chatMethods,
};
