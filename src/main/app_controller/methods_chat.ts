const fs = require('node:fs');

const { nowTs, getConversation, sortedConversations } = require('../conversation_service');
const { CodexRunner, splitShellArgs } = require('../codex_runner');
const { CodexAppServerRunner } = require('../codex_app_server_runner');
const { normalizePreview } = require('./shared');

const ASSISTANT_STREAM_PREVIEW_MIN_INTERVAL_MS = 240;
const ASSISTANT_STREAM_PREVIEW_MIN_GROWTH = 32;

function normalizeAssistantRuntimeText(text) {
  return String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg', '.tif', '.tiff']);

function attachmentBasename(filePath) {
  const raw = String(filePath || '').trim();
  if (!raw) {
    return '';
  }
  const parts = raw.split(/[\\/]/);
  return parts[parts.length - 1] || raw;
}

function looksLikeImageAttachment(item) {
  const mimeType = String(item?.mimeType || '').trim().toLowerCase();
  if (mimeType.startsWith('image/')) {
    return true;
  }
  const filePath = String(item?.path || '').trim().toLowerCase();
  for (const ext of IMAGE_EXTENSIONS) {
    if (filePath.endsWith(ext)) {
      return true;
    }
  }
  return false;
}

function normalizeAttachments(attachments) {
  const list = Array.isArray(attachments) ? attachments : [];
  const seen = new Set();
  return list
    .map((item) => {
      const path = String(item?.path || '').trim();
      if (!path || seen.has(path) || !fs.existsSync(path)) {
        return null;
      }
      seen.add(path);
      return {
        path,
        name: String(item?.name || '').trim() || attachmentBasename(path),
        mimeType: String(item?.mimeType || '').trim(),
        size: Number(item?.size || 0) || 0,
        kind: looksLikeImageAttachment(item) ? 'image' : String(item?.kind || '').trim(),
      };
    })
    .filter((item) => item && item.kind === 'image');
}

function appendAttachmentPreview(text, attachments) {
  const preview = normalizePreview(text);
  const count = Array.isArray(attachments) ? attachments.length : 0;
  if (count <= 0) {
    return preview;
  }
  return `${preview} [附件 ${count}]`;
}

const USAGE_META_KEYS = new Set(['输入Tokens', '缓存输入Tokens', '输出Tokens', '总Tokens']);

function supportsAppServer(commandText) {
  const parts = splitShellArgs(commandText);
  return parts.length >= 2
    && /codex/i.test(String(parts[0] || ''))
    && String(parts[1] || '') === 'exec';
}

const chatMethods = {
  _ensureAssistantStreamPreviewState(runner) {
    let previewState = this.assistantStreamPreviewByRunner.get(runner);
    if (!previewState) {
      previewState = {
        lastEmittedText: '',
        lastEmittedAt: 0,
        pendingText: '',
        timer: null,
      };
      this.assistantStreamPreviewByRunner.set(runner, previewState);
    }
    return previewState;
  },

  _clearAssistantStreamPreviewTimer(runner) {
    const previewState = this.assistantStreamPreviewByRunner.get(runner);
    if (!previewState?.timer) {
      return;
    }
    clearTimeout(previewState.timer);
    previewState.timer = null;
  },

  _emitStreamingAssistantUpdate(conversationId, runner, text) {
    const body = normalizeAssistantRuntimeText(text);
    if (!body) {
      return false;
    }

    const previewState = this._ensureAssistantStreamPreviewState(runner);
    if (body === previewState.lastEmittedText) {
      return false;
    }

    this._clearAssistantStreamPreviewTimer(runner);
    previewState.pendingText = body;
    previewState.lastEmittedText = body;
    previewState.lastEmittedAt = Date.now();

    const currentRound = Math.max(1, this.roundIndexByRunner.get(runner) || 1);
    this._removeLastStructuredEventIf(conversationId, (item) => item?.kind === 'assistant-update');
    this._removeLastWorkflowItemIf(
      conversationId,
      (item) => item?.type === 'assistant'
        && item?.status === 'running'
        && Number(item?.roundIndex || 0) === currentRound,
    );
    this._appendStructuredAssistantUpdate(conversationId, body);
    this._appendWorkflowAssistantUpdate(conversationId, currentRound, body);
    return true;
  },

  _scheduleStreamingAssistantUpdate(conversationId, runner, delayMs) {
    const previewState = this._ensureAssistantStreamPreviewState(runner);
    if (previewState.timer) {
      return;
    }
    previewState.timer = setTimeout(() => {
      previewState.timer = null;
      this._emitStreamingAssistantUpdate(conversationId, runner, previewState.pendingText);
    }, Math.max(16, Number(delayMs) || ASSISTANT_STREAM_PREVIEW_MIN_INTERVAL_MS));
  },

  _maybeEmitStreamingAssistantUpdate(conversationId, runner, delta, options = {}) {
    const optionEntries = Object.entries(options || {});
    const streamOptions = new Map(optionEntries);
    const previewState = this._ensureAssistantStreamPreviewState(runner);
    const sourceText = streamOptions.has('text')
      ? streamOptions.get('text')
      : (this.assistantBufferByRunner.get(runner) || '');
    const body = normalizeAssistantRuntimeText(sourceText);
    if (!body) {
      return false;
    }

    previewState.pendingText = body;
    if (Boolean(streamOptions.get('force'))) {
      return this._emitStreamingAssistantUpdate(conversationId, runner, body);
    }

    if (body === previewState.lastEmittedText) {
      return false;
    }

    const now = Date.now();
    const sinceLastEmit = previewState.lastEmittedAt > 0
      ? now - previewState.lastEmittedAt
      : ASSISTANT_STREAM_PREVIEW_MIN_INTERVAL_MS;
    const lengthDelta = body.length - String(previewState.lastEmittedText || '').length;
    const deltaText = String(delta || '');
    const shouldEmitNow = (
      !previewState.lastEmittedAt
      || sinceLastEmit >= ASSISTANT_STREAM_PREVIEW_MIN_INTERVAL_MS
      || lengthDelta >= ASSISTANT_STREAM_PREVIEW_MIN_GROWTH
      || deltaText.includes('\n')
    );

    if (shouldEmitNow) {
      return this._emitStreamingAssistantUpdate(conversationId, runner, body);
    }

    this._scheduleStreamingAssistantUpdate(
      conversationId,
      runner,
      ASSISTANT_STREAM_PREVIEW_MIN_INTERVAL_MS - sinceLastEmit,
    );
    return false;
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
      return { error: '当前运行模式不支持插入对话，请改用排队发送。', snapshot: this.snapshot() };
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
    this._appendWorkflowStep(targetId, `R${roundIndex}-S0. 请求: ${userText}`);
    this._appendStructuredEvent(targetId, 'info', '收到新请求，准备执行...');
    this._setPhase(targetId, '准备中...');
    this._setStartedAt(targetId, Date.now());

    this._persist();

    const prompt = userText;
    const hasAttachments = normalizedAttachments.length > 0;
    const useAppServer = this.useNativeMemory && supportsAppServer(this.commandText) && !hasAttachments;
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
          if (targetConv.sessionContinuationMode === 'fork' && value && value !== '-') {
            targetConv.sessionContinuationMode = 'resume';
          }
          targetConv.updatedAt = nowTs();
          this._syncConversationUpdated(targetConv);
        }
      }

      this._emit({ type: 'meta-updated', conversationId: targetId, key, value });
      if (!USAGE_META_KEYS.has(key)) {
        this._appendStructuredEvent(targetId, 'hint', `${key}: ${value}`);
      }
    });

    runner.on('assistant_delta', (delta) => {
      const current = this.assistantBufferByRunner.get(runner) || '';
      const next = current + String(delta || '');
      this.assistantBufferByRunner.set(runner, next);
      this._maybeEmitStreamingAssistantUpdate(targetId, runner, delta, { text: next });
    });

    runner.on('assistant_update', (payload) => {
      const text = normalizeAssistantRuntimeText(payload?.text || '');
      if (!text) {
        return;
      }
      const bufferedText = normalizeAssistantRuntimeText(this.assistantBufferByRunner.get(runner) || '');
      const previewText = bufferedText.length >= text.length ? bufferedText : text;
      if (previewText.length > bufferedText.length) {
        this.assistantBufferByRunner.set(runner, previewText);
      }
      this._maybeEmitStreamingAssistantUpdate(targetId, runner, '', { text: previewText, force: true });
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
      const currentRound = Math.max(1, this.roundIndexByRunner.get(runner) || 1);

      if (targetConv) {
        if (result.sessionId) {
          targetConv.sessionId = result.sessionId;
        } else if (result.sessionResetSuggested) {
          targetConv.sessionId = '';
          this._appendStructuredEvent(targetId, 'warn', '已清空失效会话ID，下一次将自动创建新会话');
        }
      }

      const finalText = (this.assistantBufferByRunner.get(runner) || '').trim() || String(result.assistantText || '').trim();
      while (this._removeLastStructuredEventIf(
        targetId,
        (item) => item?.kind === 'assistant-update',
      )) {}
      while (this._removeLastWorkflowItemIf(
        targetId,
        (item) => item.type === 'assistant'
          && item.status === 'running'
          && Number(item.roundIndex || 0) === currentRound,
      )) {}
      if (finalText && targetConv) {
        this._appendWorkflowAssistantReply(targetId, currentRound, finalText);
        targetConv.messages.push({ role: 'assistant', text: finalText, createdAt: nowTs() });
      } else if (!finalText && targetConv && result.exitCode === 0) {
        this._appendStructuredEvent(targetId, 'warn', 'Codex 未返回可解析内容（请查看右侧运行步骤/事件原文）');
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
