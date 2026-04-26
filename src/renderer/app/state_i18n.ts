import { codexdesk } from './codexdesk.js';
import type {
  AppState,
  FontSizeOptions,
  Language,
  PersistOptions,
  RuntimeTab,
  RenderAllOptions,
  RenderHooks,
  ThemeOptions,
  Theme,
  UiState,
} from './types.js';
import { I18N } from './i18n_catalog.js';
import { el } from './dom_refs.js';

type KatexRenderer = {
  renderToString: (
    expression: string,
    options: {
      displayMode?: boolean;
      throwOnError?: boolean;
      strict?: 'ignore' | boolean | string;
      output?: 'html' | 'mathml' | 'htmlAndMathml';
      trust?: boolean;
    },
  ) => string;
};

function getKatexRenderer() {
  const maybeKatex = (globalThis as typeof globalThis & { katex?: KatexRenderer }).katex;
  if (maybeKatex && typeof maybeKatex.renderToString === 'function') {
    return maybeKatex;
  }
  return null;
}

const state: AppState = {
  appInfo: {
    name: 'Codex Desk',
    version: '',
  },
  settings: {
    commandText: '',
    workdir: '',
    defaultWorkdir: '',
    deviceIdentity: '',
    notifications: {
      activeProvider: 'telegram',
      providers: {
        telegram: {
          enabled: false,
          chatId: '',
          hasBotToken: false,
          botTokenHash: '',
          botTokenFingerprint: '',
        },
      },
    },
    remoteControl: {
      activeProvider: 'telegram',
      providers: {
        telegram: {
          enabled: false,
          botToken: '',
          hasBotToken: false,
          botTokenHash: '',
          botTokenFingerprint: '',
          allowedChatId: '',
        },
      },
    },
    security: {
      hasMasterPassword: false,
      unlocked: true,
    },
  },
  activeConversationId: '',
  conversations: [],
  runtimeByConversation: {},
  metaByConversation: {},
  runningConversationIds: new Set(),
  queuedCountByConversation: {},
  queuedMessagesByConversation: {},
  collapsedByConversation: {},
  messageMarkdownByConversation: {},
  workflowCollapsedByConversation: {},
  chatVisibleCountByConversation: {},
  runtimeVisibleCountByConversation: {},
  draftsByConversation: {},
  composerAttachmentsByConversation: {},
  inputBindingConversationId: '',
  activeTab: 'workflow',
  ui: {
    language: 'zh-CN',
    theme: 'light',
    zoomFactor: 1,
    sidebarWidth: 320,
    runtimePanelWidth: 440,
    chatFontSize: 15,
    runtimePanelHidden: false,
    settingsPanelHidden: false,
    sidebarHidden: false,
  },
};

const UI_PREFS_KEY = 'codexdesk.ui-prefs.v1';
const DRAFT_PREFS_KEY = 'codexdesk.drafts.v1';
const NO_CONVERSATION_DRAFT_KEY = '__no_conversation__';
const CHAT_FONT_SIZE_MIN = 12;
const CHAT_FONT_SIZE_MAX = 24;
const CHAT_FONT_SIZE_DEFAULT = 15;
const APP_ZOOM_MIN = 0.5;
const APP_ZOOM_MAX = 2.5;
const APP_ZOOM_DEFAULT = 1;
const APP_ZOOM_STEP = 0.1;
const CHAT_PAGE_SIZE_INITIAL = 80;
const CHAT_PAGE_SIZE_INCREMENT = 80;
const SIDEBAR_WIDTH_MIN = 220;
const SIDEBAR_WIDTH_MAX = 520;
const SIDEBAR_WIDTH_DEFAULT = 320;
const RUNTIME_PANEL_WIDTH_MIN = 320;
const RUNTIME_PANEL_WIDTH_MAX = 760;
const RUNTIME_PANEL_WIDTH_DEFAULT = 440;
const RUNTIME_PAGE_SIZE_INITIAL = 200;
const RUNTIME_PAGE_SIZE_INCREMENT = 200;
const MARKDOWN_CACHE_LIMIT = 400;
const markdownRenderCache = new Map<string, string>();

type MarkdownRenderContext = {
  references: Map<string, string>;
};

const renderHooks: RenderHooks = {
  renderAll: () => {},
  renderSettings: () => {},
};


function currentLang(): Language {
  return state.ui.language === 'en-US' ? 'en-US' : 'zh-CN';
}

function t(key, vars = {}) {
  const table = I18N[currentLang()] || I18N['zh-CN'];
  const text = table[key] || I18N['zh-CN'][key] || key;
  return String(text).replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}

function clampChatFontSize(input, fallback = CHAT_FONT_SIZE_DEFAULT) {
  const value = Number(input);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(CHAT_FONT_SIZE_MAX, Math.max(CHAT_FONT_SIZE_MIN, Math.round(value)));
}

function clampAppZoom(input, fallback = APP_ZOOM_DEFAULT) {
  const value = Number(input);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  const snapped = Math.round(value / APP_ZOOM_STEP) * APP_ZOOM_STEP;
  return Math.min(APP_ZOOM_MAX, Math.max(APP_ZOOM_MIN, Math.round(snapped * 100) / 100));
}

function clampSidebarWidth(input, fallback = SIDEBAR_WIDTH_DEFAULT) {
  const value = Number(input);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(value)));
}

function clampRuntimePanelWidth(input, fallback = RUNTIME_PANEL_WIDTH_DEFAULT) {
  const value = Number(input);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(RUNTIME_PANEL_WIDTH_MAX, Math.max(RUNTIME_PANEL_WIDTH_MIN, Math.round(value)));
}

function normalizeTheme(input: unknown): Theme {
  return String(input || '').trim().toLowerCase() === 'dark' ? 'dark' : 'light';
}

