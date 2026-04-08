const fs = require('node:fs');
const path = require('node:path');

/**
 * Resolve the source package root regardless of whether the file runs from
 * raw source (`src/main`) or compiled output (`src/app/main`).
 */
function resolvePackageRoot(startDir = __dirname) {
  const current = path.resolve(startDir);
  const candidates = [
    path.resolve(current, '..'),
    path.resolve(current, '..', '..'),
    path.resolve(current, '..', '..', '..'),
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    if (fs.existsSync(path.join(candidate, 'package.json')) && fs.existsSync(path.join(candidate, 'renderer', 'index.html'))) {
      return candidate;
    }
  }

  return path.resolve(current, '..', '..');
}

/**
 * Resolve the repository root for project-level resources such as `docs/`
 * and `resource/`, which live one level above the package root.
 */
function resolveRepoRoot(startDir = __dirname) {
  const packageRoot = resolvePackageRoot(startDir);
  const candidates = [
    path.resolve(packageRoot, '..'),
    packageRoot,
  ];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }
    if (fs.existsSync(path.join(candidate, 'resource')) || fs.existsSync(path.join(candidate, 'docs'))) {
      return candidate;
    }
  }

  return path.resolve(packageRoot, '..');
}

module.exports = {
  resolvePackageRoot,
  resolveRepoRoot,
};
