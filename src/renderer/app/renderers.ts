import { codexdesk } from './codexdesk.js';
import type {
  ComposerRenderOptions,
  ConversationMessage,
  ConversationSummary,
  MessageAttachment,
  MessageUsage,
  RawEventEntry,
  RenderAllOptions,
  RenderTransientOptions,
  RendererCallbacks,
  RuntimeState,
  WorkflowItem,
} from './types.js';
import {
  APP_ZOOM_DEFAULT,
  clampAppZoom,
  currentLang,
  draftStorageKey,
  el,
  ensureRuntimeVisibleCount,
  escapeHtml,
  ensureChatVisibleCount,
  getComposerAttachments,
  getConversationDraft,
  increaseRuntimeVisibleCount,
  localizeKnownText,
  renderMarkdownLike,
  resolvePermissionSummary,
  state,
  t,
} from './state_i18n.js';
import {
  anyConversationRunning,
  canRetryLastMessage,
  cleanupCollapsed,
  cleanupMessageMarkdown,
  cleanupWorkflowCollapsed,
  currentConversation,
  effectivePhaseRaw,
  ensureMeta,
  ensureRuntime,
  getConversationState,
  hasActiveConversation,
  isConversationRunning,
  isMessageCollapsed,
  isWorkflowStepCollapsed,
  messagePreview,
  phaseLabel,
  queuedCount,
  queuedMessages,
  resolveMessageMarkdownEnabled,
  setMessageCollapsed,
  setMessageMarkdownEnabled,
  setWorkflowStepCollapsed,
  sortedConversations,
  updatePhaseClass,
} from './conversation_runtime.js';

let rendererCallbacks: RendererCallbacks = {
  onConversationSelected: async () => {},
};

interface ConversationListItemCacheEntry {
  version: number;
  conversationRef: ConversationSummary;
  language: string;
  title: string;
  sessionId: string;
  pinnedAt: number;
  updatedAt: number;
  createdAt: number;
  latestMessageRef: ConversationMessage | null;
  statusKey: string;
  statusLabel: string;
  queue: number;
  searchText: string;
  contentHtml: string;
  idAttr: string;
}

const conversationListItemCache = new Map<string, ConversationListItemCacheEntry>();
const conversationAvatarToneCache = new Map<string, string>();
let sortedConversationCacheKey = '';
let sortedConversationCache: ConversationSummary[] = [];
let conversationListCacheVersion = 0;
let lastConversationListRenderSignature = '';

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

function setRendererCallbacks(nextCallbacks: Partial<RendererCallbacks> = {}) {
  rendererCallbacks = {
    ...rendererCallbacks,
    ...nextCallbacks,
  };
}

function conversationAvatarTone(id: string, title: string): string {
  const cacheKey = `${id}:${title}`;
  const cached = conversationAvatarToneCache.get(cacheKey);
  if (cached) {
    return cached;
  }
  const seed = `${id}:${title}`;
  let total = 0;
  for (const ch of seed) {
    total += ch.codePointAt(0) || 0;
  }
  const tone = `tone-${(total % 6) + 1}`;
  conversationAvatarToneCache.set(cacheKey, tone);
  return tone;
}

function conversationPreviewText(item: ConversationSummary): string {
  const messages = Array.isArray(item.messages) ? item.messages : [];
  const latest = messages[messages.length - 1];
  if (!latest) {
    return t('sidebarEmptyPreview');
  }
  const prefix = latest.role === 'user' ? `${t('roleYou')}: ` : '';
  return messagePreview(`${prefix}${String(latest.text || '')}`);
}

function sortedConversationsCached(): ConversationSummary[] {
  const cacheKey = state.conversations
    .map((item) => `${item.id}:${Number(item.pinnedAt || 0)}:${Number(item.updatedAt || 0)}:${Number(item.createdAt || 0)}`)
    .join('|');
  if (cacheKey === sortedConversationCacheKey) {
    return sortedConversationCache;
  }
  sortedConversationCacheKey = cacheKey;
  sortedConversationCache = sortedConversations();
  return sortedConversationCache;
}

