// Taking the money: cash (with change) or card.
import { useCallback, useEffect, useRef, useState } from 'react'
import { cashSuggestions, formatPence, keyedPence } from '../../../shared/money'
import type { Tender as TenderType } from '../../../shared/sale'
import { takeCardPayment, type CardStage } from '../lib/card'

const KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '00', 'C']

type Done = { receiptNo: string; method: 'cash' | 'card'; changePence: number; card?: string }

const STAGE_TEXT: Record<CardStage, string> = {
  sending: 'Sending the amount to the card reader…',
  waiting: 'Ask the customer to tap, insert or swipe their card.',
  cancelling: 'Cancelling on the card reader…',
  checking: 'Connection lost. Still checking with the card reader…',
}

export function Tender(props: {
  totalPence: number
  online: boolean
  tillId: string
  // Saves the sale on this PC. Returns its receipt number.
  complete: (tender: TenderType, saleId?: string) => Promise<{ receiptNo: string }>
  onBack: () => void // nothing was paid: back to the basket
  onFinished: (done: Done) => void // paid and saved: next customer
}) {
  const { totalPence, online } = props
  const [entry, setEntry] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cardStage, setCardStage] = useState<CardStage | null>(null)
  const [done, setDone] = useState<Done | null>(null)
  const cancelCard = useRef(false)

  const given = keyedPence(entry) ?? 0
  const enough = given >= totalPence
  const failure = (err: unknown) => (err as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')

  const takeCash = useCallback(async (tenderedPence: number) => {
    if (busy || tenderedPence < totalPence) return
    setBusy(true)
    setError(null)
    try {
      const { receiptNo } = await props.complete({ method: 'cash', tenderedPence })
      setDone({ receiptNo, method: 'cash', changePence: tenderedPence - totalPence })
    } catch (err) {
      setError(`The sale was NOT saved: ${failure(err)}`)
    } finally {
      setBusy(false)
    }
  }, [busy, props, totalPence])

  async function takeCard() {
    if (busy || !online) return
    setBusy(true)
    setError(null)
    cancelCard.current = false
    const saleId = crypto.randomUUID()
    const outcome = await takeCardPayment({
      saleId, tillId: props.tillId, amountPence: totalPence,
      onStage: setCardStage, cancelRequested: () => cancelCard.current,
    })
    setCardStage(null)
    if (outcome.kind === 'approved') {
      try {
        const { receiptNo } = await props.complete(
          { method: 'card', paymentIntentId: outcome.paymentIntentId, brand: outcome.brand, last4: outcome.last4 }, saleId)
        setDone({ receiptNo, method: 'card', changePence: 0, card: [outcome.brand, outcome.last4 && `ending ${outcome.last4}`].filter(Boolean).join(' ') })
      } catch (err) {
        setError(`The card WAS charged ${formatPence(totalPence)}, but the sale was NOT saved: ${failure(err)} Do not charge the customer again. Tell the manager.`)
      }
    } else if (outcome.kind === 'declined') setError(`Card declined: ${outcome.message} Nothing was charged. Try another card, or take cash.`)
    else if (outcome.kind === 'cancelled') setError('Card payment cancelled. Nothing was charged.')
    else setError(outcome.message)
    setBusy(false)
  }

  // Keyboard and scanner: digits are cash given; a scan must never add items while paying.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      event.stopPropagation()
      if (done) { if (event.key === 'Enter') props.onFinished(done); return }
      if (busy) return
      if (/^\d$/.test(event.key)) setEntry((e) => (e + event.key).slice(0, 7))
      else if (event.key === 'Backspace') setEntry((e) => e.slice(0, -1))
      else if (event.key === 'Enter') { event.preventDefault(); if (enough) void takeCash(given) }
      else if (event.key === 'Escape') props.onBack()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [busy, done, enough, given, props, takeCash])

  if (done) {
    return (
      <div className="overlay" role="dialog" aria-label="Sale complete">
        <div className="tender done">
          {done.method === 'cash' ? (
            <>
              <p className="muted big">Change to give</p>
              <p className="change" data-testid="change">{formatPence(done.changePence)}</p>
            </>
          ) : (
            <>
              <p className="muted big">Card approved</p>
              <p className="change" data-testid="change">{formatPence(totalPence)}</p>
              {done.card && <p className="muted">{done.card}</p>}
            </>
          )}
          <p className="muted">Sale saved · receipt {done.receiptNo}</p>
          <button className="primary next" onClick={() => props.onFinished(done)}>Next customer</button>
        </div>
      </div>
    )
  }

  if (cardStage) {
    return (
      <div className="overlay" role="dialog" aria-label="Card payment">
        <div className="tender done">
          <p className="muted big">Card · {formatPence(totalPence)}</p>
          <p className="big" data-testid="card-stage">{STAGE_TEXT[cardStage]}</p>
          <button className="danger next" onClick={() => { cancelCard.current = true; setCardStage('cancelling') }} disabled={cardStage === 'cancelling' || cardStage === 'sending'}>
            Cancel card payment
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="overlay" role="dialog" aria-label="Payment">
      <div className="tender">
        <header className="tender-top">
          <div>
            <span className="muted">To pay</span>
            <strong data-testid="due">{formatPence(totalPence)}</strong>
          </div>
          <button onClick={props.onBack} disabled={busy}>Back to basket</button>
        </header>

        {error && <p className="error" role="alert">{error}</p>}

        <div className="tender-body">
          <section>
            <h2>Cash</h2>
            <div className="entry">{entry ? formatPence(given) : 'Cash given'}</div>
            <p className={`change-line${entry && !enough ? ' short' : ''}`} data-testid="change-line">
              {!entry ? ' ' : enough ? `Change ${formatPence(given - totalPence)}` : `${formatPence(totalPence - given)} short`}
            </p>
            <div className="quick">
              <button onClick={() => void takeCash(totalPence)} disabled={busy}>Exact</button>
              {cashSuggestions(totalPence).map((amount) => (
                <button key={amount} onClick={() => void takeCash(amount)} disabled={busy}>{formatPence(amount).replace('.00', '')}</button>
              ))}
            </div>
            <div className="keys">
              {KEYS.map((key) => (
                <button key={key} className={key === 'C' ? 'key clear' : 'key'} disabled={busy}
                  onClick={() => setEntry((e) => (key === 'C' ? '' : (e + key).slice(0, 7)))}>{key}</button>
              ))}
            </div>
            <button className="primary take" onClick={() => void takeCash(given)} disabled={busy || !enough}>Take cash</button>
          </section>

          <section>
            <h2>Card</h2>
            <button className="card-btn" onClick={() => void takeCard()} disabled={busy || !online}>
              Card {formatPence(totalPence)}
            </button>
            <p className="muted">
              {online
                ? 'The amount is sent to the card reader for you. Nothing to type on the reader.'
                : 'Offline: card payments need the internet. Cash only until it is back.'}
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
