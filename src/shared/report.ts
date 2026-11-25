// X and Z reports. Both show the same figures for the trading day so far.
//   X = a look at any time; nothing changes.
//   Z = the end of the day: the figures are fixed, the day closes and a new one starts.
import { formatPence, formatRate } from './money'
import type { ReceiptLine } from './escpos'
import type { ShopDetails } from './receipt'
import type { SaleRecord } from './sale'
import type { RefundRecord } from './refund'
import type { AuditRow } from './audit'

// One trading day on one till.
export type DayInfo = {
  id: string
  zNumber: number
  openedAt: string
  openedBy: string | null
  floatPence: number // cash put in the drawer at the start
  closedAt: string | null
  closedBy: string | null
  countedPence: number | null
  report: Report | null // the Z report, once closed
}

export type RateLine = { rate: number; grossPence: number; netPence: number; vatPence: number }

// All money in whole pence. This is also exactly what is saved to the database.
export type Report = {
  version: 1
  kind: 'X' | 'Z'
  zNumber: number
  tillName: string
  openedAt: string
  generatedAt: string
  sales: { count: number; items: number; totalPence: number }
  payments: { cashPence: number; cardPence: number }
  vat: RateLine[] // on sales, highest rate first
  refunds: { count: number; totalPence: number; cashPence: number; cardPence: number; vatPence: number }
  netPence: number // sales less refunds
  netVatPence: number // VAT on sales less VAT in refunds
  voids: { lineCount: number; linePence: number; saleCount: number; salePence: number }
  discounts: { count: number; pence: number } // lines sold for less: a manager's price change, or a discount
  noSales: number // drawer opened with no sale
  drawer: {
    floatPence: number
    cashSalesPence: number
    cashRefundsPence: number
    expectedPence: number
    countedPence: number | null
    differencePence: number | null // counted less expected: minus means short
  }
  // Card takings on the till (sales less refunds) against the card machine's own end-of-day total, when typed in.
  cardCheck?: { tillPence: number; machinePence: number; differencePence: number } | null
}

const p = (pounds: number | null | undefined): number => Math.round((pounds ?? 0) * 100)

export function buildReport(input: {
  kind: 'X' | 'Z'
  day: DayInfo
  tillName: string
  sales: SaleRecord[]
  refunds: RefundRecord[]
  audits: AuditRow[]
  at: Date
  countedPence?: number | null
  cardMachinePence?: number | null
}): Report {
  const { day } = input
  const byRate = new Map<number, RateLine>()
  let items = 0, total = 0, cash = 0, card = 0, discountCount = 0, discountPence = 0

  for (const record of input.sales) {
    total += p(record.sale.total)
    for (const pay of record.payments) {
      if (pay.method === 'cash') cash += p(pay.amount)
      else card += p(pay.amount)
    }
    for (const item of record.items) {
      if (item.voided) continue
      items += item.quantity
      const gross = p(item.line_total), vat = p(item.vat_amount)
      const line = byRate.get(item.vat_rate) ?? { rate: item.vat_rate, grossPence: 0, netPence: 0, vatPence: 0 }
      line.grossPence += gross
      line.vatPence += vat
      line.netPence += gross - vat
      byRate.set(item.vat_rate, line)
      if (item.original_unit_price !== null && item.original_unit_price > item.unit_price) {
        discountCount++
        discountPence += Math.round((p(item.original_unit_price) - p(item.unit_price)) * item.quantity)
      }
      if (p(item.discount_amount) > 0) {
        discountCount++
        discountPence += p(item.discount_amount)
      }
    }
  }

  let refundTotal = 0, refundCash = 0, refundCard = 0, refundVat = 0
  for (const record of input.refunds) {
    const amount = p(record.refund.total)
    refundTotal += amount
    refundVat += p(record.refund.vat_total)
    if (record.refund.method === 'cash') refundCash += amount
    else refundCard += amount
  }

  const of = (action: string) => input.audits.filter((a) => a.action === action)
  const sum = (rows: AuditRow[]) => rows.reduce((s, a) => s + p(a.amount), 0)
  const vat = [...byRate.values()].sort((a, b) => b.rate - a.rate)
  const vatTotal = vat.reduce((s, r) => s + r.vatPence, 0)
  const expected = day.floatPence + cash - refundCash
  const counted = input.countedPence ?? null

  return {
    version: 1,
    kind: input.kind,
    zNumber: day.zNumber,
    tillName: input.tillName,
    openedAt: day.openedAt,
    generatedAt: input.at.toISOString(),
    sales: { count: input.sales.length, items, totalPence: total },
    payments: { cashPence: cash, cardPence: card },
    vat,
    refunds: { count: input.refunds.length, totalPence: refundTotal, cashPence: refundCash, cardPence: refundCard, vatPence: refundVat },
    netPence: total - refundTotal,
    netVatPence: vatTotal - refundVat,
    voids: { lineCount: of('void_line').length, linePence: sum(of('void_line')), saleCount: of('void_sale').length, salePence: sum(of('void_sale')) },
    discounts: { count: discountCount, pence: discountPence },
    noSales: of('no_sale').length,
    drawer: {
      floatPence: day.floatPence, cashSalesPence: cash, cashRefundsPence: refundCash, expectedPence: expected,
      countedPence: counted, differencePence: counted === null ? null : counted - expected,
    },
    cardCheck: input.cardMachinePence === null || input.cardMachinePence === undefined ? null
      : { tillPence: card - refundCard, machinePence: input.cardMachinePence, differencePence: input.cardMachinePence - (card - refundCard) },
  }
}

