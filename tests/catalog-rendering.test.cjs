const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup() {
  const home = { innerHTML: '' }, category = { innerHTML: '' };
  const context = vm.createContext({ document: { addEventListener() {}, querySelectorAll: () => [],
    getElementById: id => id === 'home' ? home : id === 'productContainer' ? category : null } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../scripts/scripts.js'), 'utf8'), context);
  return { context, home, category };
}
const product = { id: "1';evil()//", name: '<svg onload=evil()>', img: '/image.png" onerror="evil()',
  price: 1000, oldPrice: 2000, review_count: '<script>evil()</script>', specs: { RAM: '<img src=x onerror=evil()>' } };

test('homepage product cards escape text, image attributes and inline navigation IDs', () => {
  const { context, home } = setup();
  context.renderHomeGrid([product], 'home');
  assert.ok(!home.innerHTML.includes('<svg') && !home.innerHTML.includes('<script>'));
  assert.ok(home.innerHTML.includes('&lt;svg onload=evil()&gt;'));
  assert.ok(home.innerHTML.includes('/image.png&quot; onerror=&quot;evil()'));
  assert.ok(home.innerHTML.includes("product-detail.html?id=0'"));
});

test('category cards escape specifications and preserve normal product links/prices', () => {
  const { context, category } = setup();
  context.renderProducts([{ ...product, id: 42 }]);
  assert.ok(category.innerHTML.includes('&lt;img src=x onerror=evil()&gt;'));
  assert.ok(!category.innerHTML.includes('<svg'));
  assert.ok(category.innerHTML.includes("product-detail.html?id=42'"));
  assert.ok(category.innerHTML.includes('1.000đ'));
});

test('invalid numeric catalog fields cannot introduce markup or script code', () => {
  const { context, home } = setup();
  context.renderHomeGrid([{ ...product, price: '<img src=x>', oldPrice: 0 }], 'home');
  assert.ok(!home.innerHTML.includes('<img src=x>'));
  assert.equal(context.catalogProductId('2.5'), 0);
  assert.equal(context.catalogProductId('17'), 17);
});
