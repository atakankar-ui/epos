// The basket: what is being sold right now. Pure sums, no screen and no database,
// so it can be tested on its own.
import type { Product } from './products'

// The shop's rule (decided 24 Nov 2026): a product with no VAT code is sold at 0% VAT.
export const VAT_WHEN_UNKNOWN = 0

export const MAX_QTY = 999

export type Line = {
  id: string
  productId: string | null // null for a typed-in "Misc item"
  name: string
  barcode: string | null
  unitPence: number // price of one, VAT included
  qty: number
  vatRate: number // 0.2, 0.05 or 0
  voided: boolean // a voided line stays visible, struck through, but counts for nothing
  priceKeyed: boolean // true when the cashier typed the price (no price on the product)
}

export type Basket = { lines: Line[] }

export const emptyBasket: Basket = { lines: [] }

export function lineTotalPence(line: Line): number {
  return line.voided ? 0 : line.unitPence * line.qty
}

// Prices include VAT, so the VAT inside a price is price x rate / (1 + rate).
export function vatInside(grossPence: number, rate: number): number {
  return Math.round((grossPence * rate) / (1 + rate))
}

export function lineVatPence(line: Line): number {
  return vatInside(lineTotalPence(line), line.vatRate)
}

// Scan a product. A second scan of the same item at the same price adds one to
// the line already there instead of making a new line.
export function addProduct(
  basket: Basket,
  product: Product,
  newLineId: string,
  keyedPricePence?: number,
): { basket: Basket; lineId: string } {
  const unitPence = keyedPricePence ?? product.pricePence
  if (unitPence === null || unitPence === undefined || unitPence <= 0) {
    throw new Error('This product has no price.')
  }
  const existing = basket.lines.find(
    (l) => !l.voided && l.productId === product.id && l.unitPence === unitPence && l.qty < MAX_QTY,
  )
  if (existing) {
    return { basket: setQty(basket, existing.id, existing.qty + 1), lineId: existing.id }
  }
  const line: Line = {
    id: newLineId,
    productId: product.id,
    name: product.name,
    barcode: product.barcode,
    unitPence,
    qty: 1,
    vatRate: product.vatRate ?? VAT_WHEN_UNKNOWN,
    voided: false,
    priceKeyed: keyedPricePence !== undefined,
  }
  return { basket: { lines: [...basket.lines, line] }, lineId: newLineId }
}

export function addMiscItem(basket: Basket, pricePence: number, newLineId: string): Basket {
  if (!Number.isInteger(pricePence) || pricePence <= 0) throw new Error('Type a price first.')
  const line: Line = {
    id: newLineId,
    productId: null,
    name: 'Misc item',
    barcode: null,
    unitPence: pricePence,
    qty: 1,
    vatRate: VAT_WHEN_UNKNOWN,
    voided: false,
    priceKeyed: true,
  }
  return { lines: [...basket.lines, line] }
}

export function setQty(basket: Basket, lineId: string, qty: number): Basket {
  if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
    throw new Error(`Quantity must be between 1 and ${MAX_QTY}.`)
  }
  return {
    lines: basket.lines.map((l) => (l.id === lineId && !l.voided ? { ...l, qty } : l)),
  }
}

export function voidLine(basket: Basket, lineId: string): Basket {
  return { lines: basket.lines.map((l) => (l.id === lineId ? { ...l, voided: true } : l)) }
}

export type RateTotal = { rate: number; grossPence: number; vatPence: number; netPence: number }

export type Totals = {
  totalPence: number // what the customer pays
  vatPence: number
  itemCount: number
  byRate: RateTotal[] // highest rate first
}

// VAT is worked out line by line, then the lines are added up for each rate.
export function totals(basket: Basket): Totals {
  const byRate = new Map<number, RateTotal>()
  let totalPence = 0
  let itemCount = 0
  for (const line of basket.lines) {
    if (line.voided) continue
    const gross = lineTotalPence(line)
    const vat = lineVatPence(line)
    totalPence += gross
    itemCount += line.qty
    const entry = byRate.get(line.vatRate) ?? { rate: line.vatRate, grossPence: 0, vatPence: 0, netPence: 0 }
    entry.grossPence += gross
    entry.vatPence += vat
    entry.netPence += gross - vat
    byRate.set(line.vatRate, entry)
  }
  const list = [...byRate.values()].sort((a, b) => b.rate - a.rate)
  return { totalPence, vatPence: list.reduce((sum, r) => sum + r.vatPence, 0), itemCount, byRate: list }
}

export function hasLiveLines(basket: Basket): boolean {
  return basket.lines.some((l) => !l.voided)
}