function buildConversationListItemContent(item: ConversationSummary): ConversationListItemCacheEntry {
  const status = getConversationState(item.id);
  const queue = queuedCount(item.id);
  const pinned = Number(item.pinnedAt || 0) > 0;
  const titleText = String(item.title || '-').trim();
  const avatarChar = titleText ? Array.from(titleText)[0] : '•';
  const avatarTone = conversationAvatarTone(item.id, titleText);
  const timeText = formatMessageTime(item.updatedAt || item.createdAt);
  const previewText = conversationPreviewText(item);
  const queueBadge = queue > 0 ? `<span class="queue-badge">${escapeHtml(String(queue))}</span>` : '';
  const pinBadge = pinned ? [
    `<span class="conversation-pin-badge" title="${escapeHtml(t('pinnedConversation'))}" aria-label="${escapeHtml(t('pinnedConversation'))}">`,
    '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">',
    '<path d="M14 4v1.4l1.8 1.8v4.2l1.9 1.9v.8h-4.2V20l-1.5-1.5v-4.4H7.8v-.8l1.9-1.9V7.2l1.8-1.8V4z" />',
    '</svg>',
    '</span>',
  ].join('') : '';
  const contentHtml = [
    `<div class="conversation-avatar ${escapeHtml(avatarTone)}">${escapeHtml(avatarChar)}</div>`,
    '<div class="conversation-main">',
    '<div class="conversation-top-row">',
    '<div class="conversation-title-row">',
    `<span class="conversation-title-text">${escapeHtml(item.title || '-')}</span>`,
    '</div>',
    '<div class="conversation-top-meta">',
    `<div class="conversation-time">${escapeHtml(timeText || '')}</div>`,
    pinBadge,
    '</div>',
    '</div>',
    '<div class="conversation-bottom-row">',
    '<div class="conversation-preview-row">',
    `<span class="conv-state-pill state-${escapeHtml(status.key)}">${escapeHtml(status.label)}</span>`,
    `<span class="conversation-preview">${escapeHtml(previewText)}</span>`,
    '</div>',
    `<div class="conversation-side-badges">${queueBadge}</div>`,
    '</div>',
    '</div>',
  ].join('');
  return {
    version: conversationListCacheVersion + 1,
    conversationRef: item,
    language: currentLang(),
    title: String(item.title || ''),
    sessionId: String(item.sessionId || ''),
    pinnedAt: Number(item.pinnedAt || 0),
    updatedAt: Number(item.updatedAt || 0),
    createdAt: Number(item.createdAt || 0),
    latestMessageRef: Array.isArray(item.messages) && item.messages.length ? item.messages[item.messages.length - 1] : null,
    statusKey: status.key,
    statusLabel: status.label,
    queue,
    searchText: `${String(item.title || '')}\n${previewText}\n${String(item.sessionId || '')}`.toLowerCase(),
    contentHtml,
    idAttr: escapeHtml(item.id),
  };
}

function getConversationListItemCache(item: ConversationSummary): ConversationListItemCacheEntry {
  const cached = conversationListItemCache.get(item.id);
  const latestMessageRef = Array.isArray(item.messages) && item.messages.length ? item.messages[item.messages.length - 1] : null;
  const status = getConversationState(item.id);
  const queue = queuedCount(item.id);
  if (
    cached
    && cached.conversationRef === item
    && cached.language === currentLang()
    && cached.title === String(item.title || '')
    && cached.sessionId === String(item.sessionId || '')
    && cached.pinnedAt === Number(item.pinnedAt || 0)
    && cached.updatedAt === Number(item.updatedAt || 0)
    && cached.createdAt === Number(item.createdAt || 0)
    && cached.latestMessageRef === latestMessageRef
    && cached.statusKey === status.key
    && cached.statusLabel === status.label
    && cached.queue === queue
  ) {
    return cached;
  }
  const next = buildConversationListItemContent(item);
  conversationListCacheVersion = next.version;
  conversationListItemCache.set(item.id, next);
  return next;
}

function renderConversationListItem(item: ConversationSummary, activeId: string): string {
  const cached = getConversationListItemCache(item);
  const active = item.id === activeId ? ' active' : '';
  return `<div class="conversation-item${active}" data-id="${cached.idAttr}">${cached.contentHtml}</div>`;
}

function renderConversationList() {
  const activeId = state.activeConversationId;
  if (!state.conversations.length) {
    el.conversationList.innerHTML = [
      `<div class="tip" style="padding:16px;">${escapeHtml(t('noConversation'))}</div>`,
      `<div class="tip" style="padding:0 16px 16px 16px;">${escapeHtml(t('clickNewConversation'))}</div>`,
    ].join('');
    return;
  }
  const keyword = String(el.sidebarSearchInput?.value || '').trim().toLowerCase();
  const visibleItems = sortedConversationsCached()
    .filter((item) => {
      if (!keyword) {
        return true;
      }
      return getConversationListItemCache(item).searchText.includes(keyword);
    });
  const renderSignature = `${currentLang()}|${keyword}|${activeId}|${visibleItems.map((item) => {
    const cached = getConversationListItemCache(item);
    return `${item.id}:${cached.version}`;
  }).join('|')}`;
  if (renderSignature === lastConversationListRenderSignature) {
    return;
  }
  lastConversationListRenderSignature = renderSignature;
  const html = visibleItems.map((item) => renderConversationListItem(item, activeId)).join('');
  const emptyText = keyword ? t('sidebarSearchEmpty') : t('noConversation');
  el.conversationList.innerHTML = html || `<div class="tip" style="padding:16px;">${escapeHtml(emptyText)}</div>`;
}

