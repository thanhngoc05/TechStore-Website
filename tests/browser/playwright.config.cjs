const { defineConfig } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
const localPython = path.join(root, '.venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
const python = fs.existsSync(localPython) ? localPython : 'python';

module.exports = defineConfig({
  testDir: '.', testMatch: '*.spec.cjs', workers: 1, retries: 0,
  timeout: 30000, globalTimeout: 180000,
  use: { baseURL: 'http://127.0.0.1:5011', browserName: 'chromium', trace: 'retain-on-failure' },
  webServer: {
    command: `"${python}" tests/browser/server.py`, cwd: root,
    env: { TECHSTORE_BROWSER_TEST: '1' },
    url: 'http://127.0.0.1:5011/api/ready', reuseExistingServer: false,
  },
});
