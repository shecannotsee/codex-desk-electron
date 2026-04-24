export type Language = 'zh-CN' | 'en-US';
export type Theme = 'light' | 'dark';
export type ActiveTab = 'structured' | 'workflow' | 'raw';
export type RuntimeTab = ActiveTab;

export interface AppInfo {
  name: string;
  version: string;
}

export type NotificationProvider = 'telegram';

export interface TelegramSettingsState {
  enabled: boolean;
  botToken?: string;
  chatId: string;
  hasBotToken?: boolean;
  botTokenHash?: string;
  botTokenFingerprint?: string;
}

export interface NotificationSettingsState {
  activeProvider: NotificationProvider;
  providers: {
    telegram: TelegramSettingsState;
  };
}

export interface TelegramRemoteControlState {
  enabled: boolean;
  botToken?: string;
  hasBotToken?: boolean;
  botTokenHash?: string;
  botTokenFingerprint?: string;
  allowedChatId: string;
}

export interface RemoteControlSettingsState {
  activeProvider: NotificationProvider;
  providers: {
    telegram: TelegramRemoteControlState;
  };
}

export interface SecuritySettingsState {
  hasMasterPassword: boolean;
  unlocked: boolean;
}

export interface SettingsState {
  commandText: string;
  workdir: string;
  defaultWorkdir: string;
  useNativeMemory?: boolean;
  deviceIdentity: string;
  notifications: NotificationSettingsState;
  remoteControl: RemoteControlSettingsState;
  security: SecuritySettingsState;
}

export interface UiState {
  language: Language;
  theme: Theme;
  zoomFactor: number;
  sidebarWidth: number;
  runtimePanelWidth: number;
  chatFontSize: number;
  runtimePanelHidden: boolean;
  settingsPanelHidden: boolean;
  sidebarHidden: boolean;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  text: string;
  attachments?: MessageAttachment[];
  usage?: MessageUsage;
  createdAt?: number;
  interrupted?: boolean;
  interruptedReason?: string;
  interruptedAt?: number;
  timestamp?: number;
  time?: number;
}

