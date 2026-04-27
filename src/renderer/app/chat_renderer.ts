import type {
  ConversationMessage,
  ConversationSummary,
  MessageAttachment,
  MessageUsage,
  RenderTransientOptions,
} from './types.js';
import {
  currentLang,
  el,
  ensureChatVisibleCount,
  escapeHtml,
  state,
  t,
} from './state_i18n.js';
import { renderMarkdownLike } from './markdown_renderer.js';
import {
  cleanupCollapsed,
  cleanupMessageMarkdown,
  currentConversation,
  ensureMeta,
  isConversationRunning,
  isMessageCollapsed,
  messagePreview,
  resolveMessageMarkdownEnabled,
} from './conversation_runtime.js';
import { runningStepMarkdown } from './runtime_renderer.js';

interface ModelPricing {
  inputPerMillion: number;
  cachedInputPerMillion: number;
  outputPerMillion: number;
}

const MODEL_PRICING_TABLE: Array<[string, ModelPricing]> = [
  ['gpt-5.4-mini', { inputPerMillion: 0.75, cachedInputPerMillion: 0.075, outputPerMillion: 4.5 }],
  ['gpt-5.4-nano', { inputPerMillion: 0.2, cachedInputPerMillion: 0.02, outputPerMillion: 1.25 }],
  ['gpt-5.4', { inputPerMillion: 2.5, cachedInputPerMillion: 0.25, outputPerMillion: 15 }],
  ['gpt-5.3-codex', { inputPerMillion: 1.75, cachedInputPerMillion: 0.175, outputPerMillion: 14 }],
  ['gpt-5.3-chat-latest', { inputPerMillion: 1.75, cachedInputPerMillion: 0.175, outputPerMillion: 14 }],
  ['gpt-5.2', { inputPerMillion: 1.75, cachedInputPerMillion: 0.175, outputPerMillion: 14 }],
  ['gpt-5.2-codex', { inputPerMillion: 1.75, cachedInputPerMillion: 0.175, outputPerMillion: 14 }],
  ['gpt-5.1-codex-mini', { inputPerMillion: 0.25, cachedInputPerMillion: 0.025, outputPerMillion: 2 }],
  ['gpt-5.1', { inputPerMillion: 1.25, cachedInputPerMillion: 0.125, outputPerMillion: 10 }],
  ['gpt-5.1-codex', { inputPerMillion: 1.25, cachedInputPerMillion: 0.125, outputPerMillion: 10 }],
  ['gpt-5-codex', { inputPerMillion: 1.25, cachedInputPerMillion: 0.125, outputPerMillion: 10 }],
  ['codex-mini-latest', { inputPerMillion: 1.5, cachedInputPerMillion: 0.375, outputPerMillion: 6 }],
  ['gpt-5-mini', { inputPerMillion: 0.25, cachedInputPerMillion: 0.025, outputPerMillion: 2 }],
  ['gpt-5-nano', { inputPerMillion: 0.05, cachedInputPerMillion: 0.005, outputPerMillion: 0.4 }],
  ['gpt-5', { inputPerMillion: 1.25, cachedInputPerMillion: 0.125, outputPerMillion: 10 }],
];

