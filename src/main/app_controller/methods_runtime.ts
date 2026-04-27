const { nowTs, newConversation, getConversation, sortedConversations } = require('../conversation_service');
const { importSessionJsonl } = require('../session_importer');
const { buildExportFileName, exportConversationJsonl } = require('../session_exporter');
const {
  normalizeIdentity,
  normalizeNotificationSettings,
  normalizeRemoteControlSettings,
  normalizeWorkdir,
} = require('../state_store');
const { NotificationCenter } = require('../notification_bridge');
const { appendTelegramLog } = require('../telegram_log_store');
const { normalizePreview, tsLabel } = require('./shared');
const fs = require('node:fs');

function isCompletedPhase(phaseText) {
  const text = String(phaseText || '').trim().toLowerCase();
  if (!text) {
    return false;
  }
  return ['已完成', '完成', 'completed', 'success', 'done'].some((item) => text.includes(item));
}

const MAX_RUNTIME_EVENTS = 500;
const MAX_RUNTIME_WORKFLOW = 500;
const MAX_RUNTIME_RAW = 1000;
const TELEGRAM_VAULT_LOCKED_ERROR = '当前已启用的通知和远程对话已暂停，请先在设置 > 通知解锁与保护中解锁';

function pushBounded(list, item, limit) {
  if (!Array.isArray(list)) {
    return;
  }
  list.push(item);
  const overflow = list.length - Math.max(1, Number(limit) || 1);
  if (overflow > 0) {
    list.splice(0, overflow);
  }
}

function securitySnapshot(controller) {
  const hasMasterPassword = Boolean(controller?.security?.hasMasterPassword);
  const unlocked = hasMasterPassword
    ? Boolean(controller?.security?.unlocked)
    : true;
  return {
    hasMasterPassword,
    unlocked,
  };
}

function normalizeNotificationFailureEventMessage(message, exitCode = '') {
  const text = String(message || '').trim();
  if (!text) {
    return '';
  }
  if (/^通知发送失败[:：]/.test(text)) {
    return '';
  }
  if (/^当前任务非正常结束，剩余\s+\d+\s+条排队消息已停止自动执行$/.test(text)) {
    return '';
  }
  if (/^任务失败，退出码\b/.test(text)) {
    return '';
  }
  if (/^turn\.failed\b/i.test(text)) {
    const detail = text.replace(/^turn\.failed\b[:：\s-]*/i, '').trim();
    return detail || '';
  }
  if (
    Number.isInteger(Number(exitCode))
    && Number(exitCode) > 0
    && text === `任务失败，退出码 ${Number(exitCode)}`
  ) {
    return '';
  }
  return text;
}

function normalizeWorkflowPlanStatus(status = '') {
  const text = String(status || '').trim().toLowerCase();
  if (text === 'completed' || text === 'done' || text === 'success') {
    return 'completed';
  }
  if (text === 'in_progress' || text === 'inprogress' || text === 'running' || text === 'active') {
    return 'in_progress';
  }
  return 'pending';
}

function buildWorkflowPlanBody(explanation = '', plan = []) {
  const lines = [];
  const note = String(explanation || '').trim();
  if (note) {
    lines.push(`> ${note}`);
    lines.push('');
  }
  const items = Array.isArray(plan) ? plan : [];
  if (!items.length) {
    lines.push('- [ ] 暂无计划步骤');
    return lines.join('\n');
  }
  items.forEach((item) => {
    const stepText = String(item?.step || '').trim() || '未命名步骤';
    const status = normalizeWorkflowPlanStatus(item?.status);
    if (status === 'completed') {
      lines.push(`- [x] ${stepText}`);
      return;
    }
    if (status === 'in_progress') {
      lines.push(`- [ ] ${stepText} **(进行中)**`);
      return;
    }
    lines.push(`- [ ] ${stepText}`);
  });
  return lines.join('\n');
}

function summarizeWorkflowPlan(plan = []) {
  const items = Array.isArray(plan) ? plan : [];
  const total = items.length;
  let completed = 0;
  let activeStep = '';
  items.forEach((item) => {
    const status = normalizeWorkflowPlanStatus(item?.status);
    if (status === 'completed') {
      completed += 1;
      return;
    }
    if (!activeStep && status === 'in_progress') {
      activeStep = String(item?.step || '').trim();
    }
  });
  const preview = activeStep
    ? `进行中: ${activeStep}`
    : (total > 0 ? `已完成 ${completed}/${total}` : '暂无计划步骤');
  return {
    total,
    completed,
    activeStep,
    preview,
  };
}

