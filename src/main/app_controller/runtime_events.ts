const { tsLabel } = require('./shared');
const {
  MAX_RUNTIME_RAW,
  pushBounded,
} = require('./runtime_helpers');

const runtimeEventMethods = {
  _syncConversationUpdated(conversation) {
    this._emit({ type: 'conversation-updated', conversation });
  },

  _setPhase(conversationId, phase) {
    const runtime = this.runtimeStore.ensure(conversationId);
    runtime.phase = phase;
    this._emit({ type: 'runtime-phase', conversationId, phase });
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
};

module.exports = {
  runtimeEventMethods,
};
