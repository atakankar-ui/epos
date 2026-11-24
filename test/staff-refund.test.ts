import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalDb } from '../src/main/db'
import { addProduct, emptyBasket, overridePrice, setQty, totals, voidLine } from '../src/shared/basket'
import { buildSale, withReceipt } from '../src/shared/sale'
import { buildRefund, normaliseReceiptNo, refundable } from '../src/shared/refund'
import { auditRow } from '../src/shared/audit'
import { activeStaff, checkPin, hashPin, managers, newSalt, validPin, type Staff } from '../src/shared/staff'
import type { Binding } from '../src/shared/local'
import type { Product } from '../src/shared/products'

const cola: Product = { id: 'p1', name: 'Cola', barcode: '111', pricePence: 149, vatRate: 0.2 }
const bread: Product = { id: 'p2', name: 'Bread', barcode: '222', pricePence: 120, vatRate: 0 }
let n = 0
const newId = () => `id-${++n}`

function sale() {
  let b = addProduct(emptyBasket, cola, 'l1').basket
  b = setQty(b, 'l1', 3)
  b = addProduct(b, bread, 'l2').basket
  b = addProduct(b, { ...bread, id: 'p3', name: 'Voided thing' }, 'l3').basket
  b = voidLine(b, 'l3')
  return withReceipt(buildSale({ basket: b, orgId: 'org', tillId: 'till', staffId: 's1', soldAt: new Date('2026-11-24T10:00:00Z'), tender: { method: 'cash', tenderedPence: 1000 }, newId }), 'T1', 5)
}

describe('PINs', () => {
  it('accepts 4 to 6 digits only', () => {
    expect(['1234', '123456'].every(validPin)).toBe(true)
    expect(['123', '1234567', '12a4', ''].some(validPin)).toBe(false)
  })

  it('checks a PIN against its scrambled form, and never keeps the PIN itself', async () => {
    const salt = newSalt()
    const staff: Staff = { id: 's', name: 'Ayse', role: 'manager', pinSalt: salt, pinHash: await hashPin('4821', salt), active: true }
    expect(JSON.stringify(staff)).not.toContain('4821')
    expect(await checkPin(staff, '4821')).toBe(true)
    expect(await checkPin(staff, '4822')).toBe(false)
    expect(await checkPin({ ...staff, active: false }, '4821')).toBe(false)
    expect(await hashPin('4821', newSalt())).not.toBe(staff.pinHash) // same PIN, different person: different scramble
  })

  it('lists who can sign in and who can approve', () => {
    const list: Staff[] = [
      { id: '1', name: 'Zed', role: 'cashier', pinSalt: 's', pinHash: 'h', active: true },
      { id: '2', name: 'Amy', role: 'manager', pinSalt: 's', pinHash: 'h', active: true },
      { id: '3', name: 'Gone', role: 'manager', pinSalt: 's', pinHash: 'h', active: false },
      { id: '4', name: 'No PIN yet', role: 'manager', pinSalt: null, pinHash: null, active: true },
    ]
    expect(activeStaff(list).map((s) => s.name)).toEqual(['Amy', 'Zed'])
    expect(managers(list).map((s) => s.name)).toEqual(['Amy'])
  })
})

describe('price override', () => {
  it('changes the price, remembers the old one, and the sale row records both', () => {
    let b = addProduct(emptyBasket, cola, 'l1').basket
    b = overridePrice(b, 'l1', 100)
    b = overridePrice(b, 'l1', 90) // changed twice: the original is still the shelf price
    expect(totals(b).totalPence).toBe(90)
    const again = addProduct(b, cola, 'l2') // a fresh scan is a new line at the normal price
    expect(again.basket.lines).toHaveLength(2)
    const draft = buildSale({ basket: b, orgId: 'o', tillId: 't', soldAt: new Date(), tender: { method: 'cash', tenderedPence: 90 }, newId })
    expect(draft.items[0]).toMatchObject({ unit_price: 0.9, original_unit_price: 1.49 })
    expect(() => overridePrice(b, 'l1', -5)).toThrow()
  })
})

