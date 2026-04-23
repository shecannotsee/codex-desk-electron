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
  UiElementRefs,
  UiState,
} from './types.js';

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
          allowedChatId: '',
          effectiveAllowedChatId: '',
          usesNotificationChatId: true,
        },
      },
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

const I18N: Record<string, Record<string, string>> = {
  'zh-CN': {
    sidebarTitle: '会话列表',
    sidebarSearchPlaceholder: '搜索会话',
    sidebarSearchEmpty: '没有匹配的会话',
    newConversation: '新建对话',
    importSession: '导入会话JSONL',
    exportSession: '导出当前会话JSONL',
    renameConversation: '重命名',
    closeCurrentConversation: '关闭当前会话',
    chatTitlePrefix: '当前对话',
    sessionId: 'ID',
    clickToCopy: '点击复制',
    copySuccess: '复制成功',
    status: '状态',
    queue: '排队',
    currentTime: '时间',
    command: 'Codex命令',
    workdir: '工作目录',
    composerWorkdir: '会话目录',
    chooseWorkdirTitle: '新建对话',
    chooseWorkdirMessage: '请选择这次新建对话的工作目录。',
    browseWorkdir: '选择目录',
    permission: '会话权限',
    language: '语言',
    chatFontSize: '对话字号',
    refreshVersion: '获取Codex版本',
    refreshModel: '获取模型',
    clickToFetch: '点击获取',
    codexVersionShort: 'Codex版本',
    modelShort: '模型',
    usageInputShort: '输入',
    usageCachedShort: '缓存',
    usageOutputShort: '输出',
    usageCostShort: '$',
    usageInputTitle: '输入 Tokens',
    usageCachedTitle: '缓存输入 Tokens',
    usageOutputTitle: '输出 Tokens',
    usageCostTitle: '预估费用（USD）',
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
    menuNotification: '通知与身份',
    menuInterface: '界面',
    menuWindow: '窗口',
    menuHelp: '帮助',
    deviceIdentityLabel: '设备身份标识',
    deviceIdentityHint: '用于区分不同 Codex Desk 实例，Telegram 通知会带上这个标识。',
    deviceIdentityPlaceholder: '例如: desk-office',
    notificationProviderLabel: '通讯工具',
    notificationProviderHint: '当前先支持 Telegram，后续可在这里扩展更多 provider。',
    providerTelegram: 'Telegram',
    telegramEnabled: '启用 Telegram 结果通知',
    telegramBotToken: 'Bot Token',
    telegramBotTokenPlaceholder: '留空则保持当前已保存 Token',
    telegramTokenSaved: '已保存 Token 指纹: {fingerprint}',
    telegramTokenMissing: '当前未保存 Bot Token',
    telegramClearToken: '清除已保存 Token',
    telegramChatId: 'Chat ID',
    telegramChatIdPlaceholder: '填入接收通知的 chat id',
    telegramHint: '通知会推送成功与失败结果。对话 ID 仍是主标识，名称只用于快速识别。',
    telegramRemoteControlEnabled: '启用 Telegram 远程发消息',
    telegramAllowedChatId: '远程控制 Chat ID',
    telegramAllowedChatIdPlaceholder: '留空则复用通知 Chat ID',
    telegramRemoteControlHint: '开启后，可在 Telegram 中用 /list、/use、/new 选择对话，并直接发送文本到当前绑定对话。',
    saveSettings: '保存配置',
    testNotificationProvider: '发送测试通知',
    settingsSaved: '配置已保存',
    telegramTestSuccess: 'Telegram 测试通知已发送',
    closeWindow: '关闭窗口',
    quit: '退出',
    resetZoom: '实际大小',
    zoomIn: '放大',
    zoomOut: '缩小',
    appZoom: '界面缩放',
    minimize: '最小化',
    fullscreen: '全屏',
    exitFullscreen: '退出全屏',
    about: '关于 Codex Desk',
    aboutDialogDesc: 'Codex Desk 是 Codex CLI 的桌面图形客户端。',
    aboutSessionConfig: '当前会话配置',
    close: '关闭',
    theme: '模式',
    themeLight: '白天模式',
    themeDark: '夜间模式',
    languageZh: '中文',
    languageEn: 'English',
    contextMenuNew: '新建对话',
    contextMenuImport: '导入会话JSONL',
    contextMenuExport: '导出当前会话JSONL',
    contextMenuRename: '重命名当前对话',
    contextMenuPin: '置顶当前对话',
    contextMenuUnpin: '取消置顶当前对话',
    contextMenuClose: '关闭当前会话',
    pinnedConversation: '置顶',
    copy: '复制',
    tabStructured: '结构化事件',
    tabWorkflow: '运行步骤',
    tabRaw: '事件原文',
    inputPlaceholderIdle: '输入消息，Ctrl+Enter 发送',
    inputPlaceholderRunning: '正在回复中，可点击「插入对话」或「排队发送」',
    inputPlaceholderNoConversation: '先新建一个会话，然后开始聊天',
    addAttachment: '添加附件',
    attachmentTypeImage: '图片',
    attachmentHint: '支持图片附件，发送时会作为真实附件传给 Codex',
    attachmentCount: '附件 {count}',
    attachmentRemove: '移除附件',
    attachmentEmpty: '当前没有附件',
    attachmentOnlyImages: '当前真实附件仅支持图片文件。',
    attachmentInvalidPath: '附件路径无效，已忽略。',
    attachmentBadge: '附件',
    runningInProgress: '正在执行中...',
    chatRunningHint: 'Codex 正在执行中，请稍候...',
    chatRunningHintWithQueue: 'Codex 正在执行中，当前还有 {count} 条排队消息...',
    send: '发送',
    queueSend: '排队发送',
    insertMessage: '插入对话',
    retryLast: '重试上一条',
    stop: '停止',
    renameModalTitle: '重命名会话',
    renameModalPlaceholder: '请输入会话名称',
    importModeTitle: '导入后如何继续这条会话？',
    importModeMessage: '检测到这个会话包含原生会话 ID。请选择导入后下一次发送消息时，要继续原会话还是先分叉成新会话。',
    importModeFile: '文件: {value}',
    importModeSession: '会话ID: {value}',
    importModeResumeTitle: '继续原会话（resume）',
    importModeResumeDesc: '后续消息继续写进同一个 Codex 原生会话。如果导入后的会话和原会话都继续使用，会互相影响。',
    importModeForkTitle: '分叉为新会话（fork）',
    importModeForkDesc: '第一次继续时先从当前会话历史分叉出新的 thread id，后续不再影响原会话。',
    importModeConfirm: '确认导入',
    importWorkdirTitle: '导入工作目录',
    importWorkdirMessage: '请选择导入后的工作目录来源。',
    importWorkdirFile: '文件: {value}',
    importWorkdirImportedTitle: '使用导入文件目录',
    importWorkdirImportedDesc: '{value}',
    importWorkdirImportedUnavailable: '导入文件未提供可用的原工作目录。',
    importWorkdirDefaultTitle: '使用默认目录',
    importWorkdirDefaultDesc: '{value}',
    importWorkdirCustomTitle: '手动选择新目录',
    importWorkdirCustomDesc: '{value}',
    importWorkdirCustomUnset: '未选择目录',
    importWorkdirConfirm: '确认导入',
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
    runtimeWorkflowEmpty: '当前还没有关键过程；命令细节仍可在结构化事件或 JSON 中查看',
    rawEventSent: '发送',
    rawEventReceived: '接收',
    queuedQuestionsTitle: '待执行排队提问',
    queuedQuestionsHint: '以下提问会在当前回复完成后按顺序执行',
    queuedQuestionItem: '排队提问 #{index}',
    queuedRepliesTitle: '待执行排队消息',
    queuedRepliesHint: '当前回复完成后会按顺序执行以下消息',
    queuedReplyItem: '排队消息 #{index}',
    queuedUndo: '撤销',
    queuedUndoAll: '全部撤销',
    queuedFromInput: '输入',
    queuedFromRetry: '重试',
    queuedAt: '入队时间',
    queueEmpty: '当前没有排队消息',
    question: '问题',
    startTime: '开始时间',
    roleYou: '你',
    roleCodex: 'Codex',
    collapseMessage: '折叠',
    expandMessage: '展开',
    renderRaw: '原文',
    renderMarkdown: 'Markdown',
    emptyMessagePreview: '（空消息）',
    loadEarlierMessages: '加载更早消息（剩余 {count} 条）',
    showingRecentMessages: '当前显示最近 {visible}/{total} 条消息',
    runtimeLoadEarlier: '加载更早记录（剩余 {count} 条）',
    runtimeShowingRecent: '当前显示最近 {visible}/{total} 条记录',
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
    sidebarSearchPlaceholder: 'Search chats',
    sidebarSearchEmpty: 'No matching chats',
    newConversation: 'New',
    importSession: 'Import Session JSONL',
    exportSession: 'Export Current Conversation JSONL',
    renameConversation: 'Rename',
    closeCurrentConversation: 'Close Current',
    chatTitlePrefix: 'Current Conversation',
    sessionId: 'ID',
    clickToCopy: 'Click to copy',
    copySuccess: 'Copied',
    status: 'Status',
    queue: 'Queue',
    currentTime: 'Time',
    command: 'Codex Command',
    workdir: 'Working Directory',
    composerWorkdir: 'Chat Directory',
    chooseWorkdirTitle: 'New Conversation',
    chooseWorkdirMessage: 'Choose the working directory for this conversation.',
    browseWorkdir: 'Choose Folder',
    permission: 'Session Permission',
    language: 'Language',
    chatFontSize: 'Chat Font Size',
    refreshVersion: 'Refresh Codex Version',
    refreshModel: 'Refresh Model',
    clickToFetch: 'Click to fetch',
    codexVersionShort: 'Codex Version',
    modelShort: 'Model',
    usageInputShort: 'In',
    usageCachedShort: 'Cache',
    usageOutputShort: 'Out',
    usageCostShort: '$',
    usageInputTitle: 'Input Tokens',
    usageCachedTitle: 'Cached Input Tokens',
    usageOutputTitle: 'Output Tokens',
    usageCostTitle: 'Estimated Cost (USD)',
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
    menuNotification: 'Notifications',
    menuInterface: 'Interface',
    menuWindow: 'Window',
    menuHelp: 'Help',
    deviceIdentityLabel: 'Device Identity',
    deviceIdentityHint: 'Used to distinguish different Codex Desk instances. Telegram notifications include this label.',
    deviceIdentityPlaceholder: 'Example: desk-office',
    notificationProviderLabel: 'Provider',
    notificationProviderHint: 'Telegram is the first provider. More channels can be added here later.',
    providerTelegram: 'Telegram',
    telegramEnabled: 'Enable Telegram result notifications',
    telegramBotToken: 'Bot Token',
    telegramBotTokenPlaceholder: 'Leave blank to keep the saved token',
    telegramTokenSaved: 'Saved token fingerprint: {fingerprint}',
    telegramTokenMissing: 'No Bot Token saved yet',
    telegramClearToken: 'Clear Saved Token',
    telegramChatId: 'Chat ID',
    telegramChatIdPlaceholder: 'Paste the target chat id',
    telegramHint: 'Notifications include both success and failure results. The conversation ID remains the primary identifier.',
    telegramRemoteControlEnabled: 'Enable Telegram remote sending',
    telegramAllowedChatId: 'Remote Control Chat ID',
    telegramAllowedChatIdPlaceholder: 'Leave blank to reuse the notification Chat ID',
    telegramRemoteControlHint: 'When enabled, you can use /list, /use, and /new in Telegram, then send plain text into the currently bound conversation.',
    saveSettings: 'Save Settings',
    testNotificationProvider: 'Send Test Notification',
    settingsSaved: 'Settings saved',
    telegramTestSuccess: 'Telegram test notification sent',
    closeWindow: 'Close Window',
    quit: 'Quit',
    resetZoom: 'Actual Size',
    zoomIn: 'Zoom In',
    zoomOut: 'Zoom Out',
    appZoom: 'App Zoom',
    minimize: 'Minimize',
    fullscreen: 'Full Screen',
    exitFullscreen: 'Exit Full Screen',
    about: 'About Codex Desk',
    aboutDialogDesc: 'Codex Desk is the desktop GUI client for Codex CLI.',
    aboutSessionConfig: 'Current Session Configuration',
    close: 'Close',
    theme: 'Mode',
    themeLight: 'Day Mode',
    themeDark: 'Night Mode',
    languageZh: 'Chinese',
    languageEn: 'English',
    contextMenuNew: 'New Conversation',
    contextMenuImport: 'Import Session JSONL',
    contextMenuExport: 'Export Current Conversation JSONL',
    contextMenuRename: 'Rename Current Conversation',
    contextMenuPin: 'Pin Conversation',
    contextMenuUnpin: 'Unpin Conversation',
    contextMenuClose: 'Close Current Conversation',
    pinnedConversation: 'Pinned',
    copy: 'Copy',
    tabStructured: 'Structured Events',
    tabWorkflow: 'Workflow',
    tabRaw: 'Raw Events',
    inputPlaceholderIdle: 'Type a message, press Ctrl+Enter to send',
    inputPlaceholderRunning: 'Response in progress. Use "Insert Message" or "Queue Send".',
    inputPlaceholderNoConversation: 'Create a conversation first, then start chatting',
    addAttachment: 'Add Attachment',
    attachmentTypeImage: 'Image',
    attachmentHint: 'Image attachments are sent to Codex as real attachments.',
    attachmentCount: '{count} attachments',
    attachmentRemove: 'Remove attachment',
    attachmentEmpty: 'No attachments selected.',
    attachmentOnlyImages: 'Real attachments currently support images only.',
    attachmentInvalidPath: 'Invalid attachment path ignored.',
    attachmentBadge: 'Attachment',
    runningInProgress: 'Running...',
    chatRunningHint: 'Codex is working, please wait...',
    chatRunningHintWithQueue: 'Codex is working. {count} queued message(s) pending...',
    send: 'Send',
    queueSend: 'Queue Send',
    insertMessage: 'Insert Message',
    retryLast: 'Retry Last',
    stop: 'Stop',
    renameModalTitle: 'Rename Conversation',
    renameModalPlaceholder: 'Enter conversation name',
    importModeTitle: 'How should this imported session continue?',
    importModeMessage: 'This session contains a native Codex session ID. Choose whether the next message after import should resume the original session or fork a new one first.',
    importModeFile: 'File: {value}',
    importModeSession: 'Session ID: {value}',
    importModeResumeTitle: 'Resume Original Session',
    importModeResumeDesc: 'Future messages continue on the same native Codex session. If both the imported session and the original session keep being used, both sides affect each other.',
    importModeForkTitle: 'Fork Into New Session',
    importModeForkDesc: 'The first follow-up will fork a new thread id from this session history, so future messages no longer affect the original session.',
    importModeConfirm: 'Import Session',
    importWorkdirTitle: 'Import Working Directory',
    importWorkdirMessage: 'Choose which working directory should be used after import.',
    importWorkdirFile: 'File: {value}',
    importWorkdirImportedTitle: 'Use Imported Directory',
    importWorkdirImportedDesc: '{value}',
    importWorkdirImportedUnavailable: 'No usable original working directory was found in the imported file.',
    importWorkdirDefaultTitle: 'Use Default Directory',
    importWorkdirDefaultDesc: '{value}',
    importWorkdirCustomTitle: 'Choose New Directory',
    importWorkdirCustomDesc: '{value}',
    importWorkdirCustomUnset: 'No directory selected.',
    importWorkdirConfirm: 'Import Session',
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
    runtimeWorkflowEmpty: 'No key workflow items yet. Command details remain in structured events or raw JSON.',
    rawEventSent: 'Sent',
    rawEventReceived: 'Received',
    queuedQuestionsTitle: 'Queued Questions',
    queuedQuestionsHint: 'These questions will run in order after current response finishes.',
    queuedQuestionItem: 'Queued Question #{index}',
    queuedRepliesTitle: 'Queued Messages',
    queuedRepliesHint: 'These messages will run in order after current response finishes.',
    queuedReplyItem: 'Queued #{index}',
    queuedUndo: 'Undo',
    queuedUndoAll: 'Clear All',
    queuedFromInput: 'Input',
    queuedFromRetry: 'Retry',
    queuedAt: 'Queued At',
    queueEmpty: 'No queued messages right now.',
    question: 'Question',
    startTime: 'Start',
    roleYou: 'You',
    roleCodex: 'Codex',
    collapseMessage: 'Collapse',
    expandMessage: 'Expand',
    renderRaw: 'Raw',
    renderMarkdown: 'Markdown',
    emptyMessagePreview: '(empty message)',
    loadEarlierMessages: 'Load earlier messages ({count} remaining)',
    showingRecentMessages: 'Showing latest {visible}/{total} messages',
    runtimeLoadEarlier: 'Load earlier entries ({count} remaining)',
    runtimeShowingRecent: 'Showing latest {visible}/{total} entries',
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

const queryById = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const queryAll = <T extends Element>(selector: string): T[] => Array.from(document.querySelectorAll(selector)) as T[];

const el: UiElementRefs = {
  appRoot: queryById<HTMLElement>('app-root'),
  sidebarResizer: queryById<HTMLElement>('sidebar-resizer'),
  workspace: queryById<HTMLElement>('workspace'),
  sidebarTitle: document.getElementById('sidebar-title'),
  sidebarSearchInput: queryById<HTMLInputElement>('sidebar-search-input'),
  conversationList: queryById<HTMLElement>('conversation-list'),
  focusRow: queryById<HTMLElement>('focus-row'),
  btnSidebarNewConv: queryById<HTMLButtonElement>('btn-sidebar-new-conv'),
  btnNewConv: queryById<HTMLButtonElement>('btn-new-conv'),
  btnImportSession: queryById<HTMLButtonElement>('btn-import-session'),
  btnExportSession: queryById<HTMLButtonElement>('btn-export-session'),
  btnRenameConv: queryById<HTMLButtonElement>('btn-rename-conv'),
  btnCloseConv: queryById<HTMLButtonElement>('btn-close-conv'),

  chatTitle: queryById<HTMLElement>('chat-title'),
  labelSessionId: queryById<HTMLElement>('label-session-id'),
  labelPhase: queryById<HTMLElement>('label-phase'),
  labelQueue: queryById<HTMLElement>('label-queue'),
  labelMetaModel: queryById<HTMLElement>('label-meta-model'),
  sessionId: queryById<HTMLElement>('session-id'),
  btnSessionId: queryById<HTMLButtonElement>('btn-session-id'),
  btnMetaModel: queryById<HTMLButtonElement>('btn-meta-model'),
  metaModelValue: queryById<HTMLElement>('meta-model-value'),
  phase: queryById<HTMLElement>('phase'),
  phaseChip: queryById<HTMLElement>('phase-chip'),
  queueChip: queryById<HTMLButtonElement>('queue-chip'),
  queueCount: queryById<HTMLElement>('queue-count'),
  currentTimeChip: queryById<HTMLElement>('current-time-chip'),
  currentTimeValue: queryById<HTMLElement>('current-time-value'),
  queuePopover: queryById<HTMLElement>('queue-popover'),
  queuePopoverTitle: queryById<HTMLElement>('queue-popover-title'),
  queuePopoverBody: queryById<HTMLElement>('queue-popover-body'),
  queuePopoverClear: queryById<HTMLButtonElement>('queue-popover-clear'),
  queuePopoverClose: queryById<HTMLButtonElement>('queue-popover-close'),
  btnQuickSettings: queryById<HTMLButtonElement>('btn-quick-settings'),
  labelQuickSettings: queryById<HTMLElement>('label-quick-settings'),
  quickSettingsMenu: queryById<HTMLElement>('quick-settings-menu'),
  quickSettingsScrim: queryById<HTMLElement>('quick-settings-scrim'),
  quickSettingsRoot: queryById<HTMLElement>('quick-settings-root'),
  quickSettingsDetail: queryById<HTMLElement>('quick-settings-detail'),
  qsBack: queryById<HTMLButtonElement>('qs-back'),
  qsDetailTitle: queryById<HTMLElement>('qs-detail-title'),
  qsAppName: queryById<HTMLElement>('qs-app-name'),
  qsAppVersion: queryById<HTMLElement>('qs-app-version'),
  qsAppDesc: queryById<HTMLElement>('qs-app-desc'),
  zoomHud: queryById<HTMLElement>('zoom-hud'),
  qsToggleSettings: queryById<HTMLButtonElement>('qs-toggle-settings'),
  qsToggleRuntime: queryById<HTMLButtonElement>('qs-toggle-runtime'),
  qsToggleSidebar: queryById<HTMLButtonElement>('qs-toggle-sidebar'),
  labelZoomFactor: queryById<HTMLElement>('label-zoom-factor'),
  zoomFactorRange: queryById<HTMLInputElement>('zoom-factor-range'),
  zoomFactorValue: queryById<HTMLElement>('zoom-factor-value'),
  btnZoomResetInline: queryById<HTMLButtonElement>('btn-zoom-reset-inline'),
  qsLangZh: queryById<HTMLButtonElement>('qs-lang-zh'),
  qsLangEn: queryById<HTMLButtonElement>('qs-lang-en'),
  qsRootThemeToggle: queryById<HTMLButtonElement>('qs-root-theme-toggle'),
  labelRootThemeToggle: queryById<HTMLElement>('label-root-theme-toggle'),
  qsRootThemeSwitch: queryById<HTMLElement>('qs-root-theme-switch'),
  qsDeviceIdentityInput: queryById<HTMLInputElement>('qs-device-identity-input'),
  qsNotificationProviderTelegram: queryById<HTMLButtonElement>('qs-notification-provider-telegram'),
  qsTelegramEnabled: queryById<HTMLInputElement>('qs-telegram-enabled'),
  labelQsTelegramEnabled: queryById<HTMLElement>('label-qs-telegram-enabled'),
  qsTelegramBotTokenInput: queryById<HTMLInputElement>('qs-telegram-bot-token-input'),
  qsTelegramChatIdInput: queryById<HTMLInputElement>('qs-telegram-chat-id-input'),
  qsTelegramTokenStatus: queryById<HTMLElement>('qs-telegram-token-status'),
  qsTelegramRemoteControlEnabled: queryById<HTMLInputElement>('qs-telegram-remote-control-enabled'),
  labelQsTelegramRemoteControlEnabled: queryById<HTMLElement>('label-qs-telegram-remote-control-enabled'),
  qsTelegramAllowedChatIdInput: queryById<HTMLInputElement>('qs-telegram-allowed-chat-id-input'),
  qsTelegramSave: queryById<HTMLButtonElement>('qs-telegram-save'),
  qsTelegramTest: queryById<HTMLButtonElement>('qs-telegram-test'),
  qsTelegramClearToken: queryById<HTMLButtonElement>('qs-telegram-clear-token'),
  i18nNodes: queryAll<HTMLElement>('[data-i18n-key]'),

  commandInput: queryById<HTMLInputElement>('command-input'),
  workdirInput: queryById<HTMLInputElement>('workdir-input'),
  createConversationModal: queryById<HTMLElement>('create-conversation-modal'),
  createConversationTitle: queryById<HTMLElement>('create-conversation-title'),
  createConversationMessage: queryById<HTMLElement>('create-conversation-message'),
  createConversationWorkdirLabel: queryById<HTMLElement>('create-conversation-workdir-label'),
  createConversationWorkdirInput: queryById<HTMLInputElement>('create-conversation-workdir-input'),
  createConversationBrowse: queryById<HTMLButtonElement>('create-conversation-browse'),
  createConversationCancel: queryById<HTMLButtonElement>('create-conversation-cancel'),
  createConversationConfirm: queryById<HTMLButtonElement>('create-conversation-confirm'),
  importWorkdirModal: queryById<HTMLElement>('import-workdir-modal'),
  importWorkdirTitle: queryById<HTMLElement>('import-workdir-title'),
  importWorkdirMessage: queryById<HTMLElement>('import-workdir-message'),
  importWorkdirFile: queryById<HTMLElement>('import-workdir-file'),
  importWorkdirImported: queryById<HTMLButtonElement>('import-workdir-imported'),
  importWorkdirImportedTitle: queryById<HTMLElement>('import-workdir-imported-title'),
  importWorkdirImportedDesc: queryById<HTMLElement>('import-workdir-imported-desc'),
  importWorkdirDefault: queryById<HTMLButtonElement>('import-workdir-default'),
  importWorkdirDefaultTitle: queryById<HTMLElement>('import-workdir-default-title'),
  importWorkdirDefaultDesc: queryById<HTMLElement>('import-workdir-default-desc'),
  importWorkdirCustom: queryById<HTMLButtonElement>('import-workdir-custom'),
  importWorkdirCustomTitle: queryById<HTMLElement>('import-workdir-custom-title'),
  importWorkdirCustomDesc: queryById<HTMLElement>('import-workdir-custom-desc'),
  importWorkdirCustomBrowse: queryById<HTMLButtonElement>('import-workdir-custom-browse'),
  importWorkdirCancel: queryById<HTMLButtonElement>('import-workdir-cancel'),
  importWorkdirConfirm: queryById<HTMLButtonElement>('import-workdir-confirm'),
  permissionInput: queryById<HTMLInputElement>('permission-input'),
  labelCommand: queryById<HTMLElement>('label-command'),
  labelWorkdir: queryById<HTMLElement>('label-workdir'),
  labelPermission: queryById<HTMLElement>('label-permission'),
  languageSelect: queryById<HTMLSelectElement>('language-select'),
  labelLanguage: queryById<HTMLElement>('label-language'),
  fontSizeRange: queryById<HTMLInputElement>('font-size-range'),
  labelFontSize: queryById<HTMLElement>('label-font-size'),
  fontSizeValue: queryById<HTMLInputElement>('font-size-value'),
  btnRefreshVersion: queryById<HTMLButtonElement>('btn-refresh-version'),
  btnRefreshModel: queryById<HTMLButtonElement>('btn-refresh-model'),

  btnClearChat: queryById<HTMLButtonElement>('btn-clear-chat'),
  btnClearRuntime: queryById<HTMLButtonElement>('btn-clear-runtime'),
  btnToggleSettings: queryById<HTMLButtonElement>('btn-toggle-settings'),
  btnToggleRuntime: queryById<HTMLButtonElement>('btn-toggle-runtime'),
  btnToggleSidebar: queryById<HTMLButtonElement>('btn-toggle-sidebar'),

  contentRow: queryById<HTMLElement>('content-row'),
  chatView: queryById<HTMLElement>('chat-view'),
  runtimeResizer: queryById<HTMLElement>('runtime-resizer'),
  runtimePanel: queryById<HTMLElement>('runtime-panel'),
  tabStructured: queryById<HTMLElement>('tab-structured'),
  tabWorkflow: queryById<HTMLElement>('tab-workflow'),
  tabRaw: queryById<HTMLElement>('tab-raw'),
  tabBtnStructured: queryById<HTMLButtonElement>('tab-btn-structured'),
  tabBtnWorkflow: queryById<HTMLButtonElement>('tab-btn-workflow'),
  tabBtnRaw: queryById<HTMLButtonElement>('tab-btn-raw'),
  tabButtons: queryAll<HTMLButtonElement>('.tab-btn'),

  inputBox: queryById<HTMLTextAreaElement>('input-box'),
  attachmentInput: queryById<HTMLInputElement>('attachment-input'),
  composerAttachments: queryById<HTMLElement>('composer-attachments'),
  btnAddAttachment: queryById<HTMLButtonElement>('btn-add-attachment'),
  attachmentKindMenu: queryById<HTMLElement>('attachment-kind-menu'),
  btnAddImageAttachment: queryById<HTMLButtonElement>('btn-add-image-attachment'),
  composerResizeHandle: queryById<HTMLElement>('composer-resize-handle'),
  sendRow: queryById<HTMLElement>('send-row'),
  btnSend: queryById<HTMLButtonElement>('btn-send'),
  btnInsertMessage: queryById<HTMLButtonElement>('btn-insert-message'),
  btnRetryLast: queryById<HTMLButtonElement>('btn-retry-last'),
  btnStop: queryById<HTMLButtonElement>('btn-stop'),
  composerWorkdir: queryById<HTMLElement>('composer-workdir'),
  labelComposerWorkdir: queryById<HTMLElement>('label-composer-workdir'),
  composerWorkdirValue: queryById<HTMLElement>('composer-workdir-value'),

  renameModal: queryById<HTMLElement>('rename-modal'),
  renameModalTitle: queryById<HTMLElement>('rename-modal-title'),
  renameInput: queryById<HTMLInputElement>('rename-input'),
  renameCancel: queryById<HTMLButtonElement>('rename-cancel'),
  renameConfirm: queryById<HTMLButtonElement>('rename-confirm'),
  importModeModal: queryById<HTMLElement>('import-mode-modal'),
  importModeTitle: queryById<HTMLElement>('import-mode-title'),
  importModeMessage: queryById<HTMLElement>('import-mode-message'),
  importModeFile: queryById<HTMLElement>('import-mode-file'),
  importModeSession: queryById<HTMLElement>('import-mode-session'),
  importModeResume: queryById<HTMLButtonElement>('import-mode-resume'),
  importModeResumeTitle: queryById<HTMLElement>('import-mode-resume-title'),
  importModeResumeDesc: queryById<HTMLElement>('import-mode-resume-desc'),
  importModeFork: queryById<HTMLButtonElement>('import-mode-fork'),
  importModeForkTitle: queryById<HTMLElement>('import-mode-fork-title'),
  importModeForkDesc: queryById<HTMLElement>('import-mode-fork-desc'),
  importModeCancel: queryById<HTMLButtonElement>('import-mode-cancel'),
  importModeConfirm: queryById<HTMLButtonElement>('import-mode-confirm'),
  confirmModal: queryById<HTMLElement>('confirm-modal'),
  confirmModalTitle: queryById<HTMLElement>('confirm-modal-title'),
  confirmModalBody: queryById<HTMLElement>('confirm-modal-body'),
  confirmCancel: queryById<HTMLButtonElement>('confirm-cancel'),
  confirmAccept: queryById<HTMLButtonElement>('confirm-accept'),
  closeGuardModal: queryById<HTMLElement>('close-guard-modal'),
  closeGuardTitle: queryById<HTMLElement>('close-guard-title'),
  closeGuardMessage: queryById<HTMLElement>('close-guard-message'),
  closeGuardDetail: queryById<HTMLElement>('close-guard-detail'),
  closeGuardCancel: queryById<HTMLButtonElement>('close-guard-cancel'),
  closeGuardStop: queryById<HTMLButtonElement>('close-guard-stop'),
  closeGuardForce: queryById<HTMLButtonElement>('close-guard-force'),
  aboutModal: queryById<HTMLElement>('about-modal'),
  aboutClose: queryById<HTMLButtonElement>('about-close'),
  aboutCodexVersionInput: queryById<HTMLInputElement>('about-codex-version-input'),
  labelAboutCodexVersion: queryById<HTMLElement>('label-about-codex-version'),

  contextMenu: queryById<HTMLElement>('conversation-context-menu'),
  ctxNewConv: queryById<HTMLButtonElement>('ctx-new-conv'),
  ctxImportConv: queryById<HTMLButtonElement>('ctx-import-conv'),
  ctxExportConv: queryById<HTMLButtonElement>('ctx-export-conv'),
  ctxRenameConv: queryById<HTMLButtonElement>('ctx-rename-conv'),
  ctxPinConv: queryById<HTMLButtonElement>('ctx-pin-conv'),
  ctxCloseConv: queryById<HTMLButtonElement>('ctx-close-conv'),
  chatContextMenu: queryById<HTMLElement>('chat-context-menu'),
  ctxCopySelection: queryById<HTMLButtonElement>('ctx-copy-selection'),
  ctxToggleRuntime: queryById<HTMLButtonElement>('ctx-toggle-runtime'),
  ctxToggleSidebar: queryById<HTMLButtonElement>('ctx-toggle-sidebar'),
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