function summarizeWorkflowPurposeText(text = '', limit = 140) {
  const normalized = String(text || '')
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!normalized) {
    return '';
  }
  const firstParagraph = normalized.split(/\n{2,}/)[0]?.replace(/\s+/g, ' ').trim() || '';
  if (!firstParagraph) {
    return '';
  }
  return normalizePreview(firstParagraph, limit);
}

function buildStructuredProgressMessage(body = '', segmentIndex = 0) {
  const preview = normalizePreview(body, 96);
  if (!preview) {
    return '';
  }
  const index = Number(segmentIndex || 0);
  return index > 0
    ? `阶段进展 #${index}: ${preview}`
    : `阶段进展: ${preview}`;
}

function extractIncrementalProgressText(fullText = '', previousFullText = '') {
  const current = String(fullText || '').trim();
  const previous = String(previousFullText || '').trim();
  if (!current) {
    return '';
  }
  if (!previous) {
    return current;
  }
  if (current === previous) {
    return '';
  }
  if (current.startsWith(previous)) {
    return current.slice(previous.length).replace(/^\s+/, '').trim();
  }
  return current;
}

function inferStructuredEventKind(level = '', message = '', metaKey = '') {
  const normalizedLevel = String(level || '').trim().toLowerCase();
  const text = String(message || '').trim();
  const key = String(metaKey || '').trim();
  if (!text && !key) {
    return '';
  }
  if (key === '会话ID' || key === '模型') {
    return 'startup';
  }
  if (/^请求[:：]/.test(text) || /^收到新请求/.test(text)) {
    return 'request';
  }
  if (
    normalizedLevel === 'hint'
    && (
      /^启动 app-server[:：]/.test(text)
      || /^已(恢复|创建|分叉)原生会话[:：]/.test(text)
      || /^使用原生会话续聊[:：]/.test(text)
      || /^创建新的 Codex 原生会话$/.test(text)
      || /^当前为本地拼接上下文模式/.test(text)
    )
  ) {
    return 'startup';
  }
  return '';
}