function attachmentName(item: MessageAttachment | null | undefined): string {
  const name = String(item?.name || '').trim();
  if (name) {
    return name;
  }
  const path = String(item?.path || '').trim();
  if (!path) {
    return '';
  }
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

function renderAttachmentChips(attachments: MessageAttachment[] = [], removable = false): string {
  const items = Array.isArray(attachments) ? attachments : [];
  if (!items.length) {
    return '';
  }
  return items.map((item, index) => {
    const name = attachmentName(item);
    const path = String(item?.path || '').trim();
    const removeButton = removable
      ? `<button type="button" class="composer-attachment-remove" data-attachment-index="${String(index)}" aria-label="${escapeHtml(t('attachmentRemove'))}" title="${escapeHtml(t('attachmentRemove'))}">×</button>`
      : '';
    return [
      `<div class="${removable ? 'composer-attachment-chip' : 'msg-attachment-chip'}" title="${escapeHtml(path || name)}">`,
      `<span class="${removable ? 'composer-attachment-badge' : 'msg-attachment-badge'}">${escapeHtml(t('attachmentBadge'))}</span>`,
      `<span class="${removable ? 'composer-attachment-name' : 'msg-attachment-name'}">${escapeHtml(name || path)}</span>`,
      removeButton,
      '</div>',
    ].join('');
  }).join('');
}

function toMessageTimeMs(input: unknown): number {
  const raw = Number(input);
  if (!Number.isFinite(raw) || raw <= 0) {
    return 0;
  }
  if (raw < 1e12) {
    return Math.round(raw * 1000);
  }
  return Math.round(raw);
}

function formatMessageTime(input: unknown): string {
  const timeMs = toMessageTimeMs(input);
  if (!timeMs) {
    return '';
  }
  const dt = new Date(timeMs);
  if (Number.isNaN(dt.getTime())) {
    return '';
  }

  const now = new Date();
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  const hh = String(dt.getHours()).padStart(2, '0');
  const mi = String(dt.getMinutes()).padStart(2, '0');

  const isSameYear = yyyy === now.getFullYear();
  const isSameDay = isSameYear
    && dt.getMonth() === now.getMonth()
    && dt.getDate() === now.getDate();

  if (isSameDay) {
    return `${hh}:${mi}`;
  }
  if (isSameYear) {
    return `${mm}-${dd} ${hh}:${mi}`;
  }
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
}

function formatUsageCount(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw || raw === '-') {
    return '-';
  }
  const normalized = raw.replace(/,/g, '');
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return raw;
  }
  return parsed.toLocaleString(currentLang());
}

function formatUsageCompact(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw || raw === '-') {
    return '-';
  }
  const normalized = raw.replace(/,/g, '');
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) {
    return raw;
  }
  if (parsed >= 1_000_000_000) {
    return `${(parsed / 1_000_000_000).toFixed(parsed >= 10_000_000_000 ? 0 : 1).replace(/\.0$/, '')}B`;
  }
  if (parsed >= 1_000_000) {
    return `${(parsed / 1_000_000).toFixed(parsed >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`;
  }
  if (parsed >= 1_000) {
    return `${(parsed / 1_000).toFixed(parsed >= 10_000 ? 0 : 1).replace(/\.0$/, '')}K`;
  }
  return String(parsed);
}

