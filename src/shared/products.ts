import { poundsToPence } from './money'

// A product as the till needs it. Comes from Retail Aid's products table.
export type Product = {
  id: string
  name: string
  barcode: string | null
  pricePence: number | null // null = no selling price set yet
  vatRate: number | null // null = no VAT code set yet
}

// The row shape the database sends.
export type ProductRow = {
  id: string
  name: string
  till_name: string | null
  barcode: string | null
  retail_price: number | string | null
  vat_rate: number | string | null
}

export function toProduct(row: ProductRow): Product {
  const price = poundsToPence(row.retail_price)
  const rate = row.vat_rate === null || row.vat_rate === '' ? null : Number(row.vat_rate)
  return {
    id: row.id,
    name: (row.till_name && row.till_name.trim()) || row.name,
    barcode: row.barcode && row.barcode.trim() ? row.barcode.trim() : null,
    pricePence: price !== null && price > 0 ? price : null,
    vatRate: rate !== null && Number.isFinite(rate) ? rate : null,
  }
}

// Scanners and labels disagree about zeros at the front (a 12-digit UPC is the
// same item as its 13-digit form with a 0 in front), so compare without them.
function barcodeKey(code: string): string {
  const trimmed = code.trim()
  const stripped = trimmed.replace(/^0+/, '')
  return stripped === '' ? trimmed : stripped
}

export type ProductIndex = {
  all: Product[]
  byBarcode: Map<string, Product>
  searchText: string[] // lower-case name + barcode, same order as `all`
}

export function buildIndex(products: Product[]): ProductIndex {
  const byBarcode = new Map<string, Product>()
  for (const product of products) {
    if (product.barcode) byBarcode.set(barcodeKey(product.barcode), product)
  }
  return {
    all: products,
    byBarcode,
    searchText: products.map((p) => `${p.name} ${p.barcode ?? ''}`.toLowerCase()),
  }
}

export function findByBarcode(index: ProductIndex, code: string): Product | null {
  if (!code.trim()) return null
  return index.byBarcode.get(barcodeKey(code)) ?? null
}

// Every word typed must appear somewhere in the name (or barcode). Names that
// start with the first word come first.
export function searchProducts(index: ProductIndex, query: string, limit = 40): Product[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const starts: Product[] = []
  const rest: Product[] = []
  for (let i = 0; i < index.all.length; i++) {
    const text = index.searchText[i]
    if (!words.every((w) => text.includes(w))) continue
    if (text.startsWith(words[0])) starts.push(index.all[i])
    else rest.push(index.all[i])
    if (starts.length >= limit) break
  }
  return starts.concat(rest).slice(0, limit)
}
