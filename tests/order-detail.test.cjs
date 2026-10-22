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
