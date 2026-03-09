function sortedConversations() {
  return [...state.conversations].sort((a, b) => {
    const bu = Number(b.updatedAt || 0);
    const au = Number(a.updatedAt || 0);
    if (bu !== au) {
      return bu - au;
    }
    return Number(b.createdAt || 0) - Number(a.createdAt || 0);
  });
}

function currentConversation() {
  return state.conversations.find((item) => item.id === state.activeConversationId) || null;
}

function hasActiveConversation() {
  return Boolean(currentConversation());
}

function ensureCollapsed(conversationId) {
  if (!state.collapsedByConversation[conversationId] || typeof state.collapsedByConversation[conversationId] !== 'object') {
    state.collapsedByConversation[conversationId] = {};
  }
  return state.collapsedByConversation[conversationId];
}

function isMessageCollapsed(conversationId, index) {
  if (!conversationId) {
    return false;
  }
  const table = ensureCollapsed(conversationId);
  return Boolean(table[String(index)]);
}

function setMessageCollapsed(conversationId, index, collapsed) {
  if (!conversationId) {
    return;
  }
  const key = String(index);
  const table = ensureCollapsed(conversationId);
  if (collapsed) {
    table[key] = true;
  } else {
    delete table[key];
  }
}

function cleanupCollapsed(conversationId, messageCount) {
  if (!conversationId || !state.collapsedByConversation[conversationId]) {
    return;
  }
  const table = state.collapsedByConversation[conversationId];
  const maxIndex = Number(messageCount || 0) - 1;
  Object.keys(table).forEach((key) => {
    const idx = Number(key);
    if (!Number.isInteger(idx) || idx < 0 || idx > maxIndex) {
      delete table[key];
    }
  });
}

function ensureWorkflowCollapsed(conversationId) {
  if (!state.workflowCollapsedByConversation[conversationId] || typeof state.workflowCollapsedByConversation[conversationId] !== 'object') {
    state.workflowCollapsedByConversation[conversationId] = {};
  }
  return state.workflowCollapsedByConversation[conversationId];
}

function isWorkflowStepCollapsed(conversationId, index) {
  if (!conversationId) {
    return true;
  }
  const table = ensureWorkflowCollapsed(conversationId);
  const key = String(index);
  if (Object.prototype.hasOwnProperty.call(table, key)) {
    return Boolean(table[key]);
  }
  return true;
}

function setWorkflowStepCollapsed(conversationId, index, collapsed) {
  if (!conversationId) {
    return;
  }
  const key = String(index);
  const table = ensureWorkflowCollapsed(conversationId);
  table[key] = Boolean(collapsed);
}

function cleanupWorkflowCollapsed(conversationId, itemCount) {
  if (!conversationId || !state.workflowCollapsedByConversation[conversationId]) {
    return;
  }
  const table = state.workflowCollapsedByConversation[conversationId];
  const maxIndex = Number(itemCount || 0) - 1;
  Object.keys(table).forEach((key) => {
    const idx = Number(key);
    if (!Number.isInteger(idx) || idx < 0 || idx > maxIndex) {
      delete table[key];
    }
  });
}

function messagePreview(text) {
  const condensed = String(text || '').replace(/\s+/g, ' ').trim();
  if (!condensed) {
    return t('emptyMessagePreview');
  }
  const limit = 120;
  if (condensed.length <= limit) {
    return condensed;
  }
  return `${condensed.slice(0, limit - 1)}…`;
}

function ensureRuntime(conversationId) {
  if (!state.runtimeByConversation[conversationId]) {
    state.runtimeByConversation[conversationId] = {
      workflow: [],
      events: [],
      raw: [],
      phase: '空闲',
      startedAt: null,
    };
  }
  return state.runtimeByConversation[conversationId];
}

function ensureMeta(conversationId) {
  if (!state.metaByConversation[conversationId]) {
    state.metaByConversation[conversationId] = {
      Codex版本: '-',
      模型: '-',
      会话ID: '-',
    };
  }
  return state.metaByConversation[conversationId];
}

function isConversationRunning(conversationId) {
  return state.runningConversationIds.has(conversationId);
}

function anyConversationRunning() {
  return state.runningConversationIds.size > 0;
}

