const { test, expect } = require('@playwright/test');

const marker = 'window.__catalogXss=true';
const product = {
  id: 101, name: `Needle <img src=x onerror="${marker}">`, brand: '<svg onload=window.__catalogXss=true>',
  img: `missing.png" onerror="${marker}`, price: 1000, oldPrice: 2000, rating: 4, review_count: 2,
  specs: { '<svg>Spec name</svg>': `<img src=x onerror="${marker}">` },
  description: `<h3>Safe heading</h3><p><strong>Safe format</strong></p>
    <p style="position:fixed" onclick="${marker}">Text</p><img src=x onerror="${marker}">
    <script>${marker}</script><svg onload="${marker}"></svg><iframe srcdoc="bad"></iframe>
    <form id="clobber"><input name="token"></form>
    <a href="javascript:${marker}">Bad link</a><a href="https://example.com/info">Safe link</a>`,
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { window.__catalogXss = false; });
  await page.route('https://**/*', route => route.abort());
  await page.route('**/api/public/products', route => route.fulfill({ json: { SamSung: [product] } }));
  await page.route('**/api/public/products/101', route => route.fulfill({ json: { ...product, category: 'SamSung' } }));
  await page.route('**/api/reviews/*', route => route.fulfill({ json: [] }));
});

test('homepage and search display stored product text without creating executable elements', async ({ page }) => {
  await page.goto('/index.html');
  const grid = page.locator('#samsung-grid');
  await expect(grid.locator('.product-name')).toHaveText(product.name);
  await expect(grid.locator('svg,script,img[onerror]')).toHaveCount(0);
  await page.locator('#searchInput').fill('needle');
  const suggestion = page.locator('#searchDropdown .search-item');
  await expect(suggestion.locator('.name')).toHaveText(product.name);
  await expect(suggestion.locator('svg,script,img[onerror]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__catalogXss)).toBe(false);
  await suggestion.click();
  await expect(page).toHaveURL(/product-detail\.html\?id=101$/);
});

test('category specifications stay literal and valid product navigation still works', async ({ page }) => {
  await page.goto('/SamSung.html');
  const card = page.locator('#productContainer .p-card');
  await expect(card.locator('.p-name')).toHaveText(product.name);
  await expect(card.locator('.p-specs')).toContainText(Object.values(product.specs)[0]);
  await expect(card.locator('svg,script,img[onerror]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__catalogXss)).toBe(false);
  await card.click();
  await expect(page).toHaveURL(/product-detail\.html\?id=101$/);
});

test('rich product descriptions retain formatting while removing active markup and unsafe links', async ({ page }) => {
  await page.goto('/product-detail.html?id=101');
  await expect(page.locator('#product-content h1')).toHaveText(`${product.brand} - ${product.name}`);
  await expect(page.locator('#dynamic-breadcrumb strong')).toHaveText(product.name);
  const description = page.locator('.product-description-content');
  await expect(description.getByRole('heading', { name: 'Safe heading', exact: true })).toBeVisible();
  await expect(description.locator('strong')).toHaveText('Safe format');
  await expect(description.locator('script,svg,iframe,form,input,[onerror],[onclick],p[style],#clobber')).toHaveCount(0);
  await expect(description.getByText('Bad link', { exact: true })).not.toHaveAttribute('href');
  await expect(description.getByText('Safe link', { exact: true })).toHaveAttribute('href', 'https://example.com/info');
  await expect(page.locator('.specs-table')).toContainText('<svg>Spec name</svg>');
  await expect(page.locator('.specs-table svg,.specs-table img,.product-main-img[onerror]')).toHaveCount(0);
  expect(await page.evaluate(() => window.DOMPurify.version)).toBe('3.4.17');
  expect(await page.evaluate(() => window.__catalogXss)).toBe(false);
});

test('missing sanitizer falls back to escaped description text', async ({ page }) => {
  await page.route('**/scripts/vendor/purify.min.js', route => route.abort());
  await page.goto('/product-detail.html?id=101');
  const description = page.locator('.product-description-content');
  await expect(page.locator('#product-content h1')).toContainText(product.name);
  await expect(description).toContainText('<h3>Safe heading</h3>');
  await expect(description.locator('script,svg,iframe,form,input,img[onerror]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__catalogXss)).toBe(false);
});

test('detail distinguishes a missing product from a temporary catalog failure', async ({ page }) => {
  await page.route('**/api/public/products/102', route => route.fulfill({ status: 503, json: {} }));
  await page.goto('/product-detail.html?id=102');
  await expect(page.locator('#product-content h2')).toContainText('Không thể tải sản phẩm');
  await page.goto('/product-detail.html?id=2147483647');
  await expect(page.locator('#product-content h2')).toContainText('Sản phẩm không tồn tại');
});

test('account header escapes the username and sign-out clears only session state', async ({ page }) => {
  await page.goto('/index.html');
  await page.evaluate(username => {
    localStorage.setItem('token', 'header-test-token');
    localStorage.setItem('username', username);
    localStorage.setItem('role', 'user');
    localStorage.setItem('storefront-preference', 'keep');
    sessionStorage.setItem('order_idempotency_key', 'old-order');
  }, product.name);
  await page.reload();
  await expect(page.locator('#user-display span')).toHaveText(product.name);
  await expect(page.locator('#user-display img')).toHaveCount(0);
  await expect(page.locator('#user-display #logout-btn')).toHaveCount(0);
  expect(await page.evaluate(() => window.__catalogXss)).toBe(false);
  await page.getByRole('button', { name: 'Đăng xuất' }).click();
  await expect(page.getByRole('button', { name: 'Đăng xuất' })).toHaveCount(0);
  expect(await page.evaluate(() => ({
    token: localStorage.getItem('token'), preference: localStorage.getItem('storefront-preference'),
    checkout: sessionStorage.getItem('order_idempotency_key'),
  }))).toEqual({ token: null, preference: 'keep', checkout: null });
});
