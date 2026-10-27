const { test, expect } = require('@playwright/test');
const { randomUUID } = require('node:crypto');
const password = 'Browser-test-only-42!';

async function createUser(request) {
  const username = `browser-${randomUUID()}`;
  const registered = await request.post('/register', { data: { username, password, email: `${username}@example.com` } });
  expect(registered.status()).toBe(201);
  const login = await request.post('/login', { data: { username, password, required_role: 'user' } });
  expect(login.ok()).toBeTruthy();
  return (await login.json()).access_token;
}
async function authenticate(page, token) {
  await page.addInitScript(token => localStorage.setItem('token', token), token);
}
test.beforeEach(async ({ page }) => {
  await page.route('https://**/*', route => route.abort());
  // Keep address selection deterministic without contacting the external location service.
  await page.route('**/api/public/locations?depth=3', route => route.fulfill({
    json: [{ name: 'Test Province', districts: [{ name: 'Test District', wards: [{ name: 'Test Ward' }] }] }],
  }));
});

test('home displays products loaded from the real API', async ({ page }) => {
  await page.goto('/index.html', { waitUntil: 'domcontentloaded' });
  const product = page.locator('#samsung-grid .product-card').first();
  await expect(product).toBeVisible();
  await product.click();
  await expect(page).toHaveURL(/product-detail\.html\?id=\d+/);
});

test('customer registers and logs in using the visible forms', async ({ page }) => {
  const username = `browser-${randomUUID()}`;
  page.on('dialog', dialog => dialog.accept());
  await page.goto('/register.html');
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await page.locator('#confirm_password').fill(password);
  await page.locator('#email').fill(`${username}@example.com`);
  await page.locator('#phone').fill('0901234567');
  await page.locator('#registerForm button[type=submit]').click();
  await expect(page).toHaveURL(/login\.html$/);
  await page.locator('#username').fill(username);
  await page.locator('#password').fill(password);
  await page.locator('#mainBtn').click();
  await expect(page).toHaveURL(/index\.html$/);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('role'))).toBe('user');
  expect(await page.evaluate(() => localStorage.getItem('token'))).toBeTruthy();
});

test('customer cannot read the admin refund queue', async ({ page, request }) => {
  await authenticate(page, await createUser(request));
  await page.goto('/admin-refunds.html');
  await expect(page.locator('#refundAdminMessage')).toHaveText('Bạn không có quyền Admin');
  await expect(page.locator('#refundQueue')).toBeEmpty();
});

test('admin can load the empty refund queue', async ({ page, request }) => {
  const login = await request.post('/login', { data: { username: 'browser-admin', password, required_role: 'admin' } });
  expect(login.ok()).toBeTruthy();
  await authenticate(page, (await login.json()).access_token);
  await page.goto('/admin-refunds.html');
  await expect(page.locator('#refundAdminMessage')).toHaveText('Không có yêu cầu trong bộ lọc này.');
  await expect(page.locator('#refundPage')).toHaveText('Trang 1 · 0 yêu cầu');
});

test('customer sees their own empty refund history', async ({ page, request }) => {
  await authenticate(page, await createUser(request));
  await page.goto('/refund-requests.html');
  await expect(page.locator('#refundCustomerMessage')).toHaveText('Bạn chưa có yêu cầu hoàn tiền nào.');
  await expect(page.locator('#refundCustomerList')).toBeEmpty();
});

test('a forged paid return cannot create an order or unlock checkout', async ({ page, request }) => {
  const token = await createUser(request);
  const headers = { Authorization: `Bearer ${token}` };
  const countOrders = async () => {
    const response = await request.get('/api/orders/me', { headers });
    expect(response.ok()).toBeTruthy();
    return response.json();
  };
  const before = await countOrders();
  await authenticate(page, token);
  const dialogPromise = page.waitForEvent('dialog');
  await page.goto('/order-information.html?status=PAID&orderCode=999999999999', { waitUntil: 'domcontentloaded' });
  const dialog = await dialogPromise;
  expect(dialog.message()).toContain('Chưa xác minh được thanh toán');
  await dialog.accept();
  await expect(page.locator('#mainNextBtn')).toBeDisabled();
  expect(await countOrders()).toEqual(before);
});

