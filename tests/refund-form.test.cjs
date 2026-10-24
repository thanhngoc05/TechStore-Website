const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function submit({ token = 'test-token', ok = true } = {}) {
  const fields = { orderCode: 'ORD-1', customerName: 'Buyer', customerPhone: '0900000000',
    customerEmail: 'buyer@example.com', bankName: 'Test', bankAccountNumber: '123',
    bankAccountHolder: 'Buyer', refundNote: '' };
  const nodes = Object.fromEntries(Object.entries(fields).map(([id, value]) => [id, { value }]));
  let handler;
  nodes.refundForm = { addEventListener: (event, fn) => { handler = fn; } };
  const calls = [], messages = [];
  const window = { location: { href: 'https://example.com/pages/momo-cancel.html' }, apiUrl: p => p };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../scripts/momo-cancel.js'), 'utf8'), {
    URL, window, localStorage: { getItem: () => token }, alert: text => messages.push(text),
    document: { getElementById: id => nodes[id] || null, addEventListener: (event, fn) => fn() },
    fetch: async (url, options) => { calls.push({ url, options }); return { ok, json: async () => ({ msg: 'Test' }) }; },
    console,
  });
  await handler({ preventDefault() {} });
  return { calls, messages, window };
}

test('refund sends authentication and never automatically cancels an order', async () => {
  const page = await submit();
  assert.equal(page.calls.length, 1);
  assert.equal(page.calls[0].url, '/api/public/refund-request');
  assert.equal(page.calls[0].options.headers.Authorization, 'Bearer test-token');
  assert.match(page.messages[0], /chưa được hủy tự động/);
});

test('refund without login sends no request', async () => {
  const page = await submit({ token: null });
  assert.equal(page.calls.length, 0);
  assert.equal(page.window.location.href, 'login.html');
});

test('failed refund request stays on the form', async () => {
  const page = await submit({ ok: false });
  assert.equal(page.calls.length, 1);
  assert.match(page.messages[0], /thất bại/);
  assert.equal(page.window.location.href, 'https://example.com/pages/momo-cancel.html');
});
