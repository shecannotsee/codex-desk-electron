const path = require('node:path');

const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');

const { AppController } = require('./app_controller');

app.setName('Codex Desk');

let mainWindow = null;
let controller = null;
let menuLanguage = 'zh-CN';
let allowWindowClose = false;
let closeGuardPending = false;

const MENU_TEXT = {
  'zh-CN': {
    file: '文件',
    conversation: '对话',
    runtime: '运行',
    edit: '编辑',
    view: '视图',
    window: '窗口',
    help: '帮助',

    newConversation: '新建对话',
    renameConversation: '重命名当前对话',
    closeConversation: '关闭当前对话',
    clearChat: '清空当前对话内容',
    clearRuntime: '清空右侧运行日志',
    retryLast: '重试上一条',
    stop: '停止当前任务',
    quit: '退出',

    refreshVersion: '获取 Codex 版本',
    refreshModel: '获取模型',

    toggleSettings: '隐藏/显示配置信息',
    toggleRuntime: '隐藏/显示右侧面板',
    toggleSidebar: '隐藏/显示左侧会话',
    language: '语言',
    languageZh: '中文',
    languageEn: 'English',
    reload: '重新加载',
    toggleDevTools: '开发者工具',
    resetZoom: '实际大小',
    zoomIn: '放大',
    zoomOut: '缩小',
    fullscreen: '全屏',

    undo: '撤销',
    redo: '重做',
    cut: '剪切',
    copy: '复制',
    paste: '粘贴',
    selectAll: '全选',

    minimize: '最小化',
    zoom: '缩放',
    closeWindow: '关闭窗口',
    about: '关于 Codex Desk',
    aboutMessage: 'Codex Desk 桌面端',
    closeGuardTitle: '存在进行中的任务',
    closeGuardMessage: '当前有 {count} 个会话仍在运行。',
    closeGuardDetail: '建议先停止任务再关闭窗口，避免中途中断。',
    closeGuardCancel: '取消',
    closeGuardStopAndClose: '停止任务并关闭',
    closeGuardForceClose: '直接关闭',
  },
  'en-US': {
    file: 'File',
    conversation: 'Conversation',
    runtime: 'Runtime',
    edit: 'Edit',
    view: 'View',
    window: 'Window',
    help: 'Help',

    newConversation: 'New Conversation',
    renameConversation: 'Rename Current Conversation',
    closeConversation: 'Close Current Conversation',
    clearChat: 'Clear Current Chat',
    clearRuntime: 'Clear Runtime Logs',
    retryLast: 'Retry Last',
    stop: 'Stop Current Task',
    quit: 'Quit',

    refreshVersion: 'Refresh Codex Version',
    refreshModel: 'Refresh Model',

    toggleSettings: 'Toggle Config Rows',
    toggleRuntime: 'Toggle Runtime Panel',
    toggleSidebar: 'Toggle Left Sidebar',
    language: 'Language',
    languageZh: 'Chinese',
    languageEn: 'English',
    reload: 'Reload',
    toggleDevTools: 'Developer Tools',
    resetZoom: 'Actual Size',
    zoomIn: 'Zoom In',
    zoomOut: 'Zoom Out',
    fullscreen: 'Toggle Full Screen',

    undo: 'Undo',
    redo: 'Redo',
    cut: 'Cut',
    copy: 'Copy',
    paste: 'Paste',
    selectAll: 'Select All',

    minimize: 'Minimize',
    zoom: 'Zoom',
    closeWindow: 'Close Window',
    about: 'About Codex Desk',
    aboutMessage: 'Codex Desk Desktop App',
    closeGuardTitle: 'Tasks Are Still Running',
    closeGuardMessage: '{count} conversation(s) are still running.',
    closeGuardDetail: 'Recommended: stop tasks before closing to avoid interruption.',
    closeGuardCancel: 'Cancel',
    closeGuardStopAndClose: 'Stop And Close',
    closeGuardForceClose: 'Close Now',
  },
};

function normalizeLanguage(input) {
  const raw = String(input || '').trim().toLowerCase();
  if (raw.startsWith('zh')) {
    return 'zh-CN';
  }
  return 'en-US';
}

function menuText() {
  return MENU_TEXT[menuLanguage] || MENU_TEXT['zh-CN'];
}

function templateText(input, vars = {}) {
  return String(input || '').replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? ''));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRunnersStop(timeoutMs = 3000, intervalMs = 120) {
  const begin = Date.now();
  while (Date.now() - begin < timeoutMs) {
    if (!controller || controller.runningConversationCount() <= 0) {
      return true;
    }
    await sleep(intervalMs);
  }
  return !controller || controller.runningConversationCount() <= 0;
}

function sendMenuAction(action) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send('app:menu-action', { action: String(action || '') });
}