const runtimeMethods = {
  _inferStructuredEventKind(level = '', message = '', metaKey = '') {
    return inferStructuredEventKind(level, message, metaKey);
  },

  _emit(event) {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return;
    }
    this.mainWindow.webContents.send('app:event', event);
  },

  _persist() {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this._syncNotificationCenter();
    this._syncRemoteControlCenter();
    this.stateStorage.saveState({
      commandText: this.commandText,
      workdir: this.workdir,
      useNativeMemory: this.useNativeMemory,
      deviceIdentity: this.deviceIdentity,
      notifications: this.notifications,
      remoteControl: this.remoteControl,
      activeConversationId: this.activeConversationId,
      conversations: this.conversations,
      metaByConversation: this.metaByConversation,
    }, {
      vault: this.vault,
      vaultKey: this.vaultKey,
    });
  },

  _schedulePersist(delay = 180) {
    const wait = Math.max(0, Number(delay) || 0);
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this._persist();
    }, wait);
  },

  _defaultWorkdir() {
    return normalizeWorkdir('');
  },

  _resolveConversationWorkdir(conversationId) {
    const conv = getConversation(this.conversations, conversationId);
    return normalizeWorkdir(conv?.workdir || this._defaultWorkdir());
  },

  _syncNotificationCenter() {
    const normalizedIdentity = normalizeIdentity(this.deviceIdentity || '');
    const normalizedNotifications = normalizeNotificationSettings(this.notifications);
    this.deviceIdentity = normalizedIdentity;
    this.notifications = normalizedNotifications;
    if (!this.notificationCenter) {
      this.notificationCenter = new NotificationCenter({
        settings: normalizedNotifications,
        deviceIdentity: normalizedIdentity,
      });
      return this.notificationCenter;
    }
    this.notificationCenter.updateConfig({
      settings: normalizedNotifications,
      deviceIdentity: normalizedIdentity,
    });
    return this.notificationCenter;
  },

  _hasLockedCredentialVault() {
    return Boolean(this.security?.hasMasterPassword) && !Boolean(this.security?.unlocked);
  },

  _lockedCredentialError(logLabel = 'Telegram') {
    appendTelegramLog('warn', `${logLabel} 未执行: ${TELEGRAM_VAULT_LOCKED_ERROR}`);
    return TELEGRAM_VAULT_LOCKED_ERROR;
  },

  _clearCredentialSecrets() {
    const nextNotifications = normalizeNotificationSettings(this.notifications);
    nextNotifications.telegram = {
      ...nextNotifications.telegram,
      botToken: '',
    };
    this.notifications = nextNotifications;

    const nextRemoteControl = normalizeRemoteControlSettings(this.remoteControl);
    nextRemoteControl.telegram = {
      ...nextRemoteControl.telegram,
      botToken: '',
    };
    this.remoteControl = nextRemoteControl;
  },

  _applyUnlockedCredentialSecrets(secrets: any = {}) {
    const notificationBotToken = String(secrets?.notifications?.telegram?.botToken || '').trim();
    const remoteBotToken = String(secrets?.remoteControl?.telegram?.botToken || '').trim();
    this.notifications = normalizeNotificationSettings({
      ...(this.notifications && typeof this.notifications === 'object' ? this.notifications : {}),
      telegram: {
        ...((this.notifications?.telegram && typeof this.notifications.telegram === 'object')
          ? this.notifications.telegram
          : {}),
        botToken: notificationBotToken,
      },
    });
    this.remoteControl = normalizeRemoteControlSettings({
      ...(this.remoteControl && typeof this.remoteControl === 'object' ? this.remoteControl : {}),
      telegram: {
        ...((this.remoteControl?.telegram && typeof this.remoteControl.telegram === 'object')
          ? this.remoteControl.telegram
          : {}),
        botToken: remoteBotToken,
      },
    });
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
      const queuedMessageId = String(item?.id || '').trim();
      return {
        id: queuedMessageId || `q-${conversationId}-${queuedAt || Date.now()}-${index + 1}`,
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

  _conversationSwitchPayload(conversationId) {
    const activeId = String(conversationId || this.activeConversationId || '').trim();
    const conv = activeId ? getConversation(this.conversations, activeId) : null;
    const runtime = activeId ? this.runtimeStore.ensure(activeId) : null;
    const notificationCenter = this._syncNotificationCenter();
    const remoteControlCenter = this._syncRemoteControlCenter();
    return {
      settings: {
        commandText: this.commandText,
        workdir: activeId ? this._resolveConversationWorkdir(activeId) : this._defaultWorkdir(),
        defaultWorkdir: this._defaultWorkdir(),
        deviceIdentity: notificationCenter.getDeviceIdentity(),
        notifications: notificationCenter.snapshot({ includeSecrets: !this._hasLockedCredentialVault() }),
        remoteControl: remoteControlCenter.snapshot({ includeSecrets: !this._hasLockedCredentialVault() }),
        security: securitySnapshot(this),
      },
      activeConversationId: activeId,
      conversation: conv || null,
      runtime: runtime ? {
        workflow: [...runtime.workflow],
        events: [...runtime.events],
        raw: [...runtime.raw],
        phase: runtime.phase,
        startedAt: runtime.startedAt,
      } : null,
      meta: activeId ? { ...this._ensureMeta(activeId) } : null,
      runningConversationIds: Array.from(this.runners.keys()),
      queuedCount: activeId ? this._pendingQueueSize(activeId) : 0,
      queuedMessages: activeId ? this._queuedItemsForUi(activeId) : [],
    };
  },

  _appendStructuredEvent(conversationId, level, message, options = {}) {
    const optionBag = options && typeof options === 'object' ? options : {};
    this.structuredEventSeq += 1;
    const runtime = this.runtimeStore.ensure(conversationId);
    const item = {
      id: `evt-${Date.now()}-${this.structuredEventSeq}`,
      level,
      message: String(message || ''),
      ...(Reflect.has(optionBag, 'kind') ? { kind: Reflect.get(optionBag, 'kind') } : {}),
      ...(Reflect.has(optionBag, 'body') ? { body: Reflect.get(optionBag, 'body') } : {}),
      ...(Reflect.has(optionBag, 'rawRefId') ? { rawRefId: Reflect.get(optionBag, 'rawRefId') } : {}),
      ...(Reflect.has(optionBag, 'rawRefLabel') ? { rawRefLabel: Reflect.get(optionBag, 'rawRefLabel') } : {}),
      timestamp: tsLabel(),
    };
    pushBounded(runtime.events, item, MAX_RUNTIME_EVENTS);
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
    pushBounded(runtime.events, item, MAX_RUNTIME_EVENTS);
    this._emit({ type: 'runtime-event-append', conversationId, item });
  },

  _appendStructuredAssistantProgress(conversationId, text, options = {}) {
    const fullText = String(text || '').trim();
    if (!fullText) {
      return;
    }
    const optionBag = options && typeof options === 'object' ? options : {};
    const roundIndex = Math.max(1, Number(Reflect.get(optionBag, 'roundIndex') || 0) || 1);
    const providedSegmentIndex = Number(Reflect.get(optionBag, 'segmentIndex') || 0) || 0;
    const eventIndex = this._findLastStructuredEventIndex(
      conversationId,
      (item) => item?.kind === 'assistant-progress'
        && item?.status === 'running'
        && Number(item?.roundIndex || 0) === roundIndex,
    );
    const nextTimestamp = tsLabel();
    if (eventIndex >= 0) {
      const runtime = this.runtimeStore.ensure(conversationId);
      const current = runtime.events[eventIndex] || {};
      const segmentIndex = Number(current.segmentIndex || providedSegmentIndex || 0) || 0;
      const previousFullText = String(current.previousFullText || '').trim();
      const body = extractIncrementalProgressText(fullText, previousFullText)
        || String(current.body || '').trim()
        || fullText;
      this._updateStructuredEvent(conversationId, eventIndex, {
        ...current,
        fullText,
        body,
        message: buildStructuredProgressMessage(body, segmentIndex),
        timestamp: nextTimestamp,
      });
      return;
    }

    const previousFullText = this._latestAssistantProgressFullText(conversationId, roundIndex);
    const body = extractIncrementalProgressText(fullText, previousFullText);
    if (!body) {
      return;
    }
    this.structuredEventSeq += 1;
    const runtime = this.runtimeStore.ensure(conversationId);
    const item = {
      id: `evt-${Date.now()}-${this.structuredEventSeq}`,
      level: 'hint',
      kind: 'assistant-progress',
      roundIndex,
      segmentIndex: providedSegmentIndex || this._nextAssistantProgressSegmentIndex(conversationId, roundIndex),
      previousFullText,
      fullText,
      body,
      status: 'running',
      message: buildStructuredProgressMessage(
        body,
        providedSegmentIndex || this._nextAssistantProgressSegmentIndex(conversationId, roundIndex),
      ),
      timestamp: nextTimestamp,
    };
    pushBounded(runtime.events, item, MAX_RUNTIME_EVENTS);
    this._emit({ type: 'runtime-event-append', conversationId, item });
  },

  _appendStructuredRequestEvent(conversationId, text, options = {}) {
    const body = String(text || '').trim();
    if (!body) {
      return;
    }
    const optionBag = options && typeof options === 'object' ? options : {};
    this.structuredEventSeq += 1;
    const runtime = this.runtimeStore.ensure(conversationId);
    const item = {
      id: `evt-${Date.now()}-${this.structuredEventSeq}`,
      level: 'hint',
      kind: 'request',
      roundIndex: Number(Reflect.get(optionBag, 'roundIndex') || 0) || 0,
      body,
      message: `请求: ${normalizePreview(body, 180)}`,
      timestamp: tsLabel(),
    };
    pushBounded(runtime.events, item, MAX_RUNTIME_EVENTS);
    this._emit({ type: 'runtime-event-append', conversationId, item });
  },

  _resolveNotificationFailureReason(conversationId, {
    fallback = '',
    exitCode = '',
  } = {}) {
    const runtime = this.runtimeStore.ensure(conversationId);
    const events = Array.isArray(runtime?.events) ? runtime.events : [];
    for (const level of ['error', 'warn']) {
      for (let index = events.length - 1; index >= 0; index -= 1) {
        const item = events[index];
        if (String(item?.level || '').trim().toLowerCase() !== level) {
          continue;
        }
        const resolved = normalizeNotificationFailureEventMessage(item?.message, exitCode);
        if (resolved) {
          return resolved;
        }
      }
    }
    const fallbackText = String(fallback || '').trim();
    if (fallbackText) {
      return fallbackText;
    }
    if (Number.isInteger(Number(exitCode)) && Number(exitCode) > 0) {
      return `任务失败，退出码 ${Number(exitCode)}`;
    }
    return '任务失败';
  },

  _removeLastStructuredEventIf(conversationId, predicate) {
    const runtime = this.runtimeStore.ensure(conversationId);
    if (typeof predicate !== 'function') {
      return false;
    }
    const targetIndex = this._findLastStructuredEventIndex(conversationId, predicate);
    if (targetIndex < 0) {
      return false;
    }
    runtime.events.splice(targetIndex, 1);
    this._emit({ type: 'runtime-event-pop', conversationId, index: targetIndex });
    return true;
  },

  _appendWorkflowRoundHeader(conversationId, roundIndex, userText) {
    this._appendStructuredRequestEvent(conversationId, userText, { roundIndex });
    const body = String(userText || '').trim();
    if (!body) {
      return;
    }
    const runtime = this.runtimeStore.ensure(conversationId);
    const item = {
      type: 'round',
      roundIndex: Number(roundIndex || 0) || 0,
      stepIndex: 0,
      title: `请求 ${Number(roundIndex || 0) || 0}`,
      tag: 'REQUEST',
      channel: 'progress',
      importance: 'high',
      sourceKind: 'request',
      preview: normalizePreview(body),
      body,
      timestamp: tsLabel(),
    };
    pushBounded(runtime.workflow, item, MAX_RUNTIME_WORKFLOW);
    this._emit({ type: 'runtime-workflow-append', conversationId, item });
  },

  _resolveLatestWorkflowPurpose(conversationId, roundIndex) {
    const runtime = this.runtimeStore.ensure(conversationId);
    const items = Array.isArray(runtime.workflow) ? runtime.workflow : [];
    const targetRound = Number(roundIndex || 0);
    for (let index = items.length - 1; index >= 0; index -= 1) {
      const item = items[index];
      if (!item || typeof item !== 'object') {
        continue;
      }
      if (targetRound > 0 && Number(item.roundIndex || 0) !== targetRound) {
        continue;
      }
      if (item.type === 'assistant-progress') {
        const purpose = summarizeWorkflowPurposeText(item.fullText || item.body || '');
        if (purpose) {
          return purpose;
        }
      }
      if (item.type === 'plan') {
        const planItems = Array.isArray(item.planItems) ? item.planItems : [];
        const active = planItems.find((entry) => String(entry?.status || '').trim().toLowerCase() === 'in_progress');
        const pending = planItems.find((entry) => String(entry?.status || '').trim().toLowerCase() === 'pending');
        const purpose = summarizeWorkflowPurposeText(active?.step || pending?.step || item.preview || '');
        if (purpose) {
          return purpose;
        }
      }
    }
    return '';
  },

  _appendWorkflowStep(conversationId, stepText, options = {}) {
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

    const commandPurpose = String(Reflect.get(options || {}, 'purpose') || '').trim();
    if ((tag === 'RUN' || tag === 'DONE') && commandPurpose) {
      body = `目的: ${commandPurpose}\n\n${body}`;
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
      ...(commandPurpose ? { commandPurpose } : {}),
      body,
      timestamp: tsLabel(),
    };
    pushBounded(runtime.workflow, item, MAX_RUNTIME_WORKFLOW);
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
    pushBounded(runtime.workflow, item, MAX_RUNTIME_WORKFLOW);
    this._emit({ type: 'runtime-workflow-append', conversationId, item });
  },

  _appendWorkflowAssistantUpdate(conversationId, roundIndex, text) {
    this._appendWorkflowAssistantMessage(conversationId, roundIndex, text, 'running');
  },

  _appendWorkflowAssistantProgress(conversationId, roundIndex, text, options = {}) {
    const fullText = String(text || '').trim();
    if (!fullText) {
      return;
    }
    const targetRound = Math.max(1, Number(roundIndex || 0) || 1);
    const optionBag = options && typeof options === 'object' ? options : {};
    const providedSegmentIndex = Number(Reflect.get(optionBag, 'segmentIndex') || 0) || 0;
    const workflowIndex = this._findLastWorkflowItemIndex(
      conversationId,
      (item) => item?.type === 'assistant-progress'
        && item?.status === 'running'
        && Number(item?.roundIndex || 0) === targetRound,
    );
    const nextTimestamp = tsLabel();
    if (workflowIndex >= 0) {
      const runtime = this.runtimeStore.ensure(conversationId);
      const current = runtime.workflow[workflowIndex] || {};
      const previousFullText = String(current.previousFullText || '').trim();
      const body = extractIncrementalProgressText(fullText, previousFullText)
        || String(current.body || '').trim()
        || fullText;
      this._updateWorkflowItem(conversationId, workflowIndex, {
        ...current,
        fullText,
        body,
        timestamp: nextTimestamp,
      });
      return;
    }

    const segmentIndex = providedSegmentIndex || this._nextAssistantProgressSegmentIndex(conversationId, targetRound);
    const previousFullText = this._latestAssistantProgressFullText(conversationId, targetRound);
    const body = extractIncrementalProgressText(fullText, previousFullText);
    if (!body) {
      return;
    }
    const runtime = this.runtimeStore.ensure(conversationId);
    const item = {
      type: 'assistant-progress',
      roundIndex: targetRound,
      stepIndex: 997,
      segmentIndex,
      title: `assistant-progress-${segmentIndex}`,
      tag: 'PROG',
      channel: 'status',
      importance: 'high',
      sourceKind: 'assistant-progress',
      previousFullText,
      fullText,
      body,
      status: 'running',
      timestamp: nextTimestamp,
    };
    pushBounded(runtime.workflow, item, MAX_RUNTIME_WORKFLOW);
    this._emit({ type: 'runtime-workflow-append', conversationId, item });
  },

  _appendWorkflowAssistantReply(conversationId, roundIndex, text) {
    this._appendWorkflowAssistantMessage(conversationId, roundIndex, text, 'success');
  },

  _upsertWorkflowPlan(conversationId, roundIndex, {
    explanation = '',
    plan = [],
  } = {}) {
    const summary = summarizeWorkflowPlan(plan);
    const runtime = this.runtimeStore.ensure(conversationId);
    for (let index = runtime.workflow.length - 1; index >= 0; index -= 1) {
      const item = runtime.workflow[index];
      if (
        item
        && item.type === 'plan'
        && Number(item.roundIndex || 0) === Number(roundIndex || 0)
      ) {
        runtime.workflow.splice(index, 1);
        this._emit({ type: 'runtime-workflow-pop', conversationId, index });
        break;
      }
    }
    const item = {
      type: 'plan',
      roundIndex: Number(roundIndex || 0) || 0,
      stepIndex: 998,
      title: summary.total > 0 ? `计划 ${summary.completed}/${summary.total}` : '计划',
      tag: 'PLAN',
      channel: 'progress',
      importance: 'high',
      sourceKind: 'plan',
      body: buildWorkflowPlanBody(explanation, plan),
      preview: summary.preview,
      planExplanation: String(explanation || '').trim(),
      planItems: Array.isArray(plan) ? plan.map((entry) => ({
        step: String(entry?.step || '').trim(),
        status: normalizeWorkflowPlanStatus(entry?.status),
      })) : [],
      timestamp: tsLabel(),
    };
    pushBounded(runtime.workflow, item, MAX_RUNTIME_WORKFLOW);
    this._emit({ type: 'runtime-workflow-append', conversationId, item });
  },

  _removeLastWorkflowItemIf(conversationId, predicate) {
    const runtime = this.runtimeStore.ensure(conversationId);
    if (typeof predicate !== 'function') {
      return false;
    }
    const targetIndex = this._findLastWorkflowItemIndex(conversationId, predicate);
    if (targetIndex < 0) {
      return false;
    }
    runtime.workflow.splice(targetIndex, 1);
    this._emit({ type: 'runtime-workflow-pop', conversationId, index: targetIndex });
    return true;
  },

  _findLastStructuredEventIndex(conversationId, predicate) {
    const runtime = this.runtimeStore.ensure(conversationId);
    if (typeof predicate !== 'function') {
      return -1;
    }
    for (let index = runtime.events.length - 1; index >= 0; index -= 1) {
      const item = runtime.events[index];
      if (predicate(item)) {
        return index;
      }
    }
    return -1;
  },

  _updateStructuredEvent(conversationId, index, nextItem) {
    const runtime = this.runtimeStore.ensure(conversationId);
    if (!Number.isInteger(index) || index < 0 || index >= runtime.events.length) {
      return false;
    }
    runtime.events[index] = nextItem;
    this._emit({ type: 'runtime-event-update', conversationId, index, item: nextItem });
    return true;
  },

  _findLastWorkflowItemIndex(conversationId, predicate) {
    const runtime = this.runtimeStore.ensure(conversationId);
    if (typeof predicate !== 'function') {
      return -1;
    }
    for (let index = runtime.workflow.length - 1; index >= 0; index -= 1) {
      const item = runtime.workflow[index];
      if (predicate(item)) {
        return index;
      }
    }
    return -1;
  },

  _updateWorkflowItem(conversationId, index, nextItem) {
    const runtime = this.runtimeStore.ensure(conversationId);
    if (!Number.isInteger(index) || index < 0 || index >= runtime.workflow.length) {
      return false;
    }
    runtime.workflow[index] = nextItem;
    this._emit({ type: 'runtime-workflow-update', conversationId, index, item: nextItem });
    return true;
  },

  _nextAssistantProgressSegmentIndex(conversationId, roundIndex) {
    const targetRound = Math.max(1, Number(roundIndex || 0) || 1);
    const runtime = this.runtimeStore.ensure(conversationId);
    let maxIndex = 0;
    for (const item of runtime.workflow) {
      if (item?.type !== 'assistant-progress') {
        continue;
      }
      if (Number(item?.roundIndex || 0) !== targetRound) {
        continue;
      }
      maxIndex = Math.max(maxIndex, Number(item?.segmentIndex || 0) || 0);
    }
    for (const item of runtime.events) {
      if (item?.kind !== 'assistant-progress') {
        continue;
      }
      if (Number(item?.roundIndex || 0) !== targetRound) {
        continue;
      }
      maxIndex = Math.max(maxIndex, Number(item?.segmentIndex || 0) || 0);
    }
    return maxIndex + 1;
  },

  _latestAssistantProgressFullText(conversationId, roundIndex) {
    const targetRound = Math.max(1, Number(roundIndex || 0) || 1);
    const runtime = this.runtimeStore.ensure(conversationId);
    for (let index = runtime.workflow.length - 1; index >= 0; index -= 1) {
      const item = runtime.workflow[index];
      if (item?.type !== 'assistant-progress') {
        continue;
      }
      if (Number(item?.roundIndex || 0) !== targetRound) {
        continue;
      }
      const text = String(item?.fullText || item?.body || '').trim();
      if (text) {
        return text;
      }
    }
    return '';
  },

  _resolveAssistantProgressSegmentIndex(conversationId, roundIndex) {
    const targetRound = Math.max(1, Number(roundIndex || 0) || 1);
    const runningWorkflowIndex = this._findLastWorkflowItemIndex(
      conversationId,
      (item) => item?.type === 'assistant-progress'
        && item?.status === 'running'
        && Number(item?.roundIndex || 0) === targetRound,
    );
    if (runningWorkflowIndex >= 0) {
      const runtime = this.runtimeStore.ensure(conversationId);
      const segmentIndex = Number(runtime.workflow[runningWorkflowIndex]?.segmentIndex || 0) || 0;
      if (segmentIndex > 0) {
        return segmentIndex;
      }
    }
    const runningEventIndex = this._findLastStructuredEventIndex(
      conversationId,
      (item) => item?.kind === 'assistant-progress'
        && item?.status === 'running'
        && Number(item?.roundIndex || 0) === targetRound,
    );
    if (runningEventIndex >= 0) {
      const runtime = this.runtimeStore.ensure(conversationId);
      const segmentIndex = Number(runtime.events[runningEventIndex]?.segmentIndex || 0) || 0;
      if (segmentIndex > 0) {
        return segmentIndex;
      }
    }
    return this._nextAssistantProgressSegmentIndex(conversationId, targetRound);
  },

  _sealAssistantProgressSegments(conversationId, roundIndex, status = 'success') {
    const targetRound = Math.max(1, Number(roundIndex || 0) || 1);
    const nextStatus = String(status || 'success').trim() || 'success';
    const structuredIndex = this._findLastStructuredEventIndex(
      conversationId,
      (item) => item?.kind === 'assistant-progress'
        && item?.status === 'running'
        && Number(item?.roundIndex || 0) === targetRound,
    );
    if (structuredIndex >= 0) {
      const runtime = this.runtimeStore.ensure(conversationId);
      const current = runtime.events[structuredIndex] || {};
      this._updateStructuredEvent(conversationId, structuredIndex, {
        ...current,
        status: nextStatus,
      });
    }

    const workflowIndex = this._findLastWorkflowItemIndex(
      conversationId,
      (item) => item?.type === 'assistant-progress'
        && item?.status === 'running'
        && Number(item?.roundIndex || 0) === targetRound,
    );
    if (workflowIndex >= 0) {
      const runtime = this.runtimeStore.ensure(conversationId);
      const current = runtime.workflow[workflowIndex] || {};
      this._updateWorkflowItem(conversationId, workflowIndex, {
        ...current,
        status: nextStatus,
      });
    }
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

  snapshot() {
    const activeWorkdir = this.activeConversationId
      ? this._resolveConversationWorkdir(this.activeConversationId)
      : this._defaultWorkdir();
    const notificationCenter = this._syncNotificationCenter();
    const remoteControlCenter = this._syncRemoteControlCenter();
    return {
      settings: {
        commandText: this.commandText,
        workdir: activeWorkdir,
        defaultWorkdir: this._defaultWorkdir(),
        useNativeMemory: this.useNativeMemory,
        deviceIdentity: notificationCenter.getDeviceIdentity(),
        notifications: notificationCenter.snapshot({ includeSecrets: !this._hasLockedCredentialVault() }),
        remoteControl: remoteControlCenter.snapshot({ includeSecrets: !this._hasLockedCredentialVault() }),
        security: securitySnapshot(this),
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

  setMasterPassword(password) {
    if (this.security?.hasMasterPassword && !this.security?.unlocked) {
      return { ok: false, error: '请先解锁后再修改主密码', snapshot: this.snapshot() };
    }
    try {
      const result = this.stateStorage.setVaultPassword(password);
      this.vault = result?.vault || this.vault;
      this.security = {
        hasMasterPassword: true,
        unlocked: true,
      };
      this.vaultKey = result?.key || null;
      this._syncNotificationCenter();
      this._syncRemoteControlCenter();
      this._persist();
      return { ok: true, snapshot: this.snapshot() };
    } catch (error) {
      return { ok: false, error: error?.message || String(error), snapshot: this.snapshot() };
    }
  },

  unlockMasterPassword(password) {
    if (!this.security?.hasMasterPassword) {
      return { ok: false, error: '当前还没有设置主密码', snapshot: this.snapshot() };
    }
    try {
      const result = this.stateStorage.unlockSecrets(password);
      this.vaultKey = result?.key || null;
      if (!this.vault?.passwordHash || !this.vault?.passwordSalt) {
        this.vault = this.stateStorage.loadState().vault || this.vault;
      }
      this.security = {
        hasMasterPassword: true,
        unlocked: true,
      };
      this._applyUnlockedCredentialSecrets(result?.secrets || {});
      this._syncNotificationCenter();
      this._syncRemoteControlCenter();
      return { ok: true, snapshot: this.snapshot() };
    } catch (error) {
      return { ok: false, error: error?.message || String(error), snapshot: this.snapshot() };
    }
  },

  lockMasterPassword() {
    if (!this.security?.hasMasterPassword) {
      return { ok: true, snapshot: this.snapshot() };
    }
    this.vaultKey = null;
    this.security = {
      hasMasterPassword: true,
      unlocked: false,
    };
    this._clearCredentialSecrets();
    this._syncNotificationCenter();
    this._syncRemoteControlCenter();
    this._persist();
    return { ok: true, snapshot: this.snapshot() };
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
    const conv = newConversation(imported.title, this.conversations);
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
