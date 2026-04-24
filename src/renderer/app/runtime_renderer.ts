import type { RawEventEntry, RuntimeState, WorkflowItem } from './types.js';
import {
  el,
  ensureRuntimeVisibleCount,
  escapeHtml,
  increaseRuntimeVisibleCount,
  localizeKnownText,
  renderMarkdownLike,
  state,
  t,
} from './state_i18n.js';
import {
  cleanupWorkflowCollapsed,
  ensureRuntime,
  hasActiveConversation,
  isConversationRunning,
  isWorkflowStepCollapsed,
  messagePreview,
  queuedMessages,
  setWorkflowStepCollapsed,
} from './conversation_runtime.js';

function runningStepMarkdown(conversationId: string): string {
  if (!conversationId) {
    return localizeKnownText(t('phaseRunning'));
  }
  const runtime = ensureRuntime(conversationId);
  const assistantItem = findLatestWorkflowItem(runtime, (item) => item.type === 'assistant' && item.status === 'running');
  if (assistantItem) {
    const body = String(localizeKnownText(assistantItem.body || '')).trim();
    if (body) {
      return body;
    }
  }

  const stepItem = findLatestCurrentStepItem(runtime);
  if (stepItem) {
    return formatWorkflowItemMarkdown(stepItem);
  }
  const phaseText = String(localizeKnownText(runtime.phase || '')).trim();
  return phaseText || localizeKnownText(t('phaseRunning'));
}

function workflowChannel(item: WorkflowItem | null | undefined): string {
  return String(item?.channel || '').trim().toLowerCase();
}

function isWorkflowDetailItem(item: WorkflowItem | null | undefined): boolean {
  if (!item || typeof item !== 'object') {
    return false;
  }
  const channel = workflowChannel(item);
  if (channel === 'detail') {
    return true;
  }
  const tag = String(item.tag || '').trim().toUpperCase();
  return tag === 'RUN' || tag === 'DONE';
}

function isWorkflowProgressItem(item: WorkflowItem | null | undefined): boolean {
  if (!item || typeof item !== 'object') {
    return false;
  }
  return !isWorkflowDetailItem(item);
}

function findLatestWorkflowItem(
  runtime: RuntimeState | null | undefined,
  predicate: (item: WorkflowItem) => boolean,
): WorkflowItem | null {
  const items = Array.isArray(runtime?.workflow) ? runtime.workflow : [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item && typeof item === 'object' && predicate(item)) {
      return item;
    }
  }
  return null;
}

function findLatestCurrentStepItem(runtime: RuntimeState | null | undefined): WorkflowItem | null {
  return findLatestWorkflowItem(
    runtime,
    (item) => isWorkflowProgressItem(item) && item.type !== 'assistant' && item.type !== 'round',
  ) || findLatestWorkflowItem(
    runtime,
    (item) => isWorkflowProgressItem(item) && item.type !== 'assistant',
  );
}

function formatWorkflowItemMarkdown(item: WorkflowItem | null | undefined): string {
  if (!item || typeof item !== 'object') {
    return '';
  }
  if (item.type === 'round') {
    return String(localizeKnownText(item.preview || '')).trim();
  }
  const title = String(localizeKnownText(item.title || item.tag || '')).trim();
  const body = String(localizeKnownText(item.body || '')).trim();
  if (title && body) {
    return `**${title}**\n\n${body}`;
  }
  if (body) {
    return body;
  }
  return title;
}

function renderWorkflowRunningPanel(conversationId: string): string {
  if (!isConversationRunning(conversationId)) {
    return '';
  }
  const stepMarkdown = runningStepMarkdown(conversationId);
  return [
    '<div class="runtime-workflow-running-panel">',
    '<div class="msg-running-panel">',
    '<div class="msg-running-status">',
    '<div class="msg-running-dots" aria-hidden="true"><span></span><span></span><span></span></div>',
    `<div class="msg-running-status-text">${escapeHtml(t('runningInProgress'))}</div>`,
    '</div>',
    '<div class="msg-running-step-panel">',
    `<div class="msg-running-step">${renderMarkdownLike(stepMarkdown)}</div>`,
    '</div>',
    '</div>',
    '</div>',
  ].join('');
}

function renderRuntimePaginationBar(tab: 'structured' | 'workflow' | 'raw', totalCount: number, visibleCount: number): string {
  const total = Math.max(0, Number(totalCount) || 0);
  const visible = Math.max(0, Math.min(total, Number(visibleCount) || 0));
  const remaining = Math.max(0, total - visible);
  if (!remaining) {
    return '';
  }
  return [
    '<div class="chat-pagination-bar runtime-pagination-bar">',
    `<button type="button" class="chat-load-more-button" data-runtime-load-more="${escapeHtml(tab)}">${escapeHtml(t('runtimeLoadEarlier', { count: remaining }))}</button>`,
    `<div class="chat-pagination-summary">${escapeHtml(t('runtimeShowingRecent', { visible, total }))}</div>`,
    '</div>',
  ].join('');
}

