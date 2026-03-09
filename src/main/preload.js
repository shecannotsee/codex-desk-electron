const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('codexdesk', {
  getSnapshot: () => ipcRenderer.invoke('app:get-snapshot'),
  updateSettings: (payload) => ipcRenderer.invoke('app:update-settings', payload),

  switchConversation: (conversationId) => ipcRenderer.invoke('conversation:switch', { conversationId }),
  createConversation: () => ipcRenderer.invoke('conversation:create'),
  renameConversation: (conversationId, title) => ipcRenderer.invoke('conversation:rename', { conversationId, title }),
  closeCurrentConversation: () => ipcRenderer.invoke('conversation:close-current'),
  clearChat: (conversationId) => ipcRenderer.invoke('conversation:clear-chat', { conversationId }),
  clearRuntime: (conversationId, silent = false) => ipcRenderer.invoke('conversation:clear-runtime', { conversationId, silent }),
  stopConversation: (conversationId) => ipcRenderer.invoke('conversation:stop', { conversationId }),
  refreshCodexVersion: (conversationId) => ipcRenderer.invoke('meta:refresh-codex-version', { conversationId }),
  refreshModelInfo: (conversationId) => ipcRenderer.invoke('meta:refresh-model', { conversationId }),

  sendMessage: (conversationId, text) => ipcRenderer.invoke('chat:send', { conversationId, text }),
  retryLastMessage: (conversationId) => ipcRenderer.invoke('chat:retry-last', { conversationId }),
  setMenuLanguage: (language) => ipcRenderer.invoke('ui:set-menu-language', { language }),
  invokeUiAction: (action) => ipcRenderer.invoke('ui:invoke-action', { action }),
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
});