function parseUiPrefs(rawText: string | null): UiState {
  try {
    const data = JSON.parse(String(rawText || '{}'));
    const language: Language = data.language === 'en-US' ? 'en-US' : 'zh-CN';
    const theme = normalizeTheme(data.theme);
    const zoomFactor = clampAppZoom(data.zoomFactor, APP_ZOOM_DEFAULT);
    const sidebarWidth = clampSidebarWidth(data.sidebarWidth, SIDEBAR_WIDTH_DEFAULT);
    const runtimePanelWidth = clampRuntimePanelWidth(data.runtimePanelWidth, RUNTIME_PANEL_WIDTH_DEFAULT);
    const chatFontSize = clampChatFontSize(data.chatFontSize, CHAT_FONT_SIZE_DEFAULT);
    const runtimePanelHidden = Boolean(data.runtimePanelHidden);
    const settingsPanelHidden = Boolean(data.settingsPanelHidden);
    const sidebarHidden = Boolean(data.sidebarHidden);
    return {
      language,
      theme,
      zoomFactor,
      sidebarWidth,
      runtimePanelWidth,
      chatFontSize,
      runtimePanelHidden,
      settingsPanelHidden,
      sidebarHidden,
    };
  } catch {
    return {
      language: 'zh-CN',
      theme: 'light',
      zoomFactor: APP_ZOOM_DEFAULT,
      sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
      runtimePanelWidth: RUNTIME_PANEL_WIDTH_DEFAULT,
      chatFontSize: CHAT_FONT_SIZE_DEFAULT,
      runtimePanelHidden: false,
      settingsPanelHidden: false,
      sidebarHidden: false,
    };
  }
}

function loadUiPrefs() {
  const raw = window.localStorage.getItem(UI_PREFS_KEY);
  state.ui = parseUiPrefs(raw);
}

function saveUiPrefs() {
  window.localStorage.setItem(UI_PREFS_KEY, JSON.stringify(state.ui));
}

function draftStorageKey(conversationId) {
  const id = String(conversationId || '').trim();
  return id || NO_CONVERSATION_DRAFT_KEY;
}

function parseDraftPrefs(raw) {
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const result = {};
    Object.entries(parsed).forEach(([key, value]) => {
      const nextKey = String(key || '').trim();
      if (!nextKey) {
        return;
      }
      const nextValue = String(value || '');
      if (nextValue) {
        result[nextKey] = nextValue;
      }
    });
    return result;
  } catch {
    return {};
  }
}

function loadDraftPrefs() {
  state.draftsByConversation = parseDraftPrefs(window.localStorage.getItem(DRAFT_PREFS_KEY));
}

function saveDraftPrefs() {
  window.localStorage.setItem(DRAFT_PREFS_KEY, JSON.stringify(state.draftsByConversation || {}));
}

function getConversationDraft(conversationId) {
  return String(state.draftsByConversation[draftStorageKey(conversationId)] || '');
}

function setConversationDraft(conversationId, text, options: PersistOptions = {}) {
  const persist = options.persist !== false;
  const key = draftStorageKey(conversationId);
  const nextValue = String(text || '');
  if (nextValue) {
    state.draftsByConversation[key] = nextValue;
  } else {
    delete state.draftsByConversation[key];
  }
  if (persist) {
    saveDraftPrefs();
  }
}

function pruneConversationDrafts(validConversationIds) {
  const validKeys = new Set((validConversationIds || []).map((id) => draftStorageKey(id)));
  validKeys.add(NO_CONVERSATION_DRAFT_KEY);
  let changed = false;
  Object.keys(state.draftsByConversation || {}).forEach((key) => {
    if (!validKeys.has(key)) {
      delete state.draftsByConversation[key];
      changed = true;
    }
  });
  if (changed) {
    saveDraftPrefs();
  }
}

function getComposerAttachments(conversationId) {
  const key = draftStorageKey(conversationId);
  const items = state.composerAttachmentsByConversation[key];
  return Array.isArray(items) ? items : [];
}

function setComposerAttachments(conversationId, attachments) {
  const key = draftStorageKey(conversationId);
  const items = Array.isArray(attachments)
    ? attachments.filter((item) => item && String(item.path || '').trim())
    : [];
  if (items.length) {
    state.composerAttachmentsByConversation[key] = items;
  } else {
    delete state.composerAttachmentsByConversation[key];
  }
}

function pruneComposerAttachments(validConversationIds) {
  const validKeys = new Set((validConversationIds || []).map((id) => draftStorageKey(id)));
  validKeys.add(NO_CONVERSATION_DRAFT_KEY);
  Object.keys(state.composerAttachmentsByConversation || {}).forEach((key) => {
    if (!validKeys.has(key)) {
      delete state.composerAttachmentsByConversation[key];
    }
  });
}

function defaultChatVisibleCount(totalCount) {
  const total = Math.max(0, Number(totalCount) || 0);
  return Math.min(total, CHAT_PAGE_SIZE_INITIAL);
}

function ensureChatVisibleCount(conversationId, totalCount) {
  const id = String(conversationId || '').trim();
  const total = Math.max(0, Number(totalCount) || 0);
  if (!id) {
    return defaultChatVisibleCount(total);
  }
  const fallback = defaultChatVisibleCount(total);
  const current = Number(state.chatVisibleCountByConversation[id]);
  let next = Number.isFinite(current) ? Math.max(0, Math.round(current)) : fallback;
  if (total <= 0) {
    next = 0;
  } else {
    next = Math.max(fallback, Math.min(total, next || fallback));
  }
  state.chatVisibleCountByConversation[id] = next;
  return next;
}

function syncChatVisibleCount(conversationId, totalCount, previousTotalCount = 0) {
  const id = String(conversationId || '').trim();
  const total = Math.max(0, Number(totalCount) || 0);
  const previousTotal = Math.max(0, Number(previousTotalCount) || 0);
  if (!id) {
    return defaultChatVisibleCount(total);
  }
  let current = ensureChatVisibleCount(id, previousTotal);
  if (total <= 0) {
    state.chatVisibleCountByConversation[id] = 0;
    return 0;
  }
  if (total > previousTotal && current >= previousTotal) {
    current = Math.min(total, Math.max(defaultChatVisibleCount(total), current + (total - previousTotal)));
  } else {
    current = Math.max(defaultChatVisibleCount(total), Math.min(total, current));
  }
  state.chatVisibleCountByConversation[id] = current;
  return current;
}