export function reportLines(report: Report, shop: ShopDetails, timeZone?: string): ReceiptLine[] {
  const lines: ReceiptLine[] = []
  const text = (t: string, extra: Partial<Extract<ReceiptLine, { kind: 'text' }>> = {}) => lines.push({ kind: 'text', text: t, ...extra })
  const pair = (left: string, right: string, bold = false) => lines.push({ kind: 'pair', left, right, bold })
  const when = (iso: string) => new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false, timeZone,
  }).format(new Date(iso)).replace(',', '')
  const count = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(3))

  text(shop.name, { align: 'centre', bold: true })
  if (shop.vatNumber?.trim()) text(`VAT No. ${shop.vatNumber.trim()}`, { align: 'centre' })
  text(`${report.kind} REPORT`, { align: 'centre', bold: true, big: true })
  text(report.kind === 'Z' ? 'End of day. The day is now closed.' : 'A look at the day so far. Nothing is reset.', { align: 'centre' })
  lines.push({ kind: 'blank' })
  pair(report.tillName, `Z number ${report.zNumber}`)
  pair('Day started', when(report.openedAt))
  pair(report.kind === 'Z' ? 'Day closed' : 'Printed', when(report.generatedAt))
  lines.push({ kind: 'rule' })

  pair(`Sales (${report.sales.count}, ${count(report.sales.items)} items)`, formatPence(report.sales.totalPence), true)
  pair('  Cash', formatPence(report.payments.cashPence))
  pair('  Card', formatPence(report.payments.cardPence))
  pair(`Refunds (${report.refunds.count})`, `-${formatPence(report.refunds.totalPence)}`)
  pair('Sales less refunds', formatPence(report.netPence), true)
  lines.push({ kind: 'rule' })

  text('VAT on sales', { bold: true })
  for (const r of report.vat) pair(`  ${formatRate(r.rate)} on ${formatPence(r.netPence)} net`, formatPence(r.vatPence))
  if (report.vat.length === 0) text('  No sales')
  pair('  VAT in refunds', `-${formatPence(report.refunds.vatPence)}`)
  pair('VAT after refunds', formatPence(report.netVatPence), true)
  lines.push({ kind: 'rule' })

  pair(`Voided lines (${report.voids.lineCount})`, formatPence(report.voids.linePence))
  pair(`Voided sales (${report.voids.saleCount})`, formatPence(report.voids.salePence))
  pair(`Discounts and reductions (${report.discounts.count})`, formatPence(report.discounts.pence))
  pair('Drawer opened with no sale', String(report.noSales))
  lines.push({ kind: 'rule' })

  text('Cash in the drawer', { bold: true })
  pair('  Float at start', formatPence(report.drawer.floatPence))
  pair('  Cash sales', formatPence(report.drawer.cashSalesPence))
  pair('  Cash refunds', `-${formatPence(report.drawer.cashRefundsPence)}`)
  pair('Should be in the drawer', formatPence(report.drawer.expectedPence), true)
  if (report.drawer.countedPence !== null && report.drawer.differencePence !== null) {
    pair('Counted', formatPence(report.drawer.countedPence))
    const d = report.drawer.differencePence
    pair(d === 0 ? 'Exactly right' : d > 0 ? 'Over by' : 'Short by', formatPence(Math.abs(d)), true)
  }
  if (report.cardCheck) {
    lines.push({ kind: 'rule' })
    text('Card machine check', { bold: true })
    pair('  Card sales', formatPence(report.payments.cardPence))
    pair('  Card refunds', `-${formatPence(report.refunds.cardPence)}`)
    pair('Till says card took', formatPence(report.cardCheck.tillPence), true)
    pair('Card machine says', formatPence(report.cardCheck.machinePence))
    const c = report.cardCheck.differencePence
    pair(c === 0 ? 'They match' : c > 0 ? 'Card machine took more by' : 'Card machine took less by', formatPence(Math.abs(c)), true)
  }
  return lines
}
