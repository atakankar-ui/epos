// The till's side of a card payment.
//
// The till never talks to Stripe itself and never holds a Stripe secret. It asks a small
// server function ("till-card", a Supabase edge function) to do three things:
//   start   send this amount to this till's card reader
//   status  has the customer paid yet?
//   cancel  clear the reader
// The reader then shows the amount on its own, and the till waits for the answer.
import { supabase } from './supabase'

export type CardOutcome =
  | { kind: 'approved'; paymentIntentId: string; brand: string | null; last4: string | null }
  | { kind: 'declined'; message: string }
  | { kind: 'cancelled' }
  | { kind: 'unavailable'; message: string } // nothing was charged: not set up, reader off, no internet at the start
  | { kind: 'unknown'; message: string } // lost touch mid-payment: the reader's own screen has the answer

export type CardStage = 'sending' | 'waiting' | 'cancelling' | 'checking'

type Reply = {
  state?: 'waiting' | 'approved' | 'declined' | 'cancelled'
  payment_intent_id?: string
  brand?: string | null
  last4?: string | null
  message?: string
}

type CallResult = { ok: true; reply: Reply } | { ok: false; network: boolean; message: string }

async function call(body: Record<string, unknown>): Promise<CallResult> {
  const { data, error } = await supabase.functions.invoke('till-card', { body })
  if (!error) return { ok: true, reply: (data ?? {}) as Reply }
  if (error.name === 'FunctionsFetchError') return { ok: false, network: true, message: 'No internet connection.' }
  // The function answered with an error: read the reason it gave, if any.
  let message = 'Card payments are not set up for this till yet.'
  try {
    const response = (error as { context?: Response }).context
    // 404 = the server function is not there at all; keep the plain wording for that.
    const detail = response && response.status !== 404 ? ((await response.json()) as { message?: string }) : null
    if (detail?.message) message = detail.message
  } catch { /* keep the default wording */ }
  return { ok: false, network: false, message }
}

const POLL_MS = 1500
const GIVE_UP_AFTER_FAILED_CHECKS = 20 // about 30 seconds with no answer
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export async function takeCardPayment(input: {
  saleId: string // also stops the same sale being charged twice if "start" is sent again
  tillId: string
  amountPence: number
  onStage: (stage: CardStage) => void
  cancelRequested: () => boolean
}): Promise<CardOutcome> {
  input.onStage('sending')
  const started = await call({ action: 'start', sale_id: input.saleId, till_id: input.tillId, amount_pence: input.amountPence })
  if (!started.ok) return { kind: 'unavailable', message: started.message }
  const paymentIntentId = started.reply.payment_intent_id
  if (!paymentIntentId) return { kind: 'unavailable', message: started.reply.message ?? 'The card reader did not accept the payment.' }

  let cancelSent = false
  let failedChecks = 0
  for (;;) {
    if (input.cancelRequested() && !cancelSent) {
      cancelSent = true
      input.onStage('cancelling')
      await call({ action: 'cancel', payment_intent_id: paymentIntentId, till_id: input.tillId })
      // Keep checking: if the customer tapped at the same moment, the payment may still have gone through.
    }
    await wait(POLL_MS)
    const checked = await call({ action: 'status', payment_intent_id: paymentIntentId, till_id: input.tillId })
    if (!checked.ok) {
      failedChecks++
      input.onStage('checking')
      if (failedChecks >= GIVE_UP_AFTER_FAILED_CHECKS) {
        return { kind: 'unknown', message: 'Lost contact while the card was being taken. Look at the card reader: if it says Approved, the customer HAS paid.' }
      }
      continue
    }
    failedChecks = 0
    const reply = checked.reply
    if (reply.state === 'approved') return { kind: 'approved', paymentIntentId, brand: reply.brand ?? null, last4: reply.last4 ?? null }
    if (reply.state === 'declined') return { kind: 'declined', message: reply.message ?? 'The card was declined.' }
    if (reply.state === 'cancelled') return { kind: 'cancelled' }
    input.onStage(cancelSent ? 'cancelling' : 'waiting')
  }
}
