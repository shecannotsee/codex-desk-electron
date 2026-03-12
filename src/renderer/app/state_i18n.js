/* global codexdesk */

const state = {
  settings: {
    commandText: '',
    workdir: '',
  },
  activeConversationId: '',
  conversations: [],
  runtimeByConversation: {},
  metaByConversation: {},
  runningConversationIds: new Set(),
  queuedCountByConversation: {},
  queuedMessagesByConversation: {},
  collapsedByConversation: {},
  workflowCollapsedByConversation: {},
  chatVisibleCountByConversation: {},
  draftsByConversation: {},
  inputBindingConversationId: '',
  activeTab: 'structured',
  ui: {
    language: 'zh-CN',
    theme: 'light',
    sidebarWidth: 320,
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
const CHAT_PAGE_SIZE_INITIAL = 80;
const CHAT_PAGE_SIZE_INCREMENT = 80;
const SIDEBAR_WIDTH_MIN = 220;
const SIDEBAR_WIDTH_MAX = 520;
const SIDEBAR_WIDTH_DEFAULT = 320;
const MARKDOWN_CACHE_LIMIT = 400;
const markdownRenderCache = new Map();

const I18N = {
  'zh-CN': {
    sidebarTitle: '会话列表',
    newConversation: '新建对话',
    importSession: '导入会话JSONL',
    renameConversation: '重命名',
    closeCurrentConversation: '关闭当前会话',
    chatTitlePrefix: '当前对话',
    sessionId: 'ID',
    status: '状态',
    queue: '排队',
    elapsed: '耗时',
    busyGenerating: '● 正在生成回复...',
    busyGeneratingWithQueue: '● 正在生成回复...（排队 {count}）',
    command: 'Codex命令',
    workdir: '工作目录',
    permission: '会话权限',
    language: '语言',
    chatFontSize: '对话字号',
    refreshVersion: '获取Codex版本',
    refreshModel: '获取模型',
    codexVersionShort: 'Codex版本',
    modelShort: '模型',
    clearChat: '清空当前对话内容',
    clearRuntime: '清空右侧运行日志',
    toggleSettingsHide: '隐藏配置信息',
    toggleSettingsShow: '显示配置信息',
    toggleRuntimeHide: '隐藏右侧面板',
    toggleRuntimeShow: '显示右侧面板',
    toggleSidebarHide: '隐藏左侧会话',
    toggleSidebarShow: '显示左侧会话',
    quickSettings: '设置',
    settingsBack: '返回',
    menuFile: '文件',
    menuConversation: '对话',
    menuRuntime: '运行',
    menuInterface: '界面',
    menuWindow: '窗口',
    menuHelp: '帮助',
    closeWindow: '关闭窗口',
    quit: '退出',
    resetZoom: '实际大小',
    zoomIn: '放大',
    zoomOut: '缩小',
    minimize: '最小化',
    fullscreen: '全屏',
    exitFullscreen: '退出全屏',
    about: '关于 Codex Desk',
    aboutDialogDesc: 'Codex Desk 是 Codex CLI 的桌面图形客户端。',
    aboutSessionConfig: '当前会话配置',
    close: '关闭',
    theme: '主题',
    themeLight: '浅色',
    themeDark: '深色',
    languageZh: '中文',
    languageEn: 'English',
    contextMenuNew: '新建对话',
    contextMenuRename: '重命名当前对话',
    contextMenuClose: '关闭当前会话',
    tabStructured: '结构化事件',
    tabWorkflow: '运行步骤',
    tabRaw: '事件原文(JSON)',
    inputPlaceholderIdle: '输入消息，Ctrl+Enter 发送',
    inputPlaceholderRunning: '正在回复中，可继续输入并点击「排队发送」',
    inputPlaceholderNoConversation: '先新建一个会话，然后开始聊天',
    runningInProgress: '正在执行中...',
    chatRunningHint: 'Codex 正在执行中，请稍候...',
    chatRunningHintWithQueue: 'Codex 正在执行中，当前还有 {count} 条排队消息...',
    send: '发送',
    queueSend: '排队发送',
    retryLast: '重试上一条',
    stop: '停止',
    renameModalTitle: '重命名会话',
    renameModalPlaceholder: '请输入会话名称',
    closeConversationTitle: '关闭当前会话',
    closeGuardTitle: '存在进行中的任务',
    closeGuardDetail: '建议先停止任务再关闭窗口，避免中途中断。',
    closeGuardCancel: '取消',
    closeGuardStopAndClose: '停止任务并关闭',
    closeGuardForceClose: '直接关闭',
    cancel: '取消',
    confirm: '确认',
    noConversation: '暂无会话',
    clickNewConversation: '点一下上面的「新建对话」吧',
    emptyChatTip1: '右侧安静了下来 ( •̀ ω •́ )✧',
    emptyChatTip2: '还没有会话，快去左边点「新建对话」召唤我吧',
    emptyChatTip3: '我已经把键盘和光标都准备好了',
    noMessagesTip1: '当前对话暂无消息',
    noMessagesTip2: '可在左侧新建/切换会话，右侧标签查看运行细节',
    runtimeTipStructured: '这里会显示结构化事件，现在先休息一下',
    runtimeTipWorkflow: '这里会显示运行步骤，等你新建会话后马上开工',
    runtimeTipRaw: '等待中：暂无会话',
    queuedQuestionsTitle: '待执行排队提问',
    queuedQuestionsHint: '以下提问会在当前回复完成后按顺序执行',
    queuedQuestionItem: '排队提问 #{index}',
    queuedRepliesTitle: '待执行排队消息',
    queuedRepliesHint: '当前回复完成后会按顺序执行以下消息',
    queuedReplyItem: '排队消息 #{index}',
    queuedFromInput: '输入',
    queuedFromRetry: '重试',
    queuedAt: '入队时间',
    question: '问题',
    startTime: '开始时间',
    roleYou: '你',
    roleCodex: 'Codex',
    collapseMessage: '折叠',
    expandMessage: '展开',
    emptyMessagePreview: '（空消息）',
    loadEarlierMessages: '加载更早消息（剩余 {count} 条）',
    showingRecentMessages: '当前显示最近 {visible}/{total} 条消息',
    stateRunning: '运行中',
    stateError: '失败',
    stateSuccess: '已完成',
    stateQueued: '排队中',
    stateIdle: '空闲',
    phaseBackground: '后台运行中',
    phaseIdle: '空闲',
    phaseRunning: '运行中',
    alertConversationNameEmpty: '会话名称不能为空',
    confirmCloseConversation: '确认关闭对话「{title}」吗？',
    modelMeta: 'Codex版本: {version} | 模型: {model}',
    queueBadge: '排队 {count}',
    permissionAll: '读写: 全部目录 | 其他: 无限制',
    permissionReadOnly: '读写: 无 | 其他: 只读',
    permissionLimited: '读写: {paths} | 其他: 受限',
    permissionTitleAll: '可写目录: 全部目录',
    permissionTitleReadOnly: '可写目录: 无',
    permissionTitleLimited: '可写目录: {paths}\n说明: 其余目录受沙箱/策略限制',
  },
  'en-US': {
    sidebarTitle: 'Conversations',
    newConversation: 'New',
    importSession: 'Import Session JSONL',
    renameConversation: 'Rename',
    closeCurrentConversation: 'Close Current',
    chatTitlePrefix: 'Current Conversation',
    sessionId: 'ID',
    status: 'Status',
    queue: 'Queue',
    elapsed: 'Elapsed',
    busyGenerating: '● Generating response...',
    busyGeneratingWithQueue: '● Generating response... (queued {count})',
    command: 'Codex Command',
    workdir: 'Working Directory',
    permission: 'Session Permission',
    language: 'Language',
    chatFontSize: 'Chat Font Size',
    refreshVersion: 'Refresh Codex Version',
    refreshModel: 'Refresh Model',
    codexVersionShort: 'Codex Version',
    modelShort: 'Model',
    clearChat: 'Clear Chat',
    clearRuntime: 'Clear Runtime Logs',
    toggleSettingsHide: 'Hide Config Rows',
    toggleSettingsShow: 'Show Config Rows',
    toggleRuntimeHide: 'Hide Runtime Panel',
    toggleRuntimeShow: 'Show Runtime Panel',
    toggleSidebarHide: 'Hide Left Sidebar',
    toggleSidebarShow: 'Show Left Sidebar',
    quickSettings: 'Settings',
    settingsBack: 'Back',
    menuFile: 'File',
    menuConversation: 'Conversation',
    menuRuntime: 'Runtime',
    menuInterface: 'Interface',
    menuWindow: 'Window',
    menuHelp: 'Help',
    closeWindow: 'Close Window',
    quit: 'Quit',
    resetZoom: 'Actual Size',
    zoomIn: 'Zoom In',
    zoomOut: 'Zoom Out',
    minimize: 'Minimize',
    fullscreen: 'Full Screen',
    exitFullscreen: 'Exit Full Screen',
    about: 'About Codex Desk',
    aboutDialogDesc: 'Codex Desk is the desktop GUI client for Codex CLI.',
    aboutSessionConfig: 'Current Session Configuration',
    close: 'Close',
    theme: 'Theme',
    themeLight: 'Light',
    themeDark: 'Dark',
    languageZh: 'Chinese',
    languageEn: 'English',
    contextMenuNew: 'New Conversation',
    contextMenuRename: 'Rename Current Conversation',
    contextMenuClose: 'Close Current Conversation',
    tabStructured: 'Structured Events',
    tabWorkflow: 'Workflow',
    tabRaw: 'Raw Events (JSON)',
    inputPlaceholderIdle: 'Type a message, press Ctrl+Enter to send',
    inputPlaceholderRunning: 'Response in progress. Keep typing and click "Queue Send".',
    inputPlaceholderNoConversation: 'Create a conversation first, then start chatting',
    runningInProgress: 'Running...',
    chatRunningHint: 'Codex is working, please wait...',
    chatRunningHintWithQueue: 'Codex is working. {count} queued message(s) pending...',
    send: 'Send',
    queueSend: 'Queue Send',
    retryLast: 'Retry Last',
    stop: 'Stop',
    renameModalTitle: 'Rename Conversation',
    renameModalPlaceholder: 'Enter conversation name',
    closeConversationTitle: 'Close Current Conversation',
    closeGuardTitle: 'Tasks Are Still Running',
    closeGuardDetail: 'Recommended: stop tasks before closing to avoid interruption.',
    closeGuardCancel: 'Cancel',
    closeGuardStopAndClose: 'Stop And Close',
    closeGuardForceClose: 'Close Now',
    cancel: 'Cancel',
    confirm: 'Confirm',
    noConversation: 'No conversations yet',
    clickNewConversation: 'Click "New" above to start one',
    emptyChatTip1: 'Quiet here for now.',
    emptyChatTip2: 'No conversation yet, create one from the left panel.',
    emptyChatTip3: 'Keyboard and cursor are ready.',
    noMessagesTip1: 'No messages in this conversation yet',
    noMessagesTip2: 'Use the left panel to create/switch conversations',
    runtimeTipStructured: 'Structured events will appear here.',
    runtimeTipWorkflow: 'Workflow steps will appear here after you start.',
    runtimeTipRaw: 'Waiting: no active conversation',
    queuedQuestionsTitle: 'Queued Questions',
    queuedQuestionsHint: 'These questions will run in order after current response finishes.',
    queuedQuestionItem: 'Queued Question #{index}',
    queuedRepliesTitle: 'Queued Messages',
    queuedRepliesHint: 'These messages will run in order after current response finishes.',
    queuedReplyItem: 'Queued #{index}',
    queuedFromInput: 'Input',
    queuedFromRetry: 'Retry',
    queuedAt: 'Queued At',
    question: 'Question',
    startTime: 'Start',
    roleYou: 'You',
    roleCodex: 'Codex',
    collapseMessage: 'Collapse',
    expandMessage: 'Expand',
    emptyMessagePreview: '(empty message)',
    loadEarlierMessages: 'Load earlier messages ({count} remaining)',
    showingRecentMessages: 'Showing latest {visible}/{total} messages',
    stateRunning: 'Running',
    stateError: 'Failed',
    stateSuccess: 'Completed',
    stateQueued: 'Queued',
    stateIdle: 'Idle',
    phaseBackground: 'Running in background',
    phaseIdle: 'Idle',
    phaseRunning: 'Running',
    alertConversationNameEmpty: 'Conversation name cannot be empty',
    confirmCloseConversation: 'Close conversation "{title}"?',
    modelMeta: 'Codex Version: {version} | Model: {model}',
    queueBadge: 'Queued {count}',
    permissionAll: 'RW: all directories | Others: unrestricted',
    permissionReadOnly: 'RW: none | Others: read-only',
    permissionLimited: 'RW: {paths} | Others: restricted',
    permissionTitleAll: 'Writable directories: all',
    permissionTitleReadOnly: 'Writable directories: none',
    permissionTitleLimited: 'Writable directories: {paths}\nNote: other paths are sandbox-restricted',
  },
};

const el = {
  appRoot: document.getElementById('app-root'),
  sidebarResizer: document.getElementById('sidebar-resizer'),
  workspace: document.getElementById('workspace'),
  sidebarTitle: document.getElementById('sidebar-title'),
  conversationList: document.getElementById('conversation-list'),
  focusRow: document.getElementById('focus-row'),
  btnNewConv: document.getElementById('btn-new-conv'),
  btnImportSession: document.getElementById('btn-import-session'),
  btnRenameConv: document.getElementById('btn-rename-conv'),
  btnCloseConv: document.getElementById('btn-close-conv'),

  chatTitle: document.getElementById('chat-title'),
  labelSessionId: document.getElementById('label-session-id'),
  labelPhase: document.getElementById('label-phase'),
  labelQueue: document.getElementById('label-queue'),
  labelElapsed: document.getElementById('label-elapsed'),
  labelMetaVersion: document.getElementById('label-meta-version'),
  labelMetaModel: document.getElementById('label-meta-model'),
  sessionId: document.getElementById('session-id'),
  btnSessionId: document.getElementById('btn-session-id'),
  btnMetaVersion: document.getElementById('btn-meta-version'),
  btnMetaModel: document.getElementById('btn-meta-model'),
  metaVersionValue: document.getElementById('meta-version-value'),
  metaModelValue: document.getElementById('meta-model-value'),
  phase: document.getElementById('phase'),
  phaseChip: document.getElementById('phase-chip'),
  queueChip: document.getElementById('queue-chip'),
  queueCount: document.getElementById('queue-count'),
  elapsed: document.getElementById('elapsed'),
  busyIndicator: document.getElementById('busy-indicator'),
  btnQuickSettings: document.getElementById('btn-quick-settings'),
  labelQuickSettings: document.getElementById('label-quick-settings'),
  quickSettingsMenu: document.getElementById('quick-settings-menu'),
  quickSettingsRoot: document.getElementById('quick-settings-root'),
  quickSettingsDetail: document.getElementById('quick-settings-detail'),
  qsBack: document.getElementById('qs-back'),
  qsDetailTitle: document.getElementById('qs-detail-title'),
  qsToggleSettings: document.getElementById('qs-toggle-settings'),
  qsToggleRuntime: document.getElementById('qs-toggle-runtime'),
  qsToggleSidebar: document.getElementById('qs-toggle-sidebar'),
  qsLangZh: document.getElementById('qs-lang-zh'),
  qsLangEn: document.getElementById('qs-lang-en'),
  qsThemeLight: document.getElementById('qs-theme-light'),
  qsThemeDark: document.getElementById('qs-theme-dark'),
  i18nNodes: Array.from(document.querySelectorAll('[data-i18n-key]')),

  commandInput: document.getElementById('command-input'),
  workdirInput: document.getElementById('workdir-input'),
  permissionInput: document.getElementById('permission-input'),
  labelCommand: document.getElementById('label-command'),
  labelWorkdir: document.getElementById('label-workdir'),
  labelPermission: document.getElementById('label-permission'),
  languageSelect: document.getElementById('language-select'),
  labelLanguage: document.getElementById('label-language'),
  fontSizeRange: document.getElementById('font-size-range'),
  labelFontSize: document.getElementById('label-font-size'),
  fontSizeValue: document.getElementById('font-size-value'),
  btnRefreshVersion: document.getElementById('btn-refresh-version'),
  btnRefreshModel: document.getElementById('btn-refresh-model'),

  btnClearChat: document.getElementById('btn-clear-chat'),
  btnClearRuntime: document.getElementById('btn-clear-runtime'),
  btnToggleSettings: document.getElementById('btn-toggle-settings'),
  btnToggleRuntime: document.getElementById('btn-toggle-runtime'),
  btnToggleSidebar: document.getElementById('btn-toggle-sidebar'),

  contentRow: document.getElementById('content-row'),
  chatView: document.getElementById('chat-view'),
  runtimePanel: document.getElementById('runtime-panel'),
  tabStructured: document.getElementById('tab-structured'),
  tabWorkflow: document.getElementById('tab-workflow'),
  tabRaw: document.getElementById('tab-raw'),
  tabBtnStructured: document.getElementById('tab-btn-structured'),
  tabBtnWorkflow: document.getElementById('tab-btn-workflow'),
  tabBtnRaw: document.getElementById('tab-btn-raw'),
  tabButtons: Array.from(document.querySelectorAll('.tab-btn')),

  inputBox: document.getElementById('input-box'),
  sendRow: document.getElementById('send-row'),
  btnSend: document.getElementById('btn-send'),
  btnRetryLast: document.getElementById('btn-retry-last'),
  btnStop: document.getElementById('btn-stop'),

  renameModal: document.getElementById('rename-modal'),
  renameModalTitle: document.getElementById('rename-modal-title'),
  renameInput: document.getElementById('rename-input'),
  renameCancel: document.getElementById('rename-cancel'),
  renameConfirm: document.getElementById('rename-confirm'),
  confirmModal: document.getElementById('confirm-modal'),
  confirmModalTitle: document.getElementById('confirm-modal-title'),
  confirmModalBody: document.getElementById('confirm-modal-body'),
  confirmCancel: document.getElementById('confirm-cancel'),
  confirmAccept: document.getElementById('confirm-accept'),
  closeGuardModal: document.getElementById('close-guard-modal'),
  closeGuardTitle: document.getElementById('close-guard-title'),
  closeGuardMessage: document.getElementById('close-guard-message'),
  closeGuardDetail: document.getElementById('close-guard-detail'),
  closeGuardCancel: document.getElementById('close-guard-cancel'),
  closeGuardStop: document.getElementById('close-guard-stop'),
  closeGuardForce: document.getElementById('close-guard-force'),
  aboutModal: document.getElementById('about-modal'),
  aboutClose: document.getElementById('about-close'),

  contextMenu: document.getElementById('conversation-context-menu'),
  ctxNewConv: document.getElementById('ctx-new-conv'),
  ctxRenameConv: document.getElementById('ctx-rename-conv'),
  ctxCloseConv: document.getElementById('ctx-close-conv'),
  chatContextMenu: document.getElementById('chat-context-menu'),
  ctxToggleRuntime: document.getElementById('ctx-toggle-runtime'),
  ctxToggleSidebar: document.getElementById('ctx-toggle-sidebar'),
};

function currentLang() {
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

function clampSidebarWidth(input, fallback = SIDEBAR_WIDTH_DEFAULT) {
  const value = Number(input);
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(value)));
}

function normalizeTheme(input) {
  return String(input || '').trim().toLowerCase() === 'dark' ? 'dark' : 'light';
}

function parseUiPrefs(rawText) {
  try {
    const data = JSON.parse(String(rawText || '{}'));
    const language = data.language === 'en-US' ? 'en-US' : 'zh-CN';
    const theme = normalizeTheme(data.theme);
    const sidebarWidth = clampSidebarWidth(data.sidebarWidth, SIDEBAR_WIDTH_DEFAULT);
    const chatFontSize = clampChatFontSize(data.chatFontSize, CHAT_FONT_SIZE_DEFAULT);
    const runtimePanelHidden = Boolean(data.runtimePanelHidden);
    const settingsPanelHidden = Boolean(data.settingsPanelHidden);
    const sidebarHidden = Boolean(data.sidebarHidden);
    return {
      language,
      theme,
      sidebarWidth,
      chatFontSize,
      runtimePanelHidden,
      settingsPanelHidden,
      sidebarHidden,
    };
  } catch {
    return {
      language: 'zh-CN',
      theme: 'light',
      sidebarWidth: SIDEBAR_WIDTH_DEFAULT,
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

function setConversationDraft(conversationId, text, options = {}) {
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

function setSidebarWidth(input, options = {}) {
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

function setTheme(input, options = {}) {
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
    renderAll();
  }
}

function setChatFontSize(input, options = {}) {
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
    renderSettings();
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
    ['会话文件路径不能为空', 'Session file path cannot be empty'],
    ['会话文件不存在:', 'Session file not found:'],
    ['未从会话文件中解析到可导入的用户/助手消息', 'No importable user/assistant messages were found in the session file'],
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
  return String(text || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function renderInline(text) {
  const parts = String(text || '').split(/(`[^`]+`)/g);
  return parts.map((part) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length >= 2) {
      const code = escapeHtml(part.slice(1, -1));
      return `<code>${code}</code>`;
    }
    let escaped = escapeHtml(part);
    escaped = escaped.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "<a href='$2' target='_blank' rel='noreferrer'>$1</a>");
    escaped = escaped.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
    escaped = escaped.replace(/__([^_\n]+)__/g, '<b>$1</b>');
    escaped = escaped.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<i>$1</i>');
    escaped = escaped.replace(/(?<!_)_([^_\n]+)_(?!_)/g, '<i>$1</i>');
    return escaped;
  }).join('');
}

function renderMarkdownFallback(text) {
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
      result.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^[-*_]{3,}$/.test(stripped)) {
      result.push('<hr/>');
      index += 1;
      continue;
    }

    if (stripped.startsWith('>')) {
      const quotes = [];
      while (index < lines.length && String(lines[index] || '').trim().startsWith('>')) {
        quotes.push(String(lines[index] || '').trim().slice(1).trim());
        index += 1;
      }
      result.push(`<blockquote>${quotes.map((item) => renderInline(item)).join('<br>')}</blockquote>`);
      continue;
    }

    if (/^[-*+]\s+/.test(stripped)) {
      const items = [];
      while (index < lines.length && /^\s*[-*+]\s+/.test(String(lines[index] || ''))) {
        const item = String(lines[index] || '').replace(/^\s*[-*+]\s+/, '').trim();
        items.push(`<li>${renderInline(item)}</li>`);
        index += 1;
      }
      result.push(`<ul>${items.join('')}</ul>`);
      continue;
    }

    if (/^\d+\.\s+/.test(stripped)) {
      const items = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(String(lines[index] || ''))) {
        const item = String(lines[index] || '').replace(/^\s*\d+\.\s+/, '').trim();
        items.push(`<li>${renderInline(item)}</li>`);
        index += 1;
      }
      result.push(`<ol>${items.join('')}</ol>`);
      continue;
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
      if (currentStrip.startsWith('>')) {
        break;
      }
      if (/^\s*[-*+]\s+/.test(current)) {
        break;
      }
      if (/^\s*\d+\.\s+/.test(current)) {
        break;
      }
      paragraphLines.push(currentStrip);
      index += 1;
    }
    result.push(`<p>${renderInline(paragraphLines.join(' '))}</p>`);
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
  let start = 0;
  let html = '';
  let match = null;

  while ((match = fencePattern.exec(raw)) !== null) {
    const normalPart = raw.slice(start, match.index);
    if (normalPart.trim()) {
      html += renderMarkdownFallback(normalPart);
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
    html += renderMarkdownFallback(tail);
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
