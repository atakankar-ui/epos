import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalDb } from '../src/main/db'
import { addMiscItem, addProduct, emptyBasket, overridePrice, setQty, voidLine } from '../src/shared/basket'
import { buildSale } from '../src/shared/sale'
import { buildRefund } from '../src/shared/refund'
import { auditRow } from '../src/shared/audit'
import { buildReport, reportLines } from '../src/shared/report'
import { toText } from '../src/shared/escpos'
import type { Binding } from '../src/shared/local'
import type { Product } from '../src/shared/products'

const cola: Product = { id: 'p1', name: 'Cola', barcode: '111', pricePence: 149, vatRate: 0.2 }
const bread: Product = { id: 'p2', name: 'Bread', barcode: '222', pricePence: 120, vatRate: 0 }
const heater: Product = { id: 'p3', name: 'Heater', barcode: '333', pricePence: 2100, vatRate: 0.05 }
const binding: Binding = { orgId: 'org', orgName: 'Test Shop', userId: 'u', email: 'e', tillId: 'till', tillName: 'Till 1', receiptPrefix: 'T1' }
const shop = { name: 'Corner Shop', address: null, vatNumber: 'GB123456789', footer: null }

let dir: string, db: LocalDb, n = 0
const newId = () => `id-${++n}`
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'till-db-')); db = new LocalDb(join(dir, 'till.sqlite')); db.bind(binding) })
afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }) })

const at = (hhmm: string) => new Date(`2026-11-24T${hhmm}:00Z`)
const log = (action: Parameters<typeof auditRow>[0]['action'], amountPence: number | null, when: Date) =>
  db.logAudit(auditRow({ id: newId(), orgId: 'org', tillId: 'till', at: when, staffId: null, action, reason: 'r', amountPence }))

// A small but complete day: 3 sales (2 cash, 1 card), a price cut, voids, a no-sale and a part refund.
function tradeADay() {
  const day = db.openDay({ id: 'day-1', openedBy: null, floatPence: 5000, at: at('08:00').toISOString() })
  // Sale 1, cash: 3 colas (£4.47, VAT 75p) + bread (£1.20, 0%); a second bread scanned then voided.
  let b = setQty(addProduct(emptyBasket, cola, 'a').basket, 'a', 3)
  b = addProduct(b, bread, 'b').basket
  b = voidLine(addProduct(b, { ...bread, id: 'p9' }, 'c').basket, 'c')
  log('void_line', 120, at('09:01'))
  const s1 = db.saveSale(buildSale({ basket: b, orgId: 'org', tillId: 'till', soldAt: at('09:02'), tender: { method: 'cash', tenderedPence: 1000 }, newId }))
  // Sale 2, card: a heater (£21.00, VAT £1.00).
  db.saveSale(buildSale({ basket: addProduct(emptyBasket, heater, 'a').basket, orgId: 'org', tillId: 'till', soldAt: at('10:00'), tender: { method: 'card' }, newId }))
  // Sale 3, cash: 2 colas reduced from £1.49 to £1.00 (£2.00, VAT 33p) + a 50p misc item.
  let c = overridePrice(setQty(addProduct(emptyBasket, cola, 'a').basket, 'a', 2), 'a', 100)
  c = addMiscItem(c, 50, 'b')
  log('price_override', 100, at('11:00'))
  db.saveSale(buildSale({ basket: c, orgId: 'org', tillId: 'till', soldAt: at('11:01'), tender: { method: 'cash', tenderedPence: 250 }, newId }))
  // An abandoned basket, a drawer opening, and one cola from sale 1 refunded in cash.
  log('void_sale', 899, at('12:00'))
  log('no_sale', null, at('12:30'))
  db.saveRefund(buildRefund({ record: s1, picks: { [s1.items[0].id]: 1 }, already: {}, reason: 'Faulty', staffId: null, approvedBy: null, returnToStock: true, orgId: 'org', tillId: 'till', at: at('13:00'), newId }))
  log('refund', 149, at('13:00'))
  return day
}

