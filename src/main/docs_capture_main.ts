const fs = require('node:fs');
const path = require('node:path');

const { resolveRepoRoot } = require('./project_paths');

const DOCS_CAPTURE_MODE = process.argv.includes('--docs-capture')
  || ['1', 'true', 'yes', 'on'].includes(String(process.env.CODEX_DESK_DOC_CAPTURE || '').trim().toLowerCase());

function docsAssetsDir() {
  return path.join(resolveRepoRoot(__dirname), 'docs', 'assets');
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

function registerDocsCaptureIpc({
  app,
  ipcMain,
  getMainWindow,
  setAllowWindowClose,
}) {
  ipcMain.handle('docs:capture-enabled', async () => {
    return { ok: true, enabled: DOCS_CAPTURE_MODE };
  });

  ipcMain.handle('docs:capture-page', async (_, payload) => {
    if (!DOCS_CAPTURE_MODE) {
      return { ok: false, error: 'docs capture mode disabled' };
    }
    const mainWindow = getMainWindow();
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
      setAllowWindowClose(true);
      setTimeout(() => {
        app.quit();
      }, 80);
    }
    return { ok: true };
  });
}

module.exports = {
  DOCS_CAPTURE_MODE,
  registerDocsCaptureIpc,
};
