const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('codexdesk', {
  getAppInfo: () => ipcRenderer.invoke('app:get-info'),
  getSnapshot: () => ipcRenderer.invoke('app:get-snapshot'),
  getTelegramLogs: () => ipcRenderer.invoke('app:get-telegram-logs'),
  updateSettings: (payload) => ipcRenderer.invoke('app:update-settings', payload),
  setMasterPassword: (password) => ipcRenderer.invoke('app:set-master-password', { password }),
  unlockMasterPassword: (password) => ipcRenderer.invoke('app:unlock-master-password', { password }),
  lockMasterPassword: () => ipcRenderer.invoke('app:lock-master-password'),
  testNotificationProvider: () => ipcRenderer.invoke('app:test-notification-provider'),
  testRemoteControlProvider: () => ipcRenderer.invoke('app:test-remote-control-provider'),
  pickWorkdir: (payload) => ipcRenderer.invoke('app:pick-workdir', payload),

  switchConversation: (conversationId) => ipcRenderer.invoke('conversation:switch', { conversationId }),
  createConversation: (payload) => ipcRenderer.invoke('conversation:create', payload),
  pickImportSession: () => ipcRenderer.invoke('conversation:pick-import-session'),
  importSessionFromFile: (filePath, continuationMode, workdirChoice) => ipcRenderer.invoke('conversation:import-session-file', {
    filePath,
    continuationMode,
    workdirChoice,
  }),
  exportSession: (conversationId) => ipcRenderer.invoke('conversation:export-session', { conversationId }),
  renameConversation: (conversationId, title) => ipcRenderer.invoke('conversation:rename', { conversationId, title }),
  changeConversationAvatar: (conversationId) => ipcRenderer.invoke('conversation:change-avatar', { conversationId }),
  toggleConversationPin: (conversationId) => ipcRenderer.invoke('conversation:toggle-pin', { conversationId }),
  closeCurrentConversation: () => ipcRenderer.invoke('conversation:close-current'),
  clearChat: (conversationId) => ipcRenderer.invoke('conversation:clear-chat', { conversationId }),
  clearRuntime: (conversationId, silent = false) => ipcRenderer.invoke('conversation:clear-runtime', { conversationId, silent }),
  stopConversation: (conversationId) => ipcRenderer.invoke('conversation:stop', { conversationId }),
  refreshCodexVersion: (conversationId) => ipcRenderer.invoke('meta:refresh-codex-version', { conversationId }),
  refreshModelInfo: (conversationId) => ipcRenderer.invoke('meta:refresh-model', { conversationId }),

  sendMessage: (conversationId, text, attachments = [], options = {}) => ipcRenderer.invoke('chat:send', {
    conversationId,
    text,
    attachments,
    options,
  }),
  insertMessage: (conversationId, text) => ipcRenderer.invoke('chat:insert', { conversationId, text }),
  retryLastMessage: (conversationId) => ipcRenderer.invoke('chat:retry-last', { conversationId }),
  cancelQueuedMessage: (conversationId, queuedMessageId, queuedIndex) => ipcRenderer.invoke('chat:cancel-queued-message', {
    conversationId,
    queuedMessageId,
    queuedIndex,
  }),
  cancelAllQueuedMessages: (conversationId) => ipcRenderer.invoke('chat:cancel-all-queued-messages', {
    conversationId,
  }),
  getPathForFile: (file) => {
    try {
      return String(webUtils.getPathForFile(file) || '');
    } catch {
      return '';
    }
  },
  openPath: (targetPath) => ipcRenderer.invoke('shell:open-path', { path: targetPath }),
  setMenuLanguage: (language) => ipcRenderer.invoke('ui:set-menu-language', { language }),
  setWindowTheme: (theme) => ipcRenderer.invoke('ui:set-window-theme', { theme }),
  getZoomFactor: () => ipcRenderer.invoke('ui:get-zoom-factor'),
  setZoomFactor: (zoomFactor) => ipcRenderer.invoke('ui:set-zoom-factor', { zoomFactor }),
  invokeUiAction: (action) => ipcRenderer.invoke('ui:invoke-action', { action }),
  resolveCloseGuard: (action) => ipcRenderer.invoke('app:resolve-close-guard', { action }),
  isDocsCaptureEnabled: async () => {
    const result = await ipcRenderer.invoke('docs:capture-enabled');
    return Boolean(result?.enabled);
  },
  captureDocPage: (fileName) => ipcRenderer.invoke('docs:capture-page', { fileName }),
  finishDocsCapture: () => ipcRenderer.invoke('docs:capture-finish'),

  onEvent: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('app:event', handler);
    return () => {
      ipcRenderer.removeListener('app:event', handler);
    };
  },
  onMenuAction: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('app:menu-action', handler);
    return () => {
      ipcRenderer.removeListener('app:menu-action', handler);
    };
  },
  onCloseGuard: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('app:close-guard', handler);
    return () => {
      ipcRenderer.removeListener('app:close-guard', handler);
    };
  },
});
