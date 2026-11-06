const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup() {
  const inputEvents = {}, dropdownEvents = {}, ready = [];
  const input = { value: 'needle', setAttribute() {}, addEventListener: (event, handler) => { inputEvents[event] = handler; } };
  const dropdown = { innerHTML: '', style: {}, addEventListener: (event, handler) => { dropdownEvents[event] = handler; } };
  const document = { addEventListener() {}, querySelectorAll: () => [], querySelector: () => null,
    getElementById: id => id === 'searchInput' ? input : id === 'searchDropdown' ? dropdown : null };
  const window = { location: { href: '', pathname: '/index.html' } };
  const context = vm.createContext({ document, window });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../scripts/scripts.js'), 'utf8'), context);
  document.addEventListener = (event, handler) => { if (event === 'DOMContentLoaded') ready.push(handler); };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../scripts/sidebar.js'), 'utf8'), context);
  ready.forEach(handler => handler());
  return { context, input, dropdown, inputEvents, dropdownEvents, window };
}

test('search suggestions escape stored product names and image attributes', () => {
  const { context, input, dropdown, inputEvents } = setup();
  context.product = { id: '1" onclick="evil()', name: 'needle <svg onload=evil()>',
    img: '/image.png" onerror="evil()', price: '<script>evil()</script>' };
  vm.runInContext('allProducts = {Test: [product]}', context);
  inputEvents.input.call(input);
  assert.ok(!dropdown.innerHTML.includes('<svg') && !dropdown.innerHTML.includes('<script>'));
  assert.ok(dropdown.innerHTML.includes('needle &lt;svg onload=evil()&gt;'));
  assert.ok(dropdown.innerHTML.includes('/image.png&quot; onerror=&quot;evil()'));
  assert.ok(!dropdown.innerHTML.includes('href='));
});

test('sidebar cards use escaped attributes and retain valid product links', () => {
  const { context } = setup();
  const html = context.createProductCard({ id: 42, name: '<img src=x>', img: 'x" onerror="evil()', price: 1000 });
  assert.ok(!html.includes('<img src=x>'));
  assert.ok(html.includes('&lt;img src=x&gt;'));
  assert.ok(html.includes('product-detail.html?id=42'));
  assert.ok(html.includes('1.000 VNĐ'));
});

test('search suggestions use native links with positive integer IDs', () => {
  const { context, input, dropdown, inputEvents } = setup();
  context.product = { id: 7, name: 'Needle', img: '/image.png', price: 10 };
  vm.runInContext('allProducts = {Test: [product]}', context);
  inputEvents.input.call(input);
  assert.ok(dropdown.innerHTML.includes('<a class="search-item" href="product-detail.html?id=7">'));
});
