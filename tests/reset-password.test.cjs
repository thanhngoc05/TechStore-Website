const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function page({ token = 'a'.repeat(43), password = 'new-test-password', confirmation = password,
                ok = true, offline = false } = {}) {
  let submit;
  const nodes = {
    resetPasswordForm: { addEventListener: (event, handler) => { submit = handler; } },
    newPassword: { value: password }, confirmPassword: { value: confirmation },
    resetPasswordButton: { disabled: false }, resetMessage: { textContent: '' },
  };
  const calls = [], history = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../scripts/reset-password.js'), 'utf8'), {
    URLSearchParams, TextEncoder,
    window: { location: { search: token ? '?token=' + token : '', pathname: '/pages/reset-password.html' },
      history: { replaceState: (...args) => history.push(args) }, apiUrl: p => p },
    document: { getElementById: id => nodes[id] },
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (offline) throw new Error('Offline');
      return { ok, json: async () => ({ msg: ok ? 'Updated' : 'Link expired' }) };
    },
  });
  return { nodes, calls, history, submit: () => submit({ preventDefault() {} }) };
}

test('reset sends the token once and removes it from visible URL', async () => {
  const p = page();
  await Promise.all([p.submit(), p.submit()]);
  await p.submit();
  assert.equal(p.calls.length, 1);
  assert.equal(p.calls[0].url, '/api/reset-password');
  assert.equal(JSON.parse(p.calls[0].options.body).token, 'a'.repeat(43));
  assert.equal(p.history[0][2], '/pages/reset-password.html');
  assert.equal(p.nodes.newPassword.value, '');
  assert.equal(p.nodes.resetPasswordButton.disabled, true);
});

test('missing token blocks reset', async () => {
  const p = page({ token: '' });
  await p.submit();
  assert.equal(p.calls.length, 0);
  assert.equal(p.nodes.resetPasswordButton.disabled, true);
});

for (const options of [{ confirmation: 'different' }, { password: 'short' }, { password: 'ể'.repeat(30) }]) {
  test('invalid or mismatched password is checked before sending: ' + JSON.stringify(options), async () => {
    const p = page(options);
    await p.submit();
    assert.equal(p.calls.length, 0);
    assert.ok(p.nodes.resetMessage.textContent.length > 0);
  });
}

for (const options of [{ ok: false }, { offline: true }]) {
  test('failed reset can be retried: ' + JSON.stringify(options), async () => {
    const p = page(options);
    await p.submit();
    assert.equal(p.nodes.resetPasswordButton.disabled, false);
    assert.equal(p.nodes.newPassword.value, 'new-test-password');
  });
}
