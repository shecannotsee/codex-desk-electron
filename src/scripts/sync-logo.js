const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const sourceCandidates = [
  path.resolve(__dirname, '..', '..', 'resource', 'logo.png'),
  path.resolve(__dirname, '..', '..', 'resource', 'logo_with_white_border.png'),
];
const targetDir = path.resolve(__dirname, '..', 'build');
const target = path.resolve(targetDir, 'icon.png');
const tempPrepared = path.resolve(targetDir, 'icon.prepared.png');
const ICON_SIZE = 1024;
const LOGO_SAFE_BOX = 980;

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function findImageTool() {
  const candidates = ['magick', 'convert'];
  for (const cmd of candidates) {
    const result = spawnSync(cmd, ['-version'], { encoding: 'utf-8' });
    if (result.status === 0) {
      return cmd;
    }
  }
  return '';
}

function resolveSourceLogo() {
  for (const candidate of sourceCandidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return '';
}

function runImageTool(cmd, args) {
  const result = spawnSync(cmd, args, { encoding: 'utf-8' });
  if (result.status !== 0) {
    const stderr = String(result.stderr || '').trim();
    const stdout = String(result.stdout || '').trim();
    const detail = stderr || stdout || `exit code ${result.status}`;
    throw new Error(detail);
  }
}

function buildIconWithImageTool(cmd, source) {
  // Source logo is already rounded: preserve source alpha shape and only fit it on standard icon canvas.
  runImageTool(cmd, [
    source,
    '-auto-orient',
    '-background', 'none',
    '-gravity', 'center',
    '-resize', `${LOGO_SAFE_BOX}x${LOGO_SAFE_BOX}>`,
    '-extent', `${ICON_SIZE}x${ICON_SIZE}`,
    tempPrepared,
  ]);

  runImageTool(cmd, [tempPrepared, '-background', 'none', '-alpha', 'set', target]);
}

function cleanupTempFiles() {
  fs.rmSync(tempPrepared, { force: true });
}

function main() {
  ensureDir(targetDir);
  const source = resolveSourceLogo();

  if (!source) {
    if (fs.existsSync(target)) {
      console.warn(`[sync-logo] source not found, keep existing icon: ${target}`);
      return;
    }
    console.error(`[sync-logo] logo not found: ${sourceCandidates.join(' | ')}`);
    process.exit(1);
  }

  const tool = findImageTool();
  try {
    if (tool) {
      buildIconWithImageTool(tool, source);
      console.log(`[sync-logo] source: ${source}`);
      console.log(`[sync-logo] icon updated with preserve-source alpha shape: ${target}`);
    } else {
      fs.copyFileSync(source, target);
      console.log(`[sync-logo] source: ${source}`);
      console.warn('[sync-logo] ImageMagick not found, fallback to raw copy.');
      console.log(`[sync-logo] icon updated: ${target}`);
    }
  } finally {
    cleanupTempFiles();
  }
}

main();