function renderStructuredTab(runtime: RuntimeState, stickToBottom = true) {
  const totalCount = Array.isArray(runtime.events) ? runtime.events.length : 0;
  const visibleCount = ensureRuntimeVisibleCount(state.activeConversationId, 'structured', totalCount);
  const startIndex = Math.max(0, totalCount - visibleCount);
  const html = runtime.events.slice(startIndex).map((item) => {
    const level = escapeHtml(item.level || 'info');
    const message = escapeHtml(localizeKnownText(item.message || ''));
    return [
      `<div class="runtime-event level-${level}">`,
      `<span class="ts">[${escapeHtml(item.timestamp || '--:--:--')}]</span> `,
      `<b>${escapeHtml(String(item.level || 'INFO').toUpperCase())}</b> `,
      `<span>${message}</span>`,
      '</div>',
    ].join('');
  }).join('');

  el.tabStructured.innerHTML = `${renderRuntimePaginationBar('structured', totalCount, visibleCount)}${html}`;
  el.tabStructured.onclick = (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const button = target.closest('[data-runtime-load-more="structured"]');
    if (!button) {
      return;
    }
    increaseRuntimeVisibleCount(state.activeConversationId, 'structured', totalCount);
    renderStructuredTab(runtime, false);
  };
  if (stickToBottom) {
    el.tabStructured.scrollTop = el.tabStructured.scrollHeight;
  }
}

