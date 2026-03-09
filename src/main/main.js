const fs = require('node:fs');
const path = require('node:path');

const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');

const { AppController } = require('./app_controller');

app.setName('Codex Desk');

let mainWindow = null;
let controller = null;
let menuLanguage = 'zh-CN';
let allowWindowClose = false;
let closeGuardPending = false;
const ZOOM_FACTOR_MIN = 0.5;
const ZOOM_FACTOR_MAX = 2.5;
const ZOOM_FACTOR_STEP = 0.1;
const DOCS_CAPTURE_MODE = process.argv.includes('--docs-capture')
  || ['1', 'true', 'yes', 'on'].includes(String(process.env.CODEX_DESK_DOC_CAPTURE || '').trim().toLowerCase());

function docsAssetsDir() {
  return path.join(__dirname, '..', '..', 'docs', 'assets');
}

function normalizeCaptureFileName(input) {
  const raw = String(input || '').trim();
  if (!raw) {
    return '';
  }
  const safeBase = raw
    .replaceAll('\\', '-')
    .replaceAll('/', '-')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-');
  const withExt = safeBase.toLowerCase().endsWith('.png') ? safeBase : `${safeBase}.png`;
  const normalized = path.basename(withExt);
  if (!normalized || normalized === '.' || normalized === '..') {
    return '';
  }
  return normalized;
}

function resolveAppIconPath() {
  const candidates = [
    path.join(__dirname, '..', 'build', 'icon.png'),
    path.join(__dirname, '..', '..', 'resource', 'logo.png'),
    path.join(process.resourcesPath || '', 'resource', 'logo.png'),
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

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

function clampZoomFactor(input) {
  const value = Number(input);
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(ZOOM_FACTOR_MIN, Math.min(ZOOM_FACTOR_MAX, value));
}

async function invokeUiAction(rawAction) {
  const action = String(rawAction || '').trim();
  if (!action) {
    return { ok: false, error: '无效动作' };
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    return { ok: false, error: '窗口不可用' };
  }

  const wc = mainWindow.webContents;
  switch (action) {
    case 'app:close-window':
      mainWindow.close();
      return { ok: true };
    case 'app:quit':
      app.quit();
      return { ok: true };
    case 'window:minimize':
      mainWindow.minimize();
      return { ok: true };
    case 'window:toggle-fullscreen':
      mainWindow.setFullScreen(!mainWindow.isFullScreen());
      return { ok: true };
    case 'window:exit-fullscreen':
      if (mainWindow.isFullScreen()) {
        mainWindow.setFullScreen(false);
      }
      return { ok: true };
    case 'view:reload':
      wc.reload();
      return { ok: true };
    case 'view:toggle-devtools':
      wc.toggleDevTools();
      return { ok: true };
    case 'view:zoom-reset':
      wc.setZoomFactor(1);
      return { ok: true, zoomFactor: 1 };
    case 'view:zoom-in': {
      const next = clampZoomFactor(wc.getZoomFactor() + ZOOM_FACTOR_STEP);
      wc.setZoomFactor(next);
      return { ok: true, zoomFactor: next };
    }
    case 'view:zoom-out': {
      const next = clampZoomFactor(wc.getZoomFactor() - ZOOM_FACTOR_STEP);
      wc.setZoomFactor(next);
      return { ok: true, zoomFactor: next };
    }
    case 'help:about':
      sendMenuAction('help:about');
      return { ok: true };
    default:
      return { ok: false, error: `未支持的动作: ${action}` };
  }
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
          click: () => sendMenuAction('help:about'),
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

async function handleWindowCloseGuard(event) {
  if (DOCS_CAPTURE_MODE || allowWindowClose || !controller || !mainWindow || mainWindow.isDestroyed()) {
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
  const icon = resolveAppIconPath();
  mainWindow = new BrowserWindow({
    title: 'Codex Desk',
    width: 1460,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    autoHideMenuBar: true,
    icon,
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
  mainWindow.setMenuBarVisibility(false);

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

  ipcMain.handle('ui:invoke-action', async (_, payload) => {
    return invokeUiAction(payload?.action);
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

  ipcMain.handle('docs:capture-enabled', async () => {
    return { ok: true, enabled: DOCS_CAPTURE_MODE };
  });

  ipcMain.handle('docs:capture-page', async (_, payload) => {
    if (!DOCS_CAPTURE_MODE) {
      return { ok: false, error: 'docs capture mode disabled' };
    }
    if (!mainWindow || mainWindow.isDestroyed()) {
      return { ok: false, error: 'window unavailable' };
    }
    const fileName = normalizeCaptureFileName(payload?.fileName);
    if (!fileName) {
      return { ok: false, error: 'invalid file name' };
    }

    const outputDir = docsAssetsDir();
    fs.mkdirSync(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, fileName);
    const safePrefix = path.resolve(outputDir) + path.sep;
    if (!path.resolve(outputPath).startsWith(safePrefix)) {
      return { ok: false, error: 'invalid capture path' };
    }

    const image = await mainWindow.webContents.capturePage();
    fs.writeFileSync(outputPath, image.toPNG());
    return { ok: true, outputPath };
  });

  ipcMain.handle('docs:capture-finish', async () => {
    if (DOCS_CAPTURE_MODE) {
      allowWindowClose = true;
      setTimeout(() => {
        app.quit();
      }, 80);
    }
    return { ok: true };
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
