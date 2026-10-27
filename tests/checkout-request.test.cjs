const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for (const status of [201, 409, 429, 500]) {
  test(`checkout status ${status} does not generate or retry a new order key`, async () => {
    const calls = [], window = { apiUrl: p => p };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../scripts/checkout-request.js'), 'utf8'), {
      window, fetch: async (url, options) => {
        calls.push(options);
        return { status, ok: status === 201, json: async () => ({ msg: 'Test response' }) };
      },
    });
    const build = { token: 'test-token', idemKey: 'original-key', payload: { items: [] } };
    const result = await window.submitCheckoutRequest(build);
    assert.equal(result.res.status, status);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].headers['Idempotency-Key'], 'original-key');
    assert.equal(build.idemKey, 'original-key');
    await window.submitCheckoutRequest(build);
    assert.equal(calls[1].headers['Idempotency-Key'], 'original-key');
  });
}
