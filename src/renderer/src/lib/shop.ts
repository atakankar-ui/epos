// Everything the "connection check" page asks the database.
import { supabase } from './supabase'

export type ShopInfo = {
  id: string
  name: string
  role: 'buyer' | 'staff'
}

export type Check = {
  label: string
  state: 'ok' | 'todo' | 'problem'
  detail: string
}

// Which shop is this sign-in acting in? Same rule as Retail Aid: the shop the
// profile points at, else the first shop the person belongs to.
export async function loadShop(userId: string): Promise<ShopInfo> {
  const { data: orgId, error: orgError } = await supabase.rpc('current_org')
  if (orgError) throw new Error(orgError.message)
  if (!orgId) throw new Error('This sign-in does not belong to a shop yet.')

  const [{ data: org, error: e1 }, { data: member, error: e2 }] = await Promise.all([
    supabase.from('orgs').select('id, name').eq('id', orgId).maybeSingle(),
    supabase.from('memberships').select('role').eq('org_id', orgId).eq('user_id', userId).maybeSingle(),
  ])
  if (e1) throw new Error(e1.message)
  if (e2) throw new Error(e2.message)
  if (!org) throw new Error('The shop for this sign-in could not be read.')

  return { id: org.id, name: org.name, role: member?.role === 'buyer' ? 'buyer' : 'staff' }
}

async function countProducts(filter?: 'priced' | 'barcoded' | 'vat'): Promise<number> {
  let q = supabase.from('products').select('id', { count: 'exact', head: true }).eq('archived', false)
  if (filter === 'priced') q = q.gt('retail_price', 0)
  if (filter === 'barcoded') q = q.not('barcode', 'is', null)
  if (filter === 'vat') q = q.not('vat_code', 'is', null)
  const { count, error } = await q
  if (error) throw new Error(error.message)
  return count ?? 0
}

const TILL_TABLES = [
  'shop_settings', 'tills', 'staff', 'day_sessions', 'sales', 'sale_items',
  'payments', 'refunds', 'refund_items', 'audit_log',
] as const

// Are the till's own tables in the database yet? (They arrive with the one-off
// database step, "phase 60".) Returns the names that are still missing.
async function missingTillTables(): Promise<string[]> {
  const results = await Promise.all(
    TILL_TABLES.map(async (table) => {
      // A real read, not a "head" request: a head request to a missing table
      // comes back empty and would look like success.
      const { error } = await supabase.from(table).select('org_id').limit(1)
      return error ? table : null
    }),
  )
  return results.filter((t): t is (typeof TILL_TABLES)[number] => t !== null)
}

const n = (value: number) => value.toLocaleString('en-GB')

export async function runChecks(): Promise<Check[]> {
  const checks: Check[] = []

  try {
    const [all, priced, barcoded, vat] = await Promise.all([
      countProducts(), countProducts('priced'), countProducts('barcoded'), countProducts('vat'),
    ])
    checks.push({
      label: 'Products',
      state: all > 0 ? 'ok' : 'todo',
      detail: all > 0 ? `${n(all)} products found for this shop.` : 'This shop has no products yet.',
    })
    checks.push({
      label: 'Shelf prices',
      state: priced === all && all > 0 ? 'ok' : 'todo',
      detail: priced === all
        ? `All ${n(all)} have a selling price.`
        : `${n(priced)} of ${n(all)} have a selling price. For the rest, the till asks the cashier to type the price.`,
    })
    checks.push({
      label: 'Barcodes',
      state: barcoded === all && all > 0 ? 'ok' : 'todo',
      detail: `${n(barcoded)} of ${n(all)} have a barcode.`,
    })
    checks.push({
      label: 'VAT codes',
      state: vat === all && all > 0 ? 'ok' : 'todo',
      detail: `${n(vat)} of ${n(all)} have a VAT code. Receipts and Z-reports need one on every product sold.`,
    })
  } catch (err) {
    checks.push({ label: 'Products', state: 'problem', detail: (err as Error).message })
  }

  const missing = await missingTillTables()
  checks.push({
    label: 'Till tables',
    state: missing.length === 0 ? 'ok' : 'todo',
    detail:
      missing.length === 0
        ? 'Sales, payments, refunds, staff, reports and the audit log are ready.'
        : `Not in the database yet (${missing.length} of ${TILL_TABLES.length} missing). This is the one-off database step that is waiting for the go-ahead.`,
  })

  return checks
}
