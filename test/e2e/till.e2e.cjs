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
const printJobs = fs.mkdtempSync(path.join(os.tmpdir(), 'till-jobs-')) // the stand-in printer: each job lands here as a file
const jobs = () => fs.readdirSync(printJobs).sort().map((f) => fs.readFileSync(path.join(printJobs, f)))
const KICK = Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa])

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
  { id: 'a6', name: 'Bread roll', till_name: null, barcode: null, retail_price: 0.45, vat_rate: 0 },
  { id: 'a7', name: 'Daily Mirror', till_name: null, barcode: null, retail_price: 1.3, vat_rate: 0 },
]
for (let i = products.length; i < 2304; i++) products.push({ id: `f${String(i).padStart(5, '0')}`, name: `Filler product ${i}`, till_name: null, barcode: String(9000000000000 + i), retail_price: 1, vat_rate: null })

const server = {
  offline: false,
  actingOrg: org,
  refuseSales: false, // the database says no (as it would if the row rules rejected the sale)
  failItemsOnce: false, // the connection drops half-way through one sale
  tills: [{ id: 'old-till', name: 'Till 1', receipt_prefix: 'T1' }], // the shop already has a Till 1
  rows: { sales: new Map(), sale_items: new Map(), payments: new Map(), refunds: new Map(), refund_items: new Map(), audit_log: new Map(), day_sessions: new Map() },
  staff: [],
  posts: 0,
  shopSettings: [],
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
  if (p === '/rest/v1/shop_settings') {
    if (req.method() === 'POST') { server.shopSettings = [req.postDataJSON()]; return json(route, [{ org_id: org }], 201) }
    return json(route, server.shopSettings)
  }
  if (p === '/rest/v1/staff') {
    if (req.method() === 'POST') { const row = { id: `staff-${server.staff.length + 1}`, active: true, ...req.postDataJSON() }; server.staff.push(row); return json(route, [{ id: row.id }], 201) }
    if (req.method() === 'PATCH') { const row = server.staff.find((r) => `eq.${r.id}` === url.searchParams.get('id')); Object.assign(row, req.postDataJSON()); return json(route, [{ id: row.id }]) }
    return json(route, server.staff)
  }
  const table = p.replace('/rest/v1/', '')
  if (server.rows[table] && req.method() === 'GET') return json(route, [...server.rows[table].values()])
  if (table === 'day_sessions' && req.method() === 'PATCH') { // close a day: only one that is still open, as the real rule says
    const row = server.rows.day_sessions.get(url.searchParams.get('id').replace('eq.', ''))
    if (row && !row.closed_at) Object.assign(row, req.postDataJSON())
    return route.fulfill({ status: 204, headers: cors })
  }
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
  app = await electron.launch({ executablePath: path.join(dir, 'node_modules/electron/dist/electron'), args: ['--no-sandbox', `--user-data-dir=${profile}`, dir], cwd: dir, env: { ...process.env, TILL_PRINT_TO_FILE: printJobs } })
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
const because = async (reason) => { await win.click(`.approval >> text="${reason}"`); await win.waitForSelector('.approval', { state: 'detached' }); await win.waitForTimeout(250) } // the log entry is written, then the screen changes
const audits = (action) => [...server.rows.audit_log.values()].filter((a) => a.action === action)
const pin = async (digits) => { await win.keyboard.type(digits); await win.keyboard.press('Enter') }
const openSetup = async () => { await win.click('.topbar >> text=Menu'); await win.click('.approval >> text=Setup') }
const totalIs = (t) => win.waitForFunction((t) => document.querySelector('[data-testid=total]')?.textContent === t, t, { timeout: 10000 })
const saved = () => win.waitForFunction(() => document.querySelector('.message')?.textContent.includes('Sale saved'))
const alertText = async () => (await win.textContent('.tender [role=alert]')).trim()
const sellCola = async () => { await scan('5000112637922'); await win.click('.pay.by-cash'); await win.click('.quick >> text=Exact'); await win.click('text=Next customer'); await saved(); return message() }

;(async () => {
  // ----- first start: sign in, connect, download -----
  await launch()
  await win.fill('input[type=email]', 'owner@example.com')
  await win.fill('input[type=password]', 'x')
  await win.click('button[type=submit]')
  await win.waitForSelector('text=Start the day', { timeout: 20000 })
  await win.keyboard.type('5000'); assert.equal(await win.textContent('[data-testid=money]'), '£50.00'); await win.keyboard.press('Enter') // Enter starts the day
  await win.waitForSelector('.sell')
  assert.match(await win.textContent('.topbar'), /Corner Test Shop.*Till 2.*TEST SHOP/); await waitingIs(0)
  const day1 = [...server.rows.day_sessions.values()][0]
  assert.deepEqual({ ...day1, id: 0, opened_at: 0 }, { id: 0, org_id: org, till_id: '33333333-3333-4333-8333-333333333333', z_number: 1, opened_at: 0, opened_by: null, opening_float: 50 }); step('start the day with a £50 float: the trading day is opened and sent')
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
  await scan('5000112637922'); assert.equal(await total(), '£16.68') // a scan while the reason box is open adds nothing
  await because('Scanned by mistake')
  assert.equal(await total(), '£15.48'); assert.equal(await win.locator('.line.voided').count(), 1); step('void line: struck through, taken off the total')
  await win.click('.tabs >> text=Search'); await win.fill('.search-box', 'heat fan'); assert.equal(await win.locator('.tile').count(), 1)
  await win.keyboard.type('12'); await win.fill('.search-box', 'heater'); await win.click('.tile'); await win.click('.tabs >> text=No barcode')
  assert.equal(await total(), '£36.48'); assert.equal((await win.textContent('[data-testid=entry]')).trim(), ''); step('search by name and tap to add')
  await scan('444'); for (const k of ['9', '9']) await win.click(`.keys >> text="${k}"`); await win.click('.misc')
  assert.equal(await total(), '£38.46')
  const vat = (await win.locator('.totals .vat span').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '))
  assert.deepEqual(vat, ['VAT 20%: £2.58 on £15.48', 'VAT 5%: £1.00 on £21.00', 'VAT 0%: £0.00 on £1.98']); step('VAT breakdown by rate is right')
  await win.click('text=Void sale'); await win.click('.approval >> text=Cancel'); assert.equal(await total(), '£38.46')
  await win.click('text=Void sale'); await because('Customer changed their mind'); assert.equal(await total(), '£0.00'); step('void sale asks why first, then clears the basket')
  assert.equal(server.rows.sales.size, 0); step('a voided sale sends nothing')

  // ----- the product buttons and the Card button on the selling screen -----
  assert.deepEqual(await win.locator('.tile span').allInnerTexts(), ['Bread roll', 'Daily Mirror'])
  await win.click('.tile >> text=Bread roll'); await win.click('.tile >> text=Bread roll'); await win.click('.tile >> text=Daily Mirror')
  assert.equal(await total(), '£2.20'); assert.match((await lines())[0], /^2 Bread roll/); step('No barcode tab: one tap sells bread and papers')
  await shot('selling')
  await win.click('.pay.by-card'); assert.equal(await win.textContent('[data-testid=card-amount]'), '£2.20'); step('Card on the selling screen goes straight to the card-machine step')
  await win.click('text=No, declined or cancelled'); await win.click('text=Back to basket'); await win.click('text=Void sale'); await because('Scanned by mistake')
  assert.equal(server.rows.sales.size, 0)

  // ----- a sale while online -----
  await scan('5000112637922'); await scan('5000112637922'); await scan('12345678905'); await scan('444')
  await win.click('.line >> text=White Bread'); await win.click('text=Void line'); await because('Wrong item or price')
  await win.click('.pay.by-cash')
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
  assert.equal(sale1.day_session_id, day1.id)
  assert.deepEqual({ ...sale1, id: 0, sold_at: 0 }, { id: 0, org_id: org, till_id: '33333333-3333-4333-8333-333333333333', day_session_id: day1.id, staff_id: null, status: 'completed', total: 3.97, vat_total: 0.5, discount_total: 0, sold_at: 0, receipt_seq: 1, receipt_no: 'T2-000001' })
  const items1 = [...server.rows.sale_items.values()]
  assert.deepEqual(items1.map((i) => [i.line_no, i.product_id, i.quantity, i.line_total, i.vat_rate, i.vat_amount, i.voided]), [[1, 'a1', 2, 2.98, 0.2, 0.5, false], [2, 'a2', 1, 1.2, 0, 0, true], [3, 'a5', 1, 0.99, 0, 0, false]])
  assert.deepEqual([...server.rows.payments.values()].map((p) => [p.sale_id, p.method, p.amount, p.tendered, p.change_given]), [[sale1.id, 'cash', 3.97, 5, 1.03]]); step('online sale: saved, receipt T2-000001, and the database got the sale, its 3 lines (product id + quantity on each) and the payment')
  assert.deepEqual([...server.rows.audit_log.values()].map((a) => [a.action, a.reason, a.amount, a.staff_id]), [['void_line', 'Scanned by mistake', 1.2, null], ['void_sale', 'Customer changed their mind', 38.46, null], ['void_sale', 'Scanned by mistake', 2.2, null], ['void_line', 'Wrong item or price', 1.2, null]])
  assert.equal(audits('void_line')[0].details.name, 'White Bread 800g'); step('audit log: both voided lines and the voided sale were logged with reason, amount and time, and sent')

  // ----- internet goes down -----
  await setNet(false); await linkIs('Offline'); step('internet off: shows "Offline"')
  assert.match(await sellCola(), /Receipt T2-000002/); assert.match(await sellCola(), /Receipt T2-000003/)
  await waitingIs(2); assert.equal(server.rows.sales.size, 1); step('two sales made offline: saved on the PC, "2 sales waiting to send"')
  await shot('offline')
  await scan('5000112637922'); await win.click('.pay.by-cash')
  assert.equal(await win.locator('.card-btn').isDisabled(), false); await win.waitForSelector('text=/If the card machine itself is still working/')
  await win.click('text=Back to basket'); assert.equal(await total(), '£1.49'); await win.click('text=Void sale'); await because('Scanned by mistake'); await waitingIs(3); step('offline: cards can still be taken if the card machine works on its own; Back to basket keeps the basket')
  await openSetup(); await win.waitForSelector('text=Waiting to send: 3')
  assert.equal(await win.locator('button:has-text("Disconnect")').isDisabled(), true); step('cannot disconnect the till while sales are waiting')
  await win.click('text=Back to till')

  // ----- power cut: close the app with sales unsent, start it again with no internet -----
  await app.close()
  await launch(); server.offline = true
  await win.waitForSelector('.sell', { timeout: 20000 })
  assert.match(await win.textContent('.topbar'), /Corner Test Shop.*Till 2/); step('restart with no internet: opens straight to the till, no sign-in')
  await waitingIs(3); step('the 2 unsent sales and the unsent log entry survived the restart')
  assert.match(await sellCola(), /Receipt T2-000004/); await waitingIs(4); step('products work from the local copy and receipt numbers carry on (T2-000004)')

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
  await win.waitForSelector('.waiting.bad'); await openSetup()
  await win.waitForSelector('text=/1 could not be accepted.*row-level security/'); await shot('refused'); step('a sale the database refuses is kept on the PC and the reason is shown in Setup')
  server.refuseSales = false
  await win.click('text=Send and update now'); await win.waitForSelector('text=Waiting to send: 0')
  assert.equal(server.rows.sales.size, 5); step('once accepted it is sent: 5 sales in the database')

  // ----- sign-in switched to another shop: its products must not reach this till -----
  server.actingOrg = '99999999-9999-4999-8999-999999999999'
  await win.click('text=Send and update now'); await win.waitForSelector('text=/working in a different shop/'); step('sign-in acting in another shop: products are not updated, and Setup says why')
  server.actingOrg = org
  await win.click('text=Send and update now'); await win.waitForSelector('text=/fetched every 10 minutes/')
  await win.waitForSelector('text=Product check'); await shot('setup')

  // ----- card payments on the shop's own card machine -----
  await win.click('text=Back to till'); await linkIs('Online')
  await scan('333'); await win.click('.pay.by-cash'); await win.click('.card-btn')
  assert.equal(await win.textContent('[data-testid=card-amount]'), '£21.00'); await shot('card-confirm')
  await scan('5000112637922'); await win.keyboard.press('Enter'); await win.waitForTimeout(300)
  assert.equal(server.rows.sales.size, 5); assert.equal(await win.locator('text=Did the card machine say APPROVED?').count(), 1); step('card: shows the amount to key into the card machine; a scan or the Enter key can never count as "approved"')
  await win.click('text=No, declined or cancelled'); assert.match(await alertText(), /Card not taken, so nothing was saved/); assert.equal(server.rows.sales.size, 5); step('card declined on the machine: nothing saved, try again or take cash')
  await win.click('.card-btn'); await win.click('text=Yes, approved'); await win.waitForSelector('text=Paid by card')
  await win.click('text=Next customer'); await saved(); assert.equal(await message(), 'Sale saved: £21.00 card. Receipt T2-000006.'); await waitingIs(0)
  const cardPay = [...server.rows.payments.values()].find((x) => x.method === 'card')
  assert.deepEqual([cardPay.amount, cardPay.tendered, cardPay.change_given, cardPay.stripe_payment_intent_id, cardPay.card_brand], [21, null, null, null, null]); assert.equal(server.rows.sales.get(cardPay.sale_id).total, 21); step('card approved on the machine: sale saved and sent as a card sale')
  assert.equal(jobs().length, 0); step('with no printer chosen, sales go through and nothing is sent to a printer')

  // ----- receipt printer and cash drawer -----
  await openSetup()
  await win.selectOption('[data-testid=printer-kind]', 'network'); await win.fill('[data-testid=printer-host]', '192.168.1.50')
  await win.click('text=Print test receipt'); await win.waitForSelector('text=/Check the test receipt came out/')
  assert.equal(jobs().length, 1); assert.ok(jobs()[0].includes('Printer test')); assert.ok(!jobs()[0].includes(KICK)); step('Setup: choose a network printer, print a test receipt')
  await win.click('button:has-text("Test drawer")'); await win.waitForSelector('text=/The drawer should have opened/')
  assert.deepEqual([...jobs()[1]], [0x1b, 0x40, ...KICK]); step('Setup: Test drawer sends the drawer-open signal')
  await win.fill('[data-testid=shop-name]', 'Corner Shop Ltd'); await win.fill('[data-testid=shop-address]', '1 High Street\nLeeds LS1 1AA')
  await win.fill('[data-testid=shop-vat]', 'GB123456789'); await win.fill('[data-testid=shop-footer]', 'Thank you!')
  await win.click('text=Save receipt details'); await win.waitForSelector('text=/Every till in this shop will print these/')
  assert.deepEqual({ ...server.shopSettings[0], updated_at: 0 }, { org_id: org, trading_name: 'Corner Shop Ltd', address: '1 High Street\nLeeds LS1 1AA', vat_number: 'GB123456789', receipt_footer: 'Thank you!', updated_at: 0 }); step('receipt details saved for the whole shop')
  await shot('hardware')
  await win.click('text=Back to till')

  await scan('5000112637922'); await scan('5000112637922'); await win.click('.pay.by-cash'); await win.click('.quick >> text="£5"')
  await win.waitForSelector('text=Receipt printed.')
  const receipt = jobs()[2], words = receipt.toString('latin1')
  assert.deepEqual([...receipt.subarray(2, 7)], [...KICK])
  for (const part of ['Corner Shop Ltd', '1 High Street', 'Leeds LS1 1AA', 'VAT No. GB123456789', 'Receipt T2-000007', 'COLA 500ML', '2 x \x9c1.49', 'TOTAL', '\x9c2.98', 'Cash', '\x9c5.00', 'Change', '\x9c2.02', '20% on \x9c2.48 net', '\x9c0.50', 'Thank you!']) assert.ok(words.includes(part), 'receipt is missing: ' + part)
  step('cash sale: drawer opens first, then the receipt prints with shop details, items, total, cash, change and VAT')
  await win.click('text=Print a copy'); await win.waitForFunction((n) => true, 0); await win.waitForTimeout(300)
  assert.equal(jobs().length, 4); assert.ok(jobs()[3].includes('** COPY **')); assert.ok(!jobs()[3].includes(KICK)); step('Print a copy: marked COPY, drawer stays shut')
  await win.click('text=Next customer'); await saved()

  await scan('333'); await win.click('.pay.by-cash'); await win.click('.card-btn'); await win.click('text=Yes, approved'); await win.waitForSelector('text=Receipt printed.')
  assert.equal(jobs().length, 5); assert.ok(jobs()[4].toString('latin1').includes('Card') && jobs()[4].toString('latin1').includes('\x9c21.00')); assert.ok(!jobs()[4].includes(KICK)); step('card sale: receipt prints, drawer stays shut')
  await win.click('text=Next customer'); await saved()

  // ----- staff, PINs, manager-only actions, refunds -----
  assert.equal(audits('void_sale').length, 3)
  await scan('5000112637922'); await win.keyboard.type('99'); await win.click('.actions >> text=Price')
  await win.waitForSelector('text=/no manager has been set up yet/'); await win.click('.approval >> text=Cancel'); assert.equal(await total(), '£1.49')
  await win.click('text=Void sale'); await because('Scanned by mistake'); step('before any staff exist: selling needs no PIN, manager-only actions are refused')

  await openSetup()
  const addStaff = async (name, role, code) => { await win.fill('[data-testid=staff-name]', name); await win.selectOption('[data-testid=staff-role]', role); await win.fill('[data-testid=staff-pin]', code); await win.click('.add-staff >> text=Add'); await win.waitForSelector(`text=${name} was added.`) }
  await addStaff('Amy', 'manager', '1234'); await addStaff('Bob', 'cashier', '5678')
  assert.deepEqual(server.staff.map((r) => [r.name, r.role, r.pin_hash.length, r.pin_salt.length]), [['Amy', 'manager', 64, 32], ['Bob', 'cashier', 64, 32]])
  assert.ok(!JSON.stringify(server.staff).includes('1234') && !JSON.stringify(server.staff).includes('5678')); step('Setup: added a manager and a cashier; their PINs are stored scrambled, never as typed')
  await shot('staff')
  await win.click('text=Back to till'); await win.waitForSelector('text=Who is using the till?'); await shot('gate')
  await scan('5000112637922') // a scan on the lock page does nothing
  await win.click('.tiles >> text=Bob'); await pin('0000'); await win.waitForSelector('text=Wrong PIN.')
  await pin('5678'); await win.waitForSelector('.sell'); assert.equal(await win.textContent('[data-testid=who]'), 'Bob'); assert.equal(await total(), '£0.00'); step('the till is now locked until someone signs in; wrong PIN refused; Bob signs in')

  await scan('5000112637922'); await win.keyboard.type('99'); await win.click('.actions >> text=Price')
  await win.waitForSelector('text=A manager needs to allow this. Which manager?'); assert.deepEqual(await win.locator('.approval .tiles button').allInnerTexts().then((t) => t.map((x) => x.split('\n')[0])), ['Amy'])
  await win.click('.approval .tiles >> text=Amy'); await pin('9999'); await win.waitForSelector('text=Wrong PIN.'); assert.equal(await total(), '£1.49')
  await pin('1234'); await win.waitForSelector('text=Allowed by Amy'); await shot('approval'); await because('Reduced to clear')
  assert.equal(await total(), '£0.99'); assert.match((await lines())[0], /£0\.99 each \(was £1\.49\)/); step('price change by a cashier: needs a manager PIN and a reason; line shows the old price')
  await win.click('.pay.by-cash'); await win.click('.quick >> text=Exact'); await win.click('text=Next customer'); await saved(); await waitingIs(0)
  const over = audits('price_override')[0], bobSale = [...server.rows.sales.values()].find((x) => x.receipt_no === 'T2-000009')
  assert.deepEqual([over.staff_id, over.approved_by, over.reason, over.amount, over.details.from, over.details.to], ['staff-2', 'staff-1', 'Reduced to clear', 0.99, 1.49, 0.99])
  assert.equal(bobSale.staff_id, 'staff-2'); assert.deepEqual([...server.rows.sale_items.values()].filter((i) => i.sale_id === bobSale.id).map((i) => [i.unit_price, i.original_unit_price]), [[0.99, 1.49]]); step('the sale records who sold it and the original price; the log records who changed it, who allowed it and why')

  const before = jobs().length
  await win.click('.topbar >> text=Menu'); await win.click('text=Open drawer (no sale)'); await win.click('.approval .tiles >> text=Amy'); await pin('1234'); await because('Giving change')
  await win.waitForSelector('text=Drawer opened. This has been logged.'); assert.deepEqual([...jobs()[before]], [0x1b, 0x40, ...KICK]); await waitingIs(0)
  assert.deepEqual(audits('no_sale').map((a) => [a.staff_id, a.approved_by, a.reason]), [['staff-2', 'staff-1', 'Giving change']]); step('open drawer with no sale: manager PIN, reason, drawer opens, logged')

  await win.click('.topbar >> text=Menu'); await win.click('.approval >> text=Refund (with a receipt)')
  await win.fill('[data-testid=refund-receipt]', '7'); await win.click('.tender button:has-text("Find")')
  await win.waitForSelector('text=Refund from receipt T2-000007'); await win.click('.stepper >> text="+"'); await win.click('.stepper >> text="+"')
  assert.equal(await win.textContent('[data-testid=refund-qty]'), '2 of 2'); await win.click('.stepper >> text="−"'); await shot('refund')
  await win.click('text=Refund £1.49 in cash'); await win.click('.approval .tiles >> text=Amy'); await pin('1234'); await because('Faulty or damaged')
  await win.waitForSelector('text=Refund slip printed.'); assert.equal(await win.textContent('[data-testid=refund-total]'), '£1.49')
  const slip = jobs()[before + 1]; assert.deepEqual([...slip.subarray(2, 7)], [...KICK]); for (const part of ['REFUND', 'Refund T2-R000001', 'For receipt T2-000007', 'COLA 500ML', '-\x9c1.49', 'Reason: Faulty or damaged']) assert.ok(slip.toString('latin1').includes(part), 'refund slip is missing: ' + part)
  await win.click('.done >> text=Done'); await waitingIs(0)
  const refund = [...server.rows.refunds.values()][0], sale7 = [...server.rows.sales.values()].find((x) => x.receipt_no === 'T2-000007')
  assert.deepEqual([refund.sale_id, refund.receipt_no, refund.total, refund.vat_total, refund.method, refund.reason, refund.staff_id, refund.approved_by], [sale7.id, 'T2-R000001', 1.49, 0.25, 'cash', 'Faulty or damaged', 'staff-2', 'staff-1'])
  assert.deepEqual([...server.rows.refund_items.values()].map((i) => [i.refund_id, i.product_id, i.quantity, i.line_total, i.return_to_stock]), [[refund.id, 'a1', 1, 1.49, true]])
  assert.deepEqual(audits('refund').map((a) => [a.refund_id, a.sale_id, a.amount, a.approved_by]), [[refund.id, sale7.id, 1.49, 'staff-1']]); step('refund of 1 of 2 colas: manager PIN and reason, drawer opens, slip prints, database gets the refund with product and quantity, and it is logged')
  await win.click('.topbar >> text=Menu'); await win.click('.approval >> text=Refund (with a receipt)'); await win.click('.results >> text=T2-000007')
  await win.waitForSelector('text=/1 already refunded/'); assert.equal(await win.textContent('[data-testid=refund-qty]'), '0 of 1'); await win.click('text=Different receipt'); await win.click('.tender >> text=Close'); step('the same receipt again: only the 1 cola not yet refunded can be refunded')

  await win.click('.topbar >> text=Menu'); await win.click('.approval >> text=Refund (with a receipt)'); await win.fill('[data-testid=refund-receipt]', '8'); await win.click('.tender button:has-text("Find")')
  await win.waitForSelector('text=Refund from receipt T2-000008'); await win.click('.stepper >> text=All'); const slips = jobs().length
  await win.click('text=Refund £21.00 to the card (on the card machine)'); await win.click('.approval .tiles >> text=Amy'); await pin('1234'); await because('Faulty or damaged')
  assert.equal(await win.textContent('[data-testid=card-amount]'), '£21.00'); assert.equal(server.rows.refunds.size, 1)
  await win.click('text=Yes, refunded'); await win.waitForSelector('text=Refunded to the card'); await win.waitForSelector('text=Refund slip printed.')
  assert.ok(!jobs()[slips].includes(KICK) && jobs()[slips].includes('Paid back to card')); await win.click('.done >> text=Done'); await waitingIs(0)
  assert.deepEqual([...server.rows.refunds.values()].map((r) => [r.method, r.total]), [['cash', 1.49], ['card', 21]]); step('card refund: manager allows it, cashier does it on the card machine and confirms; saved as a card refund, drawer stays shut')

  await win.click('.topbar >> text=Menu'); await win.click('text=Lock the till'); await win.waitForSelector('text=Who is using the till?')
  await win.click('.tiles >> text=Amy'); await pin('1234'); await win.waitForSelector('.sell')
  await scan('5000112637922'); await win.keyboard.type('50'); await win.click('.actions >> text=Price'); await win.waitForSelector('text=Allowed by Amy'); await because('Damaged packaging')
  assert.equal(await total(), '£0.50'); await win.click('text=Void sale'); await because('Scanned by mistake'); step('lock the till; a manager signed in changes a price with a reason but no second PIN')

  // ----- X and Z reports -----
  await waitingIs(0)
  const pence = (x) => Math.round(x * 100), allPay = [...server.rows.payments.values()]
  const cashP = allPay.filter((x) => x.method === 'cash').reduce((t, x) => t + pence(x.amount), 0), cardP = allPay.filter((x) => x.method === 'card').reduce((t, x) => t + pence(x.amount), 0)
  const salesP = [...server.rows.sales.values()].reduce((t, x) => t + pence(x.total), 0), gbp = (n) => '£' + (n / 100).toFixed(2)
  assert.equal(salesP, cashP + cardP)
  await win.click('.topbar >> text=Menu'); await win.click('text=Reports (X and Z)'); await win.click('.reasons >> text=X report')
  await win.waitForSelector('[data-testid=report]'); await win.waitForSelector('text=Report printed.')
  const xText = await win.textContent('[data-testid=report]')
  for (const part of ['X REPORT', 'Z number 1', `Sales (${server.rows.sales.size},`, gbp(salesP), gbp(cashP), gbp(cardP), 'Refunds (2)', '-£22.49', `Voided lines (${audits('void_line').length})`, `Voided sales (${audits('void_sale').length})`, 'Discounts and reductions (1)', 'Should be in the drawer', gbp(5000 + cashP - 149)]) assert.ok(xText.includes(part), 'X report is missing: ' + part)
  assert.ok(jobs()[jobs().length - 1].includes('X REPORT')); await shot('x-report')
  await win.click('.report >> text=Back'); step('X report: totals match every sale and payment in the database; it prints; nothing is reset')
  assert.equal([...server.rows.day_sessions.values()][0].closed_at, undefined)

  await win.click('.reasons >> text=Z report'); await win.waitForSelector('text=Z report: count the cash')
  await win.keyboard.type(String(5000 + cashP - 149 + 100)); await win.click('.approval >> text=Next')
  await win.waitForSelector("text=Z report: the card machine's total"); await win.keyboard.type(String(cardP - 2100)); await win.click('text=Close the day')
  await win.waitForSelector('text=The day is closed. Start a new day when you are ready to sell again.'); await win.waitForSelector('text=Report printed.')
  const zText = await win.textContent('[data-testid=report]'); assert.ok(zText.includes('Z REPORT') && /Over by\s+£1\.00/.test(zText) && zText.includes('They match')); await shot('z-report')
  assert.ok(jobs()[jobs().length - 1].includes('Z REPORT'))
  await win.click('.report >> text=Back'); await win.click('.tender >> text=Close'); await win.waitForSelector('text=Start the day'); await waitingIs(0)
  const closed = [...server.rows.day_sessions.values()][0], rep = closed.report
  assert.ok(closed.closed_at); assert.equal(closed.closed_by, 'staff-1'); assert.equal(pence(closed.counted_cash), 5000 + cashP - 149 + 100)
  assert.deepEqual([rep.kind, rep.zNumber, rep.sales.count, rep.sales.totalPence, rep.payments.cashPence, rep.payments.cardPence, rep.refunds.totalPence, rep.refunds.vatPence, rep.noSales, rep.discounts.count, rep.discounts.pence, rep.voids.lineCount, rep.voids.saleCount],
    ['Z', 1, server.rows.sales.size, salesP, cashP, cardP, 2249, 125, 1, 1, 50, audits('void_line').length, audits('void_sale').length])
  assert.deepEqual(rep.drawer, { floatPence: 5000, cashSalesPence: cashP, cashRefundsPence: 149, expectedPence: 5000 + cashP - 149, countedPence: 5000 + cashP - 49, differencePence: 100 })
  assert.deepEqual(rep.cardCheck, { tillPence: cardP - 2100, machinePence: cardP - 2100, differencePence: 0 })
  assert.equal(rep.vat.reduce((t, v) => t + v.grossPence, 0), salesP); assert.equal(audits('z_report').length, 1); assert.equal(audits('x_report')[0].details.report.sales.totalPence, salesP)
  step('Z report: counted cash £1 over is shown; the card machine total matches the till; the day is closed; the full report is saved in the database for the retail app; both reports are logged')

  await win.click('text=Past reports'); await win.click('.results >> text=Z number 1'); await win.waitForSelector('[data-testid=report]')
  assert.equal(await win.textContent('[data-testid=report]'), zText); await win.click('.report >> text=Back'); await win.click('.tender >> text=Close'); step('the closed day cannot be sold into; its Z report can be opened again, unchanged')
  await win.click('button:has-text("Start the day")'); await win.waitForSelector('.sell'); await waitingIs(0)
  assert.deepEqual([...server.rows.day_sessions.values()].map((d) => [d.z_number, !!d.closed_at, d.opening_float]), [[1, true, 50], [2, false, 0]]); step('a new day starts as Z number 2')

  // ----- discounts, split payment, parked sales, refund with no receipt (day 2, Amy the manager signed in) -----
  let jobCount = jobs().length
  await scan('5000112637922'); await scan('5000112637922'); await win.click('.actions >> text=Discount')
  await win.waitForSelector('text=This line: COLA 500ML'); await shot('discount'); await win.click('.approval .quick >> text="10%"'); await because('Reduced to clear')
  assert.equal(await total(), '£2.68'); assert.match((await lines())[0], /10% off, saves £0\.30/); assert.match(await win.textContent('[data-testid=saved]'), /saved £0\.30/); step('discount: 10% off one line, manager and reason, the basket shows the saving')
  await scan('333'); await win.keyboard.type('50'); await win.click('.actions >> text=Discount'); await win.click('.approval >> text=The whole sale'); await win.click('.approval >> text="50% off"'); await because('Staff discount')
  assert.equal(await total(), '£11.99'); step('discount: a typed 50% off the whole sale replaces it on every line')
  await win.click('.pay.by-cash'); await win.keyboard.type('500'); await win.click('text=Take £5.00 cash, rest later')
  assert.equal(await win.textContent('[data-testid=due]'), '£6.99'); assert.match(await win.textContent('[data-testid=parts]'), /£5\.00 cash of £11\.99/); await shot('split')
  await win.click('text=Undo part payments'); await win.waitForSelector('text=£5.00 in cash'); await win.click('text=Carry on taking payment')
  await win.click('.card-btn'); assert.equal(await win.textContent('[data-testid=card-amount]'), '£6.99'); await win.click('text=Yes, approved')
  await win.waitForSelector('text=Receipt printed.'); assert.equal(await win.textContent('[data-testid=split]'), 'Paid as £5.00 cash + £6.99 card'); await win.click('text=Next customer'); await saved(); await waitingIs(0)
  const splitSale = [...server.rows.sales.values()].find((x) => x.receipt_no === 'T2-000010'), splitPays = [...server.rows.payments.values()].filter((x) => x.sale_id === splitSale.id)
  assert.deepEqual([splitSale.total, splitSale.discount_total], [11.99, 11.99]); assert.deepEqual(splitPays.map((x) => [x.method, x.amount, x.tendered, x.change_given]), [['cash', 5, 5, 0], ['card', 6.99, null, null]])
  assert.deepEqual([...server.rows.sale_items.values()].filter((i) => i.sale_id === splitSale.id).map((i) => [i.quantity, i.unit_price, i.discount_amount, i.line_total]), [[2, 1.49, 1.49, 1.49], [1, 21, 10.5, 10.5]])
  const splitReceipt = jobs()[jobCount].toString('latin1'); assert.ok(jobs()[jobCount].includes(KICK)); for (const part of ['Discount', '-\x9c1.49', 'You saved', '\x9c11.99', 'Cash', '\x9c5.00', 'Card', '\x9c6.99']) assert.ok(splitReceipt.includes(part), 'split receipt is missing: ' + part)
  assert.deepEqual(audits('discount').map((a) => [a.amount, a.reason, a.approved_by, a.details.scope]), [[0.3, 'Reduced to clear', 'staff-1', 'line'], [11.99, 'Staff discount', 'staff-1', 'sale']]); step('split payment: £5 cash then the rest on card; one sale, two payments, discounts on the receipt and in the log')

  await scan('5000112637922'); await win.click('.actions >> text="Park"'); await totalIs('£0.00'); assert.equal(await win.textContent('[data-testid=parked]'), 'Parked (1)')
  await win.click('.topbar >> text=Menu'); await win.click('text=Reports (X and Z)'); await win.click('.reasons >> text=Z report')
  await win.waitForSelector('text=/1 parked sale is still waiting/'); await win.click('.tender >> text=Close'); step('park a sale: basket clears; the day cannot be closed while a sale is parked')
  await scan('12345678905'); await win.click('.pay.by-cash'); await win.click('.quick >> text=Exact'); await win.click('text=Next customer'); await saved()
  await win.click('[data-testid=parked]'); await shot('parked'); await win.click('.results >> text=COLA 500ML'); await totalIs('£1.49'); assert.equal(await win.textContent('[data-testid=parked]'), 'Parked')
  await win.click('.pay.by-cash'); await win.click('.quick >> text=Exact'); await win.click('text=Next customer'); await saved(); await waitingIs(0); assert.equal(server.rows.sales.size, 12); step('serve another customer, then bring the parked sale back and finish it')

  jobCount = jobs().length
  await scan('444'); await win.click('.topbar >> text=Menu'); await win.click('text=Refund the items in the basket (no receipt)'); await because('Faulty or damaged')
  await totalIs('£0.00'); assert.equal(await message(), 'Refunded £0.99 in cash with no receipt. Slip T2-R000003.'); await waitingIs(0)
  const loose = [...server.rows.refunds.values()].find((r) => r.receipt_no === 'T2-R000003')
  assert.deepEqual([loose.sale_id, loose.method, loose.total, loose.approved_by], [null, 'cash', 0.99, 'staff-1']); assert.deepEqual([...server.rows.refund_items.values()].filter((i) => i.refund_id === loose.id).map((i) => [i.sale_item_id, i.product_id, i.quantity]), [[null, 'a5', 1]])
  assert.ok(jobs()[jobCount].includes(KICK) && jobs()[jobCount].includes('No receipt')); assert.equal(server.rows.sales.size, 12); step('refund with no receipt: scan the item, manager and reason, cash back, slip says "No receipt", no sale is made')

  fs.rmSync(printJobs, { recursive: true, force: true }) // the printer "breaks"
  await scan('5000112637922'); await win.click('.pay.by-cash'); await win.click('.quick >> text=Exact')
  await win.waitForSelector('text=/The sale is saved, but the printer did not respond/'); await shot('printer-failed')
  await win.click('text=Next customer'); await saved(); assert.match(await message(), /Receipt T2-000013/); await waitingIs(0)
  assert.equal([...server.rows.sales.values()].find((x) => x.receipt_no === 'T2-000013').day_session_id, [...server.rows.day_sessions.values()][1].id)
  assert.equal(server.rows.sales.size, 13); step('printer broken: the sale is still saved and sent, and the cashier is told the receipt did not print')
  await openSetup()

  // ----- disconnect -----
  await win.click('button:has-text("Disconnect")'); await win.click('text=Yes, disconnect')
  await win.waitForSelector('text=Connect this till to a shop'); step('disconnect (nothing waiting) returns to the sign-in page')

  assert.deepEqual(errors, [], 'page errors: ' + errors.join('; '))
  await app.close()
  console.log('ALL PASSED')
})().catch(async (e) => { console.error('FAILED:', e.message); try { await win.screenshot({ path: path.join(os.tmpdir(), 'till-e2e-fail.png') }) } catch {} process.exit(1) })
