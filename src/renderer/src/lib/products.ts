// Fetch the shop's whole product list once, so scanning never waits for the internet.
// (Phase 3 keeps this list in a local database on the till PC so it survives with no connection.)
import { supabase } from './supabase'
import { toProduct, type Product, type ProductRow } from '../../../shared/products'

const PAGE = 1000 // the database hands over at most 1,000 rows per request

export async function loadProducts(onProgress?: (loaded: number) => void): Promise<Product[]> {
  const products: Product[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from('products')
      .select('id, name, till_name, barcode, retail_price, vat_rate')
      .eq('archived', false)
      .order('id')
      .range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as ProductRow[]
    for (const row of rows) products.push(toProduct(row))
    onProgress?.(products.length)
    if (rows.length < PAGE) break
  }
  return products
}
