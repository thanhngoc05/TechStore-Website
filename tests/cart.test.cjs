const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function render(items, selection = []) {
  const list = { innerHTML: '', querySelectorAll: () => [] };
  const elements = { cartList: list, cartTotal: {}, checkoutBtn: {}, cartSelectAllRow: { style: {} }, cartSelectAll: {} };
  const storage = new Map([['checkout_selected_cart_item_ids', JSON.stringify(selection)]]);
  const context = vm.createContext({
    document: { addEventListener() {}, getElementById: id => elements[id] },
    sessionStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../scripts/cart.js'), 'utf8'), context);
  context.renderCart(items);
  return elements;
}

test('cart displays product text and image attributes without inserted HTML', () => {
  const elements = render([{ id: '1" onclick="evil()', name: '<svg onload=evil()>',
    img: '/image.png" onerror="evil()', quantity: '<script>evil()</script>', price: 100, subtotal: 100 }]);
  const html = elements.cartList.innerHTML;
  assert.ok(!html.includes('<svg') && !html.includes('<script>'));
  assert.ok(html.includes('&lt;svg onload=evil()&gt;'));
  assert.ok(html.includes('/image.png&quot; onerror=&quot;evil()'));
  assert.ok(html.includes('data-item-id="1&quot; onclick=&quot;evil()"'));
});

test('cart totals only selected products and preserves the checkout state', () => {
  const elements = render([{ id: 1, name: 'A & B', quantity: 2, price: 100, subtotal: 200 },
    { id: 2, name: 'Other product', quantity: 1, price: 999, subtotal: 999 }], [1]);
  assert.equal(elements.cartTotal.textContent, 'Tổng: 200đ');
  assert.equal(elements.checkoutBtn.disabled, false);
  assert.equal(elements.cartSelectAll.indeterminate, true);
  assert.ok(elements.cartList.innerHTML.includes('A &amp; B'));
});
