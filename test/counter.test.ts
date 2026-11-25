// Discounts, split payments and refunds without a receipt.
import { describe, expect, it } from 'vitest'
import { addMiscItem, addProduct, discountAll, emptyBasket, lineTotalPence, setDiscount, setQty, totals, voidLine } from '../src/shared/basket'
import { buildSale, withReceipt } from '../src/shared/sale'
import { buildLooseRefund, buildRefund, refundable } from '../src/shared/refund'
import { buildReceipt, buildRefundReceipt } from '../src/shared/receipt'
import { buildReport } from '../src/shared/report'
import { toText } from '../src/shared/escpos'
import type { Product } from '../src/shared/products'

const cola: Product = { id: 'p1', name: 'Cola', barcode: '111', pricePence: 149, vatRate: 0.2 }
const bread: Product = { id: 'p2', name: 'Bread', barcode: '222', pricePence: 120, vatRate: 0 }
const heater: Product = { id: 'p3', name: 'Heater', barcode: '333', pricePence: 2100, vatRate: 0.05 }
const shop = { name: 'Shop', address: null, vatNumber: null, footer: null }
let n = 0
const newId = () => `id-${++n}`
const three = () => {
  let b = setQty(addProduct(emptyBasket, cola, 'a').basket, 'a', 2) // 298
  b = addProduct(b, bread, 'b').basket // 120
  return addProduct(b, heater, 'c').basket // 2100  -> 2518
}

describe('discounts', () => {
  it('a percentage off one line follows the quantity, and VAT is worked out on what is paid', () => {
    let b = setDiscount(three(), 'a', { kind: 'percent', value: 10 })
    expect(lineTotalPence(b.lines[0])).toBe(268) // 298 less 30
    expect(totals(b)).toMatchObject({ totalPence: 2488, discountPence: 30 })
    expect(totals(b).byRate[0]).toEqual({ rate: 0.2, grossPence: 268, vatPence: 45, netPence: 223 })
    b = setQty(b, 'a', 4)
    expect(lineTotalPence(b.lines[0])).toBe(536) // 596 less 60
  })

  it('an amount off one line never takes it below zero, and can be removed', () => {
    let b = setDiscount(three(), 'b', { kind: 'amount', pence: 500 })
    expect(lineTotalPence(b.lines[1])).toBe(0)
    b = setDiscount(b, 'b', null)
    expect(lineTotalPence(b.lines[1])).toBe(120)
    expect(b.lines[1].discount).toBeUndefined()
  })

  it('a percentage off the whole sale goes on every line, but not on voided ones', () => {
    const b = discountAll(voidLine(three(), 'b'), { kind: 'percent', value: 50 })
    expect(totals(b)).toMatchObject({ totalPence: 149 + 1050, discountPence: 149 + 1050 })
    expect(b.lines[1].discount).toBeUndefined()
  })

  it('an amount off the whole sale is shared by size and adds up to the penny', () => {
    const b = discountAll(three(), { kind: 'amount', pence: 100 })
    expect(totals(b)).toMatchObject({ totalPence: 2418, discountPence: 100 })
    expect(b.lines.map((l) => (l.discount?.kind === 'amount' ? l.discount.pence : 0))).toEqual([11, 4, 85]) // 11.8, 4.8, 83.4 rounded down, the 2 spare pence on the biggest line
    expect(totals(discountAll(three(), { kind: 'amount', pence: 999999 })).totalPence).toBe(0)
    expect(totals(discountAll(b, null))).toMatchObject({ totalPence: 2518, discountPence: 0 })
  })

  it('refuses nonsense, and a discounted line is never merged with a fresh scan', () => {
    expect(() => setDiscount(three(), 'a', { kind: 'percent', value: 0 })).toThrow()
    expect(() => setDiscount(three(), 'a', { kind: 'percent', value: 101 })).toThrow()
    expect(() => setDiscount(three(), 'a', { kind: 'amount', pence: 0 })).toThrow()
    const b = addProduct(setDiscount(three(), 'a', { kind: 'percent', value: 10 }), cola, 'z').basket
    expect(b.lines).toHaveLength(4)
  })

  it('the sale, receipt and Z report all show the discount', () => {
    const b = setDiscount(three(), 'a', { kind: 'percent', value: 10 })
    const record = withReceipt(buildSale({ basket: b, orgId: 'o', tillId: 't', soldAt: new Date('2026-11-25T10:00:00Z'), tender: { method: 'cash', tenderedPence: 2500 }, newId }), 'T1', 1)
    expect(record.sale).toMatchObject({ total: 24.88, discount_total: 0.3, vat_total: 1.45 })
    expect(record.items[0]).toMatchObject({ unit_price: 1.49, quantity: 2, discount_amount: 0.3, line_total: 2.68, vat_amount: 0.45 })
    expect(record.items[1]).toMatchObject({ discount_amount: 0, line_total: 1.2 })
    const text = toText(buildReceipt({ record, shop, tillName: 'Till 1', timeZone: 'UTC' }), 32)
    expect(text).toContain('Cola                       £2.98\n  2 x £1.49\n  Discount                -£0.30')
    expect(text).toContain('You saved                  £0.30')
    const day = { id: 'd', zNumber: 1, openedAt: '2026-11-25T08:00:00Z', openedBy: null, floatPence: 0, closedAt: null, closedBy: null, countedPence: null, report: null }
    expect(buildReport({ kind: 'X', day, tillName: 'T', sales: [record], refunds: [], audits: [], at: new Date() }).discounts).toEqual({ count: 1, pence: 30 })
  })

  it('refunding a discounted line gives back what was paid, not the shelf price', () => {
    const b = setDiscount(three(), 'a', { kind: 'percent', value: 10 }) // 2 colas for 268
    const record = withReceipt(buildSale({ basket: b, orgId: 'o', tillId: 't', soldAt: new Date(), tender: { method: 'card' }, newId }), 'T1', 1)
    expect(refundable(record, {})[0]).toMatchObject({ unitPence: 134, sold: 2, left: 2 })
    const one = buildRefund({ record, picks: { [record.items[0].id]: 1 }, already: {}, reason: 'Faulty', staffId: null, approvedBy: null, returnToStock: true, orgId: 'o', tillId: 't', at: new Date(), newId })
    expect(one.refund.total).toBe(1.34)
    const both = buildRefund({ record, picks: { [record.items[0].id]: 2 }, already: {}, reason: 'Faulty', staffId: null, approvedBy: null, returnToStock: true, orgId: 'o', tillId: 't', at: new Date(), newId })
    expect(both.refund.total).toBe(2.68)
  })
})

