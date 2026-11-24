// Drives the real app like a cashier, with a stand-in for the shared database.
// Cloud sessions only (needs Playwright and, on Linux, xvfb):  npm run e2e   (optional: a folder for screenshots)
const { _electron: electron } = require('playwright')
const path = require('node:path')
const fs = require('node:fs')
const os = require('node:os')
const assert = require('node:assert/strict')

const dir = path.resolve(__dirname, '../..')
const shots = process.argv[2]
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'till-e2e-')) // fresh, empty till PC each run

// ---------- the stand-in database ----------
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const uid = '11111111-1111-4111-8111-111111111111', org = '22222222-2222-4222-8222-222222222222'
const exp = Math.floor(Date.now() / 1000) + 3600
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid, role: 'authenticated', exp })}.sig`
const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*', 'access-control-expose-headers': 'content-range' }
const json = (route, body, status = 200) => route.fulfill({ status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(body) })

const products = [
  { id: 'a1', name: 'Coca-Cola Original 500ml', till_name: 'COLA 500ML', barcode: '5000112637922', retail_price: 1.49, vat_rate: 0.2 },
  { id: 'a2', name: 'White Bread 800g', till_name: null, barcode: '0012345678905', retail_price: 1.2, vat_rate: 0 },
  { id: 'a3', name: 'New Biscuits', till_name: null, barcode: '222', retail_price: null, vat_rate: 0.2 },
  { id: 'a4', name: 'Fan Heater 2kW', till_name: null, barcode: '333', retail_price: 21, vat_rate: 0.05 },
  { id: 'a5', name: 'Mystery Tin', till_name: null, barcode: '444', retail_price: 0.99, vat_rate: null },
]
for (let i = products.length; i < 2304; i++) products.push({ id: `f${String(i).padStart(5, '0')}`, name: `Filler product ${i}`, till_name: null, barcode: String(9000000000000 + i), retail_price: 1, vat_rate: null })

const server = {
  offline: false,
  actingOrg: org,
  refuseSales: false, // the database says no (as it would if the row rules rejected the sale)
  failItemsOnce: false, // the connection drops half-way through one sale
  tills: [{ id: 'old-till', name: 'Till 1', receipt_prefix: 'T1' }], // the shop already has a Till 1
  rows: { sales: new Map(), sale_items: new Map(), payments: new Map() },
  posts: 0,
  card: { mode: 'missing', state: 'waiting', checks: 0, started: [] }, // the stand-in card reader
}

function handle(route) {
  const req = route.request(), url = new URL(req.url()), p = url.pathname
  if (server.offline) return route.abort('internetdisconnected')
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
  if (p.startsWith('/auth/v1/token')) return json(route, { access_token: jwt, token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: 'r', user: { id: uid, email: 'owner@example.com', aud: 'authenticated', role: 'authenticated' } })
  if (p.startsWith('/auth/v1/')) return route.fulfill({ status: 204, headers: cors })
  if (p === '/rest/v1/rpc/current_org') return json(route, server.actingOrg)
  if (p === '/rest/v1/orgs') return json(route, { id: org, name: 'Corner Test Shop' })
  if (p === '/rest/v1/memberships') return json(route, { role: 'buyer' })
  if (p === '/rest/v1/products') {
    if (req.method() === 'HEAD') return route.fulfill({ status: 200, headers: { ...cors, 'content-range': `*/${products.length}` }, body: '' })
    const offset = Number(url.searchParams.get('offset') ?? 0), limit = Number(url.searchParams.get('limit') ?? 1000)
    return json(route, products.slice(offset, offset + limit))
  }
  if (p === '/rest/v1/tills') {
    if (req.method() === 'POST') {
      const till = { id: '33333333-3333-4333-8333-333333333333', ...req.postDataJSON() }
      server.tills.push(till)
      return json(route, till, 201)
    }
    return json(route, server.tills)
  }
  if (p === '/functions/v1/till-card') {
    const body = req.postDataJSON(), card = server.card
    if (card.mode === 'missing') return json(route, { code: 'NOT_FOUND', message: 'Requested function was not found' }, 404)
    if (body.action === 'start') { card.state = 'waiting'; card.checks = 0; card.started.push(body); return json(route, { payment_intent_id: 'pi_test_' + card.started.length }) }
    if (body.action === 'cancel') { card.state = 'cancelled'; return json(route, { state: 'cancelled' }) }
    if (++card.checks >= 2 && card.state === 'waiting' && card.mode !== 'hang') card.state = card.mode // the customer takes a moment
    return json(route, card.state === 'approved' ? { state: 'approved', brand: 'visa', last4: '4242' } : card.state === 'declined' ? { state: 'declined', message: 'Insufficient funds.' } : { state: card.state })
  }
  const table = p.replace('/rest/v1/', '')
  if (server.rows[table] && req.method() === 'POST') {
    server.posts++
    if (table === 'sales' && server.refuseSales) return json(route, { code: '42501', message: 'new row violates row-level security policy for table "sales"' }, 403)
    if (table === 'sale_items' && server.failItemsOnce) { server.failItemsOnce = false; return route.abort('connectionreset') }
    for (const row of [].concat(req.postDataJSON())) if (!server.rows[table].has(row.id)) server.rows[table].set(row.id, row) // duplicates ignored, like the real one
    return route.fulfill({ status: 201, headers: cors, body: '' })
  }
  return json(route, [])
}

// ---------- driving the app ----------
let app, win
const errors = []
async function launch() {
  app = await electron.launch({ executablePath: path.join(dir, 'node_modules/electron/dist/electron'), args: ['--no-sandbox', `--user-data-dir=${profile}`, dir], cwd: dir })
  win = await app.firstWindow()
  win.on('pageerror', (e) => errors.push(e.message))
  await win.route('https://gobbuzoypsfbrkayfuod.supabase.co/**', handle)
}
const total = () => win.textContent('[data-testid=total]')
const message = async () => (await win.textContent('.message')).trim()
const lines = async () => (await win.locator('.line').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '))
const scan = async (code) => { await win.keyboard.type(code); await win.keyboard.press('Enter') }
const step = (name) => console.log('ok  ' + name)
const shot = async (name) => { if (shots) await win.screenshot({ path: path.join(shots, name + '.png') }) }
const linkIs = (text) => win.waitForFunction((t) => document.querySelector('[data-testid=link]')?.textContent === t, text, { timeout: 10000 })
const waitingIs = (n, timeout = 10000) => win.waitForFunction((n) => (document.querySelector('[data-testid=waiting]')?.textContent ?? '0').startsWith(String(n)), n, { timeout })
const setNet = async (online) => { server.offline = !online; await win.evaluate((e) => window.dispatchEvent(new Event(e)), online ? 'online' : 'offline') }
const saved = () => win.waitForFunction(() => document.querySelector('.message')?.textContent.includes('Sale saved'))
const alertText = async () => (await win.textContent('.tender [role=alert]')).trim()
const sellCola = async () => { await scan('5000112637922'); await win.click('.pay'); await win.click('.quick >> text=Exact'); await win.click('text=Next customer'); await saved(); return message() }

;(async () => {
  // ----- first start: sign in, connect, download -----
  await launch()
  await win.fill('input[type=email]', 'owner@example.com')
  await win.fill('input[type=password]', 'x')
  await win.click('button[type=submit]')
  await win.waitForSelector('.sell', { timeout: 20000 })
  assert.match(await win.textContent('.topbar'), /Corner Test Shop.*Till 2.*TEST SHOP/)
  assert.deepEqual(server.tills.map((t) => t.receipt_prefix), ['T1', 'T2']); step('first start: registered as Till 2 (Till 1 was taken) and downloaded the products')
  await linkIs('Online'); step('shows Online')

  // ----- the selling screen (Phase 2) -----
  await scan('5000112637922')
  assert.equal(await total(), '£1.49'); assert.match((await lines())[0], /^1 COLA 500ML £1\.49 each · VAT 20% £1\.49$/); step('scan adds the item, using the till name')
  await scan('5000112637922'); assert.equal((await lines()).length, 1); assert.equal(await total(), '£2.98'); step('second scan raises quantity to 2')
  await scan('12345678905'); assert.equal(await total(), '£4.18'); step('barcode found without its leading zeros')
  await scan('7777'); assert.equal(await message(), 'No product with barcode 7777.'); step('unknown barcode is refused with a clear message')
  await scan('222'); assert.match(await message(), /New Biscuits has no price/)
  await scan('250'); assert.equal(await total(), '£6.68'); step('item with no price asks for one, then sells at £2.50')
  await win.keyboard.type('5'); await win.click('.actions >> text=Qty'); assert.equal(await total(), '£16.68'); step('typed quantity applied to the selected line')
  await win.click('.actions >> text=+ 1'); assert.equal(await total(), '£19.18')
  await win.click('.actions >> text=− 1'); assert.equal(await total(), '£16.68'); step('+1 and −1 buttons')
  await win.click('.line >> text=White Bread'); await win.click('text=Void line')
  assert.equal(await total(), '£15.48'); assert.equal(await win.locator('.line.voided').count(), 1); step('void line: struck through, taken off the total')
  await win.click('.actions >> text=Search'); await win.fill('.search input', 'heat fan'); assert.equal(await win.locator('.results button').count(), 1)
  await win.keyboard.type('12'); await win.fill('.search input', 'heater'); await win.click('.results button')
  assert.equal(await total(), '£36.48'); assert.equal((await win.textContent('[data-testid=entry]')).trim(), ''); step('search by name and tap to add')
  await scan('444'); for (const k of ['9', '9']) await win.click(`.keys >> text="${k}"`); await win.click('text=Misc item')
  assert.equal(await total(), '£38.46')
  const vat = (await win.locator('.totals .vat span').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '))
  assert.deepEqual(vat, ['VAT 20%: £2.58 on £15.48', 'VAT 5%: £1.00 on £21.00', 'VAT 0%: £0.00 on £1.98']); step('VAT breakdown by rate is right')
  await win.click('text=Void sale'); await win.click('text=No'); assert.equal(await total(), '£38.46')
  await win.click('text=Void sale'); await win.click('text=Yes, void it'); assert.equal(await total(), '£0.00'); step('void sale asks first, then clears the basket')
  assert.equal(server.rows.sales.size, 0); step('a voided sale sends nothing')

  // ----- a sale while online -----
  await scan('5000112637922'); await scan('5000112637922'); await scan('12345678905'); await scan('444')
  await win.click('.line >> text=White Bread'); await win.click('text=Void line')
  await win.click('.pay')
  assert.equal(await win.textContent('[data-testid=due]'), '£3.97')
  assert.deepEqual(await win.locator('.quick button').allInnerTexts(), ['Exact', '£5', '£10', '£20', '£50'])
  await win.keyboard.type('3'); assert.equal(await win.textContent('[data-testid=change-line]'), '£3.94 short')
  assert.equal(await win.locator('text=Take cash').isDisabled(), true); await win.keyboard.press('Enter') // not enough: Enter does nothing
  await scan('') ; await win.keyboard.type('00') // £3.00, still short
  assert.equal(await win.textContent('[data-testid=change-line]'), '£0.97 short')
  await win.click('.tender .keys >> text="C"'); await win.keyboard.type('500')
  assert.equal(await win.textContent('[data-testid=change-line]'), 'Change £1.03'); step('payment page: cash typed in, shows what is short, then the change')
  await shot('tender')
  await win.keyboard.press('Enter')
  assert.equal(await win.textContent('[data-testid=change]'), '£1.03'); await shot('change')
  await win.click('text=Next customer'); await saved()
  assert.equal(await message(), 'Sale saved: £3.97 cash, £1.03 change. Receipt T2-000001.'); assert.equal(await total(), '£0.00'); assert.equal((await lines()).length, 0)
  step('typing or scanning while paying never adds items to the basket')
  await waitingIs(0)
  const sale1 = [...server.rows.sales.values()][0]
  assert.deepEqual({ ...sale1, id: 0, sold_at: 0 }, { id: 0, org_id: org, till_id: '33333333-3333-4333-8333-333333333333', status: 'completed', total: 3.97, vat_total: 0.5, discount_total: 0, sold_at: 0, receipt_seq: 1, receipt_no: 'T2-000001' })
  const items1 = [...server.rows.sale_items.values()]
  assert.deepEqual(items1.map((i) => [i.line_no, i.product_id, i.quantity, i.line_total, i.vat_rate, i.vat_amount, i.voided]), [[1, 'a1', 2, 2.98, 0.2, 0.5, false], [2, 'a2', 1, 1.2, 0, 0, true], [3, 'a5', 1, 0.99, 0, 0, false]])
  assert.deepEqual([...server.rows.payments.values()].map((p) => [p.sale_id, p.method, p.amount, p.tendered, p.change_given]), [[sale1.id, 'cash', 3.97, 5, 1.03]]); step('online sale: saved, receipt T2-000001, and the database got the sale, its 3 lines (product id + quantity on each) and the payment')

  // ----- internet goes down -----
  await setNet(false); await linkIs('Offline · cash only'); step('internet off: shows "Offline · cash only"')
  assert.match(await sellCola(), /Receipt T2-000002/); assert.match(await sellCola(), /Receipt T2-000003/)
  await waitingIs(2); assert.equal(server.rows.sales.size, 1); step('two sales made offline: saved on the PC, "2 sales waiting to send"')
  await shot('offline')
  await scan('5000112637922'); await win.click('.pay')
  assert.equal(await win.locator('.card-btn').isDisabled(), true); await win.waitForSelector('text=/Offline: card payments need the internet/')
  await win.click('text=Back to basket'); assert.equal(await total(), '£1.49'); await win.click('text=Void sale'); await win.click('text=Yes, void it'); step('offline: the Card button is off with the reason shown; Back to basket keeps the basket')
  await win.click('text=Setup'); await win.waitForSelector('text=Sales waiting to send: 2')
  assert.equal(await win.locator('button:has-text("Disconnect")').isDisabled(), true); step('cannot disconnect the till while sales are waiting')
  await win.click('text=Back to till')

  // ----- power cut: close the app with sales unsent, start it again with no internet -----
  await app.close()
  await launch(); server.offline = true
  await win.waitForSelector('.sell', { timeout: 20000 })
  assert.match(await win.textContent('.topbar'), /Corner Test Shop.*Till 2/); step('restart with no internet: opens straight to the till, no sign-in')
  await waitingIs(2); step('the 2 unsent sales survived the restart')
  assert.match(await sellCola(), /Receipt T2-000004/); await waitingIs(3); step('products work from the local copy and receipt numbers carry on (T2-000004)')

  // ----- internet back, but the connection drops half-way through one sale -----
  server.failItemsOnce = true
  await setNet(true); await waitingIs(0, 40000); await linkIs('Online') // the dropped sale is retried on the next 15-second round
  assert.equal(server.rows.sales.size, 4); assert.equal(server.rows.sale_items.size, 6); assert.equal(server.rows.payments.size, 4)
  assert.deepEqual([...server.rows.sales.values()].map((s) => s.receipt_no).sort(), ['T2-000001', 'T2-000002', 'T2-000003', 'T2-000004'])
  for (const s of server.rows.sales.values()) assert.equal([...server.rows.payments.values()].filter((p) => p.sale_id === s.id).length, 1)
  step('internet back: all sales sent, even with the connection dropping mid-sale; nothing lost, nothing doubled')

  // ----- the database refuses a sale: it must be kept and retried -----
  server.refuseSales = true
  assert.match(await sellCola(), /Receipt T2-000005/)
  await win.waitForSelector('.waiting.bad'); await win.click('text=Setup')
  await win.waitForSelector('text=/1 could not be accepted.*row-level security/'); await shot('refused'); step('a sale the database refuses is kept on the PC and the reason is shown in Setup')
  server.refuseSales = false
  await win.click('text=Send and update now'); await win.waitForSelector('text=Sales waiting to send: 0')
  assert.equal(server.rows.sales.size, 5); step('once accepted it is sent: 5 sales in the database')

  // ----- sign-in switched to another shop: its products must not reach this till -----
  server.actingOrg = '99999999-9999-4999-8999-999999999999'
  await win.click('text=Send and update now'); await win.waitForSelector('text=/working in a different shop/'); step('sign-in acting in another shop: products are not updated, and Setup says why')
  server.actingOrg = org
  await win.click('text=Send and update now'); await win.waitForSelector('text=/fetched every 10 minutes/')
  await win.waitForSelector('text=Product check'); await shot('setup')

  // ----- card payments -----
  await win.click('text=Back to till'); await linkIs('Online')
  await scan('333'); await win.click('.pay'); await win.click('.card-btn')
  await win.waitForSelector('.tender [role=alert]'); assert.equal(await alertText(), 'Card payments are not set up for this till yet.'); step('card, before Stripe is set up: says so plainly, nothing saved')
  server.card.mode = 'declined'; await win.click('.card-btn')
  await win.waitForSelector('text=Ask the customer to tap, insert or swipe their card.'); await shot('card-waiting')
  await win.waitForSelector('text=/Card declined: Insufficient funds/'); assert.equal(server.rows.sales.size, 5); step('card declined: reason shown, nothing saved, can try again or take cash')
  assert.deepEqual({ ...server.card.started[0], sale_id: 0 }, { action: 'start', sale_id: 0, till_id: '33333333-3333-4333-8333-333333333333', amount_pence: 2100 }); step('the amount (£21.00 = 2100p) was sent to the reader automatically')
  server.card.mode = 'hang'; await win.click('.card-btn')
  await win.waitForSelector('text=Ask the customer to tap, insert or swipe their card.'); await win.click('text=Cancel card payment')
  await win.waitForSelector('text=Card payment cancelled. Nothing was charged.'); assert.equal(server.rows.sales.size, 5); step('card cancelled by the cashier: nothing saved')
  server.card.mode = 'approved'; await win.click('.card-btn')
  await win.waitForSelector('text=Card approved'); assert.match(await win.textContent('.tender'), /£21\.00.*visa ending 4242.*receipt T2-000006/); await shot('card-approved')
  await win.click('text=Next customer'); await saved(); assert.equal(await message(), 'Sale saved: £21.00 card. Receipt T2-000006.')
  await waitingIs(0)
  const cardPay = [...server.rows.payments.values()].find((p) => p.method === 'card')
  assert.deepEqual([cardPay.amount, cardPay.tendered, cardPay.change_given, cardPay.stripe_payment_intent_id, cardPay.card_brand, cardPay.card_last4], [21, null, null, 'pi_test_3', 'visa', '4242'])
  assert.equal(cardPay.sale_id, server.card.started[2].sale_id); assert.equal(server.rows.sales.get(cardPay.sale_id).total, 21); step('card approved: sale saved and sent with the card details, matched to the payment the reader took')
  await win.click('text=Setup')

  // ----- disconnect -----
  await win.click('button:has-text("Disconnect")'); await win.click('text=Yes, disconnect')
  await win.waitForSelector('text=Connect this till to a shop'); step('disconnect (nothing waiting) returns to the sign-in page')

  assert.deepEqual(errors, [], 'page errors: ' + errors.join('; '))
  await app.close()
  console.log('ALL PASSED')
})().catch(async (e) => { console.error('FAILED:', e.message); try { await win.screenshot({ path: path.join(os.tmpdir(), 'till-e2e-fail.png') }) } catch {} process.exit(1) })
