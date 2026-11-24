// Taking the money: cash (with change) or card.
import { useCallback, useEffect, useState } from 'react'
import { cashSuggestions, formatPence, keyedPence } from '../../../shared/money'
import type { Tender as TenderType } from '../../../shared/sale'

const KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '00', 'C']

type Done = { receiptNo: string; saleId: string; method: 'cash' | 'card'; changePence: number }

export function Tender(props: {
  totalPence: number
  online: boolean
  tillId: string
  // Saves the sale on this PC. Returns its receipt number.
  complete: (tender: TenderType, saleId?: string) => Promise<{ receiptNo: string; saleId: string }>
  onBack: () => void // nothing was paid: back to the basket
  onFinished: (done: Done) => void // paid and saved: next customer
}) {
  const { totalPence, online } = props
  const [entry, setEntry] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmingCard, setConfirmingCard] = useState(false)
  const [cardOn, setCardOn] = useState(true)
  const [done, setDone] = useState<Done | null>(null)
  useEffect(() => { void window.till.hardware.getConfig().then((c) => setCardOn(c.card !== 'off')) }, [])
  const [printNote, setPrintNote] = useState<{ ok: boolean; text: string } | null>(null)

  // The sale is already saved. Now open the drawer (cash) and print, without ever blocking the till.
  async function finish(next: Done) {
    setDone(next)
    const result = await window.till.hardware.afterSale(next.saleId)
    if (!result.ok) setPrintNote({ ok: false, text: `The sale is saved, but the printer did not respond: ${result.message}` })
    else if (result.printed) setPrintNote({ ok: true, text: 'Receipt printed.' })
  }

  async function printAgain(saleId: string, copy: boolean) {
    setPrintNote(null)
    const result = await window.till.hardware.printReceipt(saleId, copy)
    setPrintNote(result.ok ? { ok: true, text: 'Receipt printed.' } : { ok: false, text: result.message })
  }

  const given = keyedPence(entry) ?? 0
  const enough = given >= totalPence
  const failure = (err: unknown) => (err as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')

  const takeCash = useCallback(async (tenderedPence: number) => {
    if (busy || tenderedPence < totalPence) return
    setBusy(true)
    setError(null)
    try {
      const { receiptNo, saleId } = await props.complete({ method: 'cash', tenderedPence })
      void finish({ receiptNo, saleId, method: 'cash', changePence: tenderedPence - totalPence })
    } catch (err) {
      setError(`The sale was NOT saved: ${failure(err)}`)
    } finally {
      setBusy(false)
    }
  }, [busy, props, totalPence])

  // The card is taken on the shop's own card machine. The till only records what the cashier confirms.
  async function cardApproved() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const { receiptNo, saleId } = await props.complete({ method: 'card' })
      setConfirmingCard(false)
      void finish({ receiptNo, saleId, method: 'card', changePence: 0 })
    } catch (err) {
      setConfirmingCard(false)
      setError(`The card machine took ${formatPence(totalPence)}, but the sale was NOT saved: ${failure(err)} Do not charge the customer again. Tell the manager.`)
    } finally {
      setBusy(false)
    }
  }

  // Keyboard and scanner: digits are cash given; a scan must never add items while paying.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      event.stopPropagation()
      if (done) { if (event.key === 'Enter') props.onFinished(done); return }
      if (busy || confirmingCard) return
      if (/^\d$/.test(event.key)) setEntry((e) => (e + event.key).slice(0, 7))
      else if (event.key === 'Backspace') setEntry((e) => e.slice(0, -1))
      else if (event.key === 'Enter') { event.preventDefault(); if (enough) void takeCash(given) }
      else if (event.key === 'Escape') props.onBack()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [busy, confirmingCard, done, enough, given, props, takeCash])

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
              <p className="muted big">Paid by card</p>
              <p className="change" data-testid="change">{formatPence(totalPence)}</p>
            </>
          )}
          <p className="muted">Sale saved · receipt {done.receiptNo}</p>
          {printNote && <p className={printNote.ok ? 'good' : 'error'} role="status" data-testid="print-note">{printNote.text}</p>}
          <button className="reprint" onClick={() => void printAgain(done.saleId, printNote?.ok === true)}>{printNote?.ok ? 'Print a copy' : 'Print receipt'}</button>
          <button className="primary next" onClick={() => props.onFinished(done)}>Next customer</button>
        </div>
      </div>
    )
  }

  if (confirmingCard) {
    return (
      <div className="overlay" role="dialog" aria-label="Card payment">
        <div className="tender done">
          <p className="muted big">Take this on the card machine</p>
          <p className="change" data-testid="card-amount">{formatPence(totalPence)}</p>
          <p className="big">Did the card machine say APPROVED?</p>
          {/* Buttons only: a stray scan or the Enter key must never count as "approved". */}
          <button className="primary next" onClick={() => void cardApproved()} disabled={busy}>Yes, approved</button>
          <button className="danger next" disabled={busy} onClick={() => { setConfirmingCard(false); setError('Card not taken, so nothing was saved. Try the card again, or take cash.') }}>
            No, declined or cancelled
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
            <button className="card-btn" onClick={() => { setError(null); setConfirmingCard(true) }} disabled={busy || !cardOn}>
              Card {formatPence(totalPence)}
            </button>
            <p className="muted">
              {!cardOn ? 'Card payments are switched off for this till in Setup.'
                : online ? 'Type the amount into the card machine, then confirm here.'
                  : 'The till is offline. If the card machine itself is still working, you can take cards as usual.'}
            </p>
          </section>
        </div>
      </div>
    </div>
  )
}
