const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function setup(purifier) {
  const content = { innerHTML: '' }, breadcrumb = { innerHTML: '' };
  const context = vm.createContext({ URLSearchParams,
    window: { location: { search: '?id=1' }, DOMPurify: purifier },
    document: { addEventListener() {}, getElementById: id => id === 'product-content' ? content : id === 'dynamic-breadcrumb' ? breadcrumb : null },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../scripts/product-detail.js'), 'utf8'), context);
  return { context, content, breadcrumb };
}

test('detail renders names, brands, specs, breadcrumbs and image attributes as escaped content', () => {
  const { context, content, breadcrumb } = setup();
  context.renderProductUI({ id: 1, name: '<svg onload=evil()>', brand: '<script>brand</script>',
    img: 'image.png" onerror="evil()', price: '<script>price</script>', review_count: '<svg>count</svg>',
    specs: { '<script>key</script>': '<img src=x onerror=evil()>' }, description: '<img src=x onerror=evil()>' }, '<svg>category</svg>');
  for (const html of [content.innerHTML, breadcrumb.innerHTML]) {
    assert.ok(!html.includes('<svg') && !html.includes('<script>'));
    assert.ok(html.includes('&lt;svg'));
  }
  assert.ok(content.innerHTML.includes('image.png&quot; onerror=&quot;evil()'));
  assert.ok(content.innerHTML.includes('&lt;script&gt;key&lt;/script&gt;'));
  assert.ok(!content.innerHTML.includes('<img src=x onerror=evil()>'));
});

test('description uses an explicit formatting allowlist and falls back to escaped text', () => {
  let options;
  const { context } = setup({ isSupported: true, sanitize: (html, config) => { options = config; return '<p>Clean</p>'; } });
  assert.equal(context.sanitizeProductDescription('<p onclick=evil()>Clean</p>'), '<p>Clean</p>');
  assert.ok(options.ALLOWED_TAGS.includes('p') && options.ALLOWED_TAGS.includes('h3'));
  assert.ok(!options.ALLOWED_TAGS.includes('script') && !options.ALLOWED_ATTR.includes('onclick'));
  assert.equal(options.ALLOW_DATA_ATTR, false);
  assert.equal(setup().context.sanitizeProductDescription('<script>evil()</script>'), '&lt;script&gt;evil()&lt;/script&gt;');
});
