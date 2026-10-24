const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({
  document: { readyState: 'loading', addEventListener() {} },
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../scripts/order-detail.js'), 'utf8'), context);

for (const method of ['cod', 'payos', 'momo']) {
  for (const [status, expected] of [
    ['pending', 'Chờ thanh toán'], ['success', 'Đã thanh toán'],
    ['failed', 'Thất bại'], ['unpaid', 'Chưa thanh toán'],
  ]) {
    test(`${method} ${status} displays server payment status`, () => {
      assert.equal(context.getPaymentStatusTextByMethod(status, method), expected);
    });
  }
}

test('payOS has a readable payment method label', () => {
  assert.equal(context.getPaymentMethodText('payos'), 'Thanh toán qua PayOS');
});

for (const requiresRefund of [true, false]) {
  test(`order cancellation follows server refund decision: ${requiresRefund}`, async () => {
    let click, confirmations = 0;
    const window = { location: { href: '' }, confirm: () => { confirmations++; return false; } };
    const button = { addEventListener: (event, handler) => { click = handler; } };
    const actions = { querySelector: () => button };
    const area = { prepend() {} };
    const context = vm.createContext({ window,
      document: { readyState: 'loading', addEventListener() {}, createElement: () => actions,
                  getElementById: () => area },
    });
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../scripts/order-detail.js'), 'utf8'), context);
    context.renderOrderActions({ order_code: 'ORD-1', status: 'processing',
                                payment_method: 'momo', requires_refund: requiresRefund });
    await click();
    assert.equal(confirmations, requiresRefund ? 0 : 1);
    assert.equal(window.location.href, requiresRefund ? 'momo-cancel.html?order_code=ORD-1' : '');
  });
}