describe('refunds', () => {
  const record = sale()
  const [colaLine, breadLine, voided] = record.items
  const base = { record, already: {}, reason: 'Faulty', staffId: 's1', approvedBy: 'm1', returnToStock: true, orgId: 'org', tillId: 'till', at: new Date('2026-11-25T09:00:00Z'), newId }

  it('offers only lines that were really sold, with what is left to refund', () => {
    expect(refundable(record, { [colaLine.id]: 1 })).toEqual([
      { itemId: colaLine.id, name: 'Cola', unitPence: 149, sold: 3, left: 2 },
      { itemId: breadLine.id, name: 'Bread', unitPence: 120, sold: 1, left: 1 },
    ])
  })

  it('part refund: right money, right VAT, linked to the sale and its lines', () => {
    const draft = buildRefund({ ...base, picks: { [colaLine.id]: 2, [breadLine.id]: 1 } })
    expect(draft.refund).toMatchObject({ sale_id: record.sale.id, total: 4.18, vat_total: 0.5, method: 'cash', reason: 'Faulty', staff_id: 's1', approved_by: 'm1' })
    expect(draft.items.map((i) => [i.sale_item_id, i.product_id, i.quantity, i.line_total, i.vat_amount, i.return_to_stock]))
      .toEqual([[colaLine.id, 'p1', 2, 2.98, 0.5, true], [breadLine.id, 'p2', 1, 1.2, 0, true]])
    expect(draft.originalReceiptNo).toBe('T1-000005')
  })

  it('cannot refund more than was sold, a voided line, nothing at all, or without a reason', () => {
    expect(() => buildRefund({ ...base, picks: { [colaLine.id]: 4 } })).toThrow(/Only 3/)
    expect(() => buildRefund({ ...base, already: { [colaLine.id]: 2 }, picks: { [colaLine.id]: 2 } })).toThrow(/Only 1/)
    expect(() => buildRefund({ ...base, picks: { [voided.id]: 1 } })).toThrow(/Only 0/)
    expect(() => buildRefund({ ...base, picks: {} })).toThrow(/at least one/)
    expect(() => buildRefund({ ...base, reason: '  ', picks: { [colaLine.id]: 1 } })).toThrow(/reason/)
  })

  it('reads a typed receipt number', () => {
    expect(normaliseReceiptNo('7', 'T2')).toBe('T2-000007')
    expect(normaliseReceiptNo(' t1-000042 ', 'T2')).toBe('T1-000042')
  })
})

describe('refunds and audit in the till\'s own storage', () => {
  const binding: Binding = { orgId: 'org', orgName: 'Test Shop', userId: 'u', email: 'e', tillId: 'till', tillName: 'Till 1', receiptPrefix: 'T1' }
  let dir: string, db: LocalDb
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'till-db-')); db = new LocalDb(join(dir, 'till.sqlite')); db.bind(binding) })
  afterEach(() => { db.close(); rmSync(dir, { recursive: true, force: true }) })

  const draftSale = () => buildSale({ basket: setQty(addProduct(emptyBasket, cola, 'l1').basket, 'l1', 3), orgId: 'org', tillId: 'till', soldAt: new Date(), tender: { method: 'cash', tenderedPence: 447 }, newId })

  it('finds a sale by receipt number, numbers refunds on their own run, and remembers what was refunded', () => {
    const sold = db.saveSale(draftSale())
    expect(db.findSale('T1-000001')).toEqual(sold)
    expect(db.findSale('T1-000099')).toBeNull()
    expect(db.recentSales(5)).toEqual([sold])
    const mk = (qty: number) => buildRefund({ record: sold, picks: { [sold.items[0].id]: qty }, already: db.refundedHere(sold.sale.id, false), reason: 'Faulty', staffId: null, approvedBy: null, returnToStock: true, orgId: 'org', tillId: 'till', at: new Date(), newId })
    expect(db.saveRefund(mk(1)).refund.receipt_no).toBe('T1-R000001')
    expect(db.saveRefund(mk(1)).refund.receipt_no).toBe('T1-R000002')
    expect(db.refundedHere(sold.sale.id, false)).toEqual({ [sold.items[0].id]: 2 })
    expect(() => mk(2)).toThrow(/Only 1/)
    expect(db.saveSale(draftSale()).sale.receipt_no).toBe('T1-000002') // sale numbers are untouched by refunds
  })

  it('queues refunds and audit entries in the order they happened, counts them as waiting, and blocks disconnecting', () => {
    const sold = db.saveSale(draftSale())
    db.markSynced(sold.sale.id)
    const audit = auditRow({ id: 'a1', orgId: 'org', tillId: 'till', at: new Date(), staffId: 's1', approvedBy: 'm1', action: 'no_sale', reason: ' Giving change ', amountPence: null })
    db.logAudit(audit)
    const refund = db.saveRefund(buildRefund({ record: sold, picks: { [sold.items[0].id]: 1 }, already: {}, reason: 'Faulty', staffId: 's1', approvedBy: 'm1', returnToStock: false, orgId: 'org', tillId: 'till', at: new Date(), newId }))
    expect(audit.reason).toBe('Giving change')
    expect(db.pendingOther(10).map((p) => [p.kind, p.id])).toEqual([['audit', 'a1'], ['refund', refund.refund.id]])
    expect(db.getState().waiting).toBe(2)
    expect(() => db.unbind()).toThrow(/still waiting/)
    db.markOtherRefused('a1', 'no')
    expect(db.getState()).toMatchObject({ waiting: 2, refused: 1, lastRefusal: 'no' })
    db.markOtherSynced('a1'); db.markOtherSynced(refund.refund.id)
    expect(db.getState()).toMatchObject({ waiting: 0, refused: 0 })
    expect(db.refundedHere(sold.sale.id, true)).toEqual({}) // sent ones are counted from the database instead
    expect(() => db.logAudit({ ...audit, id: 'a1' })).toThrow() // an entry can never be written over
    expect(() => db.logAudit({ ...audit, id: 'a2', till_id: 'other' })).toThrow(/different till/)
  })

  it('keeps the staff list for offline PIN checks', () => {
    const staff: Staff[] = [{ id: 's1', name: 'Amy', role: 'manager', pinSalt: 'x', pinHash: 'y', active: true }]
    db.setStaff(staff)
    expect(db.getStaff()).toEqual(staff)
  })
})
