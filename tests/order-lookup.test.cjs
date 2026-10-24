const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('lookup renders order data and image URLs without inserting user HTML', () => {
  const area = { innerHTML: '' };
  const context = vm.createContext({
    window: { addEventListener() {} },
    document: { readyState: 'loading', addEventListener() {}, querySelectorAll: () => [],
                getElementById: () => area },
    orders: [{ orderCode: 'ORD" onclick="alert(1)', status: 'processing',
      productName: '<script>alert(1)</script>', orderDate: '<svg onload=alert(1)>',
      items: [{ name: '<script>item</script>', quantity: 1 }],
      productImages: ['/image.png" onerror="alert(1)'] }],
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../scripts/Tra_cuu.js'), 'utf8'), context);
  vm.runInContext('cachedOrders = orders; filterOrders("all");', context);
  assert.equal(area.innerHTML.includes('<script>'), false);
  assert.equal(area.innerHTML.includes('<svg'), false);
  assert.ok(area.innerHTML.includes('&lt;script&gt;'));
  assert.ok(area.innerHTML.includes('ORD&quot; onclick=&quot;'));
  assert.ok(area.innerHTML.includes('/image.png&quot; onerror=&quot;'));
});
