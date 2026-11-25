// Turns a finished basket into the exact rows the database stores.
// Pure: no screen, no database, so it can be tested on its own.
import { lineDiscountPence, lineTotalPence, lineVatPence, totals, type Basket } from './basket'

const pounds = (pence: number): number => pence / 100

export type SaleRow = {
  id: string
  org_id: string
  till_id: string
  day_session_id: string | null // the trading day; filled in by the till's own storage when the sale is saved
  staff_id: string | null
  receipt_seq: number
  receipt_no: string
  status: 'completed'
  total: number
  vat_total: number
  discount_total: number
  sold_at: string
}

export type SaleItemRow = {
  id: string
  org_id: string
  sale_id: string
  line_no: number
  product_id: string | null
  name: string
  barcode: string | null
  quantity: number
  unit_price: number
  original_unit_price: number | null // only when a manager changed the price
  discount_amount: number // money off this line; line_total is what was paid
  line_total: number
  vat_rate: number
  vat_amount: number
  voided: boolean
}

export type PaymentRow = {
  id: string
  org_id: string
  sale_id: string
  method: 'cash' | 'card'
  amount: number
  tendered: number | null
  change_given: number | null
  stripe_payment_intent_id: string | null
  card_brand: string | null
  card_last4: string | null
  paid_at: string
}

// A sale before the till has given it a receipt number.
export type SaleDraft = {
  sale: Omit<SaleRow, 'receipt_seq' | 'receipt_no'>
  items: SaleItemRow[]
  payments: PaymentRow[]
}

export type SaleRecord = { sale: SaleRow; items: SaleItemRow[]; payments: PaymentRow[] }

export type Tender =
  // amountPence is only needed when a sale is paid in parts (part cash, part card): how much of the
  // total this part covers. A single payment covers the whole total.
  | { method: 'cash'; tenderedPence: number; amountPence?: number }
  // Card: taken on the shop's own card machine and confirmed by the cashier. The reference, brand and last
  // four digits are only known when a card machine is linked to the till (none is yet).
  | { method: 'card'; reference?: string | null; brand?: string | null; last4?: string | null; amountPence?: number }

export function buildSale(input: {
  basket: Basket
  orgId: string
  tillId: string
  staffId?: string | null
  soldAt: Date
  tender: Tender | Tender[] // several = a split payment
  newId: () => string
  saleId?: string // set when the id had to exist before the sale did (a card payment refers to it)
}): SaleDraft {
  const { basket, orgId, tillId, newId } = input
  const sums = totals(basket)
  if (sums.itemCount === 0) throw new Error('There is nothing in the basket to sell.')
  const saleId = input.saleId ?? newId()
  const at = input.soldAt.toISOString()

  // One payment covers the whole total. Several must each say how much they cover, and add up exactly.
  const parts = Array.isArray(input.tender) ? input.tender : [input.tender]
  if (parts.length === 0) throw new Error('The sale has not been paid.')
  const amounts = parts.map((part) => (parts.length === 1 ? part.amountPence ?? sums.totalPence : part.amountPence ?? -1))
  if (amounts.some((a) => !Number.isInteger(a) || a < 0) || amounts.reduce((s, a) => s + a, 0) !== sums.totalPence) {
    throw new Error('The payments do not add up to the total.')
  }
  const payments: PaymentRow[] = parts.map((part, i) => {
    const amount = amounts[i]
    if (part.method === 'cash' && part.tenderedPence < amount) throw new Error('The cash handed over is less than the total.')
    return {
      id: newId(),
      org_id: orgId,
      sale_id: saleId,
      method: part.method,
      amount: pounds(amount),
      tendered: part.method === 'cash' ? pounds(part.tenderedPence) : null,
      change_given: part.method === 'cash' ? pounds(part.tenderedPence - amount) : null,
      stripe_payment_intent_id: part.method === 'card' ? part.reference ?? null : null,
      card_brand: part.method === 'card' ? part.brand ?? null : null,
      card_last4: part.method === 'card' ? part.last4 ?? null : null,
      paid_at: at,
    }
  })

  const items: SaleItemRow[] = basket.lines.map((line, i) => ({
    id: newId(),
    org_id: orgId,
    sale_id: saleId,
    line_no: i + 1,
    product_id: line.productId,
    name: line.name,
    barcode: line.barcode,
    quantity: line.qty,
    unit_price: pounds(line.unitPence),
    original_unit_price: line.originalUnitPence === undefined ? null : pounds(line.originalUnitPence),
    discount_amount: pounds(lineDiscountPence(line)),
    // A voided line is kept for the record with what it would have been, flagged voided.
    line_total: pounds(line.voided ? line.unitPence * line.qty : lineTotalPence(line)),
    vat_rate: line.vatRate,
    vat_amount: pounds(line.voided ? 0 : lineVatPence(line)),
    voided: line.voided,
  }))

  return {
    sale: {
      id: saleId,
      org_id: orgId,
      till_id: tillId,
      day_session_id: null,
      staff_id: input.staffId ?? null,
      status: 'completed',
      total: pounds(sums.totalPence),
      vat_total: pounds(sums.vatPence),
      discount_total: pounds(sums.discountPence),
      sold_at: at,
    },
    items,
    payments,
  }
}

export function receiptNumber(prefix: string, seq: number): string {
  return `${prefix}-${String(seq).padStart(6, '0')}`
}

export function withReceipt(draft: SaleDraft, prefix: string, seq: number): SaleRecord {
  return {
    sale: { ...draft.sale, receipt_seq: seq, receipt_no: receiptNumber(prefix, seq) },
    items: draft.items,
    payments: draft.payments,
  }
}
