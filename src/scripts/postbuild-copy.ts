const fs = require('node:fs');
const path = require('node:path');

const { resolvePackageRoot } = require('../main/project_paths');

const packageRoot = resolvePackageRoot(__dirname);
const outRoot = path.join(packageRoot, 'app');

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(sourceRelativePath, targetRelativePath = sourceRelativePath) {
  const source = path.join(packageRoot, sourceRelativePath);
  const target = path.join(outRoot, targetRelativePath);
  ensureDir(path.dirname(target));
  fs.copyFileSync(source, target);
}

function copyDir(sourceRelativePath, targetRelativePath = sourceRelativePath) {
  const source = path.join(packageRoot, sourceRelativePath);
  const target = path.join(outRoot, targetRelativePath);
  if (!fs.existsSync(source)) {
    return;
  }
  ensureDir(path.dirname(target));
  fs.cpSync(source, target, { recursive: true });
}

function main() {
  copyFile('renderer/index.html');
  copyFile('renderer/styles.css');
  copyDir('build');
}

main();
