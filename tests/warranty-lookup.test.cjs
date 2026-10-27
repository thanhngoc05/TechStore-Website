const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function page(verification = 'SERIAL-1', ok = true) {
  const node = value => ({ value, style: {}, classList: { add() {}, remove() {} }, focus() {}, scrollIntoView() {}, innerHTML: '' });
  const nodes = { inputPhone: node('0900000000'), inputPhoneIdentifier: node(verification),
    errPhone: node(''), resultBox: node('') };
  const calls = [];
  const context = vm.createContext({ URLSearchParams,
    window: { apiUrl: p => p }, document: { getElementById: id => nodes[id], querySelectorAll: () => [] },
    fetch: async url => { calls.push(url); return { ok, json: async () => ok
      ? [{ product_name: '<script>product</script>', warranty_code: 'WR-1', serial_imei: '****1234', status: 'active' }]
      : { msg: '<script>error</script>' } }; },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../scripts/warranty-lookup.js'), 'utf8'), context);
  return { nodes, calls, lookup: () => context.handleLookup('phone') };
}

test('warranty requires a second lookup factor before calling API', async () => {
  const p = page(''); await p.lookup();
  assert.equal(p.calls.length, 0);
  assert.equal(p.nodes.errPhone.style.display, 'block');
});
test('warranty submits phone and identifier and escapes product text', async () => {
  const p = page(); await p.lookup();
  assert.match(p.calls[0], /phone=0900000000/);
  assert.match(p.calls[0], /identifier=SERIAL-1/);
  assert.equal(p.nodes.resultBox.innerHTML.includes('<script>'), false);
  assert.ok(p.nodes.resultBox.innerHTML.includes('&lt;script&gt;'));
});
test('warranty escapes error messages', async () => {
  const p = page('SERIAL-1', false); await p.lookup();
  assert.equal(p.nodes.resultBox.innerHTML.includes('<script>'), false);
});
