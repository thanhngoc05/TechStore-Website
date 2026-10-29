const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const locations = [{ name: 'Province', districts: [{ name: 'District', wards: [{ name: 'Ward' }] }] }];
function setup() {
  const select = () => ({ options: [{}], disabled: false, value: '',
    get length() { return this.options.length; }, set length(value) { this.options.length = value; },
    add(option) { this.options.push(option); } });
  const elements = { province: select(), district: select(), ward: select(), locationStatus: {},
    locationRetry: {}, addressDetailLabel: {}, detailAddress: { value: '42 Main Street' } };
  const context = vm.createContext({ URLSearchParams,
    Option: function (text, value) { this.text = text; this.value = value; },
    window: { apiUrl: path => path, location: { search: '?id=1' } },
    document: { addEventListener() {}, getElementById: id => elements[id] || null },
    sessionStorage: { removeItem() {} }, console: { warn() {}, error() {} },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../scripts/order-information.js'), 'utf8'), context);
  return { context, elements };
}

test('location outage gives manual-address guidance without losing typed shipping details', async () => {
  const { context, elements } = setup();
  let attempts = 0;
  context.fetchJsonWithTimeout = async () => { attempts++; throw new Error('Offline'); };
  await context.initLocationSelectors();
  assert.equal(attempts, 2);
  assert.equal(elements.locationRetry.hidden, false);
  assert.match(elements.locationStatus.textContent, /nhập địa chỉ đầy đủ/);
  assert.match(elements.addressDetailLabel.textContent, /tỉnh\/thành/);
  assert.equal(elements.detailAddress.value, '42 Main Street');
  assert.equal(elements.province.disabled, true);
  assert.equal(vm.runInContext('locationsLoading', context), false);
});

test('retry recovers selectors without duplicate options or clearing the address', async () => {
  const { context, elements } = setup();
  context.fetchJsonWithTimeout = async () => [];
  await context.initLocationSelectors();
  assert.equal(elements.locationRetry.hidden, false);
  context.fetchJsonWithTimeout = async () => locations;
  await context.initLocationSelectors();
  await context.initLocationSelectors();
  assert.equal(elements.province.options.length, 2);
  assert.equal(elements.province.disabled, false);
  assert.equal(elements.locationRetry.hidden, true);
  assert.equal(elements.addressDetailLabel.textContent, 'Số nhà, tên đường');
  assert.equal(elements.detailAddress.value, '42 Main Street');
  elements.province.value = 'Province';
  elements.province.onchange();
  elements.district.value = 'District';
  elements.district.onchange();
  assert.equal(elements.district.options[1].value, 'District');
  assert.equal(elements.ward.options[1].value, 'Ward');
});

test('repeated retry calls share the active location load', async () => {
  const { context, elements } = setup();
  let release, attempts = 0;
  context.fetchJsonWithTimeout = () => { attempts++; return new Promise(resolve => { release = resolve; }); };
  const pending = context.initLocationSelectors();
  await context.initLocationSelectors();
  assert.equal(attempts, 1);
  assert.equal(elements.province.disabled, true);
  assert.equal(elements.locationRetry.disabled, true);
  release(locations);
  await pending;
  assert.equal(elements.province.disabled, false);
});

test('partially malformed location data cannot leave stale options that block manual shipping', async () => {
  const { context, elements } = setup();
  context.fetchJsonWithTimeout = async () => [locations[0], null];
  await context.initLocationSelectors();
  assert.equal(elements.province.options.length, 1);
  assert.equal(elements.locationRetry.hidden, false);
  assert.equal(elements.detailAddress.value, '42 Main Street');
});
