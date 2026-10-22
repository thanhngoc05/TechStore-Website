const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../scripts/payment-return.js'), 'utf8');

function page({ search = '?status=PAID&orderCode=123', token = 'test-token',
                response = { payment_status: 'success', order_code: 'ORD-42' },
                ok = true, offline = false } = {}) {
  const calls = [], alerts = [], redirects = [], button = { disabled: false };
  const window = { location: { search, replace: url => redirects.push(url) }, apiUrl: p => p };
  vm.runInNewContext(source, {
    window, URLSearchParams, document: { getElementById: () => button },
    localStorage: { getItem: () => token }, alert: text => alerts.push(text),
    fetch: async (url, options) => {
      calls.push({ url, options });
      if (offline) throw new Error('Offline');
      return { ok, json: async () => response };
    },
  });
  return { window, calls, alerts, redirects, button };
}

test('normal checkout does not call confirmation or disable the button', async () => {
  const p = page({ search: '?id=1' });
  assert.equal(await p.window.handlePayOSReturn(), false);
  assert.equal(p.calls.length, 0);
  assert.equal(p.button.disabled, false);
});

test('confirmation uses authenticated API and its internal order code', async () => {
  const p = page();
  assert.equal(await p.window.handlePayOSReturn(), true);
  assert.equal(p.calls[0].url, '/api/payment/confirm');
  assert.deepEqual(JSON.parse(p.calls[0].options.body), { payment_ref: '123' });
  assert.equal(p.calls[0].options.headers.Authorization, 'Bearer test-token');
  assert.deepEqual(p.redirects, ['order-detail.html?order_code=ORD-42']);
});

test('forged PAID URL does not show success when server says pending', async () => {
  const p = page({ response: { payment_status: 'pending', order_code: 'ORD-42' } });
  await p.window.handlePayOSReturn();
  assert.match(p.alerts[0], /chưa được xác nhận/);
  assert.equal(p.alerts.some(text => text.includes('đã được xác nhận')), false);
});

test('CANCELLED URL cannot override verified payment success', async () => {
  const p = page({ search: '?status=CANCELLED&orderCode=123' });
  await p.window.handlePayOSReturn();
  assert.match(p.alerts[0], /đã được xác nhận/);
});

test('failed payment does not display success', async () => {
  const p = page({ response: { payment_status: 'failed', order_code: 'ORD-42' } });
  await p.window.handlePayOSReturn();
  assert.match(p.alerts[0], /không thành công/);
});

test('missing session asks for login without confirming payment', async () => {
  const p = page({ token: null });
  await p.window.handlePayOSReturn();
  assert.equal(p.calls.length, 0);
  assert.deepEqual(p.redirects, ['login.html']);
});

for (const [name, options] of [
  ['network failure', { offline: true }],
  ['unauthorized response', { ok: false, response: { msg: 'Forbidden' } }],
  ['incomplete response', { response: { payment_status: 'success' } }],
]) {
  test(name + ' keeps checkout disabled without announcing success', async () => {
    const p = page(options);
    await p.window.handlePayOSReturn();
    assert.equal(p.button.disabled, true);
    assert.deepEqual(p.redirects, []);
    assert.match(p.alerts[0], /Chưa xác minh/);
  });
}
