// The shop's receipt details (name, address, VAT number, footer). They live in the shared
// database so every till in the shop prints the same, with a copy on each PC for offline use.
import { supabase } from './supabase'
import type { Binding } from '../../../shared/local'
import type { ShopDetails } from '../../../shared/receipt'

export async function pullShopDetails(binding: Binding): Promise<void> {
  const { data, error } = await supabase
    .from('shop_settings')
    .select('trading_name, address, vat_number, receipt_footer')
    .eq('org_id', binding.orgId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return // nothing saved yet: keep whatever this PC has
  await window.till.hardware.setShopDetails({
    name: data.trading_name ?? '', address: data.address, vatNumber: data.vat_number, footer: data.receipt_footer,
  })
}

export async function saveShopDetails(binding: Binding, details: ShopDetails): Promise<void> {
  const { data, error } = await supabase
    .from('shop_settings')
    .upsert({
      org_id: binding.orgId,
      trading_name: details.name.trim() || null,
      address: details.address?.trim() || null,
      vat_number: details.vatNumber?.trim() || null,
      receipt_footer: details.footer?.trim() || null,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'org_id' })
    .select('org_id')
  if (error) {
    throw new Error(/row-level security|permission/i.test(error.message)
      ? 'Only a Buyer login can change the receipt details. This till is signed in with a Staff login.'
      : /failed to fetch/i.test(error.message) ? 'No internet. The receipt details are saved online, so this needs a connection.' : error.message)
  }
  if (!data || data.length === 0) throw new Error('Nothing was saved. Only a Buyer login can change the receipt details.')
  await window.till.hardware.setShopDetails(details)
}
