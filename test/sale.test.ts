import { describe, expect, it } from 'vitest'
import { addMiscItem, addProduct, emptyBasket, setQty, voidLine } from '../src/shared/basket'
import { buildSale, receiptNumber, withReceipt } from '../src/shared/sale'
import type { Product } from '../src/shared/products'

const cola: Product = { id: 'p1', name: 'Cola', barcode: '111', pricePence: 149, vatRate: 0.2 }
const bread: Product = { id: 'p2', name: 'Bread', barcode: '222', pricePence: 120, vatRate: 0 }

function ids() {
  let n = 0
  return () => `id-${++n}`
}

function basket() {
  let b = addProduct(emptyBasket, cola, 'l1').basket
  b = setQty(b, 'l1', 3) // 447, VAT 75 (rounded on the line)
  b = addProduct(b, bread, 'l2').basket // voided below
  b = addMiscItem(b, 50, 'l3')
  return voidLine(b, 'l2')
}

describe('turning a basket into database rows', () => {
  const draft = buildSale({
    basket: basket(), orgId: 'org', tillId: 'till', soldAt: new Date('2026-11-24T19:30:00Z'),
    tender: { method: 'cash', tenderedPence: 1000 }, newId: ids(),
  })

  it('totals in pounds, VAT included', () => {
    expect(draft.sale).toEqual({
      id: 'id-1', org_id: 'org', till_id: 'till', day_session_id: null, staff_id: null, status: 'completed',
      total: 4.97, vat_total: 0.75, discount_total: 0, sold_at: '2026-11-24T19:30:00.000Z',
    })
  })

  it('one row per line, product id and quantity on every one, voided lines flagged', () => {
    expect(draft.items).toHaveLength(3)
    expect(draft.items[0]).toMatchObject({ sale_id: 'id-1', line_no: 1, product_id: 'p1', quantity: 3, unit_price: 1.49, line_total: 4.47, vat_rate: 0.2, vat_amount: 0.75, voided: false })
    expect(draft.items[1]).toMatchObject({ line_no: 2, product_id: 'p2', voided: true, line_total: 1.2, vat_amount: 0 })
    expect(draft.items[2]).toMatchObject({ line_no: 3, product_id: null, name: 'Misc item', line_total: 0.5 })
    expect(new Set(draft.items.map((i) => i.id)).size).toBe(3)
  })

  it('cash payment with change', () => {
    expect(draft.payments).toEqual([{
      id: 'id-5', org_id: 'org', sale_id: 'id-1', method: 'cash',
      amount: 4.97, tendered: 10, change_given: 5.03,
      stripe_payment_intent_id: null, card_brand: null, card_last4: null, paid_at: '2026-11-24T19:30:00.000Z',
    }])
  })

  it('the lines add up to the sale total', () => {
    const live = draft.items.filter((i) => !i.voided)
    expect(Math.round(live.reduce((s, i) => s + i.line_total * 100, 0))).toBe(Math.round(draft.sale.total * 100))
    expect(Math.round(live.reduce((s, i) => s + i.vat_amount * 100, 0))).toBe(Math.round(draft.sale.vat_total * 100))
  })

  it('refuses an empty basket or too little cash', () => {
    const base = { orgId: 'o', tillId: 't', soldAt: new Date(), newId: ids() }
    expect(() => buildSale({ ...base, basket: emptyBasket, tender: { method: 'cash', tenderedPence: 0 } })).toThrow()
    expect(() => buildSale({ ...base, basket: voidLine(addProduct(emptyBasket, cola, 'l1').basket, 'l1'), tender: { method: 'cash', tenderedPence: 500 } })).toThrow()
    expect(() => buildSale({ ...base, basket: basket(), tender: { method: 'cash', tenderedPence: 496 } })).toThrow()
  })

  it('card payment: no cash figures, the card details kept, and the sale id decided beforehand', () => {
    const card = buildSale({
      basket: basket(), orgId: 'org', tillId: 'till', soldAt: new Date('2026-11-24T19:30:00Z'),
      tender: { method: 'card', paymentIntentId: 'pi_123', brand: 'visa', last4: '4242' }, newId: ids(), saleId: 'sale-fixed',
    })
    expect(card.sale.id).toBe('sale-fixed')
    expect(card.items.every((i) => i.sale_id === 'sale-fixed')).toBe(true)
    expect(card.payments[0]).toMatchObject({
      sale_id: 'sale-fixed', method: 'card', amount: 4.97, tendered: null, change_given: null,
      stripe_payment_intent_id: 'pi_123', card_brand: 'visa', card_last4: '4242',
    })
  })

  it('receipt numbers', () => {
    expect(receiptNumber('T1', 7)).toBe('T1-000007')
    expect(withReceipt(draft, 'T2', 123).sale).toMatchObject({ receipt_seq: 123, receipt_no: 'T2-000123', id: 'id-1' })
  })
})