function parseUsageNumber(value: unknown): number {
  const raw = String(value ?? '').trim();
  if (!raw || raw === '-') {
    return 0;
  }
  const parsed = Number(raw.replace(/,/g, ''));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function resolveModelPricing(modelName: unknown): ModelPricing | null {
  const normalized = String(modelName ?? '').trim().toLowerCase();
  if (!normalized || normalized === '-') {
    return null;
  }
  for (const [prefix, pricing] of MODEL_PRICING_TABLE) {
    if (normalized === prefix || normalized.startsWith(`${prefix}-`)) {
      return pricing;
    }
  }
  return null;
}

function calculateUsageCostUsd(usage: MessageUsage | null | undefined): number | null {
  const pricing = resolveModelPricing(usage?.model);
  if (!pricing) {
    return null;
  }
  const inputTokens = parseUsageNumber(usage?.inputTokens);
  const cachedInputTokens = parseUsageNumber(usage?.cachedInputTokens);
  const outputTokens = parseUsageNumber(usage?.outputTokens);
  if (inputTokens <= 0 && cachedInputTokens <= 0 && outputTokens <= 0) {
    return null;
  }
  const uncachedInputTokens = Math.max(0, inputTokens - cachedInputTokens);
  return (
    (uncachedInputTokens / 1_000_000) * pricing.inputPerMillion
    + (cachedInputTokens / 1_000_000) * pricing.cachedInputPerMillion
    + (outputTokens / 1_000_000) * pricing.outputPerMillion
  );
}

function formatUsageCostCompact(costUsd: number | null | undefined): string {
  const value = Number(costUsd);
  if (!Number.isFinite(value) || value <= 0) {
    return '-';
  }
  if (value < 0.0001) {
    return '<0.0001';
  }
  if (value < 0.01) {
    return value.toFixed(4);
  }
  if (value < 1) {
    return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  }
  if (value < 100) {
    return value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  }
  return value.toFixed(0);
}

function formatUsageCostFull(costUsd: number | null | undefined): string {
  const value = Number(costUsd);
  if (!Number.isFinite(value) || value <= 0) {
    return '-';
  }
  if (value < 0.0001) {
    return '<$0.0001';
  }
  return `$${value.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')}`;
}

function buildUsageFromMeta(conversationId: string): MessageUsage | null {
  const meta = ensureMeta(conversationId);
  const inputTokens = parseUsageNumber(meta['输入Tokens']);
  const cachedInputTokens = parseUsageNumber(meta['缓存输入Tokens']);
  const outputTokens = parseUsageNumber(meta['输出Tokens']);
  const totalTokens = parseUsageNumber(meta['总Tokens']);
  const model = String(meta['模型'] || '').trim();
  if (inputTokens <= 0 && cachedInputTokens <= 0 && outputTokens <= 0 && totalTokens <= 0) {
    return null;
  }
  return {
    ...(model && model !== '-' ? { model } : {}),
    inputTokens,
    cachedInputTokens,
    outputTokens,
    ...(totalTokens > 0 ? { totalTokens } : {}),
  };
}

function updateUsageMetaValue(node: HTMLElement | null | undefined, rawValue: unknown, titleKey: string) {
  if (!node) {
    return;
  }
  const formatted = formatUsageCount(rawValue);
  node.textContent = formatted;
  node.title = formatted === '-' ? t(titleKey) : `${t(titleKey)}: ${formatted}`;
}

function resolveMessageTime(item: ConversationMessage | null | undefined, conversation: ConversationSummary | null | undefined, index: number): string {
  const messageTs = toMessageTimeMs(item?.createdAt ?? item?.timestamp ?? item?.time);
  if (messageTs) {
    return formatMessageTime(messageTs);
  }
  const lastIndex = Math.max(0, Number(conversation?.messages?.length || 0) - 1);
  if (index >= lastIndex) {
    return formatMessageTime(conversation?.updatedAt);
  }
  return formatMessageTime(conversation?.createdAt);
}

function findLatestAssistantMessageIndex(conversation: ConversationSummary | null | undefined): number {
  const items = Array.isArray(conversation?.messages) ? conversation.messages : [];
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.role === 'assistant') {
      return index;
    }
  }
  return -1;
}

function renderMessageUsageFooter(conversation: ConversationSummary, latestAssistantIndex: number, index: number, item: ConversationMessage): string {
  if (item.role !== 'assistant') {
    return '';
  }
  const metaModel = String(ensureMeta(conversation.id)['模型'] || '').trim();
  const usage = item?.usage && typeof item.usage === 'object'
    ? item.usage
    : (index === latestAssistantIndex ? buildUsageFromMeta(conversation.id) : null);
  if (!usage) {
    return '';
  }
  const usageWithModel = usage?.model
    ? usage
    : {
      ...usage,
      ...(metaModel && metaModel !== '-' ? { model: metaModel } : {}),
    };
  const usageCostUsd = calculateUsageCostUsd(usageWithModel);
  const usageItems = [
    { value: usage.inputTokens, labelKey: 'usageInputShort', titleKey: 'usageInputTitle' },
    { value: usage.cachedInputTokens, labelKey: 'usageCachedShort', titleKey: 'usageCachedTitle' },
    { value: usage.outputTokens, labelKey: 'usageOutputShort', titleKey: 'usageOutputTitle' },
  ].map(({ value, labelKey, titleKey }) => {
    const formatted = formatUsageCompact(value);
    if (formatted === '-') {
      return '';
    }
    const title = `${t(titleKey)}: ${formatUsageCount(value)}`;
    const label = t(labelKey);
    return `<span class="msg-usage-item" title="${escapeHtml(title)}"><span class="msg-usage-key">${label}</span><span class="msg-usage-value">${escapeHtml(formatted)}</span></span>`;
  }).filter(Boolean);

  if (usageCostUsd !== null) {
    const pricing = resolveModelPricing(usageWithModel.model);
    const titleLines = [
      `${t('usageCostTitle')}: ${formatUsageCostFull(usageCostUsd)}`,
      `Model: ${String(usageWithModel.model || '-')}`,
    ];
    if (pricing) {
      titleLines.push(
        `Rates / 1M: in $${pricing.inputPerMillion}, cache $${pricing.cachedInputPerMillion}, out $${pricing.outputPerMillion}`,
      );
    }
    usageItems.push(
      `<span class="msg-usage-item" title="${escapeHtml(titleLines.join('\n'))}"><span class="msg-usage-key">${escapeHtml(t('usageCostShort'))}</span><span class="msg-usage-value">${escapeHtml(formatUsageCostCompact(usageCostUsd))}</span></span>`,
    );
  }

  if (!usageItems.length) {
    return '';
  }
  return `<div class="msg-usage">${usageItems.join('')}</div>`;
}

