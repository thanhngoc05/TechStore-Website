const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup(search) {
  const list = { innerHTML: '', querySelectorAll: () => [], querySelector: () => null };
  const summary = { innerHTML: '', style: {} };
  const elements = { 'cart-box': {}, 'cart-items': list, 'cart-total': { classList: { add() {} } },
    'order-summary-card': summary };
  const context = vm.createContext({ URLSearchParams,
    window: { location: { search } },
    document: { addEventListener() {}, getElementById: id => elements[id] || null },
    sessionStorage: { getItem: () => null, removeItem() {} }, localStorage: { getItem: () => null },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../scripts/order-information.js'), 'utf8'), context);
  context.product = { id: 1, name: '<svg onload=evil()>', img: '/image.png" onerror="evil()',
    quantity: '<script>evil()</script>', price: 100, subtotal: 100 };
  vm.runInContext('orderData.customer = {name: "<script>customer</script>", address: "<svg>address</svg>"}', context);
  return { context, list, summary };
}

function assertEscaped(html) {
  assert.ok(!html.includes('<svg') && !html.includes('<script>'));
  assert.ok(html.includes('&lt;svg'));
  assert.ok(html.includes('/image.png&quot; onerror=&quot;evil()'));
}

test('buy-now checkout escapes product attributes and customer summary', () => {
  const { context, list, summary } = setup('?id=1');
  vm.runInContext('foundProduct = product', context);
  context.renderCartUI();
  assertEscaped(list.innerHTML);
  context.renderFinalOrder();
  assertEscaped(summary.innerHTML);
  assert.ok(summary.innerHTML.includes('&lt;script&gt;customer&lt;/script&gt;'));
});

test('cart checkout escapes selected product rows and fallback summary', () => {
  const { context, list, summary } = setup('?cart=1');
  vm.runInContext('cartItems = [{...product, id: 1}]', context);
  context.renderCartUI();
  assertEscaped(list.innerHTML);
  context.renderFinalOrder();
  assertEscaped(summary.innerHTML);
  assert.ok(summary.innerHTML.includes('&lt;script&gt;customer&lt;/script&gt;'));
});

test('server-confirmed checkout summary escapes order, product and shipping fields', () => {
  const { context, summary } = setup('?id=1');
  vm.runInContext(`finalOrderDetailCache = {order_code: '<svg>code</svg>', created_at: '<script>date</script>',
    customer: orderData.customer, items: [product], total_amount: 100}`, context);
  context.sessionStorage.getItem = () => '<svg>code</svg>';
  context.renderFinalOrder();
  assertEscaped(summary.innerHTML);
  assert.ok(summary.innerHTML.includes('&lt;script&gt;date&lt;/script&gt;'));
  assert.ok(summary.innerHTML.includes('&lt;svg&gt;code&lt;/svg&gt;'));
});
