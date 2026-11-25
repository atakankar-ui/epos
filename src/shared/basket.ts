// The basket: what is being sold right now. Pure sums, no screen and no database,
// so it can be tested on its own.
import type { Product } from './products'

// The shop's rule (decided 24 Nov 2026): a product with no VAT code is sold at 0% VAT.
export const VAT_WHEN_UNKNOWN = 0

export const MAX_QTY = 999

// Money off one line. A percentage follows the line if its quantity changes; an amount is fixed.
export type LineDiscount = { kind: 'percent'; value: number } | { kind: 'amount'; pence: number }

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
  originalUnitPence?: number // set when a manager changed the price on this line
  discount?: LineDiscount
}

export type Basket = { lines: Line[] }

export const emptyBasket: Basket = { lines: [] }

// Before any discount.
export function lineGrossPence(line: Line): number {
  return line.voided ? 0 : line.unitPence * line.qty
}

export function lineDiscountPence(line: Line): number {
  if (line.voided || !line.discount) return 0
  const gross = lineGrossPence(line)
  return line.discount.kind === 'percent' ? Math.round((gross * line.discount.value) / 100) : Math.min(line.discount.pence, gross)
}

// What the customer pays for the line.
export function lineTotalPence(line: Line): number {
  return lineGrossPence(line) - lineDiscountPence(line)
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
    (l) => !l.voided && l.productId === product.id && l.unitPence === unitPence && l.originalUnitPence === undefined && l.discount === undefined && l.qty < MAX_QTY,
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

// A manager changes the price of one line. The price it had is kept for the record.
export function overridePrice(basket: Basket, lineId: string, newUnitPence: number): Basket {
  if (!Number.isInteger(newUnitPence) || newUnitPence < 0) throw new Error('Type the new price in pence first.')
  return {
    lines: basket.lines.map((l) => (l.id === lineId && !l.voided
      ? { ...l, unitPence: newUnitPence, originalUnitPence: l.originalUnitPence ?? l.unitPence }
      : l)),
  }
}

function checkDiscount(d: LineDiscount): void {
  if (d.kind === 'percent' && !(d.value > 0 && d.value <= 100)) throw new Error('A percentage discount is between 1 and 100.')
  if (d.kind === 'amount' && !(Number.isInteger(d.pence) && d.pence > 0)) throw new Error('Type the amount to take off first.')
}

// Put a discount on one line, or take it off again (null).
export function setDiscount(basket: Basket, lineId: string, discount: LineDiscount | null): Basket {
  if (discount) checkDiscount(discount)
  return {
    lines: basket.lines.map((l) => {
      if (l.id !== lineId || l.voided) return l
      const { discount: _old, ...rest } = l
      return discount ? { ...rest, discount } : rest
    }),
  }
}

// Discount everything in the basket right now. A percentage goes on every line. An amount is shared out
// between the lines by size, so the VAT on each rate stays right; the pennies always add up exactly.
export function discountAll(basket: Basket, discount: LineDiscount | null): Basket {
  if (discount) checkDiscount(discount)
  const live = basket.lines.filter((l) => !l.voided)
  const share = new Map<string, LineDiscount | null>()
  if (!discount || discount.kind === 'percent') {
    for (const l of live) share.set(l.id, discount)
  } else {
    const gross = live.reduce((s, l) => s + lineGrossPence(l), 0)
    const off = Math.min(discount.pence, gross)
    let given = 0
    for (const l of live) {
      const part = gross === 0 ? 0 : Math.floor((off * lineGrossPence(l)) / gross)
      given += part
      share.set(l.id, part > 0 ? { kind: 'amount', pence: part } : null)
    }
    const biggest = [...live].sort((a, b) => lineGrossPence(b) - lineGrossPence(a))[0]
    if (biggest && off - given > 0) {
      const had = share.get(biggest.id)
      share.set(biggest.id, { kind: 'amount', pence: (had && had.kind === 'amount' ? had.pence : 0) + (off - given) })
    }
  }
  let next = basket
  for (const [id, d] of share) next = setDiscount(next, id, d)
  return next
}

export function voidLine(basket: Basket, lineId: string): Basket {
  return { lines: basket.lines.map((l) => (l.id === lineId ? { ...l, voided: true } : l)) }
}

export type RateTotal = { rate: number; grossPence: number; vatPence: number; netPence: number }

export type Totals = {
  totalPence: number // what the customer pays
  vatPence: number
  discountPence: number // taken off by discounts, already left out of totalPence
  itemCount: number
  byRate: RateTotal[] // highest rate first
}

// VAT is worked out line by line, then the lines are added up for each rate.
export function totals(basket: Basket): Totals {
  const byRate = new Map<number, RateTotal>()
  let totalPence = 0
  let itemCount = 0
  let discountPence = 0
  for (const line of basket.lines) {
    if (line.voided) continue
    const gross = lineTotalPence(line)
    const vat = lineVatPence(line)
    totalPence += gross
    itemCount += line.qty
    discountPence += lineDiscountPence(line)
    const entry = byRate.get(line.vatRate) ?? { rate: line.vatRate, grossPence: 0, vatPence: 0, netPence: 0 }
    entry.grossPence += gross
    entry.vatPence += vat
    entry.netPence += gross - vat
    byRate.set(line.vatRate, entry)
  }
  const list = [...byRate.values()].sort((a, b) => b.rate - a.rate)
  return { totalPence, vatPence: list.reduce((sum, r) => sum + r.vatPence, 0), discountPence, itemCount, byRate: list }
}

export function hasLiveLines(basket: Basket): boolean {
  return basket.lines.some((l) => !l.voided)
}
