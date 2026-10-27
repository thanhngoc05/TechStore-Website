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