describe('split payment', () => {
  const base = { basket: three(), orgId: 'o', tillId: 't', soldAt: new Date('2026-11-25T10:00:00Z'), newId }

  it('part cash, part card: two payment rows that add up to the total, change only on the cash', () => {
    const draft = buildSale({ ...base, tender: [{ method: 'cash', tenderedPence: 1000, amountPence: 1000 }, { method: 'card', amountPence: 1518 }] })
    expect(draft.sale.total).toBe(25.18)
    expect(draft.payments.map((p) => [p.method, p.amount, p.tendered, p.change_given])).toEqual([['cash', 10, 10, 0], ['card', 15.18, null, null]])
    const last = buildSale({ ...base, tender: [{ method: 'card', amountPence: 2000 }, { method: 'cash', tenderedPence: 1000, amountPence: 518 }] })
    expect(last.payments[1]).toMatchObject({ amount: 5.18, tendered: 10, change_given: 4.82 })
  })

  it('the receipt lists each part, and the report puts each in the right total', () => {
    const record = withReceipt(buildSale({ ...base, tender: [{ method: 'cash', tenderedPence: 1000, amountPence: 1000 }, { method: 'card', amountPence: 1518 }] }), 'T1', 1)
    const text = toText(buildReceipt({ record, shop, tillName: 'Till 1', timeZone: 'UTC' }), 32)
    expect(text).toContain('Cash                      £10.00')
    expect(text).toContain('Card                      £15.18')
    const day = { id: 'd', zNumber: 1, openedAt: '2026-11-25T08:00:00Z', openedBy: null, floatPence: 0, closedAt: null, closedBy: null, countedPence: null, report: null }
    const report = buildReport({ kind: 'X', day, tillName: 'T', sales: [record], refunds: [], audits: [], at: new Date() })
    expect(report.payments).toEqual({ cashPence: 1000, cardPence: 1518 })
    expect(report.drawer.expectedPence).toBe(1000)
  })

  it('refuses parts that do not add up, or cash that does not cover its part', () => {
    expect(() => buildSale({ ...base, tender: [{ method: 'cash', tenderedPence: 1000, amountPence: 1000 }, { method: 'card', amountPence: 1000 }] })).toThrow(/add up/)
    expect(() => buildSale({ ...base, tender: [{ method: 'cash', tenderedPence: 1000, amountPence: 1000 }, { method: 'card' }] })).toThrow(/add up/)
    expect(() => buildSale({ ...base, tender: [{ method: 'cash', tenderedPence: 500, amountPence: 1000 }, { method: 'card', amountPence: 1518 }] })).toThrow(/less than/)
    expect(() => buildSale({ ...base, tender: [] })).toThrow()
  })
})

describe('refund without a receipt', () => {
  const basket = voidLine(addMiscItem(setQty(addProduct(addProduct(emptyBasket, cola, 'a').basket, bread, 'b').basket, 'a', 2), 75, 'c'), 'b')
  const input = { basket, reason: 'Faulty or damaged', staffId: 's1', approvedBy: 'm1', returnToStock: false, orgId: 'o', tillId: 't', at: new Date('2026-11-25T10:00:00Z'), newId }

  it('refunds what was scanned at today\'s prices, in cash, linked to no sale', () => {
    const draft = buildLooseRefund(input)
    expect(draft.refund).toMatchObject({ sale_id: null, method: 'cash', total: 3.73, vat_total: 0.5, reason: 'Faulty or damaged', approved_by: 'm1' })
    expect(draft.items.map((i) => [i.sale_item_id, i.product_id, i.name, i.quantity, i.line_total, i.return_to_stock])).toEqual([[null, 'p1', 'Cola', 2, 2.98, false], [null, null, 'Misc item', 1, 0.75, false]])
    expect(draft.originalReceiptNo).toBeNull()
  })

  it('needs items and a reason, and its slip says "No receipt"', () => {
    expect(() => buildLooseRefund({ ...input, basket: emptyBasket })).toThrow(/Scan the items/)
    expect(() => buildLooseRefund({ ...input, reason: ' ' })).toThrow(/reason/)
    const draft = buildLooseRefund(input)
    const text = toText(buildRefundReceipt({ record: { ...draft, refund: { ...draft.refund, receipt_no: 'T1-R000004' } }, shop, tillName: 'Till 1', timeZone: 'UTC' }), 32)
    expect(text).toContain('No receipt')
    expect(text).toContain('REFUNDED')
  })
})
