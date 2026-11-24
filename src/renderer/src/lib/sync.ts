// Sends sales saved on this PC to the shared database, in the background.
// A sale is only marked "sent" when the sale, its lines and its payment are all in.
// Sending the same sale twice is harmless: the database ignores rows it already has.
import { supabase } from './supabase'
import type { Binding } from '../../../shared/local'
import type { SaleRecord } from '../../../shared/sale'

export type Link = 'online' | 'offline' | 'signin'

export type SyncStatus = {
  link: Link
  waiting: number
  refused: number
  lastRefusal: string | null
}

type Failure = { kind: 'offline' | 'signin' | 'refused'; message: string }

function classify(error: { message?: string; code?: string }, status: number): Failure {
  const message = error.message ?? 'Unknown error'
  if (status === 0 || /failed to fetch|fetch failed|networkerror|load failed/i.test(message)) {
    return { kind: 'offline', message }
  }
  if (status === 401 || error.code === 'PGRST301' || error.code === 'PGRST303') return { kind: 'signin', message }
  return { kind: 'refused', message }
}

async function upload(record: SaleRecord): Promise<Failure | null> {
  const steps: Array<[string, object[]]> = [
    ['sales', [record.sale]],
    ['sale_items', record.items],
    ['payments', record.payments],
  ]
  for (const [table, rows] of steps) {
    if (rows.length === 0) continue
    const { error, status } = await supabase.from(table).upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
    if (error) return classify(error, status)
  }
  return null
}

// With nothing to send, ask the database one small question to see if it is reachable.
async function ping(binding: Binding): Promise<Failure | null> {
  const { error, status } = await supabase.from('tills').select('id').eq('id', binding.tillId).limit(1)
  return error ? classify(error, status) : null
}

// One pass: send what is waiting, oldest first. Returns where things stand.
export async function syncOnce(binding: Binding): Promise<SyncStatus> {
  const local = window.till.local
  let link: Link = 'online'

  // Without a signed-in session the database would refuse every row; don't even try.
  const { data } = await supabase.auth.getSession()
  if (!data.session) {
    link = navigator.onLine ? 'signin' : 'offline'
  } else {
    const waiting = await local.pendingSales(50)
    if (waiting.length === 0) {
      const failure = await ping(binding)
      if (failure) link = failure.kind === 'signin' ? 'signin' : failure.kind === 'offline' ? 'offline' : 'online'
    }
    for (const sale of waiting) {
      const failure = await upload(sale.record)
      if (!failure) {
        await local.markSynced(sale.id)
      } else if (failure.kind === 'refused') {
        await local.markRefused(sale.id, failure.message) // kept, tried again next pass
      } else {
        link = failure.kind
        break // no connection or no sign-in: the rest would fail the same way
      }
    }
  }

  const state = await local.getState()
  return { link, waiting: state.waiting, refused: state.refused, lastRefusal: state.lastRefusal }
}
