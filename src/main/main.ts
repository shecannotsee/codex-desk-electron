const fs = require('node:fs');
const path = require('node:path');

const { app, BrowserWindow, dialog, ipcMain } = require('electron');

const { AppController } = require('./app_controller');
const { DOCS_CAPTURE_MODE } = require('./docs_capture_main');
const { resolvePackageRoot, resolveRepoRoot } = require('./project_paths');
const { registerAppIpc } = require('./ipc_registration');
const {
  applyMenuLanguage: applyMenuLanguageToApp,
  applyWindowTheme: applyThemeToWindow,
  clampZoomFactor,
  invokeUiAction: invokeWindowUiAction,
  menuText,
  normalizeLanguage,
  normalizeTheme,
  openExternalUrl,
  templateText,
} = require('./menu_window_actions');

app.setName('Codex Desk');

let mainWindow = null;
let controller = null;
let menuLanguage = 'zh-CN';
let allowWindowClose = false;
let closeGuardPending = false;
function applyMenuLanguage(language) {
  menuLanguage = applyMenuLanguageToApp(language, sendMenuAction);
  return menuLanguage;
}

function applyWindowTheme(theme) {
  const normalized = normalizeTheme(theme);
  applyThemeToWindow(mainWindow, normalized);
  return normalized;
}

function invokeUiAction(rawAction) {
  return invokeWindowUiAction(rawAction, mainWindow, sendMenuAction);
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

function sendCloseGuardPrompt(payload) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  mainWindow.webContents.send('app:close-guard', payload || {});
}

function resolveAppIconPath() {
  const packageRoot = resolvePackageRoot(__dirname);
  const repoRoot = resolveRepoRoot(__dirname);
  const candidates = [
    path.join(packageRoot, 'build', 'icon.png'),
    path.join(repoRoot, 'resource', 'logo.png'),
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
    const text = menuText(menuLanguage);
    sendCloseGuardPrompt({
      title: text.closeGuardTitle,
      message: templateText(text.closeGuardMessage, { count: runningCount }),
      detail: text.closeGuardDetail,
      cancelLabel: text.closeGuardCancel,
      stopAndCloseLabel: text.closeGuardStopAndClose,
      forceCloseLabel: text.closeGuardForceClose,
      runningCount,
    });
  } catch {
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
    autoHideMenuBar: false,
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
  mainWindow.setAutoHideMenuBar(false);
  mainWindow.setMenuBarVisibility(false);
  applyWindowTheme('light');
  const wc = mainWindow.webContents;

  wc.setWindowOpenHandler(({ url }) => {
    openExternalUrl(url);
    return { action: 'deny' };
  });
  wc.on('will-navigate', (event, url) => {
    if (!openExternalUrl(url)) {
      return;
    }
    event.preventDefault();
  });
  wc.on('before-input-event', (event, input) => {
    if (
      input
      && input.type === 'keyDown'
      && input.key === 'Alt'
      && !input.control
      && !input.shift
      && !input.meta
    ) {
      event.preventDefault();
      mainWindow.setMenuBarVisibility(false);
    }
  });

  mainWindow.loadFile(path.join(resolvePackageRoot(__dirname), 'app', 'renderer', 'index.html'));

  mainWindow.on('close', (event) => {
    handleWindowCloseGuard(event).catch(() => {});
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function registerIpc() {
  registerAppIpc({
    app,
    dialog,
    ipcMain,
    getMainWindow: () => mainWindow,
    getController: () => controller,
    getMenuLanguage: () => menuLanguage,
    applyMenuLanguage,
    applyWindowTheme,
    clampZoomFactor,
    invokeUiAction,
    getCloseGuardPending: () => closeGuardPending,
    setCloseGuardPending: (value) => {
      closeGuardPending = Boolean(value);
    },
    setAllowWindowClose: (value) => {
      allowWindowClose = Boolean(value);
    },
    waitForRunnersStop,
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

app.on('before-quit', () => {
  controller?.shutdownServices?.();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
