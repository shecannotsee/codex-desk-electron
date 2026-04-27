const { normalizePreview, tsLabel } = require('./shared');
const {
  MAX_RUNTIME_EVENTS,
  MAX_RUNTIME_WORKFLOW,
  buildStructuredProgressMessage,
  buildWorkflowPlanBody,
  extractIncrementalProgressText,
  normalizeNotificationFailureEventMessage,
  normalizeWorkflowPlanStatus,
  pushBounded,
  summarizeWorkflowPlan,
  summarizeWorkflowPurposeText,
} = require('./runtime_helpers');

const runtimeWorkflowMethods = {
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

};

module.exports = {
  runtimeWorkflowMethods,
};
