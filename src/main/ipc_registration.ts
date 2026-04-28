const os = require('node:os');
const path = require('node:path');

const { openLocalPath } = require('./local_path_opener');
const { registerDocsCaptureIpc } = require('./docs_capture_main');
const {
  TELEGRAM_LOG_PATH,
  formatTelegramLogs,
  listTelegramLogs,
} = require('./telegram');

function registerAppIpc({
  app,
  dialog,
  ipcMain,
  getMainWindow,
  getController,
  getMenuLanguage,
  applyMenuLanguage,
  applyWindowTheme,
  clampZoomFactor,
  invokeUiAction,
  getCloseGuardPending,
  setCloseGuardPending,
  setAllowWindowClose,
  waitForRunnersStop,
}) {
  ipcMain.handle('ui:set-menu-language', async (_, payload) => {
    const language = applyMenuLanguage(payload?.language);
    return { ok: true, language };
  });

  ipcMain.handle('ui:set-window-theme', async (_, payload) => {
    const theme = applyWindowTheme(payload?.theme);
    return { ok: true, theme };
  });

  ipcMain.handle('ui:get-zoom-factor', async () => {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { ok: false, error: '窗口不可用' };
    }
    return { ok: true, zoomFactor: clampZoomFactor(mainWindow.webContents.getZoomFactor()) };
  });

  ipcMain.handle('ui:set-zoom-factor', async (_, payload) => {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { ok: false, error: '窗口不可用' };
    }
    const zoomFactor = clampZoomFactor(payload?.zoomFactor);
    mainWindow.webContents.setZoomFactor(zoomFactor);
    return { ok: true, zoomFactor };
  });

  ipcMain.handle('ui:invoke-action', async (_, payload) => {
    return invokeUiAction(payload?.action);
  });

  ipcMain.handle('app:get-snapshot', async () => getController().snapshot());

  ipcMain.handle('app:get-info', async () => ({
    ok: true,
    name: app.getName(),
    version: app.getVersion(),
  }));
  ipcMain.handle('app:get-telegram-logs', async () => {
    const entries = listTelegramLogs(200);
    return {
      ok: true,
      logCount: entries.length,
      logPath: TELEGRAM_LOG_PATH,
      logsText: formatTelegramLogs(entries),
    };
  });

  ipcMain.handle('app:update-settings', async (_, payload) => getController().updateSettings(payload || {}));
  ipcMain.handle('app:set-master-password', async (_, payload) => getController().setMasterPassword(payload?.password));
  ipcMain.handle('app:unlock-master-password', async (_, payload) => getController().unlockMasterPassword(payload?.password));
  ipcMain.handle('app:lock-master-password', async () => getController().lockMasterPassword());
  ipcMain.handle('app:test-notification-provider', async () => getController().testNotificationProvider());
  ipcMain.handle('app:test-remote-control-provider', async () => getController().testRemoteControlProvider());
  ipcMain.handle('app:pick-workdir', async (_, payload) => {
    const mainWindow = getMainWindow();
    const controller = getController();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { ok: false, error: '窗口不可用' };
    }

    const result = await dialog.showOpenDialog(mainWindow, {
      title: getMenuLanguage() === 'en-US' ? 'Choose Working Directory' : '选择工作目录',
      defaultPath: String(payload?.defaultPath || controller?._defaultWorkdir?.() || '').trim() || undefined,
      properties: ['openDirectory', 'createDirectory'],
    });

    if (result.canceled || !Array.isArray(result.filePaths) || !result.filePaths[0]) {
      return { canceled: true, snapshot: controller.snapshot() };
    }

    return {
      ok: true,
      snapshot: controller.snapshot(),
      directoryPath: result.filePaths[0],
    };
  });

  ipcMain.handle('conversation:switch', async (_, payload) => {
    const id = String(payload?.conversationId || '');
    return getController().switchConversation(id);
  });

  ipcMain.handle('conversation:create', async (_, payload) => getController().createConversation(payload || {}));

  ipcMain.handle('conversation:pick-import-session', async () => {
    const mainWindow = getMainWindow();
    const controller = getController();
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { ok: false, error: '窗口不可用' };
    }

    const result = await dialog.showOpenDialog(mainWindow, {
      title: '导入 Codex 会话',
      defaultPath: path.join(os.homedir(), '.codex', 'sessions'),
      properties: ['openFile'],
      filters: [
        { name: 'Codex Session', extensions: ['jsonl'] },
        { name: 'JSON', extensions: ['json', 'jsonl'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (result.canceled || !Array.isArray(result.filePaths) || !result.filePaths[0]) {
      return { canceled: true, snapshot: controller.snapshot() };
    }

    try {
      return {
        snapshot: controller.snapshot(),
        preview: controller.previewConversationImportFromSessionFile(result.filePaths[0]),
      };
    } catch (error) {
      return {
        error: `导入会话失败: ${error?.message || String(error)}`,
        snapshot: controller.snapshot(),
      };
    }
  });

  ipcMain.handle('conversation:import-session-file', async (_, payload) => {
    const controller = getController();
    const filePath = String(payload?.filePath || '');
    const continuationMode = String(payload?.continuationMode || 'resume');
    const workdirChoice = {
      mode: String(payload?.workdirChoice?.mode || 'default'),
      workdir: String(payload?.workdirChoice?.workdir || ''),
    };
    try {
      return controller.importConversationFromSessionFile(filePath, { continuationMode, workdirMode: workdirChoice.mode, workdir: workdirChoice.workdir });
    } catch (error) {
      return {
        error: `导入会话失败: ${error?.message || String(error)}`,
        snapshot: controller.snapshot(),
      };
    }
  });

  ipcMain.handle('conversation:export-session', async (_, payload) => {
    const mainWindow = getMainWindow();
    const controller = getController();
    const conversationId = String(payload?.conversationId || '');
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { ok: false, error: '窗口不可用' };
    }

    try {
      const preview = controller.previewConversationExport(conversationId);
      const defaultDir = path.join(os.homedir(), 'Downloads');
      const result = await dialog.showSaveDialog(mainWindow, {
        title: '导出当前会话',
        defaultPath: path.join(defaultDir, preview.suggestedFileName),
        filters: [
          { name: 'Codex Session', extensions: ['jsonl'] },
          { name: 'JSON', extensions: ['json', 'jsonl'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });

      if (result.canceled || !result.filePath) {
        return { canceled: true, snapshot: controller.snapshot() };
      }

      return controller.exportConversationToSessionFile(preview.conversationId, result.filePath);
    } catch (error) {
      return {
        error: `导出会话失败: ${error?.message || String(error)}`,
        snapshot: controller.snapshot(),
      };
    }
  });

  ipcMain.handle('conversation:rename', async (_, payload) => {
    const title = String(payload?.title || '');
    const conversationId = String(payload?.conversationId || '');
    return getController().renameConversation(conversationId, title);
  });

  ipcMain.handle('conversation:toggle-pin', async (_, payload) => {
    const conversationId = String(payload?.conversationId || '');
    return getController().toggleConversationPin(conversationId);
  });

  ipcMain.handle('conversation:close-current', async () => getController().closeCurrentConversation());

  ipcMain.handle('meta:refresh-codex-version', async (_, payload) => {
    const conversationId = String(payload?.conversationId || '');
    return getController().refreshCodexVersion(conversationId);
  });

  ipcMain.handle('meta:refresh-model', async (_, payload) => {
    const conversationId = String(payload?.conversationId || '');
    return getController().refreshModelInfo(conversationId);
  });

  ipcMain.handle('conversation:clear-chat', async (_, payload) => {
    return getController().clearChat(String(payload?.conversationId || ''));
  });

  ipcMain.handle('conversation:clear-runtime', async (_, payload) => {
    return getController().clearRuntime(String(payload?.conversationId || ''), {
      silent: Boolean(payload?.silent),
    });
  });

  ipcMain.handle('conversation:stop', async (_, payload) => {
    return getController().stopConversation(String(payload?.conversationId || ''));
  });

  ipcMain.handle('chat:send', async (_, payload) => {
    return getController().sendMessage({
      conversationId: String(payload?.conversationId || ''),
      text: String(payload?.text || ''),
      attachments: Array.isArray(payload?.attachments) ? payload.attachments : [],
    });
  });

  ipcMain.handle('chat:insert', async (_, payload) => {
    return getController().insertMessage({
      conversationId: String(payload?.conversationId || ''),
      text: String(payload?.text || ''),
    });
  });

  ipcMain.handle('chat:retry-last', async (_, payload) => {
    return getController().retryLastMessage(String(payload?.conversationId || ''));
  });

  ipcMain.handle('chat:cancel-queued-message', async (_, payload) => {
    return getController().cancelQueuedMessage(
      String(payload?.conversationId || ''),
      String(payload?.queuedMessageId || ''),
      Number(payload?.queuedIndex || 0),
    );
  });

  ipcMain.handle('chat:cancel-all-queued-messages', async (_, payload) => {
    return getController().cancelAllQueuedMessages(String(payload?.conversationId || ''));
  });

  ipcMain.handle('shell:open-path', async (_, payload) => {
    return openLocalPath(payload?.path);
  });

  ipcMain.handle('app:resolve-close-guard', async (_, payload) => {
    const action = String(payload?.action || '').trim();
    const controller = getController();
    if (!getCloseGuardPending()) {
      return { ok: false, ignored: true };
    }
    try {
      if (action === 'cancel') {
        return { ok: true, canceled: true };
      }
      if (action === 'stop-and-close') {
        controller?.stopAllRunningConversations();
        await waitForRunnersStop(3000);
      } else if (action === 'force-close') {
        controller?.stopAllRunningConversations();
      } else {
        return { ok: false, error: '无效动作' };
      }

      setAllowWindowClose(true);
      const mainWindow = getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.close();
      }
      return { ok: true };
    } finally {
      setCloseGuardPending(false);
    }
  });

  registerDocsCaptureIpc({
    app,
    ipcMain,
    getMainWindow,
    setAllowWindowClose,
  });
}

module.exports = {
  registerAppIpc,
};