function increaseChatVisibleCount(conversationId, totalCount, step = CHAT_PAGE_SIZE_INCREMENT) {
  const id = String(conversationId || '').trim();
  const total = Math.max(0, Number(totalCount) || 0);
  if (!id) {
    return defaultChatVisibleCount(total);
  }
  const current = ensureChatVisibleCount(id, total);
  const next = Math.min(total, current + Math.max(1, Number(step) || CHAT_PAGE_SIZE_INCREMENT));
  state.chatVisibleCountByConversation[id] = next;
  return next;
}

function pruneChatVisibleCounts(validConversationIds) {
  const validIds = new Set((validConversationIds || []).map((id) => String(id || '').trim()).filter(Boolean));
  Object.keys(state.chatVisibleCountByConversation || {}).forEach((id) => {
    if (!validIds.has(id)) {
      delete state.chatVisibleCountByConversation[id];
    }
  });
}

function defaultRuntimeVisibleCount(totalCount) {
  const total = Math.max(0, Number(totalCount) || 0);
  return Math.min(total, RUNTIME_PAGE_SIZE_INITIAL);
}

function ensureRuntimeVisibleCount(conversationId, tab: RuntimeTab, totalCount) {
  const id = String(conversationId || '').trim();
  const total = Math.max(0, Number(totalCount) || 0);
  if (!id) {
    return defaultRuntimeVisibleCount(total);
  }
  if (!state.runtimeVisibleCountByConversation[id] || typeof state.runtimeVisibleCountByConversation[id] !== 'object') {
    state.runtimeVisibleCountByConversation[id] = {};
  }
  const table = state.runtimeVisibleCountByConversation[id];
  const fallback = defaultRuntimeVisibleCount(total);
  const current = Number(table[tab]);
  let next = Number.isFinite(current) ? Math.max(0, Math.round(current)) : fallback;
  if (total <= 0) {
    next = 0;
  } else {
    next = Math.max(fallback, Math.min(total, next || fallback));
  }
  table[tab] = next;
  return next;
}

function increaseRuntimeVisibleCount(conversationId, tab: RuntimeTab, totalCount, step = RUNTIME_PAGE_SIZE_INCREMENT) {
  const id = String(conversationId || '').trim();
  const total = Math.max(0, Number(totalCount) || 0);
  if (!id) {
    return defaultRuntimeVisibleCount(total);
  }
  const current = ensureRuntimeVisibleCount(id, tab, total);
  const next = Math.min(total, current + Math.max(1, Number(step) || RUNTIME_PAGE_SIZE_INCREMENT));
  state.runtimeVisibleCountByConversation[id][tab] = next;
  return next;
}

function pruneRuntimeVisibleCounts(validConversationIds) {
  const validIds = new Set((validConversationIds || []).map((id) => String(id || '').trim()).filter(Boolean));
  Object.keys(state.runtimeVisibleCountByConversation || {}).forEach((id) => {
    if (!validIds.has(id)) {
      delete state.runtimeVisibleCountByConversation[id];
    }
  });
}

function syncMenuLanguage() {
  if (!codexdesk || typeof codexdesk.setMenuLanguage !== 'function') {
    return;
  }
  codexdesk.setMenuLanguage(currentLang()).catch(() => {});
}

function applyChatFontSize() {
  const chatFontSize = clampChatFontSize(state.ui.chatFontSize, CHAT_FONT_SIZE_DEFAULT);
  const px = `${chatFontSize}px`;
  const scale = (chatFontSize / CHAT_FONT_SIZE_DEFAULT).toFixed(3);
  document.documentElement.style.setProperty('--chat-font-size', px);
  document.documentElement.style.setProperty('--chat-font-scale', scale);
}

function applySidebarWidth() {
  const width = clampSidebarWidth(state.ui.sidebarWidth, SIDEBAR_WIDTH_DEFAULT);
  document.documentElement.style.setProperty('--sidebar-width', `${width}px`);
}

function applyRuntimePanelWidth() {
  const width = clampRuntimePanelWidth(state.ui.runtimePanelWidth, RUNTIME_PANEL_WIDTH_DEFAULT);
  document.documentElement.style.setProperty('--runtime-panel-width', `${width}px`);
}

function setSidebarWidth(input, options: PersistOptions = {}) {
  const persist = options.persist !== false;
  const next = clampSidebarWidth(input, state.ui.sidebarWidth);
  const changed = next !== state.ui.sidebarWidth;
  state.ui.sidebarWidth = next;
  if (changed) {
    applySidebarWidth();
    if (persist) {
      saveUiPrefs();
    }
  }
}

function setRuntimePanelWidth(input, options: PersistOptions = {}) {
  const persist = options.persist !== false;
  const next = clampRuntimePanelWidth(input, state.ui.runtimePanelWidth);
  const changed = next !== state.ui.runtimePanelWidth;
  state.ui.runtimePanelWidth = next;
  if (changed) {
    applyRuntimePanelWidth();
    if (persist) {
      saveUiPrefs();
    }
  }
}

function applyTheme() {
  document.documentElement.setAttribute('data-theme', normalizeTheme(state.ui.theme));
  syncWindowTheme();
}

function syncWindowTheme() {
  if (!codexdesk || typeof codexdesk.setWindowTheme !== 'function') {
    return;
  }
  codexdesk.setWindowTheme(normalizeTheme(state.ui.theme)).catch(() => {});
}

function setTheme(input, options: ThemeOptions = {}) {
  const persist = options.persist !== false;
  const rerender = options.rerender !== false;
  const next = normalizeTheme(input);
  const changed = next !== normalizeTheme(state.ui.theme);
  state.ui.theme = next;
  if (changed) {
    applyTheme();
    if (persist) {
      saveUiPrefs();
    }
  }
  if (rerender) {
    renderHooks.renderAll();
  }
}

