const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const sourceCandidates = [
  path.resolve(__dirname, '..', '..', 'resource', 'logo.png'),
  path.resolve(__dirname, '..', '..', 'resource', 'logo_with_white_border.png'),
];
const targetDir = path.resolve(__dirname, '..', 'build');
const target = path.resolve(targetDir, 'icon.png');
const tempTrimmed = path.resolve(targetDir, 'icon.trimmed.png');
const tempMask = path.resolve(targetDir, 'icon.mask.png');

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
  // 1) Trim outer white border, 2) normalize to square canvas, 3) apply round mask.
  runImageTool(cmd, [
    source,
    '-auto-orient',
    '-fuzz', '8%',
    '-trim',
    '+repage',
    '-background', 'none',
    '-gravity', 'center',
    '-resize', '900x900',
    '-extent', '1024x1024',
    tempTrimmed,
  ]);

  runImageTool(cmd, [
    '-size', '1024x1024',
    'xc:none',
    '-fill', 'white',
    '-draw', 'circle 512,512 512,20',
    tempMask,
  ]);

  runImageTool(cmd, [
    tempTrimmed,
    tempMask,
    '-alpha', 'off',
    '-compose', 'copy_opacity',
    '-composite',
    target,
  ]);
}

function cleanupTempFiles() {
  fs.rmSync(tempTrimmed, { force: true });
  fs.rmSync(tempMask, { force: true });
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
      console.log(`[sync-logo] icon updated with trim+round mask: ${target}`);
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