describe('X and Z report figures', () => {
  it('adds the day up correctly', () => {
    const day = tradeADay()
    const data = db.dayData(day.id)
    expect([data.sales.length, data.refunds.length, data.audits.length]).toEqual([3, 1, 5])
    const r = buildReport({ kind: 'X', tillName: 'Till 1', ...data, at: at('14:00') })
    expect(r.sales).toEqual({ count: 3, items: 8, totalPence: 567 + 2100 + 250 })
    expect(r.payments).toEqual({ cashPence: 817, cardPence: 2100 })
    expect(r.vat).toEqual([
      { rate: 0.2, grossPence: 647, netPence: 539, vatPence: 108 }, // 447 (75) + 200 (33)
      { rate: 0.05, grossPence: 2100, netPence: 2000, vatPence: 100 },
      { rate: 0, grossPence: 170, netPence: 170, vatPence: 0 }, // bread + misc
    ])
    expect(r.refunds).toEqual({ count: 1, totalPence: 149, cashPence: 149, cardPence: 0, vatPence: 25 })
    expect(r.netPence).toBe(2917 - 149)
    expect(r.netVatPence).toBe(208 - 25)
    expect(r.voids).toEqual({ lineCount: 1, linePence: 120, saleCount: 1, salePence: 899 })
    expect(r.discounts).toEqual({ count: 1, pence: 98 }) // 2 colas, 49p off each
    expect(r.noSales).toBe(1)
    expect(r.drawer).toEqual({ floatPence: 5000, cashSalesPence: 817, cashRefundsPence: 149, expectedPence: 5668, countedPence: null, differencePence: null })
    // The rates add up to the sales total, and cash + card too.
    expect(r.vat.reduce((s, v) => s + v.grossPence, 0)).toBe(r.sales.totalPence)
    expect(r.payments.cashPence + r.payments.cardPence).toBe(r.sales.totalPence)
  })

  it('prints as a report a person can read', () => {
    const data = db.dayData(tradeADay().id)
    const z = buildReport({ kind: 'Z', tillName: 'Till 1', ...data, at: at('18:00'), countedPence: 5600 })
    expect(toText(reportLines(z, shop, 'UTC'), 42)).toBe([
      '               Corner Shop',
      '           VAT No. GB123456789',
      '      Z REPORT',
      '    End of day. The day is now closed.',
      '',
      'Till 1                          Z number 1',
      'Day started               24/11/2026 08:00',
      'Day closed                24/11/2026 18:00',
      '------------------------------------------',
      'Sales (3, 8 items)                  £29.17',
      '  Cash                               £8.17',
      '  Card                              £21.00',
      'Refunds (1)                         -£1.49',
      'Sales less refunds                  £27.68',
      '------------------------------------------',
      'VAT on sales',
      '  20% on £5.39 net                   £1.08',
      '  5% on £20.00 net                   £1.00',
      '  0% on £1.70 net                    £0.00',
      '  VAT in refunds                    -£0.25',
      'VAT after refunds                    £1.83',
      '------------------------------------------',
      'Voided lines (1)                     £1.20',
      'Voided sales (1)                     £8.99',
      'Discounts and reductions (1)         £0.98',
      'Drawer opened with no sale               1',
      '------------------------------------------',
      'Cash in the drawer',
      '  Float at start                    £50.00',
      '  Cash sales                         £8.17',
      '  Cash refunds                      -£1.49',
      'Should be in the drawer             £56.68',
      'Counted                             £56.00',
      'Short by                             £0.68',
    ].join('\n'))
  })

  it('compares the till\'s card takings with the card machine\'s own total, card refunds taken off', () => {
    const day = tradeADay()
    const heaterSale = db.findSale('T1-000002')!
    db.saveRefund(buildRefund({ record: heaterSale, picks: { [heaterSale.items[0].id]: 1 }, already: {}, reason: 'Faulty', staffId: null, approvedBy: null, returnToStock: false, method: 'card', orgId: 'org', tillId: 'till', at: at('15:00'), newId }))
    const data = db.dayData(day.id)
    const none = buildReport({ kind: 'Z', tillName: 'Till 1', ...data, at: at('18:00') })
    expect(none.cardCheck).toBeNull()
    expect(none.refunds).toMatchObject({ count: 2, cashPence: 149, cardPence: 2100 })
    expect(none.drawer.expectedPence).toBe(5668) // a card refund takes nothing out of the drawer
    const short = buildReport({ kind: 'Z', tillName: 'Till 1', ...data, at: at('18:00'), cardMachinePence: 500 })
    expect(short.cardCheck).toEqual({ tillPence: 0, machinePence: 500, differencePence: 500 })
    const text = toText(reportLines(short, shop, 'UTC'), 42)
    expect(text).toContain('Till says card took                  £0.00')
    expect(text).toContain('Card machine took more by            £5.00')
    expect(toText(reportLines(buildReport({ kind: 'Z', tillName: 'Till 1', ...data, at: at('18:00'), cardMachinePence: 0 }), shop, 'UTC'), 42)).toContain('They match')
  })

  it('an empty day is all zeros, not an error', () => {
    db.openDay({ id: 'd', openedBy: null, floatPence: 0, at: at('08:00').toISOString() })
    const r = buildReport({ kind: 'X', tillName: 'Till 1', ...db.dayData('d'), at: at('09:00') })
    expect(r.sales.totalPence + r.refunds.totalPence + r.drawer.expectedPence).toBe(0)
    expect(toText(reportLines(r, shop, 'UTC'), 42)).toContain('  No sales')
  })
})

