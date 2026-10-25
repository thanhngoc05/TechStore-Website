const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function page({ token = 'test-token', conflict = false, denied = false } = {}) {
  function node() {
    return { value: '', disabled: false, hidden: false, textContent: '', children: [], handlers: {},
      options: ['pending', 'reviewing', 'resolved', 'rejected'].map(value => ({ value })),
      addEventListener(event, handler) { this.handlers[event] = handler; },
      replaceChildren() { this.children = []; }, append(child) { this.children.push(child); },
      set innerHTML(value) { throw new Error('Unsafe HTML assignment'); },
    };
  }
  const ids = ['refundQueue', 'refundAdminMessage', 'refundDetail', 'refundTitle', 'refundInfo',
    'refundReviewStatus', 'refundStaffNote', 'refundSave', 'refundAudit', 'refundReviewForm',
    'refundPrev', 'refundNext', 'refundPage', 'refundFilter', 'refundReload', 'refundNotification', 'refundNotifyRetry'];
  const nodes = Object.fromEntries(ids.map(id => [id, node()]));
  nodes.refundFilter.value = 'all';
  const record = { id: 7, order_code: 'ORD-7', status: 'pending', revision: 1,
    bank_name: '<script>bank</script>', account_last4: '3456', account_number: '123456',
    name: '<img onerror=alert(1)>', account_holder: 'Buyer', phone: '0900000000', events: [],
    notification: { state: 'failed', attempts: 1, retry_allowed: true } };
  const calls = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../scripts/admin-refunds.js'), 'utf8'), {
    document: { getElementById: id => nodes[id], createElement: () => node() },
    localStorage: { getItem: () => token }, window: { apiUrl: path => path },
    fetch: async (url, options) => {
      calls.push({ url, options });
      const isPut = options.method === 'PUT';
      const failure = denied || (isPut && conflict);
      const data = failure ? { msg: denied ? 'No access' : 'Reload required' }
        : url.endsWith('/notification') ? { notification: { state: 'sent', attempts: 2, retry_allowed: false }, msg: 'Notification sent' }
        : url.includes('?') ? { items: [record], total: 1 }
        : isPut ? { ...record, revision: 2, status: 'reviewing', staff_note: 'Reviewing' } : record;
      return { ok: !failure, json: async () => data };
    },
  });
  await new Promise(resolve => setImmediate(resolve));
  return { nodes, calls };
}

test('admin opens details as text and submits the expected revision', async () => {
  const p = await page();
  assert.equal(p.nodes.refundQueue.children.length, 1);
  assert.ok(p.nodes.refundQueue.children[0].textContent.includes('<script>bank</script>'));
  await p.nodes.refundQueue.children[0].handlers.click();
  assert.ok(p.nodes.refundInfo.textContent.includes('<img onerror=alert(1)>'));
  p.nodes.refundReviewStatus.value = 'reviewing';
  p.nodes.refundStaffNote.value = 'Reviewing';
  await p.nodes.refundReviewForm.handlers.submit({ preventDefault() {} });
  const update = p.calls.find(call => call.options.method === 'PUT');
  assert.equal(JSON.parse(update.options.body).revision, 1);
  assert.equal(update.options.headers.Authorization, 'Bearer test-token');
  assert.match(p.nodes.refundAdminMessage.textContent, /không thay đổi/);
});

test('stale update displays error without claiming success', async () => {
  const p = await page({ conflict: true });
  await p.nodes.refundQueue.children[0].handlers.click();
  await p.nodes.refundReviewForm.handlers.submit({ preventDefault() {} });
  assert.equal(p.nodes.refundAdminMessage.textContent, 'Reload required');
  assert.equal(p.nodes.refundSave.disabled, false);
});

test('missing login sends no request', async () => {
  const p = await page({ token: null });
  assert.equal(p.calls.length, 0);
  assert.match(p.nodes.refundAdminMessage.textContent, /đăng nhập/);
});

test('non-admin error leaves queue empty', async () => {
  const p = await page({ denied: true });
  assert.equal(p.nodes.refundQueue.children.length, 0);
  assert.equal(p.nodes.refundAdminMessage.textContent, 'No access');
});

test('retry notification preserves unsaved feedback and disables repeat delivery', async () => {
  const p = await page();
  await p.nodes.refundQueue.children[0].handlers.click();
  p.nodes.refundStaffNote.value = 'Unsaved customer feedback';
  await p.nodes.refundNotifyRetry.handlers.click();
  assert.equal(p.nodes.refundStaffNote.value, 'Unsaved customer feedback');
  assert.equal(p.nodes.refundNotifyRetry.disabled, true);
  await p.nodes.refundNotifyRetry.handlers.click();
  assert.equal(p.calls.filter(call => call.url.endsWith('/notification')).length, 1);
  assert.match(p.nodes.refundNotification.textContent, /Đã gửi email/);
});