function formatQueuedAt(input: unknown): string {
  const ts = Number(input);
  if (!Number.isFinite(ts) || ts <= 0) {
    return '--:--:--';
  }
  const dt = new Date(ts);
  if (Number.isNaN(dt.getTime())) {
    return '--:--:--';
  }
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  const ss = String(dt.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function renderQueuedMessagesPanel(conversationId: string): string {
  const items = queuedMessages(conversationId);
  const hintHtml = `<div class="queue-popover-hint">${escapeHtml(t('queuedRepliesHint'))}</div>`;
  if (!items.length) {
    return `${hintHtml}<div class="queue-popover-empty">${escapeHtml(t('queueEmpty'))}</div>`;
  }
  const blocks = items.map((item, index) => {
    const title = t('queuedReplyItem', { index: index + 1 });
    const source = item?.fromRetry ? t('queuedFromRetry') : t('queuedFromInput');
    const queuedAt = formatQueuedAt(item?.queuedAt);
    const body = String(item?.text || item?.preview || '').trim();
    const attachmentCount = Array.isArray(item?.attachments) ? item.attachments.length : 0;
    const attachmentMeta = attachmentCount > 0 ? ` | ${t('attachmentCount', { count: attachmentCount })}` : '';
    const queuedMessageId = String(item?.id || '').trim();
    return [
      '<div class="queued-preview-item">',
      '<div class="queued-preview-item-head">',
      '<div class="queued-preview-item-head-main">',
      `<span class="title">${escapeHtml(title)}</span>`,
      `<span class="meta">${escapeHtml(source)} | ${escapeHtml(t('queuedAt'))} ${escapeHtml(queuedAt)}${escapeHtml(attachmentMeta)}</span>`,
      '</div>',
      `<button class="queued-preview-item-remove" type="button" data-queued-message-id="${escapeHtml(queuedMessageId)}" data-queued-index="${index + 1}" aria-label="${escapeHtml(t('queuedUndo'))}">${escapeHtml(t('queuedUndo'))}</button>`,
      '</div>',
      `<div class="queued-preview-item-body">${escapeHtml(body)}</div>`,
      '</div>',
    ].join('');
  }).join('');
  return `${hintHtml}${blocks}`;
}

function renderQueuePopover(conversationId: string): void {
  if (!el.queuePopoverBody) {
    return;
  }
  el.queuePopoverBody.innerHTML = renderQueuedMessagesPanel(conversationId);
}

function renderWorkflowTab(runtime: RuntimeState, stickToBottom = true) {
  const visibleItems = runtime.workflow.filter((item) => isWorkflowProgressItem(item));
  const totalCount = visibleItems.length;
  const visibleCount = ensureRuntimeVisibleCount(state.activeConversationId, 'workflow', totalCount);
  const startIndex = Math.max(0, totalCount - visibleCount);
  const renderedItems = visibleItems.slice(startIndex);

  const toggleWorkflowItem = (index: number) => {
    if (!Number.isInteger(index) || index < 0) {
      return;
    }
    const nextCollapsed = !isWorkflowStepCollapsed(state.activeConversationId, index);
    setWorkflowStepCollapsed(state.activeConversationId, index, nextCollapsed);
    renderWorkflowTab(runtime, false);
  };

  cleanupWorkflowCollapsed(state.activeConversationId, totalCount);
  const workflowHtml = renderedItems.map((item, offset) => {
    const index = startIndex + offset;
    const collapsed = isWorkflowStepCollapsed(state.activeConversationId, index);
    const toggleText = collapsed ? t('expandMessage') : t('collapseMessage');
    if (item.type === 'round') {
      const previewText = String(item.preview || '').trim();
      const collapsedLine = `${t('question')} #${item.roundIndex} | ${messagePreview(previewText)}`;
      return [
        `<div class="runtime-step-round${collapsed ? ' collapsed' : ''}" data-wf-index="${escapeHtml(index)}">`,
        '<div class="runtime-step-round-head">',
        `<div class="title">${escapeHtml(t('question'))} #${escapeHtml(item.roundIndex)}</div>`,
        `<button type="button" class="runtime-step-toggle" data-wf-index="${escapeHtml(index)}" aria-expanded="${collapsed ? 'false' : 'true'}">${escapeHtml(toggleText)}</button>`,
        '</div>',
        `<div class="preview">${escapeHtml(item.preview || '')}</div>`,
        `<div class="time">${escapeHtml(t('startTime'))} ${escapeHtml(item.timestamp || '--:--:--')}</div>`,
        `<div class="runtime-step-collapsed-line">${escapeHtml(collapsedLine)}</div>`,
        '</div>',
      ].join('');
    }

    if (item.type === 'assistant') {
      const assistantStatus = item.status === 'running' ? t('stateRunning') : t('stateSuccess');
      const collapsedLine = messagePreview(localizeKnownText(item.body || ''));
      return [
        `<div class="runtime-step tag-${escapeHtml(item.tag || 'REPLY')}${collapsed ? ' collapsed' : ''}" data-wf-index="${escapeHtml(index)}">`,
        '<div class="runtime-step-head">',
        `<span class="left">${escapeHtml(t('roleCodex'))} | ${escapeHtml(assistantStatus)}</span>`,
        '<span class="right-group">',
        `<span class="right">${escapeHtml(item.timestamp || '--:--:--')}</span>`,
        `<button type="button" class="runtime-step-toggle" data-wf-index="${escapeHtml(index)}" aria-expanded="${collapsed ? 'false' : 'true'}">${escapeHtml(toggleText)}</button>`,
        '</span>',
        '</div>',
        `<div class="runtime-step-body">${renderMarkdownLike(localizeKnownText(item.body || ''))}</div>`,
        `<div class="runtime-step-collapsed-line">${escapeHtml(collapsedLine)}</div>`,
        '</div>',
      ].join('');
    }

    const collapsedLine = messagePreview(localizeKnownText(item.body || ''));
    return [
      `<div class="runtime-step tag-${escapeHtml(item.tag || 'INFO')}${collapsed ? ' collapsed' : ''}" data-wf-index="${escapeHtml(index)}">`,
      '<div class="runtime-step-head">',
      `<span class="left">${escapeHtml(item.tag || 'INFO')} | ${escapeHtml(item.title || '')}</span>`,
      '<span class="right-group">',
      `<span class="right">${escapeHtml(item.timestamp || '--:--:--')}</span>`,
      `<button type="button" class="runtime-step-toggle" data-wf-index="${escapeHtml(index)}" aria-expanded="${collapsed ? 'false' : 'true'}">${escapeHtml(toggleText)}</button>`,
      '</span>',
      '</div>',
      `<div class="runtime-step-body">${renderMarkdownLike(localizeKnownText(item.body || ''))}</div>`,
      `<div class="runtime-step-collapsed-line">${escapeHtml(collapsedLine)}</div>`,
      '</div>',
    ].join('');
  }).join('');
  const emptyHtml = workflowHtml ? '' : `<div class="tip">${escapeHtml(t('runtimeWorkflowEmpty'))}</div>`;
  const runningHtml = renderWorkflowRunningPanel(state.activeConversationId);
  const html = `${renderRuntimePaginationBar('workflow', totalCount, visibleCount)}${emptyHtml}${workflowHtml}${runningHtml}`;

  el.tabWorkflow.innerHTML = html;
  el.tabWorkflow.onclick = (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }

    const toggleBtn = target.closest('.runtime-step-toggle');
    if (toggleBtn) {
      event.preventDefault();
      event.stopPropagation();
      const index = Number(toggleBtn.getAttribute('data-wf-index') || '-1');
      toggleWorkflowItem(index);
      return;
    }

    const loadMoreButton = target.closest('[data-runtime-load-more="workflow"]');
    if (loadMoreButton) {
      increaseRuntimeVisibleCount(state.activeConversationId, 'workflow', totalCount);
      renderWorkflowTab(runtime, false);
      return;
    }

    const clickable = target.closest('.runtime-step-head, .runtime-step-round-head, .runtime-step-collapsed-line, .runtime-step-round');
    if (!clickable) {
      return;
    }
    const container = clickable.closest('[data-wf-index]');
    if (!container) {
      return;
    }
    const index = Number(container.getAttribute('data-wf-index') || '-1');
    toggleWorkflowItem(index);
  };
  if (stickToBottom) {
    el.tabWorkflow.scrollTop = el.tabWorkflow.scrollHeight;
  }
}

function formatRawEventLine(line: unknown): string {
  const text = typeof line === 'string'
    ? String(line || '').trim()
    : String((line as RawEventEntry | null | undefined)?.line || '').trim();
  if (!text) {
    return '';
  }
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return text;
  }
}

