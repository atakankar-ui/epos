// Finding a past sale to refund, and how much of it has been refunded already.
import { supabase } from './supabase'
import type { SaleRecord } from '../../../shared/sale'
import type { Refunded } from '../../../shared/refund'

// This till's own records first (works offline); otherwise ask the database (another till's sale).
export async function findSale(receiptNo: string, online: boolean): Promise<SaleRecord | null> {
  const here = await window.till.local.findSale(receiptNo)
  if (here) return here
  if (!online) throw new Error('That receipt is not from this till, and looking it up needs the internet.')
  const { data, error } = await supabase.from('sales').select('*, sale_items(*), payments(*)').eq('receipt_no', receiptNo).eq('status', 'completed').limit(1)
  if (error) throw new Error(error.message)
  const row = data?.[0] as (SaleRecord['sale'] & { sale_items: SaleRecord['items']; payments: SaleRecord['payments'] }) | undefined
  if (!row) return null
  const { sale_items, payments, ...sale } = row
  return { sale, items: [...sale_items].sort((a, b) => a.line_no - b.line_no), payments }
}

export async function alreadyRefunded(record: SaleRecord, online: boolean): Promise<Refunded> {
  if (!online) return window.till.local.refundedHere(record.sale.id, false)
  // Online: what the database knows, plus anything done here that has not been sent yet.
  const out = await window.till.local.refundedHere(record.sale.id, true)
  const { data, error } = await supabase.from('refund_items').select('sale_item_id, quantity').in('sale_item_id', record.items.map((i) => i.id))
  if (error) throw new Error(error.message)
  for (const row of (data ?? []) as Array<{ sale_item_id: string; quantity: number }>) out[row.sale_item_id] = (out[row.sale_item_id] ?? 0) + Number(row.quantity)
  return out
}