function setChatFontSize(input, options: FontSizeOptions = {}) {
  const persist = options.persist !== false;
  const rerenderControls = options.rerenderControls !== false;
  const next = clampChatFontSize(input, state.ui.chatFontSize);
  const changed = next !== state.ui.chatFontSize;
  state.ui.chatFontSize = next;
  if (changed) {
    applyChatFontSize();
    if (persist) {
      saveUiPrefs();
    }
  }
  if (rerenderControls) {
    renderHooks.renderSettings();
  }
}

function setRenderHooks(nextHooks: Partial<RenderHooks>) {
  if (typeof nextHooks.renderAll === 'function') {
    renderHooks.renderAll = nextHooks.renderAll;
  }
  if (typeof nextHooks.renderSettings === 'function') {
    renderHooks.renderSettings = nextHooks.renderSettings;
  }
}

function localizeKnownText(input) {
  if (currentLang() === 'zh-CN') {
    return String(input || '');
  }
  let text = String(input || '');
  const replacements = [
    ['请先新建对话。', 'Please create a conversation first.'],
    ['会话不存在', 'Conversation not found'],
    ['会话名称不能为空', 'Conversation name cannot be empty'],
    ['消息不能为空', 'Message cannot be empty'],
    ['当前对话上一条消息还在处理中，请稍候。', 'The previous message is still being processed. Please wait.'],
    ['当前对话没有可重试的用户消息。', 'No user message available to retry in this conversation.'],
    ['请先停止当前任务。', 'Please stop the current task first.'],
    ['导入会话失败:', 'Session import failed:'],
    ['导出会话失败:', 'Session export failed:'],
    ['会话文件路径不能为空', 'Session file path cannot be empty'],
    ['会话文件不存在:', 'Session file not found:'],
    ['未从会话文件中解析到可导入的用户/助手消息', 'No importable user/assistant messages were found in the session file'],
    ['导出文件路径不能为空', 'Export file path cannot be empty'],
    ['当前会话没有可导出的消息', 'The current conversation has no exportable messages'],
    ['已导出会话到:', 'Conversation exported to:'],
    ['消息数:', 'Message count:'],
    ['已请求停止当前对话任务', 'Stop requested for current conversation task'],
    ['已关闭当前对话', 'Current conversation closed'],
    ['已清空当前对话内容', 'Current conversation content cleared'],
    ['已清空右侧运行日志（结构化事件/运行步骤/事件原文）', 'Runtime logs on the right have been cleared'],
    ['后台运行中', 'Running in background'],
    ['空闲', 'Idle'],
    ['已完成', 'Completed'],
    ['失败', 'Failed'],
    ['准备中...', 'Preparing...'],
    ['正在启动 Codex...', 'Starting Codex...'],
    ['正在分析请求...', 'Analyzing request...'],
    ['正在输出回复...', 'Generating response...'],
    ['回复生成完成', 'Response generated'],
    ['任务完成', 'Task completed'],
    ['任务失败', 'Task failed'],
    ['网络异常，正在重连...', 'Network issue, reconnecting...'],
    ['Telegram Bot Token 未配置', 'Telegram Bot Token is not configured'],
    ['Telegram Bot Token 无效，接口返回 Not Found', 'Telegram Bot Token is invalid; Telegram returned Not Found'],
    ['Telegram Chat ID 未配置', 'Telegram Chat ID is not configured'],
    ['Telegram Chat ID 无效，或该聊天还没有和 Bot 建立会话', 'Telegram Chat ID is invalid, or the chat has not started a conversation with the bot yet'],
    ['Telegram 远程对话 Bot Token 未配置', 'Telegram remote chat Bot Token is not configured'],
    ['Telegram 远程对话 Chat ID 未配置', 'Telegram remote chat Chat ID is not configured'],
    ['Telegram Bot 已被对方屏蔽，请先解除屏蔽后再测试', 'The Telegram bot is blocked by the recipient; unblock it before testing again'],
    ['Telegram 请求失败', 'Telegram request failed'],
    ['Telegram 凭据已锁定，请先解锁', 'Telegram credentials are locked; unlock them first'],
    ['Telegram 凭据已锁定，请先在设置 > 凭据保护中解锁', 'Telegram credentials are locked; unlock them first in Settings > Credential Vault'],
    ['通讯凭据已锁定，请先在设置 > 凭据保护中解锁', 'Messaging credentials are locked; unlock them first in Settings > Credential Vault'],
    ['Telegram 通知和远程对话当前已暂停，请先在设置 > 通知解锁与保护中解锁', 'Telegram notifications and remote chat are paused. Unlock them first in Settings > Messaging Unlock & Protection'],
    ['当前已启用的通知和远程对话已暂停，请先在设置 > 通知解锁与保护中解锁', 'Enabled notifications and remote chat are paused. Unlock them first in Settings > Messaging Unlock & Protection'],
    ['请先解锁后再修改主密码', 'Unlock credentials before changing the master password'],
    ['主密码不能为空', 'Master password cannot be empty'],
    ['主密码错误', 'Incorrect master password'],
    ['当前还没有设置主密码', 'No master password has been set yet'],
    ['窗口不可用', 'Window unavailable'],
    ['无效动作', 'Invalid action'],
    ['未支持的动作:', 'Unsupported action:'],
  ];
  for (const [zh, en] of replacements) {
    text = text.replaceAll(zh, en);
  }
  return text;
}

