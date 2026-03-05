const path = require('node:path');

const { app, BrowserWindow, ipcMain } = require('electron');

const { AppController } = require('./app_controller');

let mainWindow = null;
let controller = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1460,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  controller = new AppController(mainWindow);

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerIpc() {
  ipcMain.handle('app:get-snapshot', async () => controller.snapshot());

  ipcMain.handle('app:update-settings', async (_, payload) => controller.updateSettings(payload || {}));

  ipcMain.handle('conversation:switch', async (_, payload) => {
    const id = String(payload?.conversationId || '');
    return controller.switchConversation(id);
  });

  ipcMain.handle('conversation:create', async () => controller.createConversation());

  ipcMain.handle('conversation:rename', async (_, payload) => {
    const title = String(payload?.title || '');
    const conversationId = String(payload?.conversationId || '');
    return controller.renameConversation(conversationId, title);
  });

  ipcMain.handle('conversation:close-current', async () => controller.closeCurrentConversation());

  ipcMain.handle('meta:refresh-codex-version', async (_, payload) => {
    const conversationId = String(payload?.conversationId || '');
    return controller.refreshCodexVersion(conversationId);
  });

  ipcMain.handle('meta:refresh-model', async (_, payload) => {
    const conversationId = String(payload?.conversationId || '');
    return controller.refreshModelInfo(conversationId);
  });

  ipcMain.handle('conversation:clear-chat', async (_, payload) => {
    return controller.clearChat(String(payload?.conversationId || ''));
  });

  ipcMain.handle('conversation:clear-runtime', async (_, payload) => {
    return controller.clearRuntime(String(payload?.conversationId || ''), {
      silent: Boolean(payload?.silent),
    });
  });

  ipcMain.handle('conversation:stop', async (_, payload) => {
    return controller.stopConversation(String(payload?.conversationId || ''));
  });

  ipcMain.handle('chat:send', async (_, payload) => {
    return controller.sendMessage({
      conversationId: String(payload?.conversationId || ''),
      text: String(payload?.text || ''),
    });
  });
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
