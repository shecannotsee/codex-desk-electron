import type { ConversationMessage, ConversationSummary } from './types.js';
import {
  currentLang,
  el,
  escapeHtml,
  state,
  t,
} from './state_i18n.js';
import {
  findConversationById,
  getConversationState,
  messagePreview,
  queuedCount,
  sortedConversations,
} from './conversation_runtime.js';
import { renderAgentTeamGroupList } from './agent_team.js';

interface AgentTeamConversationMeta {
  groupName: string;
  roleName: string;
  provider: 'codex' | 'claude';
  upstreamName: string;
}

interface ConversationListItemCacheEntry {
  version: number;
  conversationRef: ConversationSummary;
  language: string;
  title: string;
  sessionId: string;
  commandText: string;
  avatarPath: string;
  pinnedAt: number;
  updatedAt: number;
  createdAt: number;
  latestMessageRef: ConversationMessage | null;
  provider: string;
  teamMetaKey: string;
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
let lastConversationListMode = 'conversation';

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
  const teamMeta = agentTeamConversationMeta(item.id);
  const prefix = teamMeta
    ? latest.role === 'user'
      ? `${teamMeta.upstreamName || t('agentTeamUpstream')}: `
      : `${teamMeta.roleName}: `
    : latest.role === 'user' ? `${t('roleYou')}: ` : '';
  return messagePreview(`${prefix}${String(latest.text || '')}`);
}

function agentTeamConversationMeta(conversationId: string): AgentTeamConversationMeta | null {
  const id = String(conversationId || '').trim();
  if (!id) {
    return null;
  }
  for (const group of state.agentTeamGroups || []) {
    const role = (group.roles || []).find((item) => item.conversationId === id);
    if (!role) {
      continue;
    }
    return {
      groupName: String(group.name || '').trim(),
      roleName: String(role.name || '').trim(),
      provider: role.provider === 'claude' ? 'claude' : 'codex',
      upstreamName: String(role.currentUpstreamName || group.ownerName || t('agentTeamOwnerName')).trim(),
    };
  }
  return null;
}

function providerLabel(provider: unknown): string {
  return String(provider || '').trim().toLowerCase() === 'claude' ? 'Claude' : 'Codex';
}

function conversationProvider(item: ConversationSummary, teamMeta: AgentTeamConversationMeta | null): 'codex' | 'claude' {
  const provider = String(teamMeta?.provider || item.provider || '').trim().toLowerCase();
  if (provider === 'claude') {
    return 'claude';
  }
  const commandText = String(item.commandText || '').trim().toLowerCase();
  return commandText.includes('claude') ? 'claude' : 'codex';
}

const CHATGPT_AVATAR_PATHS = [
  'resource/chatgpt-01.png',
  'resource/chatgpt-02.png',
  'resource/chatgpt-03.png',
  'resource/chatgpt-04.png',
  'resource/chatgpt-05.png',
  'resource/chatgpt-06.png',
];

function stableIndex(seed: string, size: number): number {
  let hash = 0;
  for (const ch of seed) {
    hash = ((hash * 31) + (ch.codePointAt(0) || 0)) >>> 0;
  }
  return size > 0 ? hash % size : 0;
}

function defaultConversationAvatarPath(item: ConversationSummary, provider: 'codex' | 'claude'): string {
  if (provider === 'claude') {
    return 'resource/claude.png';
  }
  return CHATGPT_AVATAR_PATHS[stableIndex(String(item.id || item.title || ''), CHATGPT_AVATAR_PATHS.length)]
    || CHATGPT_AVATAR_PATHS[0];
}

function normalizeResourceAvatarPath(input: unknown): string {
  const normalized = String(input || '').replace(/\\/g, '/').replace(/^\/+/, '').trim();
  if (!normalized || normalized.includes('..') || /^[a-zA-Z][a-zA-Z\d+.-]*:/.test(normalized)) {
    return '';
  }
  const relativePath = normalized.startsWith('resource/') ? normalized.slice('resource/'.length) : normalized;
  return relativePath;
}

function isLegacyCodexAvatarPath(input: unknown): boolean {
  return normalizeResourceAvatarPath(input) === 'codex.png';
}

function conversationAvatarUrl(item: ConversationSummary, provider: 'codex' | 'claude'): string {
  const resourceBaseUrl = String(state.appInfo.resourceBaseUrl || '').trim();
  if (!resourceBaseUrl) {
    return '';
  }
  const customPath = String(item.avatarPath || '').trim();
  const hasCustomPath = customPath && !isLegacyCodexAvatarPath(customPath);
  const paths = hasCustomPath
    ? [customPath, defaultConversationAvatarPath(item, provider)]
    : [defaultConversationAvatarPath(item, provider)];
  for (const avatarPath of paths) {
    const relativePath = normalizeResourceAvatarPath(avatarPath);
    if (!relativePath) {
      continue;
    }
    try {
      return new URL(relativePath, resourceBaseUrl).toString();
    } catch {
      continue;
    }
  }
  return '';
}

