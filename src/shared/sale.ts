// Turns a finished basket into the exact rows the database stores.
// Pure: no screen, no database, so it can be tested on its own.
import { lineVatPence, totals, type Basket } from './basket'

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
  | { method: 'cash'; tenderedPence: number }
  | { method: 'card'; paymentIntentId: string; brand: string | null; last4: string | null }

export function buildSale(input: {
  basket: Basket
  orgId: string
  tillId: string
  staffId?: string | null
  soldAt: Date
  tender: Tender
  newId: () => string
  saleId?: string // set when the id had to exist before the sale did (a card payment refers to it)
}): SaleDraft {
  const { basket, orgId, tillId, tender, newId } = input
  const sums = totals(basket)
  if (sums.itemCount === 0) throw new Error('There is nothing in the basket to sell.')
  if (tender.method === 'cash' && tender.tenderedPence < sums.totalPence) {
    throw new Error('The cash handed over is less than the total.')
  }
  const saleId = input.saleId ?? newId()
  const at = input.soldAt.toISOString()

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
    // A voided line is kept for the record with what it would have been, flagged voided.
    line_total: pounds(line.unitPence * line.qty),
    vat_rate: line.vatRate,
    vat_amount: pounds(line.voided ? 0 : lineVatPence(line)),
    voided: line.voided,
  }))

  const payment: PaymentRow = {
    id: newId(),
    org_id: orgId,
    sale_id: saleId,
    method: tender.method,
    amount: pounds(sums.totalPence),
    tendered: tender.method === 'cash' ? pounds(tender.tenderedPence) : null,
    change_given: tender.method === 'cash' ? pounds(tender.tenderedPence - sums.totalPence) : null,
    stripe_payment_intent_id: tender.method === 'card' ? tender.paymentIntentId : null,
    card_brand: tender.method === 'card' ? tender.brand : null,
    card_last4: tender.method === 'card' ? tender.last4 : null,
    paid_at: at,
  }

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
      discount_total: 0,
      sold_at: at,
    },
    items,
    payments: [payment],
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