function updateConversationListActiveState(previousId: string, nextId: string): boolean {
  const prev = String(previousId || '').trim();
  const next = String(nextId || '').trim();
  if (!prev && !next) {
    return false;
  }
  if (prev === next) {
    return true;
  }
  const previousNode = prev ? el.conversationList.querySelector<HTMLElement>(`.conversation-item[data-id="${prev}"]`) : null;
  const nextNode = next ? el.conversationList.querySelector<HTMLElement>(`.conversation-item[data-id="${next}"]`) : null;
  previousNode?.classList.remove('active');
  nextNode?.classList.add('active');
  return Boolean(previousNode || nextNode);
}

function patchConversationListItem(conversationId: string): boolean {
  const id = String(conversationId || '').trim();
  if (!id) {
    return false;
  }
  const item = state.conversations.find((entry) => entry.id === id);
  if (!item) {
    return false;
  }
  const keyword = String(el.sidebarSearchInput?.value || '').trim().toLowerCase();
  const cached = getConversationListItemCache(item);
  const matches = !keyword || cached.searchText.includes(keyword);
  const node = el.conversationList.querySelector<HTMLElement>(`.conversation-item[data-id="${cached.idAttr}"]`);
  if (!matches) {
    return false;
  }
  if (!node) {
    return false;
  }
  node.className = `conversation-item${item.id === state.activeConversationId ? ' active' : ''}`;
  node.innerHTML = cached.contentHtml;
  return true;
}

function pruneConversationRenderCaches(validConversationIds: string[] = []) {
  const validIds = new Set((validConversationIds || []).map((item) => String(item || '').trim()).filter(Boolean));
  Array.from(conversationListItemCache.keys()).forEach((id) => {
    if (!validIds.has(id)) {
      conversationListItemCache.delete(id);
    }
  });
  Array.from(conversationAvatarToneCache.keys()).forEach((key) => {
    const separatorIndex = key.indexOf(':');
    const id = separatorIndex >= 0 ? key.slice(0, separatorIndex) : key;
    if (!validIds.has(id)) {
      conversationAvatarToneCache.delete(key);
    }
  });
  sortedConversationCacheKey = '';
  sortedConversationCache = [];
  lastConversationListRenderSignature = '';
}

function renderCurrentTimeDisplay() {
  const now = new Date();
  const padClockPart = (value: number): string => String(value).padStart(2, '0');
  const offsetMinutes = -now.getTimezoneOffset();
  const offsetSign = offsetMinutes >= 0 ? '+' : '-';
  const offsetAbs = Math.abs(offsetMinutes);
  const offsetHours = Math.floor(offsetAbs / 60);
  const offsetRemainMinutes = offsetAbs % 60;
  const tzOffsetLabel = `UTC${offsetSign}${padClockPart(offsetHours)}:${padClockPart(offsetRemainMinutes)}`;
  const clockLabel = `${now.getFullYear()}-${padClockPart(now.getMonth() + 1)}-${padClockPart(now.getDate())} ${padClockPart(now.getHours())}:${padClockPart(now.getMinutes())}:${padClockPart(now.getSeconds())} ${tzOffsetLabel}`;
  const timeZoneName = Intl.DateTimeFormat().resolvedOptions().timeZone || '';

  if (el.currentTimeValue) {
    el.currentTimeValue.textContent = clockLabel;
  }
  if (el.currentTimeChip) {
    el.currentTimeChip.title = timeZoneName ? `${timeZoneName} ${tzOffsetLabel}` : tzOffsetLabel;
  }
}