function escapeHtml(text) {
  return String(text ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeLocalLinkTarget(target) {
  const value = String(target || '').trim();
  if (!value) {
    return '';
  }
  if (/^file:\/\//i.test(value)) {
    return value;
  }
  return /^(\/|[a-zA-Z]:[\\/])/.test(value) ? value : '';
}

function isMarkdownEmail(value) {
  return /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(String(value || '').trim());
}

function renderMarkdownLink(label, target) {
  const href = String(target || '').trim();
  const localPath = normalizeLocalLinkTarget(href);
  if (localPath) {
    return `<a href="#" class="md-local-link" data-open-path="${escapeHtml(encodeURIComponent(localPath))}" title="${escapeHtml(localPath)}">${label}</a>`;
  }
  if (/^(https?:\/\/|mailto:)/i.test(href)) {
    return `<a href="${escapeHtml(href)}" target="_blank" rel="noreferrer">${label}</a>`;
  }
  if (isMarkdownEmail(href)) {
    const mailto = `mailto:${href}`;
    return `<a href="${escapeHtml(mailto)}" target="_blank" rel="noreferrer">${label}</a>`;
  }
  return `[${label}](${escapeHtml(href)})`;
}

function normalizeMarkdownReferenceLabel(label) {
  return String(label || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function extractMarkdownReferenceDefinitions(text) {
  const references = new Map<string, string>();
  const cleanedLines = String(text || '').split(/\r?\n/).filter((line) => {
    const match = /^\s*\[([^\]]+)\]:\s*(\S+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*$/.exec(String(line || ''));
    if (!match) {
      return true;
    }
    references.set(normalizeMarkdownReferenceLabel(match[1]), String(match[2] || '').trim());
    return false;
  });
  return {
    references,
    text: cleanedLines.join('\n'),
  };
}

function renderMarkdownMath(expression, displayMode) {
  const tex = String(expression || '').trim();
  if (!tex) {
    return '';
  }
  const katexRenderer = getKatexRenderer();
  if (!katexRenderer) {
    const fallback = `<code>${escapeHtml(tex)}</code>`;
    if (displayMode) {
      return `<div class="md-math-block md-math-fallback">${fallback}</div>`;
    }
    return `<span class="md-math-inline md-math-fallback">${fallback}</span>`;
  }
  try {
    const html = katexRenderer.renderToString(tex, {
      displayMode,
      throwOnError: false,
      strict: 'ignore',
      output: 'html',
      trust: false,
    });
    if (displayMode) {
      return `<div class="md-math-block">${html}</div>`;
    }
    return `<span class="md-math-inline">${html}</span>`;
  } catch {
    const fallback = `<code>${escapeHtml(tex)}</code>`;
    if (displayMode) {
      return `<div class="md-math-block md-math-fallback">${fallback}</div>`;
    }
    return `<span class="md-math-inline md-math-fallback">${fallback}</span>`;
  }
}

function splitMarkdownAutoLinkTail(value) {
  const match = /^(.*?)([),.!?:;]+)?$/.exec(String(value || ''));
  return {
    body: String(match?.[1] || ''),
    tail: String(match?.[2] || ''),
  };
}

function renderMarkdownTaskItem(itemText, context: MarkdownRenderContext = { references: new Map() }) {
  const match = /^\[(x|X| )\]\s+([\s\S]+)$/.exec(String(itemText || ''));
  if (!match) {
    return '';
  }
  const checked = match[1].toLowerCase() === 'x';
  return [
    '<li class="md-task-item">',
    `<span class="md-task-checkbox${checked ? ' is-checked' : ''}" aria-hidden="true"></span>`,
    `<span class="md-task-content">${renderInline(match[2], context)}</span>`,
    '</li>',
  ].join('');
}

function renderMarkdownAdmonition(kind, content, context: MarkdownRenderContext = { references: new Map() }) {
  const level = String(kind || '').toLowerCase();
  const title = String(kind || '').toUpperCase();
  return [
    `<div class="md-admonition md-admonition-${escapeHtml(level)}">`,
    `<div class="md-admonition-title">${escapeHtml(title)}</div>`,
    `<div class="md-admonition-body">${renderInline(String(content || '').trim(), context)}</div>`,
    '</div>',
  ].join('');
}

function renderInline(text, context: MarkdownRenderContext = { references: new Map() }) {
  const codeTokens: string[] = [];
  const input = String(text || '').replace(/`([^`\n]+)`/g, (_, codeText) => {
    const token = `@@MD_CODE_${codeTokens.length}@@`;
    codeTokens.push(`<code>${escapeHtml(codeText)}</code>`);
    return token;
  });
  const escapeTokens: string[] = [];
  const escapedMarkdown = input.replace(/\\([\\`*_~{}\[\]()#+\-.!|>])/g, (_, escapedChar) => {
    const token = `@@MD_ESC_${escapeTokens.length}@@`;
    escapeTokens.push(escapeHtml(escapedChar));
    return token;
  });
  const linkTokens: string[] = [];
  const pushLinkToken = (html) => {
    const token = `@@MD_LINK_${linkTokens.length}@@`;
    linkTokens.push(html);
    return token;
  };
  const mathTokens: string[] = [];
  const pushMathToken = (html) => {
    const token = `@@MD_MATH_${mathTokens.length}@@`;
    mathTokens.push(html);
    return token;
  };
  const mathLinked = escapedMarkdown.replace(/(?<!\$)\$([^\s$](?:[^$\n]|\\\$)*?[^\s$])\$(?!\$)/g, (_, expression) => (
    pushMathToken(renderMarkdownMath(expression, false))
  ));
  const linked = mathLinked
    .replace(/\[([^\]]+)\]\(([^)\n]+)\)/g, (_, label, target) => (
      pushLinkToken(renderMarkdownLink(escapeHtml(label), target))
    ))
    .replace(/\[([^\]]+)\]\[([^\]]+)\]/g, (_, label, refLabel) => {
      const referenceTarget = context.references.get(normalizeMarkdownReferenceLabel(refLabel));
      return referenceTarget
        ? pushLinkToken(renderMarkdownLink(escapeHtml(label), referenceTarget))
        : `[${label}][${refLabel}]`;
    })
    .replace(/\[([^\]]+)\]\[\]/g, (_, label) => {
      const referenceTarget = context.references.get(normalizeMarkdownReferenceLabel(label));
      return referenceTarget
        ? pushLinkToken(renderMarkdownLink(escapeHtml(label), referenceTarget))
        : `[${label}][]`;
    });
  const autoLinkedUrls = linked.replace(/https?:\/\/[^\s<]+/gi, (rawUrl, offset, whole) => {
    const previous = offset > 0 ? whole[offset - 1] : '';
    if (previous === '"' || previous === '\'' || previous === '=' || previous === '@') {
      return rawUrl;
    }
    const { body, tail } = splitMarkdownAutoLinkTail(rawUrl);
    if (!body) {
      return rawUrl;
    }
    return `${pushLinkToken(renderMarkdownLink(escapeHtml(body), body))}${tail}`;
  });
  const autoLinked = autoLinkedUrls.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, (rawEmail, offset, whole) => {
    const previous = offset > 0 ? whole[offset - 1] : '';
    if (/[A-Z0-9._%+-]/i.test(previous) || previous === '/' || previous === '"' || previous === '\'') {
      return rawEmail;
    }
    const next = offset + rawEmail.length < whole.length ? whole[offset + rawEmail.length] : '';
    if (/[A-Z0-9._%+-]/i.test(next)) {
      return rawEmail;
    }
    const { body, tail } = splitMarkdownAutoLinkTail(rawEmail);
    if (!body) {
      return rawEmail;
    }
    return `${pushLinkToken(renderMarkdownLink(escapeHtml(body), body))}${tail}`;
  });
  let escaped = escapeHtml(autoLinked);
  linkTokens.forEach((html, index) => {
    escaped = escaped.replace(`@@MD_LINK_${index}@@`, html);
  });
  mathTokens.forEach((html, index) => {
    escaped = escaped.replace(`@@MD_MATH_${index}@@`, html);
  });
  escaped = escaped.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  escaped = escaped.replace(/\*\*((?:(?!\*\*).|\n)+?)\*\*/g, '<b>$1</b>');
  escaped = escaped.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<i>$1</i>');
  codeTokens.forEach((html, index) => {
    escaped = escaped.replace(`@@MD_CODE_${index}@@`, html);
  });
  escapeTokens.forEach((html, index) => {
    escaped = escaped.replace(`@@MD_ESC_${index}@@`, html);
  });
  return escaped;
}

