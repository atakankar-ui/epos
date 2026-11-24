// Sends sales saved on this PC to the shared database, in the background.
// A sale is only marked "sent" when the sale, its lines and its payment are all in.
// Sending the same sale twice is harmless: the database ignores rows it already has.
import { supabase } from './supabase'
import type { Binding, PendingOther } from '../../../shared/local'
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

async function send(table: string, rows: object[]): Promise<Failure | null> {
  if (rows.length === 0) return null
  const { error, status } = await supabase.from(table).upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
  return error ? classify(error, status) : null
}

async function sendOther(item: PendingOther): Promise<Failure | null> {
  switch (item.kind) {
    case 'refund': return (await send('refunds', [item.record.refund])) ?? (await send('refund_items', item.record.items))
    case 'audit': return send('audit_log', [item.record])
    case 'day_open': return send('day_sessions', [item.record])
    case 'day_close': {
      // Close the day once. If it is already closed there (sent twice), nothing changes and that is fine.
      const { id, ...closing } = item.record
      const { error, status } = await supabase.from('day_sessions').update(closing).eq('id', id).is('closed_at', null)
      return error ? classify(error, status) : null
    }
  }
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
    // Day openings go first: the database will not take a sale for a day it has not heard of.
    for (const item of await local.pendingOther(50, true)) {
      const failure = await sendOther(item)
      if (!failure) await local.markOtherSynced(item.id)
      else if (failure.kind === 'refused') await local.markOtherRefused(item.id, failure.message)
      else { link = failure.kind; break }
    }
    const waiting = link === 'online' ? await local.pendingSales(50) : []
    if (waiting.length === 0 && link === 'online') {
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

    // Then refunds and audit entries, in the order they happened (a refund needs its sale to be there first).
    if (link === 'online') {
      for (const item of await local.pendingOther(100)) {
        const failure = await sendOther(item)
        if (!failure) {
          await local.markOtherSynced(item.id)
        } else if (failure.kind === 'refused') {
          await local.markOtherRefused(item.id, failure.message)
        } else {
          link = failure.kind
          break
        }
      }
    }
  }

  const state = await local.getState()
  return { link, waiting: state.waiting, refused: state.refused, lastRefusal: state.lastRefusal }
}