function renderHeader() {
  renderCurrentTimeDisplay();
  const conv = currentConversation();
  const meta = conv
    ? ensureMeta(state.activeConversationId)
    : {
      模型: '-',
      会话ID: '-',
    };
  const normalizeMetaValue = (value: unknown): string => {
    const text = String(value ?? '').trim();
    if (!text || text === '-') {
      return '';
    }
    return text;
  };

  el.chatTitle.textContent = conv ? conv.title : '-';
  const sid = normalizeMetaValue(meta['会话ID']) || normalizeMetaValue(conv?.sessionId) || '-';
  if (sid && sid !== '-' && sid.length > 16) {
    el.sessionId.textContent = `${sid.slice(0, 8)}...${sid.slice(-6)}`;
  } else {
    el.sessionId.textContent = sid || '-';
  }
  if (el.btnSessionId) {
    el.btnSessionId.disabled = !sid || sid === '-';
    el.btnSessionId.dataset.fullValue = sid;
    el.btnSessionId.dataset.tooltip = sid && sid !== '-' ? t('clickToCopy') : '';
    el.btnSessionId.setAttribute('aria-label', sid && sid !== '-' ? `${t('clickToCopy')}: ${sid}` : t('sessionId'));
  }

  const phaseRaw = effectivePhaseRaw();
  el.phase.textContent = phaseLabel(phaseRaw);
  updatePhaseClass(phaseRaw);

  const queue = conv ? queuedCount(state.activeConversationId) : 0;
  el.queueCount.textContent = String(queue);
  el.queueChip.classList.toggle('queue-chip-active', queue > 0);
  el.queueChip.classList.toggle('hidden', queue <= 0);
  if (el.queuePopoverTitle) {
    el.queuePopoverTitle.textContent = t('queuedRepliesTitle');
  }
  if (el.queuePopoverClear) {
    el.queuePopoverClear.textContent = t('queuedUndoAll');
    el.queuePopoverClear.disabled = queue <= 0;
    el.queuePopoverClear.classList.toggle('hidden', queue <= 0);
    el.queuePopoverClear.setAttribute('aria-label', t('queuedUndoAll'));
    el.queuePopoverClear.title = t('queuedUndoAll');
  }
  if (el.queuePopoverClose) {
    el.queuePopoverClose.textContent = '×';
    el.queuePopoverClose.setAttribute('aria-label', t('close'));
    el.queuePopoverClose.title = t('close');
  }
  if (el.queuePopover) {
    if (queue <= 0) {
      el.queuePopover.classList.add('hidden');
    }
    el.queueChip.setAttribute('aria-expanded', queue > 0 && !el.queuePopover.classList.contains('hidden') ? 'true' : 'false');
  }
  renderQueuePopover(state.activeConversationId);

  if (el.metaModelValue) {
    const modelText = normalizeMetaValue(meta['模型']);
    const fallbackText = t('clickToFetch');
    el.metaModelValue.textContent = modelText || fallbackText;
  }
  if (el.btnMetaModel) {
    const modelText = normalizeMetaValue(meta['模型']);
    el.btnMetaModel.dataset.tooltip = modelText || t('refreshModel');
    el.btnMetaModel.setAttribute('aria-label', modelText || t('refreshModel'));
  }
  renderComposerWorkdir();
}

