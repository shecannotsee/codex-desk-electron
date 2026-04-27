const { nowTs, getConversation } = require('../conversation_service');

const runtimeRunnerLifecycleMethods = {
  _isConversationRunning(conversationId) {
    if (!conversationId) {
      return false;
    }
    return this.runners.has(conversationId);
  },

  _anyConversationRunning() {
    return this.runners.size > 0;
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
    const waitNoticeState = this.requestWaitNoticeByRunner.get(runner);
    if (waitNoticeState?.timer) {
      clearTimeout(waitNoticeState.timer);
    }
    this.assistantBufferByRunner.delete(runner);
    this.assistantStreamPreviewByRunner.delete(runner);
    this.requestWaitNoticeByRunner.delete(runner);
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
};

module.exports = {
  runtimeRunnerLifecycleMethods,
};
