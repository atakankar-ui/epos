// Connecting a till PC to its shop (done once, needs internet), and keeping its
// copy of the products fresh afterwards.
import { supabase } from './supabase'
import { loadShop } from './shop'
import { loadProducts } from './products'
import type { Binding } from '../../../shared/local'

// Register this PC as the shop's next till: "Till 1" / T1, "Till 2" / T2 ...
async function registerTill(): Promise<{ id: string; name: string; receipt_prefix: string }> {
  const { data: existing, error } = await supabase.from('tills').select('name, receipt_prefix')
  if (error) throw new Error(error.message)
  const names = new Set((existing ?? []).map((t) => t.name))
  const prefixes = new Set((existing ?? []).map((t) => t.receipt_prefix))
  let n = 1
  while (names.has(`Till ${n}`) || prefixes.has(`T${n}`)) n++
  const { data, error: insertError } = await supabase
    .from('tills')
    .insert({ name: `Till ${n}`, receipt_prefix: `T${n}` })
    .select('id, name, receipt_prefix')
    .single()
  if (insertError) throw new Error(insertError.message)
  return data
}

export async function connectTill(userId: string, email: string, onProgress: (text: string) => void): Promise<Binding> {
  onProgress('Finding the shop…')
  const shop = await loadShop(userId)
  onProgress('Registering this till…')
  const till = await registerTill()
  const binding: Binding = {
    orgId: shop.id, orgName: shop.name, userId, email,
    tillId: till.id, tillName: till.name, receiptPrefix: till.receipt_prefix,
  }
  onProgress('Downloading products…')
  const products = await loadProducts((n) => onProgress(`Downloading products… ${n.toLocaleString('en-GB')}`))
  await window.till.local.replaceProducts(products)
  await window.till.local.bind(binding)
  return binding
}

// Fetch the latest products and prices into the local copy. Returns false (and changes
// nothing) if the sign-in is currently acting in a different shop: its products must
// never be mixed into this till.
export async function refreshProducts(binding: Binding): Promise<boolean> {
  const { data: orgId, error } = await supabase.rpc('current_org')
  if (error) throw new Error(error.message)
  if (orgId !== binding.orgId) return false
  const products = await loadProducts()
  await window.till.local.replaceProducts(products)
  return true
}