function renderSettings() {
  const meta = ensureMeta(state.activeConversationId);
  if (el.aboutCodexVersionInput) {
    const version = String(meta['Codex版本'] || '-').trim() || '-';
    el.aboutCodexVersionInput.value = version;
    el.aboutCodexVersionInput.title = version;
  }
  if (el.commandInput) {
    el.commandInput.value = state.settings.commandText || '';
    el.commandInput.title = state.settings.commandText || '-';
  }
  if (el.workdirInput) {
    el.workdirInput.value = state.settings.workdir || '';
    el.workdirInput.title = state.settings.workdir || '-';
  }
  if (el.qsDeviceIdentityInput) {
    el.qsDeviceIdentityInput.value = String(state.settings.deviceIdentity || '').trim();
    el.qsDeviceIdentityInput.title = String(state.settings.deviceIdentity || '').trim();
  }
  const activeNotificationProvider = String(state.settings.notifications?.activeProvider || 'telegram').trim().toLowerCase();
  const telegramSettings = state.settings.notifications?.providers?.telegram;
  if (el.qsNotificationProviderTelegram) {
    el.qsNotificationProviderTelegram.classList.toggle('active', activeNotificationProvider === 'telegram');
  }
  if (el.qsTelegramEnabled) {
    el.qsTelegramEnabled.checked = Boolean(telegramSettings?.enabled);
  }
  if (el.qsTelegramBotTokenInput) {
    el.qsTelegramBotTokenInput.title = t('telegramBotTokenPlaceholder');
  }
  if (el.qsTelegramChatIdInput) {
    const chatId = String(telegramSettings?.chatId || '').trim();
    el.qsTelegramChatIdInput.value = chatId;
    el.qsTelegramChatIdInput.title = chatId || '-';
  }
  if (el.qsTelegramTokenStatus) {
    const fingerprint = String(telegramSettings?.botTokenFingerprint || '').trim();
    el.qsTelegramTokenStatus.textContent = fingerprint
      ? t('telegramTokenSaved', { fingerprint })
      : t('telegramTokenMissing');
  }
  const perm = resolvePermissionSummary();
  if (el.permissionInput) {
    el.permissionInput.value = perm.text;
    el.permissionInput.title = perm.title;
  }
  el.languageSelect.value = currentLang();
  if (el.zoomFactorRange) {
    el.zoomFactorRange.value = String(Math.round(clampAppZoom(state.ui.zoomFactor, APP_ZOOM_DEFAULT) * 100));
  }
  if (el.zoomFactorValue) {
    el.zoomFactorValue.textContent = `${Math.round(clampAppZoom(state.ui.zoomFactor, APP_ZOOM_DEFAULT) * 100)}%`;
  }
  el.fontSizeRange.value = String(state.ui.chatFontSize);
  el.fontSizeValue.value = String(state.ui.chatFontSize);
  if (el.qsAppName) {
    el.qsAppName.textContent = String(state.appInfo?.name || 'Codex Desk').trim() || 'Codex Desk';
  }
  if (el.qsAppVersion) {
    const rawVersion = String(state.appInfo?.version || '').trim();
    el.qsAppVersion.textContent = rawVersion ? `v${rawVersion.replace(/^v/i, '')}` : 'v-';
  }
  const hasTelegramConfig = Boolean(
    telegramSettings?.hasBotToken
    && String(telegramSettings?.chatId || '').trim(),
  );
  if (el.qsTelegramTest) {
    el.qsTelegramTest.disabled = !hasTelegramConfig;
  }
  if (el.qsTelegramClearToken) {
    el.qsTelegramClearToken.disabled = !Boolean(telegramSettings?.hasBotToken);
  }
}

function renderComposerWorkdir() {
  if (!el.composerWorkdir || !el.labelComposerWorkdir || !el.composerWorkdirValue) {
    return;
  }
  const conv = currentConversation();
  const workdir = String(conv?.workdir || '').trim();
  el.labelComposerWorkdir.textContent = `${t('composerWorkdir')}:`;
  el.composerWorkdir.classList.toggle('hidden', !workdir);
  el.composerWorkdirValue.textContent = workdir || '-';
  el.composerWorkdirValue.title = workdir || '-';
}

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

function renderComposerAttachments() {
  if (!el.composerAttachments) {
    return;
  }
  const items = getComposerAttachments(state.activeConversationId);
  el.composerAttachments.classList.toggle('hidden', items.length <= 0);
  el.composerAttachments.innerHTML = items.length
    ? [
      '<div class="composer-attachments-head">',
      `<span class="composer-attachments-title">${escapeHtml(t('attachmentCount', { count: items.length }))}</span>`,
      `<span class="composer-attachments-hint">${escapeHtml(t('attachmentHint'))}</span>`,
      '</div>',
      `<div class="composer-attachments-list">${renderAttachmentChips(items, true)}</div>`,
    ].join('')
    : '';
}

