const { app, Menu, shell } = require('electron');

const ZOOM_FACTOR_MIN = 0.5;
const ZOOM_FACTOR_MAX = 2.5;
const ZOOM_FACTOR_STEP = 0.1;

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
    importSession: '导入会话JSONL',
    exportSession: '导出当前会话JSONL',
    renameConversation: '重命名当前对话',
    closeConversation: '关闭当前对话',
    clearChat: '清空当前对话内容',
    clearRuntime: '清空右侧运行日志',
    retryLast: '重试上一条',
    stop: '停止当前任务',
    quit: '退出',

    refreshVersion: '获取 Codex 版本',
    refreshModel: '获取模型',

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
    about: '关于 Conductor',
    aboutMessage: 'Conductor 桌面端',
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
    importSession: 'Import Session JSONL',
    exportSession: 'Export Current Conversation JSONL',
    renameConversation: 'Rename Current Conversation',
    closeConversation: 'Close Current Conversation',
    clearChat: 'Clear Current Chat',
    clearRuntime: 'Clear Runtime Logs',
    retryLast: 'Retry Last',
    stop: 'Stop Current Task',
    quit: 'Quit',

    refreshVersion: 'Refresh Codex Version',
    refreshModel: 'Refresh Model',

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
    about: 'About Conductor',
    aboutMessage: 'Conductor Desktop App',
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

function normalizeTheme(input) {
  return String(input || '').trim().toLowerCase() === 'dark' ? 'dark' : 'light';
}

function themePalette(theme) {
  if (normalizeTheme(theme) === 'dark') {
    return {
      background: '#0b1120',
      titleBarColor: '#0f172a',
      symbolColor: '#dbe4f0',
    };
  }
  return {
    background: '#f4f8fc',
    titleBarColor: '#f8fbff',
    symbolColor: '#223244',
  };
}

function applyWindowTheme(mainWindow, theme) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }
  const palette = themePalette(theme);
  mainWindow.setBackgroundColor(palette.background);
  if (typeof mainWindow.setTitleBarOverlay === 'function') {
    try {
      mainWindow.setTitleBarOverlay({
        color: palette.titleBarColor,
        symbolColor: palette.symbolColor,
      });
    } catch {
      // Ignore unsupported platforms/window managers.
    }
  }
}

function templateText(input, vars = {}) {
  return String(input || '').replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? ''));
}

function isExternalHttpUrl(input) {
  try {
    const target = new URL(String(input || ''));
    return target.protocol === 'http:' || target.protocol === 'https:';
  } catch {
    return false;
  }
}

function openExternalUrl(input) {
  if (!isExternalHttpUrl(input)) {
    return false;
  }
  shell.openExternal(String(input)).catch(() => {});
  return true;
}

function clampZoomFactor(input) {
  const value = Number(input);
  if (!Number.isFinite(value)) {
    return 1;
  }
  return Math.max(ZOOM_FACTOR_MIN, Math.min(ZOOM_FACTOR_MAX, value));
}

function menuText(language) {
  return MENU_TEXT[normalizeLanguage(language)] || MENU_TEXT['zh-CN'];
}

function applyMenuLanguage(language, sendMenuAction) {
  const menuLanguage = normalizeLanguage(language);
  const text = menuText(menuLanguage);

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
        { label: text.importSession, accelerator: 'CmdOrCtrl+Shift+O', click: () => sendMenuAction('conversation:import-session') },
        { label: text.exportSession, accelerator: 'CmdOrCtrl+Shift+S', click: () => sendMenuAction('conversation:export-session') },
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
                applyMenuLanguage('zh-CN', sendMenuAction);
                sendMenuAction('ui:language:zh-CN');
              },
            },
            {
              label: text.languageEn,
              type: 'radio',
              checked: menuLanguage === 'en-US',
              click: () => {
                applyMenuLanguage('en-US', sendMenuAction);
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
  return menuLanguage;
}

async function invokeUiAction(rawAction, mainWindow, sendMenuAction) {
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

module.exports = {
  applyMenuLanguage,
  applyWindowTheme,
  clampZoomFactor,
  invokeUiAction,
  menuText,
  normalizeLanguage,
  normalizeTheme,
  openExternalUrl,
  templateText,
};
