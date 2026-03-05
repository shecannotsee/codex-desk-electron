class RuntimeStore {
  constructor() {
    this.states = new Map();
    this.roundCounter = new Map();
  }

  ensure(conversationId) {
    if (!this.states.has(conversationId)) {
      this.states.set(conversationId, {
        workflow: [],
        events: [],
        raw: [],
        phase: '空闲',
        startedAt: null,
      });
    }
    if (!this.roundCounter.has(conversationId)) {
      this.roundCounter.set(conversationId, 0);
    }
    return this.states.get(conversationId);
  }

  nextRound(conversationId) {
    const next = (this.roundCounter.get(conversationId) || 0) + 1;
    this.roundCounter.set(conversationId, next);
    return next;
  }

  remove(conversationId) {
    this.states.delete(conversationId);
    this.roundCounter.delete(conversationId);
  }

  toObject() {
    const result = {};
    for (const [key, value] of this.states.entries()) {
      result[key] = {
        workflow: [...value.workflow],
        events: [...value.events],
        raw: [...value.raw],
        phase: value.phase,
        startedAt: value.startedAt,
      };
    }
    return result;
  }
}

module.exports = { RuntimeStore };
