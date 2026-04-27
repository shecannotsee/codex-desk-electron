const fs = require('node:fs');

const { nowTs, getConversation, sortedConversations } = require('../conversation_service');
const { CodexRunner } = require('../codex_runner');
const { CodexAppServerRunner } = require('../codex_app_server_runner');
const { normalizePreview } = require('./shared');
const { bindChatRunnerEvents } = require('./chat_runner_events');
const {
  REQUEST_WAIT_NOTICE_INTERVAL_MS,
  appendAttachmentPreview,
  normalizeAttachments,
  supportsAppServer,
} = require('./chat_helpers');

const chatMethods = {
  _startRequestWaitNotice(conversationId, runner) {
    const noticeState = {
      conversationId,
      responded: false,
      timer: null,
    };
    noticeState.timer = setTimeout(() => {
      const currentState = this.requestWaitNoticeByRunner.get(runner);
      if (!currentState || currentState.responded) {
        return;
      }
      currentState.timer = null;
      this._appendStructuredEvent(
        currentState.conversationId,
        'hint',
        `请求诊断: 请求已发送 ${Math.round(REQUEST_WAIT_NOTICE_INTERVAL_MS / 1000)}s，暂未收到响应`,
      );
    }, REQUEST_WAIT_NOTICE_INTERVAL_MS);
    this.requestWaitNoticeByRunner.set(runner, noticeState);
  },

  _markRequestWaitNoticeResponded(runner) {
    const noticeState = this.requestWaitNoticeByRunner.get(runner);
    if (!noticeState || noticeState.responded) {
      return false;
    }
    noticeState.responded = true;
    if (noticeState.timer) {
      clearTimeout(noticeState.timer);
      noticeState.timer = null;
    }
    return true;
  },

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
    delete this.preferAppServerByConversation[closeId];
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
      attachments: Array.isArray(lastUser.attachments) ? lastUser.attachments : [],
      appendUserMessage: false,
      forceFreshSession: conv.sessionContinuationMode === 'fork' ? false : true,
      fromRetry: true,
    });
  },

  async insertMessage({ conversationId, text }) {
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
    const runner = this.runners.get(targetId);
    if (!runner) {
      return { error: '当前没有进行中的任务。', snapshot: this.snapshot() };
    }
    if (typeof runner.steer !== 'function') {
      this.preferAppServerByConversation[targetId] = true;
      this._appendStructuredEvent(targetId, 'hint', '当前轮次不支持插入，已自动切换为混合策略：后续轮次将启用可插入模式');
      return this.sendMessage({
        conversationId: targetId,
        text: userText,
        appendUserMessage: true,
        forceFreshSession: false,
        fromRetry: false,
      });
    }

    try {
      await runner.steer(userText);
    } catch (error) {
      return { error: `插入对话失败: ${error?.message || String(error)}`, snapshot: this.snapshot() };
    }

    conv.messages.push({ role: 'user', text: userText, createdAt: nowTs() });
    conv.updatedAt = nowTs();
    this._syncConversationUpdated(conv);

    const currentRound = Math.max(1, this.roundIndexByRunner.get(runner) || 1);
    const stepIndex = (this.stepIndexByRunner.get(runner) || 0) + 1;
    this.stepIndexByRunner.set(runner, stepIndex);
    this._appendWorkflowStep(targetId, `R${currentRound}-S${stepIndex}. 插入指令: ${userText}`);
    this._appendStructuredEvent(targetId, 'hint', `已插入指令: ${normalizePreview(userText)}`);
    this._persist();
    return { ok: true, inserted: true, snapshot: this.snapshot() };
  },

  async sendMessage({ conversationId, text, attachments = [], appendUserMessage = true, forceFreshSession = false, fromRetry = false }) {
    const targetId = conversationId || this.activeConversationId;
    if (!targetId) {
      return { error: '请先新建对话。', snapshot: this.snapshot() };
    }
    const conv = getConversation(this.conversations, targetId);
    if (!conv) {
      return { error: '会话不存在', snapshot: this.snapshot() };
    }

    const userText = String(text || '').trim();
    const normalizedAttachments = normalizeAttachments(attachments);
    if (!userText) {
      return { error: '消息不能为空', snapshot: this.snapshot() };
    }

    const workdir = this._resolveConversationWorkdir(targetId);
    if (!workdir || !fs.existsSync(workdir) || !fs.statSync(workdir).isDirectory()) {
      return { error: `目录不存在:\n${workdir}`, snapshot: this.snapshot() };
    }

    if (this._isConversationRunning(targetId)) {
      const queue = this._getPendingQueue(targetId);
      queue.push({
        id: `q-${targetId}-${Date.now()}-${this.pendingQueueItemSeq += 1}`,
        text: userText,
        attachments: normalizedAttachments,
        appendUserMessage: Boolean(appendUserMessage),
        forceFreshSession: Boolean(forceFreshSession),
        fromRetry: Boolean(fromRetry),
        queuedAt: Date.now(),
      });
      this._emitQueueUpdated(targetId);
      this._appendStructuredEvent(targetId, 'hint', `当前仍在处理中，已加入排队（第 ${queue.length} 条）: ${appendAttachmentPreview(userText, normalizedAttachments)}`);
      this._persist();
      return { queued: true, snapshot: this.snapshot() };
    }

    if (forceFreshSession) {
      conv.sessionId = '';
      conv.sessionContinuationMode = '';
      const meta = this._ensureMeta(targetId);
      meta['会话ID'] = '-';
      this._emit({ type: 'meta-updated', conversationId: targetId, key: '会话ID', value: '-' });
      this._appendStructuredEvent(targetId, 'hint', '重试模式：已清空会话ID，将创建新会话');
    }

    let appendedUserMessage = null;
    if (appendUserMessage) {
      conv.messages.push({
        role: 'user',
        text: userText,
        attachments: normalizedAttachments,
        createdAt: nowTs(),
      });
      appendedUserMessage = conv.messages[conv.messages.length - 1] || null;
    } else if (fromRetry) {
      this._appendStructuredEvent(targetId, 'info', `用户手动重试上一条消息: ${appendAttachmentPreview(userText, normalizedAttachments)}`);
    }
    conv.updatedAt = nowTs();
    this._syncConversationUpdated(conv);

    const runtime = this.runtimeStore.ensure(targetId);
    const roundIndex = this.runtimeStore.nextRound(targetId);
    runtime.phase = '准备中...';
    runtime.startedAt = Number(process.hrtime.bigint() / 1000000n);

    while (this._removeLastStructuredEventIf(targetId, (item) => item?.kind === 'assistant-update')) {}
    while (this._removeLastWorkflowItemIf(
      targetId,
      (item) => item?.type === 'assistant' && item?.status === 'running',
    )) {}

    this._appendWorkflowRoundHeader(targetId, roundIndex, userText);
    this._appendStructuredEvent(targetId, 'hint', '收到新请求，准备执行...', { kind: 'request' });
    this._setPhase(targetId, '准备中...');
    this._setStartedAt(targetId, Date.now());

    this._persist();

    const prompt = userText;
    const hasAttachments = normalizedAttachments.length > 0;
    const useAppServerEnv = String(process.env.CODEX_DESK_ENABLE_APP_SERVER || '').trim().toLowerCase();
    const preferAppServer = Boolean(this.preferAppServerByConversation?.[targetId]);
    const appServerDisabled = useAppServerEnv === '0' || useAppServerEnv === 'false';
    const allowAppServer = !appServerDisabled || preferAppServer;
    const useAppServer = allowAppServer && this.useNativeMemory && supportsAppServer(this.commandText) && !hasAttachments;
    const hasStoredSession = Boolean(String(conv.sessionId || '').trim());
    const continuationMode = String(conv.sessionContinuationMode || '').trim();
    const appServerMode = !useAppServer
      ? ''
      : forceFreshSession || !hasStoredSession
        ? 'start'
        : continuationMode === 'fork'
          ? 'fork'
          : 'resume';

    if (appServerMode === 'fork') {
      this._appendStructuredEvent(targetId, 'hint', '本次将先分叉导入的原生会话（fork），后续继续新的 thread id');
    }
    if (hasAttachments) {
      this._appendStructuredEvent(targetId, 'hint', `本次请求附带 ${normalizedAttachments.length} 个图片附件`);
    }
    if (hasAttachments && supportsAppServer(this.commandText)) {
      this._appendStructuredEvent(targetId, 'hint', `检测到 ${normalizedAttachments.length} 个图片附件，已切换到 exec --image 模式`);
    }

    const runner = useAppServer
      ? new CodexAppServerRunner({
        commandText: this.commandText,
        prompt,
        workdir,
        sessionId: conv.sessionId || '',
        mode: appServerMode || 'start',
      })
      : new CodexRunner({
        commandText: this.commandText,
        prompt,
        attachments: normalizedAttachments,
        workdir,
        sessionId: conv.sessionId || '',
        useNativeMemory: this.useNativeMemory,
      });

    this.runners.set(targetId, runner);
    this._emit({ type: 'runner-state', conversationId: targetId, running: true });
    const streamPreviewEnv = String(process.env.CODEX_DESK_STREAM_PREVIEW || '').trim().toLowerCase();
    const enableStreamPreview = streamPreviewEnv === '1' || streamPreviewEnv === 'true';

    this.assistantBufferByRunner.set(runner, '');
    this.assistantStreamPreviewByRunner.set(runner, {
      lastEmittedText: '',
      lastEmittedAt: 0,
      pendingText: '',
      timer: null,
    });
    if (appendedUserMessage) {
      this.userMessageByRunner.set(runner, {
        conversationId: targetId,
        message: appendedUserMessage,
      });
    }
    this.stepIndexByRunner.set(runner, 0);
    this.roundIndexByRunner.set(runner, roundIndex);
    this._startRequestWaitNotice(targetId, runner);

    bindChatRunnerEvents(this, {
      targetId,
      runner,
      userText,
      enableStreamPreview,
    });
    runner.run();
    return { snapshot: this.snapshot() };
  },
};

module.exports = {
  chatMethods,
};
