const {
  ASSISTANT_STREAM_PREVIEW_MIN_GROWTH,
  ASSISTANT_STREAM_PREVIEW_MIN_INTERVAL_MS,
  normalizeAssistantRuntimeText,
} = require('./chat_helpers');

const chatStreamPreviewMethods = {
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
    const streamOptions = new Map(Object.entries(options || {}));
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
};

module.exports = {
  chatStreamPreviewMethods,
};
