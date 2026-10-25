const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for (const changed of [true, false]) {
  test(`profile session handling after password change: ${changed}`, async () => {
    let token = 'test-token';
    const calls = [];
    const nodes = Object.fromEntries(Object.entries({ phone: '0900000000', address: 'Test',
      old_password: changed ? 'old-password' : '', new_password: changed ? 'new-password' : '',
      confirm_password: changed ? 'new-password' : '' }).map(([id, value]) => [id, { value }]));
    const window = { location: { href: '' }, apiUrl: path => path };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../scripts/profile.js'), 'utf8'), {
      window, alert() {}, console,
      localStorage: { getItem: () => token, removeItem: () => { token = null; } },
      document: { getElementById: id => nodes[id] || null, addEventListener() {} },
      fetch: async (url, options) => {
        calls.push(url);
        return { ok: true, status: 200, json: async () => options.method === 'PUT'
          ? { password_changed: changed } : { username: 'buyer' } };
      },
    });
    await window.updateProfile();
    assert.equal(token, changed ? null : 'test-token');
    assert.equal(window.location.href, changed ? 'login.html' : '');
    assert.equal(calls.length, changed ? 1 : 2);
  });
}
