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
    const context = vm.createContext({
      window, alert() {}, console,
      localStorage: { getItem: () => token, removeItem: () => { token = null; } },
      sessionStorage: { removeItem() {} },
      document: { getElementById: id => nodes[id] || null, addEventListener() {} },
      fetch: async (url, options) => {
        calls.push(url);
        return { ok: true, status: 200, json: async () => options.method === 'PUT'
          ? { password_changed: changed } : { username: 'buyer' } };
      },
    });
    for (const script of ['CheckLogin.js', 'profile.js']) {
      vm.runInContext(fs.readFileSync(path.join(__dirname, '../scripts', script), 'utf8'), context);
    }
    await window.updateProfile();
    assert.equal(token, changed ? null : 'test-token');
    assert.equal(window.location.href, changed ? 'login.html' : '');
    assert.equal(calls.length, changed ? 1 : 2);
  });
}

test('profile update clears the account and checkout state when authorization expires', async () => {
  const local = new Map([['token', 'expired'], ['username', 'buyer'], ['role', 'user'], ['preference', 'keep']]);
  const session = new Map([['order_idempotency_key', 'stale']]);
  const window = { location: { href: '' } };
  const context = vm.createContext({
    window, alert() {}, console,
    document: { getElementById: () => null, addEventListener() {} },
    localStorage: { getItem: key => local.get(key), removeItem: key => local.delete(key) },
    sessionStorage: { removeItem: key => session.delete(key) },
    fetch: async () => ({ status: 401 }),
  });
  for (const script of ['CheckLogin.js', 'profile.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../scripts', script), 'utf8'), context);
  }
  await window.updateProfile();
  assert.equal(window.location.href, 'login.html');
  assert.deepEqual([...local], [['preference', 'keep']]);
  assert.equal(session.size, 0);
});