function renderRunningHintBlock(conversationId: string): string {
  if (!isConversationRunning(conversationId)) {
    return '';
  }
  const stepMarkdown = runningStepMarkdown(conversationId);
  return [
    '<div class="msg-block msg-assistant-row msg-running-row">',
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

function renderChatPaginationBar(totalCount: number, visibleCount: number): string {
  const total = Math.max(0, Number(totalCount) || 0);
  const visible = Math.max(0, Math.min(total, Number(visibleCount) || 0));
  const remaining = Math.max(0, total - visible);
  if (!remaining) {
    return '';
  }
  return [
    '<div class="chat-pagination-bar">',
    `<button type="button" class="chat-load-more-button" data-action="chat:load-earlier">${escapeHtml(t('loadEarlierMessages', { count: remaining }))}</button>`,
    `<div class="chat-pagination-summary">${escapeHtml(t('showingRecentMessages', { visible, total }))}</div>`,
    '</div>',
  ].join('');
}

function renderChatTransientStack(conversationId: string): string {
  return [
    '<div class="chat-transient-stack">',
    renderRunningHintBlock(conversationId),
    '</div>',
  ].join('');
}

function renderChatMessageBlock(
  item: ConversationMessage,
  index: number,
  conversation: ConversationSummary,
  latestAssistantIndex: number,
): string {
  const role = item.role === 'user' ? t('roleYou') : t('roleCodex');
  const bubbleClass = item.role === 'user'
    ? `msg-user${item?.interrupted ? ' msg-user-interrupted' : ''}`
    : 'msg-assistant';
  const collapsed = isMessageCollapsed(state.activeConversationId, index);
  const defaultMarkdownEnabled = item.role === 'assistant';
  const markdownEnabled = !collapsed && resolveMessageMarkdownEnabled(
    state.activeConversationId,
    index,
    defaultMarkdownEnabled,
  );
  const toggleText = collapsed ? t('expandMessage') : t('collapseMessage');
  const renderToggleText = markdownEnabled ? t('renderMarkdown') : t('renderRaw');
  const preview = messagePreview(item.text);
  const rowClass = item.role === 'user' ? 'msg-user-row' : 'msg-assistant-row';
  const timeText = resolveMessageTime(item, conversation, index);
  const usageFooter = renderMessageUsageFooter(conversation, latestAssistantIndex, index, item);
  const attachmentsHtml = Array.isArray(item.attachments) && item.attachments.length
    ? `<div class="msg-attachments">${renderAttachmentChips(item.attachments)}</div>`
    : '';
  const expandedHtml = markdownEnabled
    ? renderMarkdownLike(item.text)
    : `<div class="msg-plain-text">${escapeHtml(String(item.text || ''))}</div>`;
  const renderToggle = `<button type="button" class="msg-toggle-render" data-msg-index="${escapeHtml(index)}" aria-pressed="${markdownEnabled ? 'true' : 'false'}" ${collapsed ? 'disabled' : ''}>${escapeHtml(renderToggleText)}</button>`;
  return [
    `<div class="msg-block ${rowClass}" data-msg-row-index="${escapeHtml(index)}">`,
    '<div class="msg-head">',
    `<div class="msg-role">${escapeHtml(role)}</div>`,
    '<div class="msg-actions">',
    renderToggle,
    `<button type="button" class="msg-toggle-collapse" data-msg-index="${escapeHtml(index)}" aria-expanded="${collapsed ? 'false' : 'true'}">${escapeHtml(toggleText)}</button>`,
    '</div>',
    '</div>',
    `<div class="msg-bubble ${bubbleClass}${collapsed ? ' collapsed' : ''}" data-msg-index="${escapeHtml(index)}">`,
    `<div class="msg-expanded">${attachmentsHtml}${expandedHtml}</div>`,
    `<div class="msg-collapsed-line">${escapeHtml(preview)}</div>`,
    '<div class="msg-footer">',
    usageFooter || '<span></span>',
    `<div class="msg-time">${escapeHtml(timeText)}</div>`,
    '</div>',
    '</div>',
    '</div>',
  ].join('');
}

function renderChatTransientPanels(options: RenderTransientOptions = {}) {
  if (!el.chatView) {
    return;
  }
  const target = el.chatView.querySelector('.chat-transient-stack');
  if (!target) {
    return;
  }
  target.innerHTML = renderRunningHintBlock(state.activeConversationId);
  if (options.stickToBottom) {
    el.chatView.scrollTop = el.chatView.scrollHeight;
  }
}

function renderChat(stickToBottom = true) {
  const conv = currentConversation();
  if (!conv) {
    el.chatView.innerHTML = [
      `<div class="tip" style="margin-top:28px;">${escapeHtml(t('emptyChatTip1'))}</div>`,
      `<div class="tip">${escapeHtml(t('emptyChatTip2'))}</div>`,
      `<div class="tip">${escapeHtml(t('emptyChatTip3'))}</div>`,
    ].join('');
    return;
  }
  if (!Array.isArray(conv.messages) || !conv.messages.length) {
    el.chatView.innerHTML = [
      '<div class="chat-view-empty-shell">',
      `<div class="tip">${escapeHtml(t('noMessagesTip1'))}</div>`,
      `<div class="tip">${escapeHtml(t('noMessagesTip2'))}</div>`,
      renderChatTransientStack(state.activeConversationId),
      '</div>',
    ].join('');
    if (stickToBottom) {
      el.chatView.scrollTop = el.chatView.scrollHeight;
    }
    return;
  }

  cleanupCollapsed(state.activeConversationId, conv.messages.length);
  cleanupMessageMarkdown(state.activeConversationId, conv.messages.length);
  const totalCount = conv.messages.length;
  const visibleCount = ensureChatVisibleCount(state.activeConversationId, totalCount);
  const startIndex = Math.max(0, totalCount - visibleCount);
  const latestAssistantIndex = findLatestAssistantMessageIndex(conv);
  const blocks = conv.messages
    .slice(startIndex)
    .map((item, offset) => renderChatMessageBlock(item, startIndex + offset, conv, latestAssistantIndex));

  el.chatView.innerHTML = [
    renderChatPaginationBar(totalCount, visibleCount),
    '<div class="chat-history-list">',
    blocks.join(''),
    '</div>',
    renderChatTransientStack(state.activeConversationId),
  ].join('');
  if (stickToBottom) {
    el.chatView.scrollTop = el.chatView.scrollHeight;
  }
}

function isChatViewNearBottom(threshold = 72) {
  if (!el.chatView) {
    return true;
  }
  const distance = el.chatView.scrollHeight - el.chatView.scrollTop - el.chatView.clientHeight;
  return distance <= Math.max(0, Number(threshold) || 0);
}

export {
  renderAttachmentChips,
  toMessageTimeMs,
  formatMessageTime,
  formatUsageCount,
  updateUsageMetaValue,
  resolveMessageTime,
  renderRunningHintBlock,
  renderChatPaginationBar,
  renderChatTransientStack,
  renderChatMessageBlock,
  renderChatTransientPanels,
  renderChat,
  isChatViewNearBottom,
};
