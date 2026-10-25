const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function page({ token = 'test-token', ok = true, total = 1 } = {}) {
  function node() { return { children: [], handlers: {}, textContent: '', disabled: false,
    replaceChildren() { this.children = []; }, append(...children) { this.children.push(...children); },
    addEventListener(event, handler) { this.handlers[event] = handler; },
    set innerHTML(value) { throw new Error('Unsafe HTML assignment'); },
  }; }
  const nodes = Object.fromEntries(['refundCustomerList', 'refundCustomerMessage', 'refundCustomerPage',
    'refundCustomerReload', 'refundCustomerPrev', 'refundCustomerNext'].map(id => [id, node()]));
  const calls = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../scripts/customer-refunds.js'), 'utf8'), {
    document: { getElementById: id => nodes[id], createElement: () => node() },
    window: { apiUrl: p => p }, localStorage: { getItem: () => token },
    fetch: async (url, options) => {
      calls.push({ url, options });
      return { ok, json: async () => ok ? { total, items: [{ id: 1, order_code: 'ORD&1', status: 'reviewing',
        bank_name: 'Test Bank', account_last4: '6789', account_number: '123456789',
        staff_note: '<script>note</script>', created_at: 'Now' }] } : { msg: 'Please sign in again' } };
    },
  });
  await new Promise(resolve => setImmediate(resolve));
  return { nodes, calls };
}

test('tracking displays feedback as text and uses masked account data', async () => {
  const p = await page();
  const card = p.nodes.refundCustomerList.children[0];
  assert.match(card.children[1].textContent, /Đang kiểm tra/);
  assert.match(card.children[1].textContent, /<script>note<\/script>/);
  assert.match(card.children[1].textContent, /\*\*\*\*6789/);
  assert.equal(card.children[1].textContent.includes('123456789'), false);
  assert.equal(card.children[2].href, 'order-detail.html?order_code=ORD%261');
  assert.equal(p.calls[0].options.headers.Authorization, 'Bearer test-token');
});

test('tracking requires login', async () => {
  const p = await page({ token: null });
  assert.equal(p.calls.length, 0);
  assert.match(p.nodes.refundCustomerMessage.textContent, /đăng nhập/);
});

test('tracking errors clear old data', async () => {
  const p = await page({ ok: false });
  assert.equal(p.nodes.refundCustomerList.children.length, 0);
  assert.equal(p.nodes.refundCustomerMessage.textContent, 'Please sign in again');
});

test('tracking pagination advances and stops at the last page', async () => {
  const p = await page({ total: 50 });
  assert.equal(p.nodes.refundCustomerNext.disabled, false);
  await p.nodes.refundCustomerNext.handlers.click();
  assert.match(p.calls[1].url, /page=2/);
  assert.equal(p.nodes.refundCustomerNext.disabled, true);
  assert.equal(p.nodes.refundCustomerPrev.disabled, false);
});
