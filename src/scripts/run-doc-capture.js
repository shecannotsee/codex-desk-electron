const { spawn } = require('node:child_process');
const path = require('node:path');

const packageRoot = path.resolve(__dirname, '..');
const electron = require('electron');

const child = spawn(electron, ['.', '--docs-capture'], {
  cwd: packageRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    CONDUCTOR_DOC_CAPTURE: '1',
  },
});

child.on('close', (code) => {
  process.exit(Number.isInteger(code) ? code : 1);
});

child.on('error', (error) => {
  console.error(error?.message || String(error));
  process.exit(1);
});
