// Taking the money: cash (with change), card on the shop's own card machine, or part of each.
import { useCallback, useEffect, useState } from 'react'
import { cashSuggestions, formatPence, keyedPence } from '../../../shared/money'
import type { Tender as TenderType } from '../../../shared/sale'

const KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '00', 'C']

type Done = { receiptNo: string; saleId: string; method: 'cash' | 'card'; changePence: number }
// A payment already taken towards this sale.
type Part = { method: 'cash' | 'card'; amountPence: number }

export function Tender(props: {
  totalPence: number
  start: 'cash' | 'card' // which button on the selling screen was pressed
  online: boolean
  tillId: string
  // Saves the sale on this PC. Returns its receipt number.
  complete: (tender: TenderType[], saleId?: string) => Promise<{ receiptNo: string; saleId: string }>
  onBack: () => void // nothing was paid: back to the basket
  onFinished: (done: Done & { summary: string }) => void // paid and saved: next customer
}) {
  const { totalPence, online } = props
  const [entry, setEntry] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [parts, setParts] = useState<Part[]>([])
  const [cardAmount, setCardAmount] = useState<number | null>(props.start === 'card' ? totalPence : null) // asking "approved?" for this much
  const [undoing, setUndoing] = useState(false)
  const [cardOn, setCardOn] = useState(true)
  const [done, setDone] = useState<(Done & { summary: string }) | null>(null)
  const [printNote, setPrintNote] = useState<{ ok: boolean; text: string } | null>(null)
  useEffect(() => { void window.till.hardware.getConfig().then((c) => setCardOn(c.card !== 'off')) }, [])

  const paidPence = parts.reduce((sum, part) => sum + part.amountPence, 0)
  const duePence = totalPence - paidPence
  const given = keyedPence(entry) ?? 0
  const enough = given >= duePence
  const partial = given > 0 && given < duePence // an amount that could be taken as a part payment
  const failure = (err: unknown) => (err as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')
  const describe = (list: Part[]) => list.map((part) => `${formatPence(part.amountPence)} ${part.method}`).join(' + ')

  // The sale is already saved. Now open the drawer (cash) and print, without ever blocking the till.
  async function finish(next: Done & { summary: string }) {
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

  // The last payment: everything is now covered, so the sale is saved.
  const settle = useCallback(async (last: Part, tenderedPence: number) => {
    if (busy) return
    setBusy(true)
    setError(null)
    const all = [...parts, last]
    const tenders: TenderType[] = all.map((part, i) => (part.method === 'cash'
      ? { method: 'cash', amountPence: part.amountPence, tenderedPence: i === all.length - 1 ? tenderedPence : part.amountPence }
      : { method: 'card', amountPence: part.amountPence }))
    try {
      const { receiptNo, saleId } = await props.complete(tenders)
      setCardAmount(null)
      void finish({ receiptNo, saleId, method: last.method, changePence: last.method === 'cash' ? tenderedPence - last.amountPence : 0, summary: describe(all) })
    } catch (err) {
      setCardAmount(null)
      setError(`${all.some((part) => part.method === 'card') ? 'A card payment WAS taken, but the' : 'The'} sale was NOT saved: ${failure(err)}${all.some((part) => part.method === 'card') ? ' Do not charge the customer again. Tell the manager.' : ''}`)
    } finally {
      setBusy(false)
    }
  }, [busy, parts, props])

  const takeCash = useCallback((tenderedPence: number) => {
    if (tenderedPence >= duePence) void settle({ method: 'cash', amountPence: duePence }, tenderedPence)
  }, [duePence, settle])

  function partCash() {
    setParts([...parts, { method: 'cash', amountPence: given }])
    setEntry('')
    setError(null)
  }

  function cardApproved() {
    if (cardAmount === null || busy) return
    if (cardAmount >= duePence) return void settle({ method: 'card', amountPence: duePence }, 0)
    setParts([...parts, { method: 'card', amountPence: cardAmount }])
    setCardAmount(null)
    setEntry('')
  }

  // Keyboard and scanner: digits are cash given; a scan must never add items while paying.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      event.stopPropagation()
      if (done) { if (event.key === 'Enter') props.onFinished(done); return }
      if (busy || cardAmount !== null || undoing) return // "approved?" is answered by button only
      if (/^\d$/.test(event.key)) setEntry((e) => (e + event.key).slice(0, 7))
      else if (event.key === 'Backspace') setEntry((e) => e.slice(0, -1))
      else if (event.key === 'Enter') { event.preventDefault(); if (enough) takeCash(given) }
      else if (event.key === 'Escape' && parts.length === 0) props.onBack()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [busy, cardAmount, done, enough, given, parts.length, props, takeCash, undoing])

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
          {parts.length > 0 && <p className="muted" data-testid="split">Paid as {done.summary}</p>}
          <p className="muted">Sale saved · receipt {done.receiptNo}</p>
          {printNote && <p className={printNote.ok ? 'good' : 'error'} role="status" data-testid="print-note">{printNote.text}</p>}
          <button className="reprint" onClick={() => void printAgain(done.saleId, printNote?.ok === true)}>{printNote?.ok ? 'Print a copy' : 'Print receipt'}</button>
          <button className="primary next" onClick={() => props.onFinished(done)}>Next customer</button>
        </div>
      </div>
    )
  }

  if (cardAmount !== null) {
    return (
      <div className="overlay" role="dialog" aria-label="Card payment">
        <div className="tender done">
          <p className="muted big">Take this on the card machine</p>
          <p className="change" data-testid="card-amount">{formatPence(Math.min(cardAmount, duePence))}</p>
          <p className="big">Did the card machine say APPROVED?</p>
          {/* Buttons only: a stray scan or the Enter key must never count as "approved". */}
          <button className="primary next" onClick={cardApproved} disabled={busy}>Yes, approved</button>
          <button className="danger next" disabled={busy} onClick={() => { setCardAmount(null); setError('Card not taken, so nothing was saved. Try the card again, or take cash.') }}>
            No, declined or cancelled
          </button>
        </div>
      </div>
    )
  }

  if (undoing) {
    return (
      <div className="overlay" role="dialog" aria-label="Undo part payments">
        <div className="tender done">
          <p className="big">Give this back before going back to the basket</p>
          {parts.map((part, i) => (
            <p key={i} className="big">{formatPence(part.amountPence)} {part.method === 'cash' ? 'in cash' : 'refunded on the card machine'}</p>
          ))}
          <button className="danger next" onClick={props.onBack}>Done, I have given it all back</button>
          <button className="next" onClick={() => setUndoing(false)}>Carry on taking payment</button>
        </div>
      </div>
    )
  }

  return (
    <div className="overlay" role="dialog" aria-label="Payment">
      <div className="tender">
        <header className="tender-top">
          <div>
            <span className="muted">{parts.length ? 'Still to pay' : 'To pay'}</span>
            <strong data-testid="due">{formatPence(duePence)}</strong>
          </div>
          <button onClick={parts.length ? () => setUndoing(true) : props.onBack} disabled={busy}>{parts.length ? 'Undo part payments' : 'Back to basket'}</button>
        </header>

        {parts.length > 0 && <p className="good" data-testid="parts">Taken so far: {describe(parts)} of {formatPence(totalPence)}</p>}
        {error && <p className="error" role="alert">{error}</p>}

        <div className="tender-body">
          <section>
            <h2>Cash</h2>
            <div className="entry">{entry ? formatPence(given) : 'Cash given'}</div>
            <p className={`change-line${entry && !enough ? ' short' : ''}`} data-testid="change-line">
              {!entry ? ' ' : enough ? `Change ${formatPence(given - duePence)}` : `${formatPence(duePence - given)} short`}
            </p>
            <div className="quick">
              <button onClick={() => takeCash(duePence)} disabled={busy}>Exact</button>
              {cashSuggestions(duePence).map((amount) => (
                <button key={amount} onClick={() => takeCash(amount)} disabled={busy}>{formatPence(amount).replace('.00', '')}</button>
              ))}
            </div>
            <div className="keys">
              {KEYS.map((key) => (
                <button key={key} className={key === 'C' ? 'key clear' : 'key'} disabled={busy}
                  onClick={() => setEntry((e) => (key === 'C' ? '' : (e + key).slice(0, 7)))}>{key}</button>
              ))}
            </div>
            <button className="primary take" onClick={() => takeCash(given)} disabled={busy || !enough}>Take cash</button>
          </section>

          <section>
            <h2>Card</h2>
            <button className="card-btn" onClick={() => { setError(null); setCardAmount(duePence) }} disabled={busy || !cardOn}>
              Card {formatPence(duePence)}
            </button>
            <p className="muted">
              {!cardOn ? 'Card payments are switched off for this till in Setup.'
                : online ? 'Type the amount into the card machine, then confirm here.'
                  : 'The till is offline. If the card machine itself is still working, you can take cards as usual.'}
            </p>
            <h2>Part payment</h2>
            {partial ? (
              <div className="split">
                <button onClick={partCash} disabled={busy}>Take {formatPence(given)} cash, rest later</button>
                {cardOn && <button onClick={() => { setError(null); setCardAmount(given) }} disabled={busy}>Take {formatPence(given)} on card, rest later</button>}
              </div>
            ) : (
              <p className="muted">To split the payment, type the first part on the keypad (less than the total).</p>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}