function applyMenuLanguage(language) {
  menuLanguage = normalizeLanguage(language);
  const text = MENU_TEXT[menuLanguage] || MENU_TEXT['zh-CN'];

  const template = [
    {
      label: text.file,
      submenu: [
        { label: text.closeWindow, role: 'close' },
        { type: 'separator' },
        { label: text.quit, role: 'quit' },
      ],
    },
    {
      label: text.conversation,
      submenu: [
        { label: text.newConversation, accelerator: 'CmdOrCtrl+N', click: () => sendMenuAction('conversation:new') },
        { label: text.renameConversation, click: () => sendMenuAction('conversation:rename') },
        { label: text.closeConversation, click: () => sendMenuAction('conversation:close-current') },
        { type: 'separator' },
        { label: text.clearChat, click: () => sendMenuAction('conversation:clear-chat') },
        { label: text.retryLast, click: () => sendMenuAction('conversation:retry-last') },
        { label: text.stop, accelerator: 'CmdOrCtrl+.', click: () => sendMenuAction('conversation:stop') },
      ],
    },
    {
      label: text.edit,
      submenu: [
        { label: text.undo, role: 'undo' },
        { label: text.redo, role: 'redo' },
        { type: 'separator' },
        { label: text.cut, role: 'cut' },
        { label: text.copy, role: 'copy' },
        { label: text.paste, role: 'paste' },
        { type: 'separator' },
        { label: text.selectAll, role: 'selectAll' },
      ],
    },
    {
      label: text.runtime,
      submenu: [
        { label: text.clearRuntime, click: () => sendMenuAction('conversation:clear-runtime') },
        { type: 'separator' },
        { label: text.refreshVersion, click: () => sendMenuAction('meta:refresh-codex-version') },
        { label: text.refreshModel, click: () => sendMenuAction('meta:refresh-model') },
      ],
    },
    {
      label: text.view,
      submenu: [
        { label: text.toggleSettings, click: () => sendMenuAction('ui:toggle-settings') },
        { label: text.toggleRuntime, click: () => sendMenuAction('ui:toggle-runtime') },
        { label: text.toggleSidebar, click: () => sendMenuAction('ui:toggle-sidebar') },
        { type: 'separator' },
        {
          label: text.language,
          submenu: [
            {
              label: text.languageZh,
              type: 'radio',
              checked: menuLanguage === 'zh-CN',
              click: () => {
                applyMenuLanguage('zh-CN');
                sendMenuAction('ui:language:zh-CN');
              },
            },
            {
              label: text.languageEn,
              type: 'radio',
              checked: menuLanguage === 'en-US',
              click: () => {
                applyMenuLanguage('en-US');
                sendMenuAction('ui:language:en-US');
              },
            },
          ],
        },
        { type: 'separator' },
        { label: text.reload, role: 'reload' },
        { label: text.toggleDevTools, role: 'toggleDevTools' },
        { type: 'separator' },
        { label: text.resetZoom, role: 'resetZoom' },
        { label: text.zoomIn, role: 'zoomIn' },
        { label: text.zoomOut, role: 'zoomOut' },
        { type: 'separator' },
        { label: text.fullscreen, role: 'togglefullscreen' },
      ],
    },
    {
      label: text.window,
      submenu: [
        { label: text.minimize, role: 'minimize' },
        { label: text.zoom, role: 'zoom' },
        { label: text.closeWindow, role: 'close' },
      ],
    },
    {
      label: text.help,
      submenu: [
        {
          label: text.about,
          click: async () => {
            await dialog.showMessageBox({
              type: 'info',
              title: text.about,
              message: text.aboutMessage,
            });
          },
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function handleWindowCloseGuard(event) {
  if (allowWindowClose || !controller || !mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  const runningCount = Number(controller.runningConversationCount() || 0);
  if (runningCount <= 0) {
    return;
  }

  event.preventDefault();
  if (closeGuardPending) {
    return;
  }
  closeGuardPending = true;

  try {
    const text = menuText();
    const result = await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      title: text.closeGuardTitle,
      message: templateText(text.closeGuardMessage, { count: runningCount }),
      detail: text.closeGuardDetail,
      buttons: [text.closeGuardCancel, text.closeGuardStopAndClose, text.closeGuardForceClose],
      defaultId: 0,
      cancelId: 0,
      noLink: true,
    });

    if (result.response === 0) {
      return;
    }

    if (result.response === 1) {
      controller.stopAllRunningConversations();
      await waitForRunnersStop(3000);
    } else if (result.response === 2) {
      controller.stopAllRunningConversations();
    }

    allowWindowClose = true;
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.close();
    }
  } finally {
    closeGuardPending = false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    title: 'Codex Desk',
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
  allowWindowClose = false;
  closeGuardPending = false;
  applyMenuLanguage(menuLanguage);

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.on('close', (event) => {
    handleWindowCloseGuard(event).catch(() => {});
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerIpc() {
  ipcMain.handle('ui:set-menu-language', async (_, payload) => {
    const language = normalizeLanguage(payload?.language);
    applyMenuLanguage(language);
    return { ok: true, language };
  });

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

  ipcMain.handle('chat:retry-last', async (_, payload) => {
    return controller.retryLastMessage(String(payload?.conversationId || ''));
  });
}

app.whenReady().then(() => {
  menuLanguage = normalizeLanguage(app.getLocale());
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