export interface MessageUsage {
  model?: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export interface MessageAttachment {
  path: string;
  name?: string;
  mimeType?: string;
  size?: number;
  kind?: string;
}

export interface ConversationSummary {
  id: string;
  title: string;
  workdir?: string;
  sessionId: string;
  sessionContinuationMode?: string;
  messages: ConversationMessage[];
  pinnedAt?: number;
  createdAt?: number;
  updatedAt?: number;
}

export interface RuntimeEventItem {
  id?: string;
  timestamp?: string;
  level?: string;
  message?: string;
  [key: string]: unknown;
}

export interface RawEventEntry {
  direction?: string;
  line?: string;
  timestamp?: string;
  [key: string]: unknown;
}

export interface WorkflowItem {
  type?: string;
  tag?: string;
  title?: string;
  body?: string;
  timestamp?: string;
  roundIndex?: number;
  preview?: string;
  status?: string;
  channel?: string;
  importance?: string;
  sourceKind?: string;
  [key: string]: unknown;
}

export interface RuntimeState {
  workflow: WorkflowItem[];
  events: RuntimeEventItem[];
  raw: Array<string | RawEventEntry>;
  phase: string;
  startedAt: number | null;
}

export type RuntimeStore = Record<string, RuntimeState>;
export type MetaState = Record<string, string>;
export type MetaStore = Record<string, MetaState>;

export interface QueuedMessageItem {
  id?: string;
  index?: number;
  text?: string;
  preview?: string;
  attachments?: MessageAttachment[];
  queuedAt?: number;
  fromRetry?: boolean;
  [key: string]: unknown;
}

export interface AppSnapshot {
  settings?: Partial<SettingsState>;
  activeConversationId?: string;
  conversations?: ConversationSummary[];
  runtimeByConversation?: RuntimeStore;
  metaByConversation?: MetaStore;
  runningConversationIds?: string[];
  queuedCountByConversation?: Record<string, number>;
  queuedMessagesByConversation?: Record<string, QueuedMessageItem[]>;
  [key: string]: unknown;
}

export interface ConversationSwitchPayload {
  settings?: Partial<SettingsState>;
  activeConversationId?: string;
  conversation?: ConversationSummary | null;
  runtime?: RuntimeState | null;
  meta?: MetaState | null;
  runningConversationIds?: string[];
  queuedCount?: number;
  queuedMessages?: QueuedMessageItem[];
  [key: string]: unknown;
}

export interface AppEvent {
  type: string;
  conversationId?: string;
  item?: unknown;
  line?: unknown;
  phase?: string;
  startedAt?: number | null;
  conversation?: ConversationSummary;
  key?: string;
  value?: string;
  running?: boolean;
  count?: number;
  items?: QueuedMessageItem[];
  index?: number;
  [key: string]: unknown;
}

export interface ConfirmDialogOptions {
  title?: string;
  message?: string;
}

export interface ImportSessionPreview {
  filePath?: string;
  sessionId?: string;
  cwd?: string;
  hasImportedWorkdir?: boolean;
}

export interface ImportWorkdirChoice {
  mode?: string;
  workdir?: string;
}

export interface CloseGuardPayload {
  title?: string;
  message?: string;
  detail?: string;
  cancelLabel?: string;
  stopAndCloseLabel?: string;
  forceCloseLabel?: string;
}

export interface PersistOptions {
  persist?: boolean;
}

export interface SidebarOptions extends PersistOptions {}

export interface ThemeOptions extends PersistOptions {
  rerender?: boolean;
}

export interface FontSizeOptions extends PersistOptions {
  rerenderControls?: boolean;
}

export interface RenderAllOptions {
  stickChatToBottom?: boolean;
}

export interface RenderTransientOptions {
  stickToBottom?: boolean;
}

export interface ScheduleRenderOptions {
  stickChatToBottom?: boolean;
}

export interface ComposerRenderOptions {
  force?: boolean;
}

export interface ZoomOptions extends PersistOptions {
  rerenderControls?: boolean;
}

export interface RenderHooks {
  renderAll: (options?: RenderAllOptions) => void;
  renderSettings: () => void;
}

export interface RendererCallbacks {
  onConversationSelected: (id: string) => Promise<void>;
}

export interface RenderJobs {
  full: boolean;
  locale: boolean;
  layout: boolean;
  conversationList: boolean;
  settings: boolean;
  header: boolean;
  chat: boolean;
  chatTransient: boolean;
  runtime: boolean;
  runtimeStructured: boolean;
  runtimeWorkflow: boolean;
  runtimeRaw: boolean;
  runButtons: boolean;
  composer: boolean;
  tabs: boolean;
}

export interface GenericResult {
  error?: string;
  snapshot?: AppSnapshot;
  canceled?: boolean;
  directoryPath?: string;
  logsText?: string;
  logPath?: string;
  logCount?: number;
  exported?: {
    filePath?: string;
    messageCount?: number;
  };
  preview?: ImportSessionPreview;
  zoomFactor?: number;
  enabled?: boolean;
  ok?: boolean;
  action?: string;
  [key: string]: unknown;
}

export interface CodexDeskApi {
  getAppInfo(): Promise<Partial<AppInfo>>;
  getSnapshot(): Promise<AppSnapshot>;
  getTelegramLogs(): Promise<GenericResult>;
  updateSettings(payload: unknown): Promise<GenericResult>;
  setMasterPassword(password: string): Promise<GenericResult>;
  unlockMasterPassword(password: string): Promise<GenericResult>;
  lockMasterPassword(): Promise<GenericResult>;
  testNotificationProvider(): Promise<GenericResult>;
  testRemoteControlProvider(): Promise<GenericResult>;
  pickWorkdir(payload?: { defaultPath?: string }): Promise<GenericResult>;
  switchConversation(conversationId: string): Promise<ConversationSwitchPayload>;
  createConversation(payload?: { workdir?: string }): Promise<AppSnapshot>;
  pickImportSession(): Promise<GenericResult>;
  importSessionFromFile(filePath: string, continuationMode: string, workdirChoice?: ImportWorkdirChoice): Promise<GenericResult>;
  exportSession(conversationId: string): Promise<GenericResult>;
  renameConversation(conversationId: string, title: string): Promise<GenericResult>;
  toggleConversationPin(conversationId: string): Promise<GenericResult>;
  closeCurrentConversation(): Promise<AppSnapshot>;
  clearChat(conversationId: string): Promise<GenericResult>;
  clearRuntime(conversationId: string, silent?: boolean): Promise<GenericResult>;
  stopConversation(conversationId: string): Promise<AppSnapshot>;
  refreshCodexVersion(conversationId: string): Promise<GenericResult>;
  refreshModelInfo(conversationId: string): Promise<GenericResult>;
  sendMessage(conversationId: string, text: string, attachments?: MessageAttachment[]): Promise<GenericResult>;
  insertMessage(conversationId: string, text: string): Promise<GenericResult>;
  retryLastMessage(conversationId: string): Promise<GenericResult>;
  cancelQueuedMessage(conversationId: string, queuedMessageId: string, queuedIndex?: number): Promise<GenericResult>;
  cancelAllQueuedMessages(conversationId: string): Promise<GenericResult>;
  getPathForFile(file: File): string;
  openPath(targetPath: string): Promise<GenericResult>;
  setMenuLanguage(language: Language): Promise<unknown>;
  setWindowTheme(theme: Theme): Promise<unknown>;
  getZoomFactor(): Promise<GenericResult>;
  setZoomFactor(zoomFactor: number): Promise<GenericResult>;
  invokeUiAction(action: string): Promise<GenericResult>;
  resolveCloseGuard(action: string): Promise<unknown>;
  isDocsCaptureEnabled(): Promise<boolean>;
  captureDocPage(fileName: string): Promise<GenericResult>;
  finishDocsCapture(): Promise<unknown>;
  onEvent(callback: (event: AppEvent) => void): () => void;
  onMenuAction(callback: (payload: { action?: string }) => void): () => void;
  onCloseGuard(callback: (payload: CloseGuardPayload) => void): () => void;
}

export interface AppState {
  appInfo: AppInfo;
  settings: SettingsState;
  activeConversationId: string;
  conversations: ConversationSummary[];
  runtimeByConversation: RuntimeStore;
  metaByConversation: MetaStore;
  runningConversationIds: Set<string>;
  queuedCountByConversation: Record<string, number>;
  queuedMessagesByConversation: Record<string, QueuedMessageItem[]>;
  collapsedByConversation: Record<string, Record<string, boolean>>;
  messageMarkdownByConversation: Record<string, Record<string, boolean>>;
  workflowCollapsedByConversation: Record<string, Record<string, boolean>>;
  chatVisibleCountByConversation: Record<string, number>;
  runtimeVisibleCountByConversation: Record<string, Partial<Record<RuntimeTab, number>>>;
  draftsByConversation: Record<string, string>;
  composerAttachmentsByConversation: Record<string, MessageAttachment[]>;
  inputBindingConversationId: string;
  activeTab: ActiveTab;
  ui: UiState;
}

export interface UiElementRefs {
  appRoot: HTMLElement;
  sidebarResizer: HTMLElement;
  workspace: HTMLElement;
  sidebarTitle: HTMLElement | null;
  sidebarSearchInput: HTMLInputElement;
  conversationList: HTMLElement;
  focusRow: HTMLElement;
  btnSidebarNewConv: HTMLButtonElement;
  btnNewConv: HTMLButtonElement;
  btnImportSession: HTMLButtonElement;
  btnExportSession: HTMLButtonElement;
  btnRenameConv: HTMLButtonElement;
  btnCloseConv: HTMLButtonElement;
  chatTitle: HTMLElement;
  labelSessionId: HTMLElement;
  labelPhase: HTMLElement;
  labelQueue: HTMLElement;
  labelMetaModel: HTMLElement;
  sessionId: HTMLElement;
  btnSessionId: HTMLButtonElement;
  btnMetaModel: HTMLButtonElement;
  metaModelValue: HTMLElement;
  phase: HTMLElement;
  phaseChip: HTMLElement;
  queueChip: HTMLButtonElement;
  queueCount: HTMLElement;
  currentTimeChip: HTMLElement;
  currentTimeValue: HTMLElement;
  queuePopover: HTMLElement;
  queuePopoverTitle: HTMLElement;
  queuePopoverBody: HTMLElement;
  queuePopoverClear: HTMLButtonElement;
  queuePopoverClose: HTMLButtonElement;
  btnQuickSettings: HTMLButtonElement;
  labelQuickSettings: HTMLElement;
  quickSettingsMenu: HTMLElement;
  quickSettingsScrim: HTMLElement;
  quickSettingsRoot: HTMLElement;
  quickSettingsDetail: HTMLElement;
  qsBack: HTMLButtonElement;
  qsDetailTitle: HTMLElement;
  qsAppName: HTMLElement;
  qsAppVersion: HTMLElement;
  qsAppDesc: HTMLElement;
  zoomHud: HTMLElement;
  qsToggleSettings: HTMLButtonElement;
  qsToggleRuntime: HTMLButtonElement;
  qsToggleSidebar: HTMLButtonElement;
  labelZoomFactor: HTMLElement;
  zoomFactorRange: HTMLInputElement;
  zoomFactorValue: HTMLElement;
  btnZoomResetInline: HTMLButtonElement;
  qsLangZh: HTMLButtonElement;
  qsLangEn: HTMLButtonElement;
  qsRootThemeToggle: HTMLButtonElement;
  labelRootThemeToggle: HTMLElement;
  qsRootThemeSwitch: HTMLElement;
  qsDeviceIdentityInput: HTMLInputElement;
  qsNotificationProviderTelegram: HTMLButtonElement;
  qsIntegrationSecurity: HTMLButtonElement;
  qsTelegramEnabled: HTMLInputElement;
  labelQsTelegramEnabled: HTMLElement;
  qsTelegramBotTokenInput: HTMLInputElement;
  qsTelegramToggleTokenVisibility: HTMLButtonElement;
  qsTelegramChatIdInput: HTMLInputElement;
  qsTelegramRemoteControlEnabled: HTMLInputElement;
  labelQsTelegramRemoteControlEnabled: HTMLElement;
  qsTelegramRemoteBotTokenInput: HTMLInputElement;
  qsTelegramToggleRemoteTokenVisibility: HTMLButtonElement;
  qsTelegramAllowedChatIdInput: HTMLInputElement;
  qsTelegramSave: HTMLButtonElement;
  qsTelegramTest: HTMLButtonElement;
  qsHelpTelegramLogs: HTMLButtonElement;
  qsTelegramLogsRefresh: HTMLButtonElement;
  qsTelegramLogsCopy: HTMLButtonElement;
  qsTelegramLogsPath: HTMLInputElement;
  qsTelegramLogsCount: HTMLElement;
  qsTelegramLogsOutput: HTMLTextAreaElement;
  qsSecurityStatusValue: HTMLElement;
  qsSecurityUnlockInput: HTMLInputElement;
  qsSecurityUnlockToggle: HTMLButtonElement;
  qsSecurityUnlockAction: HTMLButtonElement;
  qsSecurityLockAction: HTMLButtonElement;
  qsSecurityNewPasswordInput: HTMLInputElement;
  qsSecurityNewPasswordToggle: HTMLButtonElement;
  qsSecurityConfirmPasswordInput: HTMLInputElement;
  qsSecurityConfirmPasswordToggle: HTMLButtonElement;
  qsSecuritySetPasswordAction: HTMLButtonElement;
  qsSecurityChangePasswordAction: HTMLButtonElement;
  i18nNodes: HTMLElement[];
  commandInput: HTMLInputElement;
  workdirInput: HTMLInputElement;
  permissionInput: HTMLInputElement;
  labelCommand: HTMLElement;
  labelWorkdir: HTMLElement;
  labelPermission: HTMLElement;
  languageSelect: HTMLSelectElement;
  labelLanguage: HTMLElement;
  fontSizeRange: HTMLInputElement;
  labelFontSize: HTMLElement;
  fontSizeValue: HTMLInputElement;
  btnRefreshVersion: HTMLButtonElement;
  btnRefreshModel: HTMLButtonElement;
  btnClearChat: HTMLButtonElement;
  btnClearRuntime: HTMLButtonElement;
  btnToggleSettings: HTMLButtonElement;
  btnToggleRuntime: HTMLButtonElement;
  btnToggleSidebar: HTMLButtonElement;
  contentRow: HTMLElement;
  chatView: HTMLElement;
  runtimeResizer: HTMLElement;
  runtimePanel: HTMLElement;
  tabStructured: HTMLElement;
  tabWorkflow: HTMLElement;
  tabRaw: HTMLElement;
  tabBtnStructured: HTMLButtonElement;
  tabBtnWorkflow: HTMLButtonElement;
  tabBtnRaw: HTMLButtonElement;
  tabButtons: HTMLButtonElement[];
  inputBox: HTMLTextAreaElement;
  attachmentInput: HTMLInputElement;
  composerAttachments: HTMLElement;
  btnAddAttachment: HTMLButtonElement;
  attachmentKindMenu: HTMLElement;
  btnAddImageAttachment: HTMLButtonElement;
  composerResizeHandle: HTMLElement;
  sendRow: HTMLElement;
  btnSend: HTMLButtonElement;
  btnInsertMessage: HTMLButtonElement;
  btnRetryLast: HTMLButtonElement;
  btnStop: HTMLButtonElement;
  composerWorkdir: HTMLElement;
  labelComposerWorkdir: HTMLElement;
  composerWorkdirValue: HTMLElement;
  createConversationModal: HTMLElement;
  createConversationTitle: HTMLElement;
  createConversationMessage: HTMLElement;
  createConversationWorkdirLabel: HTMLElement;
  createConversationWorkdirInput: HTMLInputElement;
  createConversationBrowse: HTMLButtonElement;
  createConversationCancel: HTMLButtonElement;
  createConversationConfirm: HTMLButtonElement;
  importWorkdirModal: HTMLElement;
  importWorkdirTitle: HTMLElement;
  importWorkdirMessage: HTMLElement;
  importWorkdirFile: HTMLElement;
  importWorkdirImported: HTMLButtonElement;
  importWorkdirImportedTitle: HTMLElement;
  importWorkdirImportedDesc: HTMLElement;
  importWorkdirDefault: HTMLButtonElement;
  importWorkdirDefaultTitle: HTMLElement;
  importWorkdirDefaultDesc: HTMLElement;
  importWorkdirCustom: HTMLButtonElement;
  importWorkdirCustomTitle: HTMLElement;
  importWorkdirCustomDesc: HTMLElement;
  importWorkdirCustomBrowse: HTMLButtonElement;
  importWorkdirCancel: HTMLButtonElement;
  importWorkdirConfirm: HTMLButtonElement;
  renameModal: HTMLElement;
  renameModalTitle: HTMLElement;
  renameInput: HTMLInputElement;
  renameCancel: HTMLButtonElement;
  renameConfirm: HTMLButtonElement;
  importModeModal: HTMLElement;
  importModeTitle: HTMLElement;
  importModeMessage: HTMLElement;
  importModeFile: HTMLElement;
  importModeSession: HTMLElement;
  importModeResume: HTMLButtonElement;
  importModeResumeTitle: HTMLElement;
  importModeResumeDesc: HTMLElement;
  importModeFork: HTMLButtonElement;
  importModeForkTitle: HTMLElement;
  importModeForkDesc: HTMLElement;
  importModeCancel: HTMLButtonElement;
  importModeConfirm: HTMLButtonElement;
  confirmModal: HTMLElement;
  confirmModalTitle: HTMLElement;
  confirmModalBody: HTMLElement;
  confirmCancel: HTMLButtonElement;
  confirmAccept: HTMLButtonElement;
  closeGuardModal: HTMLElement;
  closeGuardTitle: HTMLElement;
  closeGuardMessage: HTMLElement;
  closeGuardDetail: HTMLElement;
  closeGuardCancel: HTMLButtonElement;
  closeGuardStop: HTMLButtonElement;
  closeGuardForce: HTMLButtonElement;
  aboutModal: HTMLElement;
  aboutClose: HTMLButtonElement;
  aboutCodexVersionInput: HTMLInputElement;
  labelAboutCodexVersion: HTMLElement;
  contextMenu: HTMLElement;
  ctxNewConv: HTMLButtonElement;
  ctxImportConv: HTMLButtonElement;
  ctxExportConv: HTMLButtonElement;
  ctxRenameConv: HTMLButtonElement;
  ctxPinConv: HTMLButtonElement;
  ctxCloseConv: HTMLButtonElement;
  chatContextMenu: HTMLElement;
  ctxCopySelection: HTMLButtonElement;
  ctxToggleRuntime: HTMLButtonElement;
  ctxToggleSidebar: HTMLButtonElement;
}
