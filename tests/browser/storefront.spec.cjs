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

test('partial cart checkout buys only selected quantities and preserves the other item', async ({ page, request }) => {
  const token = await createUser(request);
  const headers = { Authorization: `Bearer ${token}` };
  const catalog = await request.get('/api/public/products');
  expect(catalog.ok()).toBeTruthy();
  const products = Object.values(await catalog.json()).flat().filter(item => item.price > 0).slice(0, 2);
  expect(products).toHaveLength(2);
  for (const product of products) {
    const added = await request.post('/api/cart', { headers, data: { product_id: product.id, quantity: 1 } });
    expect(added.status()).toBe(201);
  }
  const cartResponse = await request.get('/api/cart', { headers });
  expect(cartResponse.ok()).toBeTruthy();
  const items = await cartResponse.json();
  const selected = items.find(item => item.product_id === products[0].id);
  const unselected = items.find(item => item.product_id === products[1].id);
  await authenticate(page, token);
  await page.goto('/cart.html');
  await expect(page.locator('#cartList .cart-row')).toHaveCount(2);
  await expect(page.locator('#checkoutBtn')).toBeDisabled();
  const row = page.locator(`#cartList .cart-row[data-item-id="${selected.id}"]`);
  await row.locator('.cart-check').check();
  await row.locator('.qty-btn[data-delta="1"]').click();
  await expect(row.locator('.qty-val')).toHaveText('2');
  await expect(page.locator('#cartTotal')).toHaveText(`Tổng: ${(selected.price * 2).toLocaleString('vi-VN')}đ`);
  await page.locator('#checkoutBtn').click();
  await expect(page).toHaveURL(/order-information\.html\?cart=1$/);
  await expect(page.locator('#cart-items .cart-row')).toHaveCount(1);
  await expect(page.locator('#cart-items')).toContainText(selected.name);
  await expect(page.locator('#cart-items')).not.toContainText(unselected.name);
  await expect(page.locator('#province')).toBeEnabled();
  await page.locator('#customerName').fill('Partial Cart Customer');
  await page.locator('#customerPhone').fill('0901234567');
  await page.locator('#customerEmail').fill('partial-cart@example.com');
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
  const payload = created.request().postDataJSON();
  expect(payload.items).toEqual([{ product_id: selected.product_id, quantity: 2 }]);
  expect(payload.clear_cart_item_ids).toEqual([selected.id]);
  expect(payload.clear_cart).not.toBe(true);
  const { order_code: code } = await created.json();
  await expect(page.locator('#order-summary-card')).toContainText(code);
  await expect(page.locator('#order-summary-card')).not.toContainText(unselected.name);
  const detail = await request.get(`/api/orders/${encodeURIComponent(code)}`, { headers });
  expect(detail.ok()).toBeTruthy();
  expect(await detail.json()).toMatchObject({ total_amount: selected.price * 2,
    items: [{ product_id: selected.product_id, quantity: 2, price: selected.price }] });
  const remaining = await request.get('/api/cart', { headers });
  expect(remaining.ok()).toBeTruthy();
  expect(await remaining.json()).toEqual([expect.objectContaining({ id: unselected.id, quantity: 1 })]);
  await page.goto('/cart.html');
  await expect(page.locator('#cartList .cart-row')).toHaveCount(1);
  await expect(page.locator('#cartList')).toContainText(unselected.name);
  await expect(page.locator('#checkoutBtn')).toBeDisabled();
});

