const { nowTs, newConversation, getConversation } = require('../conversation_service');
const {
  normalizeIdentity,
  normalizeNotificationSettings,
  normalizeRemoteControlSettings,
  normalizeWorkdir,
} = require('../state_store');
const { tsLabel } = require('./shared');
const {
  MAX_RUNTIME_RAW,
  inferStructuredEventKind,
  isCompletedPhase,
  pushBounded,
} = require('./runtime_helpers');
const { runtimeQueueMethods } = require('./methods_runtime_queue');
const { runtimeWorkflowMethods } = require('./methods_runtime_workflow');

const runtimeMethods = {
  _inferStructuredEventKind(level = '', message = '', metaKey = '') {
    return inferStructuredEventKind(level, message, metaKey);
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

  ...runtimeQueueMethods,

  _syncConversationUpdated(conversation) {
    this._emit({ type: 'conversation-updated', conversation });
  },

  _setPhase(conversationId, phase) {
    const runtime = this.runtimeStore.ensure(conversationId);
    runtime.phase = phase;
    this._emit({ type: 'runtime-phase', conversationId, phase });
  },

  ...runtimeWorkflowMethods,

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
    this.rawEventSeq += 1;
    const item = {
      id: `raw-${Date.now()}-${this.rawEventSeq}`,
      direction: normalizedDirection === 'sent' ? 'sent' : 'received',
      line: rawText,
      timestamp: tsLabel(),
    };
    const runtime = this.runtimeStore.ensure(conversationId);
    pushBounded(runtime.raw, item, MAX_RUNTIME_RAW);
    this._emit({ type: 'runtime-raw-append', conversationId, line: item });
  },

  _latestRawItem(conversationId, predicate = null) {
    const runtime = this.runtimeStore.ensure(conversationId);
    const items = Array.isArray(runtime?.raw) ? runtime.raw : [];
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (!item || typeof item !== 'object') {
        continue;
      }
      if (typeof predicate === 'function' && !predicate(item)) {
        continue;
      }
      return item;
    }
    return null;
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

  updateSettings(input) {
    if (this._hasLockedCredentialVault()) {
      const nextNotificationToken = String(input?.notifications?.telegram?.botToken || '').trim();
      const nextRemoteToken = String(input?.remoteControl?.telegram?.botToken || '').trim();
      if (nextNotificationToken || nextRemoteToken) {
        return { error: this._lockedCredentialError('Telegram 凭据修改'), snapshot: this.snapshot() };
      }
    }
    if (typeof input.commandText === 'string') {
      this.commandText = input.commandText;
    }
    if (typeof input.workdir === 'string') {
      this.workdir = normalizeWorkdir(input.workdir);
    }
    if (typeof input.deviceIdentity === 'string') {
      this.deviceIdentity = normalizeIdentity(input.deviceIdentity);
    }
    if (input.notifications && typeof input.notifications === 'object') {
      const incomingTelegram = input.notifications.telegram && typeof input.notifications.telegram === 'object'
        ? input.notifications.telegram
        : {};
      const mergedTelegram = {
        ...((this.notifications && this.notifications.telegram && typeof this.notifications.telegram === 'object')
          ? this.notifications.telegram
          : {}),
        ...incomingTelegram,
      };
      if (incomingTelegram.clearBotToken) {
        mergedTelegram.botToken = '';
        mergedTelegram.hasBotToken = false;
        mergedTelegram.botTokenHash = '';
        mergedTelegram.botTokenFingerprint = '';
      }
      this.notifications = normalizeNotificationSettings({
        ...(this.notifications && typeof this.notifications === 'object' ? this.notifications : {}),
        ...input.notifications,
        telegram: mergedTelegram,
      });
    }
    if (input.remoteControl && typeof input.remoteControl === 'object') {
      const incomingTelegram = input.remoteControl.telegram && typeof input.remoteControl.telegram === 'object'
        ? input.remoteControl.telegram
        : {};
      const mergedTelegram = {
        ...((this.remoteControl && this.remoteControl.telegram && typeof this.remoteControl.telegram === 'object')
          ? this.remoteControl.telegram
          : {}),
        ...incomingTelegram,
      };
      if (incomingTelegram.clearBotToken) {
        mergedTelegram.botToken = '';
        mergedTelegram.hasBotToken = false;
        mergedTelegram.botTokenHash = '';
        mergedTelegram.botTokenFingerprint = '';
      }
      this.remoteControl = normalizeRemoteControlSettings({
        ...(this.remoteControl && typeof this.remoteControl === 'object' ? this.remoteControl : {}),
        ...input.remoteControl,
        telegram: mergedTelegram,
      });
    }
    this.useNativeMemory = true;
    this._syncNotificationCenter();
    this._syncRemoteControlCenter();
    this._persist();
    return this.snapshot();
  },

  switchConversation(conversationId) {
    const target = getConversation(this.conversations, conversationId);
    if (!target) {
      return this._conversationSwitchPayload(this.activeConversationId);
    }
    const runtime = this.runtimeStore.ensure(target.id);
    if (!this._isConversationRunning(target.id) && this._pendingQueueSize(target.id) <= 0 && isCompletedPhase(runtime.phase)) {
      runtime.phase = '空闲';
      this._emit({ type: 'runtime-phase', conversationId: target.id, phase: runtime.phase });
    }
    if (target.id !== this.activeConversationId) {
      this.activeConversationId = target.id;
      this._schedulePersist();
    }
    return this._conversationSwitchPayload(target.id);
  },

  createConversation(options: { workdir?: string } = {}) {
    const conv = newConversation(undefined, this.conversations);
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

  async notifyConversationResult(conversationId, {
    status = 'completed',
    userText = '',
    assistantText = '',
    errorText = '',
    exitCode = '',
  } = {}) {
    if (this._hasLockedCredentialVault()) {
      return { ok: false, error: this._lockedCredentialError('Telegram 通知') };
    }
    const notificationCenter = this._syncNotificationCenter();
    const targetConv = getConversation(this.conversations, conversationId);
    if (!targetConv) {
      return { ok: false, error: '会话不存在' };
    }
    const result = await notificationCenter.notifyConversationResult({
      status,
      conversationId: String(targetConv.sessionId || targetConv.id || '').trim(),
      sessionId: String(targetConv.sessionId || '').trim(),
      conversationTitle: targetConv.title,
      userText,
      assistantText,
      errorText,
      exitCode,
    });
    return result;
  },

  testNotificationProvider() {
    if (this._hasLockedCredentialVault()) {
      return { ok: false, error: this._lockedCredentialError('Telegram 通知测试') };
    }
    return this._syncNotificationCenter().testActiveProvider();
  },

  testRemoteControlProvider() {
    if (this._hasLockedCredentialVault()) {
      return { ok: false, error: this._lockedCredentialError('Telegram 远程对话测试') };
    }
    return this._syncRemoteControlCenter().testActiveProvider();
  },

  shutdownServices() {
    if (this.remoteControlCenter && typeof this.remoteControlCenter.stop === 'function') {
      this.remoteControlCenter.stop();
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