function isMarkdownTableSeparator(text) {
  const value = String(text || '').trim();
  if (!value || !value.includes('|')) {
    return false;
  }
  const normalized = value.replace(/^\|/, '').replace(/\|$/, '');
  const cells = normalized.split('|').map((item) => item.trim()).filter(Boolean);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function splitMarkdownTableRow(text) {
  const raw = String(text || '').trim().replace(/^\|/, '').replace(/\|$/, '');
  return raw.split('|').map((item) => item.trim());
}

function tableAlignmentFromMarker(marker) {
  const value = String(marker || '').trim();
  if (value.startsWith(':') && value.endsWith(':')) {
    return 'center';
  }
  if (value.endsWith(':')) {
    return 'right';
  }
  if (value.startsWith(':')) {
    return 'left';
  }
  return '';
}

function isMarkdownTableStart(headerLine, separatorLine) {
  if (!isMarkdownTableSeparator(separatorLine)) {
    return false;
  }
  const headers = splitMarkdownTableRow(headerLine);
  const separators = splitMarkdownTableRow(separatorLine);
  return headers.length > 0 && headers.length === separators.length;
}

function renderMarkdownTable(headerLine, separatorLine, bodyLines, context: MarkdownRenderContext = { references: new Map() }) {
  const headers = splitMarkdownTableRow(headerLine);
  const separators = splitMarkdownTableRow(separatorLine);
  if (!headers.length || headers.length !== separators.length) {
    return '';
  }

  const alignments = separators.map((item) => tableAlignmentFromMarker(item));
  const renderCell = (tag, value, alignment) => {
    const style = alignment ? ` style="text-align:${escapeHtml(alignment)}"` : '';
    return `<${tag}${style}>${renderInline(value, context)}</${tag}>`;
  };

  const headHtml = `<thead><tr>${headers.map((item, index) => renderCell('th', item, alignments[index])).join('')}</tr></thead>`;
  const bodyHtml = bodyLines.length
    ? `<tbody>${bodyLines.map((line) => {
      const cells = splitMarkdownTableRow(line);
      const normalized = headers.map((_, index) => cells[index] || '');
      return `<tr>${normalized.map((item, index) => renderCell('td', item, alignments[index])).join('')}</tr>`;
    }).join('')}</tbody>`
    : '';

  return `<div class="md-table-wrap"><table class="md-table">${headHtml}${bodyHtml}</table></div>`;
}

function isBlockquoteLine(line) {
  return /^\s*>(?:\s|>|$)/.test(String(line || ''));
}

function stripOneBlockquoteLevel(line) {
  return String(line || '').replace(/^\s*>\s?/, '');
}

function renderMarkdownParagraph(lines, context: MarkdownRenderContext = { references: new Map() }) {
  const parts = [];
  lines.forEach((line, index) => {
    const raw = String(line || '');
    parts.push(renderInline(raw.trim(), context));
    if (index >= lines.length - 1) {
      return;
    }
    parts.push(/ {2,}$/.test(raw) ? '<br>' : ' ');
  });
  return `<p>${parts.join('')}</p>`;
}

function collectMarkdownBlockMath(lines, startIndex) {
  const first = String(lines[startIndex] || '');
  const firstTrim = first.trim();
  if (!firstTrim.startsWith('$$')) {
    return null;
  }
  const inlineBody = firstTrim.slice(2);
  if (inlineBody.endsWith('$$') && inlineBody.trim() !== '$$') {
    const content = inlineBody.slice(0, -2).trim();
    return {
      html: renderMarkdownMath(content, true),
      nextIndex: startIndex + 1,
    };
  }
  const mathLines = [];
  if (inlineBody.trim()) {
    mathLines.push(inlineBody);
  }
  let index = startIndex + 1;
  while (index < lines.length) {
    const current = String(lines[index] || '');
    const currentTrim = current.trim();
    if (currentTrim.endsWith('$$')) {
      const tail = currentTrim.slice(0, -2);
      if (tail) {
        mathLines.push(tail);
      }
      return {
        html: renderMarkdownMath(mathLines.join('\n').trim(), true),
        nextIndex: index + 1,
      };
    }
    mathLines.push(current);
    index += 1;
  }
  return null;
}

function renderMarkdownFallback(text, context: MarkdownRenderContext = { references: new Map() }) {
  const lines = String(text || '').split(/\r?\n/);
  const result = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const stripped = String(line || '').trim();
    if (!stripped) {
      index += 1;
      continue;
    }

    const heading = /^(#{1,6})\s+(.+)$/.exec(stripped);
    if (heading) {
      const level = heading[1].length;
      result.push(`<h${level}>${renderInline(heading[2], context)}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^[-*_]{3,}$/.test(stripped)) {
      result.push('<hr/>');
      index += 1;
      continue;
    }

    const admonition = /^\[!(NOTE|TIP|WARNING|CAUTION)\]\s*(.*)$/i.exec(stripped);
    if (admonition) {
      const detailLines = [admonition[2]];
      index += 1;
      while (index < lines.length) {
        const current = String(lines[index] || '');
        const currentStrip = current.trim();
        if (
          !currentStrip
          || /^(#{1,6})\s+/.test(currentStrip)
          || /^[-*_]{3,}$/.test(currentStrip)
          || isBlockquoteLine(current)
          || /^\s*[-*+]\s+/.test(current)
          || /^\s*\d+\.\s+/.test(current)
          || currentStrip.startsWith('$$')
          || /^\[!(NOTE|TIP|WARNING|CAUTION)\]/i.test(currentStrip)
        ) {
          break;
        }
        detailLines.push(currentStrip);
        index += 1;
      }
      result.push(renderMarkdownAdmonition(admonition[1], detailLines.filter(Boolean).join(' '), context));
      continue;
    }

    const mathBlock = collectMarkdownBlockMath(lines, index);
    if (mathBlock) {
      result.push(mathBlock.html);
      index = mathBlock.nextIndex;
      continue;
    }

    if (isBlockquoteLine(line)) {
      const quoteLines = [];
      while (index < lines.length && isBlockquoteLine(lines[index])) {
        quoteLines.push(stripOneBlockquoteLevel(lines[index]));
        index += 1;
      }
      result.push(`<blockquote>${renderMarkdownFallback(quoteLines.join('\n'), context)}</blockquote>`);
      continue;
    }

    if (/^[-*+]\s+/.test(stripped)) {
      const items = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(String(lines[index] || ''))) {
        const item = String(lines[index] || '').replace(/^\s*[-*+]\s+/, '').trim();
        const taskItem = renderMarkdownTaskItem(item, context);
        items.push(taskItem || `<li>${renderInline(item, context)}</li>`);
        index += 1;
      }
      result.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (/^\d+\.\s+/.test(stripped)) {
      const items = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(String(lines[index] || ''))) {
        const item = String(lines[index] || '').replace(/^\s*\d+\.\s+/, '').trim();
        const taskItem = renderMarkdownTaskItem(item, context);
        items.push(taskItem || `<li>${renderInline(item, context)}</li>`);
        index += 1;
      }
      result.push(`<ol>${items.join('')}</ol>`);
      continue;
    }

    if (stripped.includes('|') && index + 1 < lines.length && isMarkdownTableStart(line, lines[index + 1])) {
      const tableLines = [line, lines[index + 1]];
      index += 2;
      while (index < lines.length) {
        const current = String(lines[index] || '');
        const currentStrip = current.trim();
        if (!currentStrip || !currentStrip.includes('|') || isMarkdownTableSeparator(currentStrip)) {
          break;
        }
        tableLines.push(current);
        index += 1;
      }
      const tableHtml = renderMarkdownTable(tableLines[0], tableLines[1], tableLines.slice(2), context);
      if (tableHtml) {
        result.push(tableHtml);
        continue;
      }
    }

    const paragraphLines = [];
    while (index < lines.length) {
      const current = String(lines[index] || '');
      const currentStrip = current.trim();
      if (!currentStrip) {
        break;
      }
      if (/^(#{1,6})\s+/.test(currentStrip)) {
        break;
      }
      if (/^[-*_]{3,}$/.test(currentStrip)) {
        break;
      }
      if (isBlockquoteLine(current)) {
        break;
      }
      if (/^\s*[-*+]\s+/.test(current)) {
        break;
      }
      if (/^\s*\d+\.\s+/.test(current)) {
        break;
      }
      if (currentStrip.startsWith('$$')) {
        break;
      }
      if (/^\[!(NOTE|TIP|WARNING|CAUTION)\]/i.test(currentStrip)) {
        break;
      }
      if (currentStrip.includes('|') && index + 1 < lines.length && isMarkdownTableStart(current, lines[index + 1])) {
        break;
      }
      paragraphLines.push(current);
      index += 1;
    }
    result.push(renderMarkdownParagraph(paragraphLines, context));
  }

  return result.join('');
}

function renderMarkdownLike(text) {
  const raw = String(text || '');
  const cacheable = raw.length > 0 && raw.length <= 50000;
  const cacheKey = cacheable ? `${currentLang()}::${raw}` : '';
  if (cacheKey && markdownRenderCache.has(cacheKey)) {
    const cached = markdownRenderCache.get(cacheKey);
    markdownRenderCache.delete(cacheKey);
    markdownRenderCache.set(cacheKey, cached);
    return cached;
  }
  const fencePattern = /```([^\n`]*)\n?([\s\S]*?)```/g;
  const fenceCollectorPattern = /```([^\n`]*)\n?([\s\S]*?)```/g;
  const references = new Map<string, string>();
  raw.replace(fenceCollectorPattern, '\n').split(/\r?\n/).forEach((line) => {
    const match = /^\s*\[([^\]]+)\]:\s*(\S+)(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?\s*$/.exec(String(line || ''));
    if (!match) {
      return;
    }
    references.set(normalizeMarkdownReferenceLabel(match[1]), String(match[2] || '').trim());
  });
  const context: MarkdownRenderContext = { references };
  let start = 0;
  let html = '';
  let match = null;

  while ((match = fencePattern.exec(raw)) !== null) {
    const normalPart = raw.slice(start, match.index);
    if (normalPart.trim()) {
      html += renderMarkdownFallback(extractMarkdownReferenceDefinitions(normalPart).text, context);
    }

    const language = String(match[1] || '').trim() || 'code';
    const codeText = escapeHtml(String(match[2] || '').replace(/\n$/, ''));
    html += [
      '<div class="md-code-wrap">',
      `<div class="md-code-lang">${escapeHtml(language)}</div>`,
      `<pre><code>${codeText}</code></pre>`,
      '</div>',
    ].join('');
    start = fencePattern.lastIndex;
  }

  const tail = raw.slice(start);
  if (tail.trim() || !html) {
    html += renderMarkdownFallback(extractMarkdownReferenceDefinitions(tail).text, context);
  }
  if (cacheKey) {
    markdownRenderCache.set(cacheKey, html);
    while (markdownRenderCache.size > MARKDOWN_CACHE_LIMIT) {
      const oldestKey = markdownRenderCache.keys().next().value;
      if (!oldestKey) {
        break;
      }
      markdownRenderCache.delete(oldestKey);
    }
  }
  return html;
}

function formatElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function splitCommandArgs(commandText) {
  const input = String(commandText || '').trim();
  if (!input) {
    return [];
  }
  const result = [];
  const re = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|([^\s]+)/g;
  let match = null;
  while ((match = re.exec(input)) !== null) {
    const token = match[1] ?? match[2] ?? match[3] ?? '';
    result.push(token.replace(/\\(["'\\])/g, '$1'));
  }
  return result;
}

function resolvePermissionSummary() {
  const args = splitCommandArgs(state.settings.commandText || '');
  const workdir = String(state.settings.workdir || '').trim();
  const addDirs = [];
  let sandbox = '';
  let bypass = false;
  const looksCodexExec = args.length >= 2 && String(args[0] || '').includes('codex') && args[1] === 'exec';

  for (let i = 0; i < args.length; i += 1) {
    const token = String(args[i] || '');
    if (token === '--dangerously-bypass-approvals-and-sandbox') {
      bypass = true;
      continue;
    }
    if ((token === '--sandbox' || token === '-s') && i + 1 < args.length) {
      sandbox = String(args[i + 1] || '').trim();
      i += 1;
      continue;
    }
    if (token.startsWith('--sandbox=')) {
      sandbox = token.split('=', 2)[1] || '';
      continue;
    }
    if (token === '--add-dir' && i + 1 < args.length) {
      const dir = String(args[i + 1] || '').trim();
      if (dir) {
        addDirs.push(dir);
      }
      i += 1;
      continue;
    }
    if (token.startsWith('--add-dir=')) {
      const dir = token.split('=', 2)[1] || '';
      if (dir.trim()) {
        addDirs.push(dir.trim());
      }
    }
  }

  if (!sandbox && args.includes('--full-auto')) {
    sandbox = 'workspace-write';
  }

  if (looksCodexExec && !addDirs.length) {
    const m = /^(\/home\/[^/]+|\/Users\/[^/]+)/.exec(workdir);
    if (m && m[1]) {
      addDirs.push(`${m[1]} (自动)`);
    }
  }

  const writableDirs = [];
  if (workdir) {
    writableDirs.push(workdir);
  }
  for (const dir of addDirs) {
    const cleaned = String(dir || '').replace(/\s*\(自动\)\s*$/, '').trim();
    if (cleaned) {
      writableDirs.push(cleaned);
    }
  }
  const uniqueWritableDirs = Array.from(new Set(writableDirs));
  const writableLabel = uniqueWritableDirs.length ? uniqueWritableDirs.join(', ') : '无';
  const writableLabelUi = currentLang() === 'zh-CN'
    ? writableLabel
    : (uniqueWritableDirs.length ? uniqueWritableDirs.join(', ') : 'none');

  if (bypass) {
    return {
      text: t('permissionAll'),
      title: t('permissionTitleAll'),
    };
  }
  if (sandbox === 'danger-full-access') {
    return {
      text: t('permissionAll'),
      title: t('permissionTitleAll'),
    };
  }
  if (sandbox === 'read-only') {
    return {
      text: t('permissionReadOnly'),
      title: t('permissionTitleReadOnly'),
    };
  }
  return {
    text: t('permissionLimited', { paths: writableLabelUi }),
    title: t('permissionTitleLimited', { paths: writableLabelUi }),
  };
}

export {
  APP_ZOOM_DEFAULT,
  APP_ZOOM_STEP,
  CHAT_FONT_SIZE_MAX,
  CHAT_FONT_SIZE_MIN,
  currentLang,
  t,
  state,
  el,
  clampChatFontSize,
  clampAppZoom,
  clampSidebarWidth,
  clampRuntimePanelWidth,
  normalizeTheme,
  parseUiPrefs,
  loadUiPrefs,
  saveUiPrefs,
  draftStorageKey,
  parseDraftPrefs,
  loadDraftPrefs,
  saveDraftPrefs,
  getConversationDraft,
  setConversationDraft,
  pruneConversationDrafts,
  getComposerAttachments,
  setComposerAttachments,
  pruneComposerAttachments,
  defaultChatVisibleCount,
  ensureChatVisibleCount,
  syncChatVisibleCount,
  increaseChatVisibleCount,
  pruneChatVisibleCounts,
  ensureRuntimeVisibleCount,
  increaseRuntimeVisibleCount,
  pruneRuntimeVisibleCounts,
  syncMenuLanguage,
  applyChatFontSize,
  applySidebarWidth,
  applyRuntimePanelWidth,
  setSidebarWidth,
  setRuntimePanelWidth,
  applyTheme,
  syncWindowTheme,
  setTheme,
  setChatFontSize,
  localizeKnownText,
  escapeHtml,
  renderInline,
  renderMarkdownFallback,
  renderMarkdownLike,
  formatElapsed,
  splitCommandArgs,
  resolvePermissionSummary,
  setRenderHooks,
};