function agentTeamMetaKey(teamMeta: AgentTeamConversationMeta | null): string {
  if (!teamMeta) {
    return '';
  }
  return [
    teamMeta.groupName,
    teamMeta.roleName,
    teamMeta.provider,
    teamMeta.upstreamName,
  ].map((item) => String(item || '').trim()).join('\u0001');
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
  const teamMeta = agentTeamConversationMeta(item.id);
  const titleText = String(item.title || '-').trim();
  const avatarChar = teamMeta?.roleName ? Array.from(teamMeta.roleName)[0] : titleText ? Array.from(titleText)[0] : '•';
  const avatarTone = conversationAvatarTone(item.id, titleText);
  const timeText = formatMessageTime(item.updatedAt || item.createdAt);
  const previewText = conversationPreviewText(item);
  const provider = conversationProvider(item, teamMeta);
  const avatarUrl = conversationAvatarUrl(item, provider);
  const avatarHtml = avatarUrl
    ? `<div class="conversation-avatar has-image"><img src="${escapeHtml(avatarUrl)}" alt="" loading="lazy" /></div>`
    : `<div class="conversation-avatar ${escapeHtml(avatarTone)}">${escapeHtml(avatarChar)}</div>`;
  const teamBadge = teamMeta ? `<span class="conversation-team-role-badge">${escapeHtml(teamMeta.groupName ? `${teamMeta.groupName} / ${teamMeta.roleName}` : teamMeta.roleName)}</span>` : '';
  const displayTitle = teamMeta?.roleName || item.title || '-';
  const queueBadge = queue > 0 ? `<span class="queue-badge">${escapeHtml(String(queue))}</span>` : '';
  const pinBadge = pinned ? [
    `<span class="conversation-pin-badge" title="${escapeHtml(t('pinnedConversation'))}" aria-label="${escapeHtml(t('pinnedConversation'))}">`,
    '<svg viewBox="0 0 24 24" focusable="false" aria-hidden="true">',
    '<path d="M14 4v1.4l1.8 1.8v4.2l1.9 1.9v.8h-4.2V20l-1.5-1.5v-4.4H7.8v-.8l1.9-1.9V7.2l1.8-1.8V4z" />',
    '</svg>',
    '</span>',
  ].join('') : '';
  const contentHtml = [
    avatarHtml,
    '<div class="conversation-main">',
    '<div class="conversation-top-row">',
    '<div class="conversation-title-row">',
    `<span class="conversation-title-text">${escapeHtml(displayTitle)}</span>`,
    teamBadge,
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
    commandText: String(item.commandText || ''),
    avatarPath: String(item.avatarPath || ''),
    pinnedAt: Number(item.pinnedAt || 0),
    updatedAt: Number(item.updatedAt || 0),
    createdAt: Number(item.createdAt || 0),
    latestMessageRef: Array.isArray(item.messages) && item.messages.length ? item.messages[item.messages.length - 1] : null,
    provider,
    teamMetaKey: agentTeamMetaKey(teamMeta),
    statusKey: status.key,
    statusLabel: status.label,
    queue,
    searchText: `${String(item.title || '')}\n${teamMeta?.groupName || ''}\n${teamMeta?.roleName || ''}\n${providerLabel(provider)}\n${previewText}\n${String(item.sessionId || '')}`.toLowerCase(),
    contentHtml,
    idAttr: escapeHtml(item.id),
  };
}

function getConversationListItemCache(item: ConversationSummary): ConversationListItemCacheEntry {
  const cached = conversationListItemCache.get(item.id);
  const latestMessageRef = Array.isArray(item.messages) && item.messages.length ? item.messages[item.messages.length - 1] : null;
  const status = getConversationState(item.id);
  const queue = queuedCount(item.id);
  const teamMeta = agentTeamConversationMeta(item.id);
  const provider = conversationProvider(item, teamMeta);
  const teamMetaKey = agentTeamMetaKey(teamMeta);
  if (
    cached
    && cached.conversationRef === item
    && cached.language === currentLang()
    && cached.title === String(item.title || '')
    && cached.sessionId === String(item.sessionId || '')
    && cached.commandText === String(item.commandText || '')
    && cached.avatarPath === String(item.avatarPath || '')
    && cached.pinnedAt === Number(item.pinnedAt || 0)
    && cached.updatedAt === Number(item.updatedAt || 0)
    && cached.createdAt === Number(item.createdAt || 0)
    && cached.latestMessageRef === latestMessageRef
    && cached.provider === provider
    && cached.teamMetaKey === teamMetaKey
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
  if (state.workspaceMode === 'team') {
    lastConversationListMode = 'team';
    renderAgentTeamGroupList();
    return;
  }
  if (lastConversationListMode !== 'conversation') {
    lastConversationListMode = 'conversation';
    lastConversationListRenderSignature = '';
  }
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
  const item = findConversationById(id);
  if (!item) {
    return false;
  }
  const keyword = String(el.sidebarSearchInput?.value || '').trim().toLowerCase();
  const cached = getConversationListItemCache(item);
  const matches = !keyword || cached.searchText.includes(keyword);
  const node = el.conversationList.querySelector<HTMLElement>(`.conversation-item[data-id="${cached.idAttr}"]`);
  if (!matches || !node) {
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

export {
  patchConversationListItem,
  pruneConversationRenderCaches,
  renderConversationList,
  updateConversationListActiveState,
};