describe('trading days in the till\'s own storage', () => {
  it('a Z closes the day for good and the next day starts fresh with the next Z number', () => {
    const day = tradeADay()
    expect(() => db.openDay({ id: 'x', openedBy: null, floatPence: 0, at: at('09:00').toISOString() })).toThrow(/already open/)
    const data = db.dayData(day.id)
    const report = buildReport({ kind: 'Z', tillName: 'Till 1', ...data, at: at('18:00'), countedPence: 5668 })
    const closed = db.closeDay({ id: day.id, closedBy: 'm1', countedPence: 5668, at: at('18:00').toISOString(), report })
    expect(closed).toMatchObject({ closedAt: '2026-11-24T18:00:00.000Z', closedBy: 'm1', countedPence: 5668 })
    expect(db.currentDay()).toBeNull()
    expect(() => db.closeDay({ id: day.id, closedBy: null, countedPence: 0, at: at('19:00').toISOString(), report })).toThrow(/not open/)

    const next = db.openDay({ id: 'day-2', openedBy: null, floatPence: 3000, at: '2026-11-25T08:00:00.000Z' })
    expect(next.zNumber).toBe(2)
    const sale = db.saveSale(buildSale({ basket: addProduct(emptyBasket, cola, 'a').basket, orgId: 'org', tillId: 'till', soldAt: new Date('2026-11-25T09:00:00Z'), tender: { method: 'cash', tenderedPence: 149 }, newId }))
    expect(sale.sale.day_session_id).toBe('day-2')
    expect(db.dayData('day-2').sales).toHaveLength(1)
    expect(db.dayData('day-2').audits).toHaveLength(0) // yesterday's log entries stay with yesterday
    expect(db.dayData(day.id).sales).toHaveLength(3) // and yesterday's figures have not moved
    expect(db.listDays(10).map((d) => [d.zNumber, d.closedAt !== null, d.report?.sales.totalPence ?? null])).toEqual([[2, false, null], [1, true, 2917]])
  })

  it('queues the day opening ahead of everything else, and the closing after', () => {
    const day = tradeADay()
    const data = db.dayData(day.id)
    db.closeDay({ id: day.id, closedBy: null, countedPence: null, at: at('18:00').toISOString(), report: buildReport({ kind: 'Z', tillName: 'Till 1', ...data, at: at('18:00') }) })
    expect(db.pendingOther(50, true).map((x) => [x.kind, x.record])).toEqual([['day_open', { id: 'day-1', org_id: 'org', till_id: 'till', z_number: 1, opened_at: '2026-11-24T08:00:00.000Z', opened_by: null, opening_float: 50 }]])
    const rest = db.pendingOther(50)
    expect(rest.some((x) => x.kind === 'day_open')).toBe(false)
    expect(rest[rest.length - 1]).toMatchObject({ kind: 'day_close', record: { id: 'day-1', closed_at: '2026-11-24T18:00:00.000Z', counted_cash: null } })
    expect(db.pendingSales(10).every((s) => s.record.sale.day_session_id === 'day-1')).toBe(true)
  })
})
