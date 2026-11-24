// Drives the real app like a cashier, with stand-in database replies.
// Cloud sessions only (needs Playwright and, on Linux, xvfb):  npm run build && xvfb-run -a node test/e2e/selling.e2e.cjs [screenshot.png]
const { _electron: electron } = require('playwright')
const path = require('node:path')
const assert = require('node:assert/strict')

const dir = path.resolve(__dirname, '../..')
const shot = process.argv[2]
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const uid = '11111111-1111-4111-8111-111111111111', org = '22222222-2222-4222-8222-222222222222'
const exp = Math.floor(Date.now() / 1000) + 3600
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, role: 'authenticated', exp })}.sig`
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'content-range' }
const json = (route, body, status = 200) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) })

// 2,304 products: a few real-looking ones, then filler, to prove loading in pages of 1,000 works.
const products = [
  { id: 'a1', name: 'Coca-Cola Original 500ml', till_name: 'COLA 500ML', barcode: '5000112637922', retail_price: 1.49, vat_rate: 0.2 },
  { id: 'a2', name: 'White Bread 800g', till_name: null, barcode: '0012345678905', retail_price: 1.2, vat_rate: 0 },
  { id: 'a3', name: 'New Biscuits', till_name: null, barcode: '222', retail_price: null, vat_rate: 0.2 },
  { id: 'a4', name: 'Fan Heater 2kW', till_name: null, barcode: '333', retail_price: 21, vat_rate: 0.05 },
  { id: 'a5', name: 'Mystery Tin', till_name: null, barcode: '444', retail_price: 0.99, vat_rate: null },
]
for (let i = products.length; i < 2304; i++) products.push({ id: `f${String(i).padStart(5, '0')}`, name: `Filler product ${i}`, till_name: null, barcode: String(9000000000000 + i), retail_price: 1, vat_rate: null })

// A fresh, empty profile each run, so a sign-in left over from the last run cannot interfere.
const profile = require('node:fs').mkdtempSync(path.join(require('node:os').tmpdir(), 'till-e2e-'))

;(async () => {
  const app = await electron.launch({ executablePath: path.join(dir, 'node_modules/electron/dist/electron'), args: ['--no-sandbox', `--user-data-dir=${profile}`, dir], cwd: dir })
  const win = await app.firstWindow()
  const errors = []
  win.on('pageerror', (e) => errors.push(e.message))
  await win.route('https://gobbuzoypsfbrkayfuod.supabase.co/**', (route) => {
    const req = route.request(), url = new URL(req.url()), p = url.pathname
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
    if (p.startsWith('/auth/v1/token')) return json(route, { access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'r', user: { id: uid, email: 'owner@example.com', aud: 'authenticated', role: 'authenticated' } })
    if (p.startsWith('/auth/v1/logout')) return route.fulfill({ status: 204, headers: cors })
    if (p === '/rest/v1/rpc/current_org') return json(route, org)
    if (p === '/rest/v1/orgs') return json(route, { id: org, name: 'Corner Test Shop' })
    if (p === '/rest/v1/memberships') return json(route, { role: 'buyer' })
    if (p === '/rest/v1/products') {
      if (req.method() === 'HEAD') return route.fulfill({ status: 200, headers: { ...cors, 'content-range': `*/${products.length}` }, body: '' })
      const offset = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? 1000)
      return json(route, products.slice(offset, offset + limit))
    }
    return json(route, [])
  })

  const total = () => win.textContent('[data-testid=total]')
  const message = async () => (await win.textContent('.message')).trim()
  const lines = async () => (await win.locator('.line').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '))
  const scan = async (code) => { await win.keyboard.type(code); await win.keyboard.press('Enter') }
  const step = (name) => console.log('ok  ' + name)

  await win.fill('input[type=email]', 'owner@example.com')
  await win.fill('input[type=password]', 'x')
  await win.click('button[type=submit]')
  await win.waitForSelector('.sell', { timeout: 20000 })
  assert.match(await win.textContent('.topbar'), /2,304 products/); step('all 2,304 products loaded across pages')
  assert.equal(await total(), '£0.00')

  await scan('5000112637922')
  assert.equal(await total(), '£1.49'); assert.match((await lines())[0], /^1 COLA 500ML £1\.49 each · VAT 20% £1\.49$/); step('scan adds the item, using the till name')
  await scan('5000112637922')
  assert.equal((await lines()).length, 1); assert.equal(await total(), '£2.98'); step('second scan raises quantity to 2')
  await scan('12345678905')
  assert.equal(await total(), '£4.18'); step('barcode found without its leading zeros')
  await scan('7777')
  assert.equal(await message(), 'No product with barcode 7777.'); assert.equal(await total(), '£4.18'); step('unknown barcode is refused with a clear message')

  await scan('222')
  assert.match(await message(), /New Biscuits has no price/); assert.equal(await total(), '£4.18')
  await scan('250')
  assert.equal(await total(), '£6.68'); step('item with no price asks for one, then sells at £2.50')

  await win.keyboard.type('5'); await win.click('.actions >> text=Qty')
  assert.equal(await total(), '£16.68'); step('typed quantity 5 applied to the selected line')
  await win.click('.actions >> text=+ 1'); assert.equal(await total(), '£19.18')
  await win.click('.actions >> text=− 1'); assert.equal(await total(), '£16.68'); step('+1 and −1 buttons')

  await win.click('.line >> text=White Bread'); await win.click('text=Void line')
  assert.equal(await total(), '£15.48'); assert.equal(await win.locator('.line.voided').count(), 1); step('void line: struck through, taken off the total')

  await win.click('.actions >> text=Search'); await win.fill('.search input', 'heat fan')
  assert.equal(await win.locator('.results button').count(), 1)
  await win.keyboard.type('12') // typing in the search box must not reach the keypad
  await win.fill('.search input', 'heater'); await win.click('.results button')
  assert.equal(await total(), '£36.48'); assert.equal((await win.textContent('[data-testid=entry]')).trim(), ''); step('search by name and tap to add')

  await scan('444')
  for (const k of ['9', '9']) await win.click(`.keys >> text="${k}"`)
  await win.click('text=Misc item')
  assert.equal(await total(), '£38.46'); step('no-VAT-code item sold at 0%, and a 99p misc item from the on-screen keys')

  const vat = (await win.locator('.totals .vat span').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '))
  // 20%: cola 2.98 -> 0.50, biscuits 12.50 -> 2.08 = 2.58 on 15.48. 5%: 21.00 -> 1.00. 0%: 0.99 + 0.99.
  assert.deepEqual(vat, ['VAT 20%: £2.58 on £15.48', 'VAT 5%: £1.00 on £21.00', 'VAT 0%: £0.00 on £1.98']); step('VAT breakdown by rate is right')
  assert.match(await win.textContent('.totals .total'), /^10 items/)
  if (shot) await win.screenshot({ path: shot })

  await win.click('text=Void sale'); await win.click('text=No'); assert.equal(await total(), '£38.46')
  await win.click('text=Void sale'); await win.click('text=Yes, void it')
  assert.equal(await total(), '£0.00'); assert.equal(await win.locator('.line').count(), 0); step('void sale asks first, then clears the basket')

  await win.click('text=Setup'); await win.waitForSelector('.checks li'); await win.click('text=Back to till')
  await win.waitForSelector('.sell'); step('Setup page opens and returns to the till')

  assert.deepEqual(errors, [], 'page errors: ' + errors.join('; '))
  await app.close()
  console.log('ALL PASSED')
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