test('customer completes COD checkout once and cancels the order from its detail page', async ({ page, request }) => {
  const token = await createUser(request);
  const headers = { Authorization: `Bearer ${token}` };
  const catalog = await request.get('/api/public/products');
  expect(catalog.ok()).toBeTruthy();
  const product = Object.values(await catalog.json()).flat().find(item => item.price > 0);
  expect(product).toBeTruthy();
  await authenticate(page, token);
  const submittedOrders = [];
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/orders') {
      submittedOrders.push(request.postDataJSON());
    }
  });
  await page.goto(`/order-information.html?id=${product.id}`);
  await expect(page.locator('#province')).toBeEnabled();
  await page.locator('#customerName').fill('Browser Customer');
  await page.locator('#customerPhone').fill('0901234567');
  await page.locator('#customerEmail').fill('checkout@example.com');
  await page.locator('#province').selectOption('Test Province');
  await page.locator('#district').selectOption('Test District');
  await page.locator('#ward').selectOption('Test Ward');
  await page.locator('#detailAddress').fill('42 Test Street');
  await page.locator('#mainNextBtn').click();
  await expect(page.locator('#step-2')).toBeVisible();
  await page.locator('#paymentMethod').selectOption('cod');
  const createdResponse = page.waitForResponse(response =>
    response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/orders');
  await page.locator('#mainNextBtn').click();
  const created = await createdResponse;
  expect(created.status()).toBe(201);
  const { order_code: code } = await created.json();
  expect(code).toBeTruthy();
  await expect(page.locator('#step-3')).toBeVisible();
  await expect(page.locator('#order-summary-card')).toContainText(code);
  expect(submittedOrders).toHaveLength(1);
  expect(submittedOrders[0].idempotency_key).toBeTruthy();
  expect(await page.evaluate(() => sessionStorage.getItem('order_idempotency_key'))).toBeNull();

  const detail = await request.get(`/api/orders/${encodeURIComponent(code)}`, { headers });
  expect(detail.ok()).toBeTruthy();
  expect(await detail.json()).toMatchObject({
    order_code: code, status: 'processing', payment_method: 'cod', total_amount: product.price,
    customer: { name: 'Browser Customer', address: '42 Test Street, Test Ward, Test District, Test Province' },
    items: [{ product_id: product.id, quantity: 1, price: product.price }],
  });

  const dialogs = [];
  page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.accept(); });
  await page.goto(`/order-detail.html?order_code=${encodeURIComponent(code)}`);
  await expect(page.locator('#odCancelBtn')).toBeVisible();
  await page.locator('#odCancelBtn').click();
  await expect(page.locator('#odCancelBtn')).toHaveCount(0);
  expect(dialogs.some(message => message.includes(`Đã hủy đơn ${code} thành công`))).toBeTruthy();
  const history = await request.get('/api/orders/me', { headers });
  expect(history.ok()).toBeTruthy();
  expect(await history.json()).toEqual([expect.objectContaining({ order_code: code, status: 'cancelled' })]);
  expect(submittedOrders).toHaveLength(1);
});

test('shipping validation keeps incomplete addresses and invalid phones out of checkout', async ({ page, request }) => {
  await authenticate(page, await createUser(request));
  const dialogs = [];
  const submittedOrders = [];
  page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.accept(); });
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/orders') submittedOrders.push(request);
  });
  const catalog = await request.get('/api/public/products');
  const product = Object.values(await catalog.json()).flat()[0];
  await page.goto(`/order-information.html?id=${product.id}`);
  await expect(page.locator('#province')).toBeEnabled();
  await page.locator('#customerName').fill('Browser Customer');
  await page.locator('#customerPhone').fill('0901234567');
  await page.locator('#customerEmail').fill('checkout@example.com');
  await page.locator('#province').selectOption('Test Province');
  await page.locator('#detailAddress').fill('42 Test Street');
  await page.locator('#mainNextBtn').click();
  await expect.poll(() => dialogs.length).toBe(1);
  expect(dialogs[0]).toContain('Quận/Huyện và Phường/Xã');
  await expect(page.locator('#step-1')).toBeVisible();

  await page.locator('#district').selectOption('Test District');
  await page.locator('#ward').selectOption('Test Ward');
  await page.locator('#detailAddress').fill('   ');
  await page.locator('#mainNextBtn').click();
  await expect.poll(() => dialogs.length).toBe(2);
  expect(dialogs[1]).toContain('số nhà, tên đường');
  await expect(page.locator('#step-1')).toBeVisible();

  await page.locator('#detailAddress').fill('42 Test Street');
  await page.locator('#customerPhone').fill('not-a-phone');
  await page.locator('#mainNextBtn').click();
  await expect.poll(() => dialogs.length).toBe(3);
  expect(dialogs[2]).toContain('số điện thoại hợp lệ');
  await expect(page.locator('#step-1')).toBeVisible();
  expect(submittedOrders).toHaveLength(0);
  await page.locator('#customerPhone').fill('0901234567');
  await page.locator('#mainNextBtn').click();
  await expect(page.locator('#step-2')).toBeVisible();
  expect(submittedOrders).toHaveLength(0);
});
