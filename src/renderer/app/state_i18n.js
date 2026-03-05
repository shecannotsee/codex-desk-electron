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
  collapsedByConversation: {},
  workflowCollapsedByConversation: {},
  activeTab: 'structured',
  ui: {
    language: 'zh-CN',
    chatFontSize: 15,
    runtimePanelHidden: false,
    settingsPanelHidden: false,
    sidebarHidden: false,
  },
};

const UI_PREFS_KEY = 'codexdesk.ui-prefs.v1';
const CHAT_FONT_SIZE_MIN = 12;
const CHAT_FONT_SIZE_MAX = 24;
const CHAT_FONT_SIZE_DEFAULT = 15;

const I18N = {
  'zh-CN': {
    sidebarTitle: '会话列表',
    newConversation: '新建对话',
    renameConversation: '重命名',
    closeCurrentConversation: '关闭当前会话',
    chatTitlePrefix: '当前对话',
    sessionId: '当前会话ID',
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
    clearChat: '清空当前对话内容',
    clearRuntime: '清空右侧运行日志',
    toggleSettingsHide: '隐藏配置信息',
    toggleSettingsShow: '显示配置信息',
    toggleRuntimeHide: '隐藏右侧面板',
    toggleRuntimeShow: '显示右侧面板',
    toggleSidebarHide: '隐藏左侧会话',
    toggleSidebarShow: '显示左侧会话',
    tabStructured: '结构化事件',
    tabWorkflow: '运行步骤',
    tabRaw: '事件原文(JSON)',
    inputPlaceholderIdle: '输入消息，Ctrl+Enter 发送',
    inputPlaceholderRunning: '正在回复中，可继续输入并点击「排队发送」',
    inputPlaceholderNoConversation: '先新建一个会话，然后开始聊天',
    send: '发送',
    queueSend: '排队发送',
    retryLast: '重试上一条',
    stop: '停止',
    renameModalTitle: '重命名会话',
    renameModalPlaceholder: '请输入会话名称',
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
    question: '问题',
    startTime: '开始时间',
    roleYou: '你',
    roleCodex: 'Codex',
    collapseMessage: '折叠',
    expandMessage: '展开',
    emptyMessagePreview: '（空消息）',
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
    renameConversation: 'Rename',
    closeCurrentConversation: 'Close Current',
    chatTitlePrefix: 'Current Conversation',
    sessionId: 'Session ID',
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
    clearChat: 'Clear Chat',
    clearRuntime: 'Clear Runtime Logs',
    toggleSettingsHide: 'Hide Config Rows',
    toggleSettingsShow: 'Show Config Rows',
    toggleRuntimeHide: 'Hide Runtime Panel',
    toggleRuntimeShow: 'Show Runtime Panel',
    toggleSidebarHide: 'Hide Left Sidebar',
    toggleSidebarShow: 'Show Left Sidebar',
    tabStructured: 'Structured Events',
    tabWorkflow: 'Workflow',
    tabRaw: 'Raw Events (JSON)',
    inputPlaceholderIdle: 'Type a message, press Ctrl+Enter to send',
    inputPlaceholderRunning: 'Response in progress. Keep typing and click "Queue Send".',
    inputPlaceholderNoConversation: 'Create a conversation first, then start chatting',
    send: 'Send',
    queueSend: 'Queue Send',
    retryLast: 'Retry Last',
    stop: 'Stop',
    renameModalTitle: 'Rename Conversation',
    renameModalPlaceholder: 'Enter conversation name',
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
    question: 'Question',
    startTime: 'Start',
    roleYou: 'You',
    roleCodex: 'Codex',
    collapseMessage: 'Collapse',
    expandMessage: 'Expand',
    emptyMessagePreview: '(empty message)',
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
  workspace: document.getElementById('workspace'),
  sidebarTitle: document.getElementById('sidebar-title'),
  conversationList: document.getElementById('conversation-list'),
  btnNewConv: document.getElementById('btn-new-conv'),
  btnRenameConv: document.getElementById('btn-rename-conv'),
  btnCloseConv: document.getElementById('btn-close-conv'),

  chatTitle: document.getElementById('chat-title'),
  labelSessionId: document.getElementById('label-session-id'),
  labelPhase: document.getElementById('label-phase'),
  labelQueue: document.getElementById('label-queue'),
  labelElapsed: document.getElementById('label-elapsed'),
  sessionId: document.getElementById('session-id'),
  phase: document.getElementById('phase'),
  phaseChip: document.getElementById('phase-chip'),
  queueChip: document.getElementById('queue-chip'),
  queueCount: document.getElementById('queue-count'),
  elapsed: document.getElementById('elapsed'),
  busyIndicator: document.getElementById('busy-indicator'),

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
  modelMeta: document.getElementById('model-meta'),
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
  btnSend: document.getElementById('btn-send'),
  btnRetryLast: document.getElementById('btn-retry-last'),
  btnStop: document.getElementById('btn-stop'),

  renameModal: document.getElementById('rename-modal'),
  renameModalTitle: document.getElementById('rename-modal-title'),
  renameInput: document.getElementById('rename-input'),
  renameCancel: document.getElementById('rename-cancel'),
  renameConfirm: document.getElementById('rename-confirm'),
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

function parseUiPrefs(rawText) {
  try {
    const data = JSON.parse(String(rawText || '{}'));
    const language = data.language === 'en-US' ? 'en-US' : 'zh-CN';
    const chatFontSize = clampChatFontSize(data.chatFontSize, CHAT_FONT_SIZE_DEFAULT);
    const runtimePanelHidden = Boolean(data.runtimePanelHidden);
    const settingsPanelHidden = Boolean(data.settingsPanelHidden);
    const sidebarHidden = Boolean(data.sidebarHidden);
    return { language, chatFontSize, runtimePanelHidden, settingsPanelHidden, sidebarHidden };
  } catch {
    return {
      language: 'zh-CN',
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

