const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('review rendering treats author, date and content as text', async () => {
  const list = { innerHTML: '' };
  const context = vm.createContext({
    URLSearchParams,
    window: { location: { search: '?id=1' }, apiUrl: path => path },
    document: { addEventListener() {}, getElementById: () => list },
    fetch: async () => ({ json: async () => [{
      username: '<img src=x onerror=alert(1)>', date: '<script>alert(2)</script>',
      rating: 5, content: '<svg onload=alert(3)> & "test"',
    }] }),
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../scripts/product-detail.js'), 'utf8'), context);
  await context.loadReviews(1);
  assert.equal(list.innerHTML.includes('<img'), false);
  assert.equal(list.innerHTML.includes('<script'), false);
  assert.equal(list.innerHTML.includes('<svg'), false);
  assert.ok(list.innerHTML.includes('&lt;img'));
  assert.ok(list.innerHTML.includes('&lt;script&gt;'));
  assert.ok(list.innerHTML.includes('&lt;svg'));
  assert.ok(list.innerHTML.includes('&amp; &quot;test&quot;'));
});
