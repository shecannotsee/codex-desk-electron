const fs = require('node:fs');
const path = require('node:path');

const packageRoot = path.resolve(__dirname, '..');
const appDir = path.join(packageRoot, 'app');

fs.rmSync(appDir, { recursive: true, force: true });