function rawEventDirectionLabel(entry: string | RawEventEntry | null | undefined): string {
  const direction = typeof entry === 'object' && entry
    ? String(entry.direction || '').trim().toLowerCase()
    : '';
  return direction === 'sent' ? t('rawEventSent') : t('rawEventReceived');
}

function rawEventDirectionClass(entry: string | RawEventEntry | null | undefined): string {
  const direction = typeof entry === 'object' && entry
    ? String(entry.direction || '').trim().toLowerCase()
    : '';
  return direction === 'sent' ? 'sent' : 'received';
}

function renderRawTab(runtime: RuntimeState, stickToBottom = true) {
  const totalCount = Array.isArray(runtime.raw) ? runtime.raw.length : 0;
  const visibleCount = ensureRuntimeVisibleCount(state.activeConversationId, 'raw', totalCount);
  const startIndex = Math.max(0, totalCount - visibleCount);
  const html = (runtime.raw || [])
    .slice(startIndex)
    .map((entry) => {
      const formatted = formatRawEventLine(entry);
      if (!formatted) {
        return '';
      }
      const direction = rawEventDirectionClass(entry);
      const label = rawEventDirectionLabel(entry);
      return [
        '<div class="raw-event-inline-entry">',
        '<div class="raw-event-inline-head">',
        `<span class="raw-event-inline-badge raw-event-inline-badge-${escapeHtml(direction)}">${escapeHtml(label)}</span>`,
        '</div>',
        `<pre class="raw-event-json">${escapeHtml(formatted)}</pre>`,
        '</div>',
      ].join('');
    })
    .filter(Boolean)
    .join('');
  el.tabRaw.innerHTML = [
    renderRuntimePaginationBar('raw', totalCount, visibleCount),
    html || `<div class="tip">${escapeHtml(t('runtimeTipRaw'))}</div>`,
  ].join('');
  el.tabRaw.onclick = (event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const button = target.closest('[data-runtime-load-more="raw"]');
    if (!button) {
      return;
    }
    increaseRuntimeVisibleCount(state.activeConversationId, 'raw', totalCount);
    renderRawTab(runtime, false);
  };
  if (stickToBottom) {
    el.tabRaw.scrollTop = el.tabRaw.scrollHeight;
  }
}

function renderActiveRuntimeTab(runtime: RuntimeState, stickToBottom = true) {
  if (state.activeTab === 'structured') {
    renderStructuredTab(runtime, stickToBottom);
    return;
  }
  if (state.activeTab === 'raw') {
    renderRawTab(runtime, stickToBottom);
    return;
  }
  renderWorkflowTab(runtime, stickToBottom);
}

function renderRuntime(stickToBottom = true) {
  if (!hasActiveConversation()) {
    if (state.activeTab === 'structured') {
      el.tabStructured.innerHTML = `<div class="tip">${escapeHtml(t('runtimeTipStructured'))}</div>`;
    } else if (state.activeTab === 'raw') {
      el.tabRaw.textContent = t('runtimeTipRaw');
    } else {
      el.tabWorkflow.innerHTML = `<div class="tip">${escapeHtml(t('runtimeTipWorkflow'))}</div>`;
    }
    return;
  }
  const runtime = ensureRuntime(state.activeConversationId);
  renderActiveRuntimeTab(runtime, stickToBottom);
}

export {
  runningStepMarkdown,
  renderStructuredTab,
  formatQueuedAt,
  renderQueuedMessagesPanel,
  renderQueuePopover,
  renderWorkflowTab,
  renderRawTab,
  renderRuntime,
};
