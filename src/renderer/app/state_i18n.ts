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

const state: AppState = {
  appInfo: {
    name: 'Conductor',
    version: '',
  },
  settings: {
    commandText: '',
    provider: 'codex',
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
  activeAgentTeamTab: 'workflow',
  workspaceMode: 'conversation',
  activeAgentTeamGroupId: '',
  agentTeamGroups: [],
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

const UI_PREFS_KEY = 'conductor.ui-prefs.v1';
const DRAFT_PREFS_KEY = 'conductor.drafts.v1';
const LEGACY_UI_PREFS_KEY = 'codexdesk.ui-prefs.v1';
const LEGACY_DRAFT_PREFS_KEY = 'codexdesk.drafts.v1';
const NO_CONVERSATION_DRAFT_KEY = '__no_conversation__';
const CHAT_FONT_SIZE_MIN = 12;
const CHAT_FONT_SIZE_MAX = 24;
const CHAT_FONT_SIZE_DEFAULT = 12;
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
  const raw = window.localStorage.getItem(UI_PREFS_KEY)
    || window.localStorage.getItem(LEGACY_UI_PREFS_KEY);
  state.ui = parseUiPrefs(raw);
  if (!window.localStorage.getItem(UI_PREFS_KEY) && raw) {
    saveUiPrefs();
  }
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
  const raw = window.localStorage.getItem(DRAFT_PREFS_KEY)
    || window.localStorage.getItem(LEGACY_DRAFT_PREFS_KEY);
  state.draftsByConversation = parseDraftPrefs(raw);
  if (!window.localStorage.getItem(DRAFT_PREFS_KEY) && raw) {
    saveDraftPrefs();
  }
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
  const patternReplacements: Array<[RegExp, string | ((...args: string[]) => string)]> = [
    [/^请求[:：]\s*/gm, 'Request: '],
    [/^收到新请求，准备执行\.\.\.$/gm, 'Received new request, preparing to run...'],
    [/^启动 app-server[:：]\s*/gm, 'Starting app-server: '],
    [/^已恢复原生会话[:：]\s*/gm, 'Resumed native session: '],
    [/^已创建原生会话[:：]\s*/gm, 'Created native session: '],
    [/^已分叉原生会话[:：]\s*/gm, 'Forked native session: '],
    [/^使用原生会话续聊[:：]\s*/gm, 'Continue with native session: '],
    [/^创建新的 Codex 原生会话$/gm, 'Create a new native Codex session'],
    [/^会话ID[:：]\s*/gm, 'Session ID: '],
    [/^模型[:：]\s*/gm, 'Model: '],
    [/^Codex版本[:：]\s*/gm, 'Codex Version: '],
    [/^Claude版本[:：]\s*/gm, 'Claude Version: '],
    [/^运行中回复[:：]\s*/gm, 'Reply in progress: '],
    [/^用户手动重试上一条消息[:：]\s*/gm, 'User manually retried the previous message: '],
    [/^本次请求附带\s+(\d+)\s+个图片附件$/gm, (_, count) => `This request includes ${count} image attachment(s)`],
    [/^检测到\s+(\d+)\s+个图片附件，已切换到 exec --image 模式$/gm, (_, count) => `Detected ${count} image attachment(s); switched to exec --image mode`],
    [/^CLI[:：]\s*Claude Code$/gm, 'CLI: Claude Code'],
    [/^CLI[:：]\s*Codex CLI$/gm, 'CLI: Codex CLI'],
    [/^计划\s+(\d+\/\d+)$/gm, 'Plan $1'],
    [/^阶段进展\s+#(\d+)[:：]\s*/gm, 'Progress #$1: '],
    [/^阶段进展[:：]\s*/gm, 'Progress: '],
    [/^进行中[:：]\s*/gm, 'In progress: '],
    [/^已完成\s+(\d+\/\d+)$/gm, 'Completed $1'],
  ];
  for (const [pattern, replacement] of patternReplacements) {
    text = text.replace(pattern, replacement as never);
  }
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
    ['暂无计划步骤', 'No plan steps yet'],
    ['未命名步骤', 'Unnamed step'],
    ['(进行中)', '(In progress)'],
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


export {
  APP_ZOOM_DEFAULT,
  APP_ZOOM_STEP,
  CHAT_FONT_SIZE_DEFAULT,
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
  setRenderHooks,
};