test('location outages allow manual shipping and retry preserves entered details', async ({ page, request }) => {
  let recovered = false;
  await page.route('**/api/public/locations?depth=3', route => route.fulfill(recovered
    ? { json: [{ name: 'Test Province', districts: [{ name: 'Test District', wards: [{ name: 'Test Ward' }] }] }] }
    : { status: 503, json: { msg: 'Test location outage' } }));
  await authenticate(page, await createUser(request));
  const catalog = await request.get('/api/public/products');
  expect(catalog.ok()).toBeTruthy();
  const product = Object.values(await catalog.json()).flat()[0];
  await page.goto(`/order-information.html?id=${product.id}`);
  await expect(page.locator('#locationStatus')).toContainText('nhập địa chỉ đầy đủ');
  await expect(page.locator('#province')).toBeDisabled();
  await expect(page.locator('#locationRetry')).toBeVisible();
  await page.locator('#customerName').fill('Manual Address Customer');
  await page.locator('#customerPhone').fill('0901234567');
  await page.locator('#detailAddress').fill('42 Test Street, Test Ward, Test District, Test Province');
  await page.locator('#mainNextBtn').click();
  await expect(page.locator('#step-2')).toBeVisible();
  await page.locator('.order-footer-btns .btn-prev').click();
  recovered = true;
  await page.locator('#locationRetry').click();
  await expect(page.locator('#province')).toBeEnabled();
  await expect(page.locator('#locationRetry')).toBeHidden();
  await expect(page.locator('#province option')).toHaveCount(2);
  await expect(page.locator('#customerName')).toHaveValue('Manual Address Customer');
  await expect(page.locator('#detailAddress')).toHaveValue('42 Test Street, Test Ward, Test District, Test Province');
  await page.locator('#province').selectOption('Test Province');
  await page.locator('#district').selectOption('Test District');
  await page.locator('#ward').selectOption('Test Ward');
  await page.locator('#mainNextBtn').click();
  await expect(page.locator('#step-2')).toBeVisible();
});

test('retry after a lost order response reuses the saved order and request key', async ({ page, request }) => {
  const token = await createUser(request);
  const headers = { Authorization: `Bearer ${token}` };
  await authenticate(page, token);
  const catalog = await request.get('/api/public/products');
  expect(catalog.ok()).toBeTruthy();
  const product = Object.values(await catalog.json()).flat()[0];
  await page.goto(`/order-information.html?id=${product.id}`);
  await expect(page.locator('#province')).toBeEnabled();
  await page.locator('#customerName').fill('Retry Customer');
  await page.locator('#customerPhone').fill('0901234567');
  await page.locator('#customerEmail').fill('retry@example.com');
  await page.locator('#province').selectOption('Test Province');
  await page.locator('#district').selectOption('Test District');
  await page.locator('#ward').selectOption('Test Ward');
  await page.locator('#detailAddress').fill('42 Test Street');
  await page.locator('#mainNextBtn').click();
  await expect(page.locator('#step-2')).toBeVisible();

  let notifyStored, disconnect;
  const stored = new Promise(resolve => { notifyStored = resolve; });
  const allowDisconnect = new Promise(resolve => { disconnect = resolve; });
  const attempts = [], dialogs = [];
  page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.accept(); });
  await page.route('**/api/orders', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    attempts.push(route.request().postDataJSON());
    if (attempts.length > 1) return route.continue();
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    notifyStored(await response.json());
    await allowDisconnect;
    // The DB committed successfully; only the browser's response is lost.
    await route.abort('failed');
  });
  await page.locator('#mainNextBtn').click();
  const original = await stored;
  try {
    await expect(page.locator('#mainNextBtn')).toBeDisabled();
    await expect(page.locator('#paymentMethod')).toBeDisabled();
    await expect(page.locator('.order-footer-btns .btn-prev')).toBeDisabled();
  } finally { disconnect(); }
  await expect.poll(() => dialogs.length).toBe(1);
  await expect(page.locator('#mainNextBtn')).toBeEnabled();
  await expect(page.locator('#step-2')).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('order_idempotency_key'))).toBe(attempts[0].idempotency_key);
  const retriedResponse = page.waitForResponse(response =>
    response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/orders');
  await page.locator('#mainNextBtn').click();
  const retried = await retriedResponse;
  expect(retried.status()).toBe(200);
  expect(await retried.json()).toMatchObject({ order_code: original.order_code, idempotent: true });
  expect(attempts).toHaveLength(2);
  expect(attempts[1]).toEqual(attempts[0]);
  await expect(page.locator('#step-3')).toBeVisible();
  await expect(page.locator('#order-summary-card')).toContainText(original.order_code);
  const history = await request.get('/api/orders/me', { headers });
  expect(history.ok()).toBeTruthy();
  expect(await history.json()).toEqual([expect.objectContaining({ order_code: original.order_code })]);
});