function renderComposerDraft(options: ComposerRenderOptions = {}) {
  if (!el.inputBox) {
    return;
  }
  const force = options.force === true;
  const draftKey = draftStorageKey(state.activeConversationId);
  const nextValue = getConversationDraft(state.activeConversationId);
  const bindingChanged = state.inputBindingConversationId !== draftKey;
  if (bindingChanged || force) {
    el.inputBox.value = nextValue;
  }
  state.inputBindingConversationId = draftKey;
  renderComposerAttachments();
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

function runningStepMarkdown(conversationId: string): string {
  if (!conversationId) {
    return localizeKnownText(phaseLabel('运行中'));
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
  const phaseText = String(localizeKnownText(phaseLabel(runtime.phase || ''))).trim();
  return phaseText || localizeKnownText(phaseLabel('运行中'));
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
  if (!conv || !Array.isArray(conv.messages) || !conv.messages.length) {
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

function renderRawTab(runtime, stickToBottom = true) {
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

function renderRunButtons() {
  const hasConv = hasActiveConversation();
  const running = isConversationRunning(state.activeConversationId);
  const canInsert = running && hasConv;
  el.btnSend.disabled = !hasConv;
  el.btnSend.textContent = running ? t('queueSend') : t('send');
  el.btnInsertMessage.disabled = !canInsert;
  el.btnInsertMessage.textContent = t('insertMessage');
  el.btnInsertMessage.classList.remove('hidden');
  el.btnRetryLast.disabled = !canRetryLastMessage();
  el.btnRetryLast.textContent = t('retryLast');
  el.btnStop.textContent = t('stop');
  el.btnNewConv.textContent = t('newConversation');
  el.btnImportSession.textContent = t('importSession');
  el.btnExportSession.textContent = t('exportSession');
  el.btnRenameConv.textContent = t('renameConversation');
  el.btnCloseConv.textContent = t('closeCurrentConversation');
  el.btnClearChat.textContent = t('clearChat');
  el.btnClearRuntime.textContent = t('clearRuntime');
  el.btnToggleSettings.textContent = state.ui.settingsPanelHidden ? t('toggleSettingsShow') : t('toggleSettingsHide');
  el.btnToggleRuntime.textContent = state.ui.runtimePanelHidden ? t('toggleRuntimeShow') : t('toggleRuntimeHide');
  el.btnToggleSidebar.textContent = state.ui.sidebarHidden ? t('toggleSidebarShow') : t('toggleSidebarHide');
  if (el.qsToggleSettings) {
    el.qsToggleSettings.textContent = state.ui.settingsPanelHidden ? t('toggleSettingsShow') : t('toggleSettingsHide');
  }
  if (el.qsToggleRuntime) {
    el.qsToggleRuntime.textContent = state.ui.runtimePanelHidden ? t('toggleRuntimeShow') : t('toggleRuntimeHide');
  }
  if (el.qsToggleSidebar) {
    el.qsToggleSidebar.textContent = state.ui.sidebarHidden ? t('toggleSidebarShow') : t('toggleSidebarHide');
  }
  if (el.qsLangZh && el.qsLangEn) {
    const isZh = currentLang() === 'zh-CN';
    el.qsLangZh.classList.toggle('active', isZh);
    el.qsLangEn.classList.toggle('active', !isZh);
  }
  if (el.qsRootThemeToggle && el.qsRootThemeSwitch) {
    const isDark = state.ui.theme === 'dark';
    el.qsRootThemeToggle.classList.toggle('active', isDark);
    el.qsRootThemeToggle.setAttribute('aria-pressed', isDark ? 'true' : 'false');
    el.qsRootThemeToggle.setAttribute('aria-label', t('themeDark'));
    el.qsRootThemeSwitch.classList.toggle('active', isDark);
  }
  if (el.quickSettingsMenu) {
    const scopedActions = new Set([
      'conversation:rename',
      'conversation:close-current',
      'conversation:clear-chat',
      'conversation:clear-runtime',
      'conversation:export-session',
      'meta:refresh-codex-version',
      'meta:refresh-model',
    ]);
    Array.from(el.quickSettingsMenu.querySelectorAll<HTMLButtonElement>('button[data-action]')).forEach((node) => {
      const action = String(node.getAttribute('data-action') || '');
      if (action === 'conversation:retry-last') {
        node.disabled = !canRetryLastMessage();
        return;
      }
      if (action === 'conversation:stop') {
        node.disabled = !hasConv || !running;
        return;
      }
      if (scopedActions.has(action)) {
        node.disabled = !hasConv;
        return;
      }
      node.disabled = false;
    });
  }
  el.btnStop.disabled = !hasConv || !running;
  el.btnRenameConv.disabled = !hasConv;
  el.btnCloseConv.disabled = !hasConv;
  el.btnExportSession.disabled = !hasConv;
  el.btnClearChat.disabled = !hasConv;
  el.btnClearRuntime.disabled = !hasConv;
  if (el.btnMetaModel) {
    el.btnMetaModel.disabled = !hasConv;
  }
  if (el.btnAddAttachment) {
    el.btnAddAttachment.disabled = !hasConv;
  }
  if (el.attachmentInput) {
    el.attachmentInput.disabled = !hasConv;
  }
  el.inputBox.disabled = !hasConv;
  if (!hasConv) {
    el.inputBox.placeholder = t('inputPlaceholderNoConversation');
  } else if (running) {
    el.inputBox.placeholder = t('inputPlaceholderRunning');
  } else {
    el.inputBox.placeholder = t('inputPlaceholderIdle');
  }
}

function isChatViewNearBottom(threshold = 72) {
  if (!el.chatView) {
    return true;
  }
  const distance = el.chatView.scrollHeight - el.chatView.scrollTop - el.chatView.clientHeight;
  return distance <= Math.max(0, Number(threshold) || 0);
}

function renderTabs() {
  el.tabButtons.forEach((btn) => {
    const tab = btn.getAttribute('data-tab');
    const active = tab === state.activeTab;
    btn.classList.toggle('active', active);
  });

  document.getElementById('tab-structured').classList.toggle('active', state.activeTab === 'structured');
  document.getElementById('tab-workflow').classList.toggle('active', state.activeTab === 'workflow');
  document.getElementById('tab-raw').classList.toggle('active', state.activeTab === 'raw');
}

function renderLayout() {
  el.contentRow.classList.toggle('runtime-hidden', state.ui.runtimePanelHidden);
  el.runtimePanel.classList.toggle('hidden', state.ui.runtimePanelHidden);
  el.workspace.classList.toggle('settings-hidden', state.ui.settingsPanelHidden);
  el.appRoot.classList.toggle('sidebar-hidden', state.ui.sidebarHidden);
}

function renderLocaleTexts() {
  document.documentElement.lang = currentLang();
  if (el.sidebarTitle) {
    el.sidebarTitle.textContent = t('sidebarTitle');
  }
  if (el.sidebarSearchInput) {
    el.sidebarSearchInput.placeholder = t('sidebarSearchPlaceholder');
    el.sidebarSearchInput.setAttribute('aria-label', t('sidebarSearchPlaceholder'));
  }
  if (el.btnSidebarNewConv) {
    el.btnSidebarNewConv.title = t('newConversation');
    el.btnSidebarNewConv.setAttribute('aria-label', t('newConversation'));
  }
  el.labelSessionId.textContent = t('sessionId');
  if (el.btnSessionId) {
    el.btnSessionId.dataset.copiedLabel = t('copySuccess');
  }
  el.labelPhase.textContent = t('status');
  el.labelQueue.textContent = t('queue');
  if (el.labelMetaModel) {
    el.labelMetaModel.textContent = t('modelShort');
  }
  if (el.labelQuickSettings) {
    el.labelQuickSettings.textContent = t('quickSettings');
  }
  if (el.labelRootThemeToggle) {
    el.labelRootThemeToggle.textContent = t('themeDark');
  }
  if (el.qsDeviceIdentityInput) {
    el.qsDeviceIdentityInput.placeholder = t('deviceIdentityPlaceholder');
  }
  if (el.qsTelegramBotTokenInput) {
    el.qsTelegramBotTokenInput.placeholder = t('telegramBotTokenPlaceholder');
  }
  if (el.qsTelegramChatIdInput) {
    el.qsTelegramChatIdInput.placeholder = t('telegramChatIdPlaceholder');
  }
  if (el.labelCommand) {
    el.labelCommand.textContent = `${t('command')}:`;
  }
  if (el.labelWorkdir) {
    el.labelWorkdir.textContent = `${t('workdir')}:`;
  }
  if (el.labelComposerWorkdir) {
    el.labelComposerWorkdir.textContent = `${t('composerWorkdir')}:`;
  }
  if (el.labelPermission) {
    el.labelPermission.textContent = `${t('permission')}:`;
  }
  if (el.labelLanguage) {
    el.labelLanguage.textContent = `${t('language')}:`;
  }
  if (el.labelZoomFactor) {
    el.labelZoomFactor.textContent = `${t('appZoom')}:`;
  }
  el.labelFontSize.textContent = `${t('chatFontSize')}:`;
  el.tabBtnStructured.textContent = t('tabStructured');
  el.tabBtnWorkflow.textContent = t('tabWorkflow');
  el.tabBtnRaw.textContent = t('tabRaw');
  if (el.btnAddAttachment) {
    el.btnAddAttachment.textContent = t('addAttachment');
    el.btnAddAttachment.title = t('attachmentHint');
  }
  if (el.btnAddImageAttachment) {
    el.btnAddImageAttachment.textContent = t('attachmentTypeImage');
    el.btnAddImageAttachment.title = t('attachmentHint');
  }
  el.renameModalTitle.textContent = t('renameModalTitle');
  el.renameInput.placeholder = t('renameModalPlaceholder');
  el.renameCancel.textContent = t('cancel');
  el.renameConfirm.textContent = t('confirm');
  if (el.importModeTitle) {
    el.importModeTitle.textContent = t('importModeTitle');
  }
  if (el.importModeMessage) {
    el.importModeMessage.textContent = t('importModeMessage');
  }
  if (el.importModeResumeTitle) {
    el.importModeResumeTitle.textContent = t('importModeResumeTitle');
  }
  if (el.importModeResumeDesc) {
    el.importModeResumeDesc.textContent = t('importModeResumeDesc');
  }
  if (el.importModeForkTitle) {
    el.importModeForkTitle.textContent = t('importModeForkTitle');
  }
  if (el.importModeForkDesc) {
    el.importModeForkDesc.textContent = t('importModeForkDesc');
  }
  if (el.importModeCancel) {
    el.importModeCancel.textContent = t('cancel');
  }
  if (el.importModeConfirm) {
    el.importModeConfirm.textContent = t('importModeConfirm');
  }
  if (el.confirmCancel) {
    el.confirmCancel.textContent = t('cancel');
  }
  if (el.confirmAccept) {
    el.confirmAccept.textContent = t('close');
  }
  if (el.ctxNewConv) {
    el.ctxNewConv.textContent = t('contextMenuNew');
  }
  if (el.ctxImportConv) {
    el.ctxImportConv.textContent = t('contextMenuImport');
  }
  if (el.ctxExportConv) {
    el.ctxExportConv.textContent = t('contextMenuExport');
  }
  if (el.ctxRenameConv) {
    el.ctxRenameConv.textContent = t('contextMenuRename');
  }
  if (el.ctxPinConv) {
    el.ctxPinConv.textContent = t('contextMenuPin');
  }
  if (el.ctxCloseConv) {
    el.ctxCloseConv.textContent = t('contextMenuClose');
  }
  if (el.ctxCopySelection) {
    el.ctxCopySelection.textContent = t('copy');
  }
  if (Array.isArray(el.i18nNodes) && el.i18nNodes.length) {
    el.i18nNodes.forEach((node) => {
      const key = node.getAttribute('data-i18n-key');
      if (!key) {
        return;
      }
      node.textContent = t(key);
    });
  }
  if (el.labelZoomFactor) {
    el.labelZoomFactor.textContent = `${t('appZoom')}:`;
  }
  if (el.labelFontSize) {
    el.labelFontSize.textContent = `${t('chatFontSize')}:`;
  }
  if (el.labelSessionId) {
    el.labelSessionId.textContent = t('sessionId');
  }
  if (el.labelPhase) {
    el.labelPhase.textContent = t('status');
  }
  if (el.labelQueue) {
    el.labelQueue.textContent = t('queue');
  }
  if (el.labelMetaModel) {
    el.labelMetaModel.textContent = t('modelShort');
  }
  if (el.labelAboutCodexVersion) {
    el.labelAboutCodexVersion.textContent = `${t('codexVersionShort')}:`;
  }
  if (el.qsDetailTitle) {
    const detailKey = el.qsDetailTitle.getAttribute('data-i18n-key');
    if (detailKey) {
      el.qsDetailTitle.textContent = t(detailKey);
    }
  }

  if (el.languageSelect.options.length >= 2) {
    el.languageSelect.options[0].text = t('languageZh');
    el.languageSelect.options[1].text = t('languageEn');
  }
}

function renderAll(options: RenderAllOptions = {}) {
  const stickChatToBottom = options.stickChatToBottom ?? isChatViewNearBottom();
  renderLocaleTexts();
  renderLayout();
  renderConversationList();
  renderSettings();
  renderHeader();
  renderChat(stickChatToBottom);
  renderRuntime(stickChatToBottom);
  renderRunButtons();
  renderComposerDraft();
  renderTabs();
}

export {
  setRendererCallbacks,
  renderConversationList,
  updateConversationListActiveState,
  patchConversationListItem,
  pruneConversationRenderCaches,
  renderHeader,
  renderSettings,
  renderComposerDraft,
  toMessageTimeMs,
  formatMessageTime,
  formatUsageCount,
  updateUsageMetaValue,
  resolveMessageTime,
  runningStepMarkdown,
  renderRunningHintBlock,
  renderChatPaginationBar,
  renderChatTransientStack,
  renderChatMessageBlock,
  renderChatTransientPanels,
  renderChat,
  renderStructuredTab,
  formatQueuedAt,
  renderQueuedMessagesPanel,
  renderQueuePopover,
  renderCurrentTimeDisplay,
  renderWorkflowTab,
  renderRawTab,
  renderRuntime,
  renderRunButtons,
  renderComposerWorkdir,
  isChatViewNearBottom,
  renderTabs,
  renderLayout,
  renderLocaleTexts,
  renderAll,
};
