// Turning "give the customer their money back for these lines" into database rows.
import { vatInside } from './basket'
import type { SaleRecord } from './sale'

export type RefundRow = {
  id: string
  org_id: string
  till_id: string
  staff_id: string | null
  approved_by: string | null
  sale_id: string
  receipt_no: string
  method: 'cash' | 'card'
  total: number
  vat_total: number
  reason: string
  refunded_at: string
}

export type RefundItemRow = {
  id: string
  org_id: string
  refund_id: string
  sale_item_id: string
  product_id: string | null
  name: string
  quantity: number
  unit_price: number
  line_total: number
  vat_rate: number
  vat_amount: number
  return_to_stock: boolean
}

export type RefundDraft = { refund: Omit<RefundRow, 'receipt_no'>; items: RefundItemRow[]; originalReceiptNo: string }
export type RefundRecord = { refund: RefundRow; items: RefundItemRow[]; originalReceiptNo: string }

// How many of each line have already been refunded: sale line id -> quantity.
export type Refunded = Record<string, number>

export function refundable(record: SaleRecord, already: Refunded): Array<{ itemId: string; name: string; unitPence: number; sold: number; left: number }> {
  return record.items.filter((i) => !i.voided).map((i) => ({
    itemId: i.id, name: i.name, unitPence: Math.round(i.unit_price * 100), sold: i.quantity,
    left: Math.max(0, i.quantity - (already[i.id] ?? 0)),
  }))
}

export function buildRefund(input: {
  record: SaleRecord
  picks: Record<string, number> // sale line id -> quantity to refund
  already: Refunded
  reason: string
  staffId: string | null
  approvedBy: string | null
  returnToStock: boolean
  orgId: string
  tillId: string
  at: Date
  newId: () => string
}): RefundDraft {
  const { record, picks } = input
  if (!input.reason.trim()) throw new Error('A refund needs a reason.')
  const left = new Map(refundable(record, input.already).map((l) => [l.itemId, l.left]))
  const refundId = input.newId()
  const items: RefundItemRow[] = []
  let totalPence = 0
  let vatPence = 0
  for (const item of record.items) {
    const qty = picks[item.id] ?? 0
    if (qty === 0) continue
    if (!Number.isInteger(qty) || qty < 0) throw new Error('Quantities must be whole numbers.')
    if (qty > (left.get(item.id) ?? 0)) throw new Error(`Only ${left.get(item.id) ?? 0} of "${item.name}" can still be refunded.`)
    const unitPence = Math.round(item.unit_price * 100)
    const gross = unitPence * qty
    const vat = vatInside(gross, item.vat_rate)
    totalPence += gross
    vatPence += vat
    items.push({
      id: input.newId(), org_id: input.orgId, refund_id: refundId, sale_item_id: item.id, product_id: item.product_id,
      name: item.name, quantity: qty, unit_price: unitPence / 100, line_total: gross / 100,
      vat_rate: item.vat_rate, vat_amount: vat / 100, return_to_stock: input.returnToStock,
    })
  }
  if (items.length === 0) throw new Error('Choose at least one item to refund.')
  return {
    refund: {
      id: refundId, org_id: input.orgId, till_id: input.tillId, staff_id: input.staffId, approved_by: input.approvedBy,
      sale_id: record.sale.id, method: 'cash', total: totalPence / 100, vat_total: vatPence / 100,
      reason: input.reason.trim(), refunded_at: input.at.toISOString(),
    },
    items,
    originalReceiptNo: record.sale.receipt_no,
  }
}

export function refundReceiptNumber(prefix: string, seq: number): string {
  return `${prefix}-R${String(seq).padStart(6, '0')}`
}

// "7" typed at this till means this till's receipt 7; a full number is used as it is.
export function normaliseReceiptNo(typed: string, prefix: string): string {
  const t = typed.trim().toUpperCase()
  return /^\d{1,6}$/.test(t) ? `${prefix}-${t.padStart(6, '0')}` : t
}
