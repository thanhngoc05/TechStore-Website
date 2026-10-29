const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup() {
  const next = { disabled: false, innerHTML: 'Continue' };
  const method = { disabled: false }, previous = { disabled: false };
  const elements = { mainNextBtn: next, paymentMethod: method };
  const storage = new Map([['order_idempotency_key', 'original-key']]);
  const alerts = [];
  const context = vm.createContext({ URLSearchParams, console: { error() {} }, alert: msg => alerts.push(msg),
    window: { location: { search: '?id=1' } },
    document: { addEventListener() {}, getElementById: id => elements[id] || null, querySelector: () => previous },
    sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) },
    localStorage: { getItem: () => 'test-token', setItem() {} },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../scripts/order-information.js'), 'utf8'), context);
  vm.runInContext('currentStep = 2', context);
  context._ensureCartItemsLoaded = async () => true;
  context._ensureBuyNowProductLoaded = async () => true;
  context._buildCreateOrderPayloadForCurrentSelection = () => ({ idemKey: 'original-key' });
  context._submitOrderWithIdempotencyRetry = async () => ({ res: { ok: true }, data: { order_code: 'ORD-1' } });
  return { context, next, method, previous, storage, alerts };
}

test('checkout blocks concurrent clicks and navigation while product loading is pending', async () => {
  const { context, next, method, previous } = setup();
  let release, submitted = 0;
  context._ensureBuyNowProductLoaded = () => new Promise(resolve => { release = resolve; });
  context._submitOrderWithIdempotencyRetry = async () => {
    submitted++;
    return { res: { ok: true }, data: { order_code: 'ORD-1' } };
  };
  const pending = context._ensureOrderCreatedBeforePayment();
  await Promise.resolve();
  assert.equal(await context._ensureOrderCreatedBeforePayment(), false);
  assert.ok(next.disabled && method.disabled && previous.disabled);
  context.handlePrev();
  await context.handleNext();
  assert.equal(vm.runInContext('currentStep', context), 2);
  release(true);
  assert.equal(await pending, true);
  assert.equal(submitted, 1);
  assert.ok(!next.disabled && !method.disabled && !previous.disabled);
  assert.equal(next.innerHTML, 'Continue');
});

test('failed prerequisite loading unlocks checkout and preserves its retry key', async () => {
  const { context, next, method, storage, alerts } = setup();
  context._ensureBuyNowProductLoaded = async () => { throw new Error('Load failed'); };
  assert.equal(await context._ensureOrderCreatedBeforePayment(), false);
  assert.ok(!next.disabled && !method.disabled);
  assert.equal(storage.get('order_idempotency_key'), 'original-key');
  assert.equal(alerts.length, 1);
  context._ensureBuyNowProductLoaded = async () => true;
  assert.equal(await context._ensureOrderCreatedBeforePayment(), true);
  assert.equal(storage.has('order_idempotency_key'), false);
});

test('server rejection restores previously disabled controls without discarding the retry key', async () => {
  const { context, next, method, storage } = setup();
  method.disabled = true;
  context._submitOrderWithIdempotencyRetry = async () => ({ res: { ok: false, status: 409 }, data: { msg: 'Conflict' } });
  assert.equal(await context._ensureOrderCreatedBeforePayment(), false);
  assert.equal(method.disabled, true);
  assert.equal(next.disabled, false);
  assert.equal(storage.get('order_idempotency_key'), 'original-key');
});