function canRetryLastMessage() {
  const conv = currentConversation();
  if (!conv || isConversationRunning(state.activeConversationId)) {
    return false;
  }
  const runtime = ensureRuntime(state.activeConversationId);
  const phase = String(runtime.phase || '');
  if (phaseKind(phase) !== 'error') {
    return false;
  }
  const messages = Array.isArray(conv.messages) ? conv.messages : [];
  return messages.some((item) => item && item.role === 'user' && String(item.text || '').trim());
}

function phaseKind(phaseText) {
  const text = String(phaseText || '');
  if (!text) {
    return 'idle';
  }
  if (['失败', 'error', 'failed'].some((k) => text.toLowerCase().includes(k))) {
    return 'error';
  }
  if (['完成', 'completed', 'success', 'done'].some((k) => text.toLowerCase().includes(k))) {
    return 'success';
  }
  if (['后台', 'background'].some((k) => text.toLowerCase().includes(k))) {
    return 'background';
  }
  if (['准备', '分析', '输出', '思考', '启动', '会话', '重连', '运行', 'running', 'starting', 'analyzing', 'generating', 'reconnecting']
    .some((k) => text.toLowerCase().includes(k))) {
    return 'running';
  }
  return 'idle';
}

function phaseLabel(phaseText) {
  if (currentLang() === 'zh-CN') {
    return String(phaseText || '');
  }
  const text = String(phaseText || '');
  const kind = phaseKind(text);
  if (text.includes('正在输出回复')) {
    return 'Generating response...';
  }
  if (text.includes('正在分析请求')) {
    return 'Analyzing request...';
  }
  if (text.includes('网络异常，正在重连')) {
    return 'Network issue, reconnecting...';
  }
  if (text.includes('准备中')) {
    return 'Preparing...';
  }
  if (kind === 'background') {
    return t('phaseBackground');
  }
  if (kind === 'running') {
    return t('phaseRunning');
  }
  if (kind === 'success') {
    return t('stateSuccess');
  }
  if (kind === 'error') {
    return t('stateError');
  }
  return t('phaseIdle');
}

function effectivePhaseRaw() {
  if (!hasActiveConversation()) {
    return anyConversationRunning() ? '后台运行中' : '空闲';
  }
  const runtime = ensureRuntime(state.activeConversationId);
  if (isConversationRunning(state.activeConversationId)) {
    return runtime.phase || '运行中';
  }
  if (anyConversationRunning()) {
    return '后台运行中';
  }
  return runtime.phase || '空闲';
}

function updatePhaseClass(phaseText) {
  const kind = phaseKind(phaseText);
  el.phase.classList.remove('phase-idle', 'phase-running', 'phase-success', 'phase-error');
  el.phaseChip.classList.remove('phase-chip-idle', 'phase-chip-running', 'phase-chip-success', 'phase-chip-error');
  if (kind === 'error') {
    el.phase.classList.add('phase-error');
    el.phaseChip.classList.add('phase-chip-error');
    return;
  }
  if (kind === 'success') {
    el.phase.classList.add('phase-success');
    el.phaseChip.classList.add('phase-chip-success');
    return;
  }
  if (kind === 'running' || kind === 'background') {
    el.phase.classList.add('phase-running');
    el.phaseChip.classList.add('phase-chip-running');
    return;
  }
  el.phase.classList.add('phase-idle');
  el.phaseChip.classList.add('phase-chip-idle');
}

function queuedCount(conversationId) {
  if (!conversationId) {
    return 0;
  }
  return Number(state.queuedCountByConversation[conversationId] || 0);
}

function queuedMessages(conversationId) {
  if (!conversationId) {
    return [];
  }
  const items = state.queuedMessagesByConversation?.[conversationId];
  if (!Array.isArray(items)) {
    return [];
  }
  return items;
}

function getConversationState(conversationId) {
  const running = isConversationRunning(conversationId);
  const queue = queuedCount(conversationId);
  const phase = String((state.runtimeByConversation?.[conversationId]?.phase) || '空闲');

  if (running) {
    return { key: 'running', label: t('stateRunning') };
  }
  const kind = phaseKind(phase);
  if (kind === 'error') {
    return { key: 'error', label: t('stateError') };
  }
  if (kind === 'success') {
    return { key: 'success', label: t('stateSuccess') };
  }
  if (queue > 0) {
    return { key: 'queued', label: t('stateQueued') };
  }
  return { key: 'idle', label: t('stateIdle') };
}
