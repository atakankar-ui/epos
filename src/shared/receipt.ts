// What a receipt says. UK rules for a VAT receipt: the shop's name, address and VAT number,
// date and time, a receipt number, each item with its price, the total, VAT split by rate,
// how it was paid, and the change given.
import { formatPence, formatRate } from './money'
import type { ReceiptLine } from './escpos'
import type { SaleRecord } from './sale'
import type { RefundRecord } from './refund'

export type ShopDetails = {
  name: string
  address: string | null // lines separated by new lines
  vatNumber: string | null
  footer: string | null
}

const pence = (pounds: number | null | undefined): number => Math.round((pounds ?? 0) * 100)

function qty(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(3)
}

export function buildReceipt(input: {
  record: SaleRecord
  shop: ShopDetails
  tillName: string
  timeZone?: string // the PC's own time zone unless told otherwise
  copy?: boolean
}): ReceiptLine[] {
  const { record, shop } = input
  const lines: ReceiptLine[] = []
  const text = (t: string, extra: Partial<Extract<ReceiptLine, { kind: 'text' }>> = {}) => lines.push({ kind: 'text', text: t, ...extra })

  text(shop.name, { align: 'centre', bold: true, big: true })
  for (const part of (shop.address ?? '').split('\n').map((p) => p.trim()).filter(Boolean)) text(part, { align: 'centre' })
  if (shop.vatNumber?.trim()) text(`VAT No. ${shop.vatNumber.trim()}`, { align: 'centre' })
  lines.push({ kind: 'blank' })

  const when = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: input.timeZone,
  }).format(new Date(record.sale.sold_at)).replace(',', '')
  lines.push({ kind: 'pair', left: when, right: input.tillName })
  text(`Receipt ${record.sale.receipt_no}`)
  if (input.copy) text('** COPY **', { align: 'centre', bold: true })
  lines.push({ kind: 'rule' })

  const sold = record.items.filter((item) => !item.voided)
  const byRate = new Map<number, { gross: number; vat: number }>()
  let count = 0
  for (const item of sold) {
    const gross = pence(item.line_total)
    const off = pence(item.discount_amount)
    lines.push({ kind: 'pair', left: item.name, right: formatPence(gross + off) })
    if (item.quantity !== 1) text(`  ${qty(item.quantity)} x ${formatPence(pence(item.unit_price))}`)
    if (off > 0) lines.push({ kind: 'pair', left: '  Discount', right: `-${formatPence(off)}` })
    const entry = byRate.get(item.vat_rate) ?? { gross: 0, vat: 0 }
    entry.gross += gross
    entry.vat += pence(item.vat_amount)
    byRate.set(item.vat_rate, entry)
    count += item.quantity
  }
  lines.push({ kind: 'rule' })

  if (pence(record.sale.discount_total) > 0) lines.push({ kind: 'pair', left: 'You saved', right: formatPence(pence(record.sale.discount_total)) })
  lines.push({ kind: 'pair', left: 'TOTAL', right: formatPence(pence(record.sale.total)), bold: true, big: true })
  text(`${qty(count)} ${count === 1 ? 'item' : 'items'}`)
  lines.push({ kind: 'blank' })

  for (const payment of record.payments) {
    if (payment.method === 'cash') {
      lines.push({ kind: 'pair', left: 'Cash', right: formatPence(pence(payment.tendered ?? payment.amount)) })
      lines.push({ kind: 'pair', left: 'Change', right: formatPence(pence(payment.change_given)) })
    } else {
      const card = ['Card', payment.card_brand, payment.card_last4 && `****${payment.card_last4}`].filter(Boolean).join(' ')
      lines.push({ kind: 'pair', left: card, right: formatPence(pence(payment.amount)) })
    }
  }
  lines.push({ kind: 'blank' })

  text('VAT included in the total:')
  for (const [rate, sums] of [...byRate.entries()].sort((a, b) => b[0] - a[0])) {
    lines.push({ kind: 'pair', left: `${formatRate(rate)} on ${formatPence(sums.gross - sums.vat)} net`, right: formatPence(sums.vat) })
  }
  lines.push({ kind: 'pair', left: 'Total VAT', right: formatPence(pence(record.sale.vat_total)) })

  if (shop.footer?.trim()) {
    lines.push({ kind: 'blank' })
    for (const part of shop.footer.split('\n').map((p) => p.trim()).filter(Boolean)) text(part, { align: 'centre' })
  }
  return lines
}

export function buildRefundReceipt(input: { record: RefundRecord; shop: ShopDetails; tillName: string; timeZone?: string }): ReceiptLine[] {
  const { record, shop } = input
  const lines: ReceiptLine[] = []
  const text = (t: string, extra: Partial<Extract<ReceiptLine, { kind: 'text' }>> = {}) => lines.push({ kind: 'text', text: t, ...extra })
  text(shop.name, { align: 'centre', bold: true, big: true })
  for (const part of (shop.address ?? '').split('\n').map((p) => p.trim()).filter(Boolean)) text(part, { align: 'centre' })
  if (shop.vatNumber?.trim()) text(`VAT No. ${shop.vatNumber.trim()}`, { align: 'centre' })
  lines.push({ kind: 'blank' })
  text('REFUND', { align: 'centre', bold: true, big: true })
  const when = new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: input.timeZone,
  }).format(new Date(record.refund.refunded_at)).replace(',', '')
  lines.push({ kind: 'pair', left: when, right: input.tillName })
  text(`Refund ${record.refund.receipt_no}`)
  text(record.originalReceiptNo ? `For receipt ${record.originalReceiptNo}` : 'No receipt')
  lines.push({ kind: 'rule' })
  for (const item of record.items) {
    lines.push({ kind: 'pair', left: item.name, right: `-${formatPence(pence(item.line_total))}` })
    if (item.quantity !== 1) text(`  ${qty(item.quantity)} x ${formatPence(pence(item.unit_price))}`)
  }
  lines.push({ kind: 'rule' })
  lines.push({ kind: 'pair', left: 'REFUNDED', right: formatPence(pence(record.refund.total)), bold: true, big: true })
  lines.push({ kind: 'pair', left: record.refund.method === 'cash' ? 'Paid back in cash' : 'Paid back to card', right: formatPence(pence(record.refund.total)) })
  lines.push({ kind: 'pair', left: 'VAT in this refund', right: formatPence(pence(record.refund.vat_total)) })
  text(`Reason: ${record.refund.reason}`)
  return lines
}

export function testReceipt(shop: ShopDetails, tillName: string, columns: number): ReceiptLine[] {
  return [
    { kind: 'text', text: shop.name, align: 'centre', bold: true, big: true },
    { kind: 'text', text: 'Printer test', align: 'centre' },
    { kind: 'rule' },
    { kind: 'pair', left: tillName, right: `${columns} characters wide` },
    { kind: 'pair', left: 'Pound sign', right: '£1.49' },
    { kind: 'text', text: 'If this line of dashes fits on one line, the width is right:' },
    { kind: 'rule' },
    { kind: 'text', text: 'Left' },
    { kind: 'text', text: 'Centre', align: 'centre' },
    { kind: 'text', text: 'Right', align: 'right' },
  ]
}
