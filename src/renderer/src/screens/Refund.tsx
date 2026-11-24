// Giving money back for a past sale: find the receipt, pick the lines, a manager allows it.
import { useEffect, useState } from 'react'
import { alreadyRefunded, findSale } from '../lib/refunds'
import { formatPence } from '../../../shared/money'
import { REFUND_REASONS } from '../../../shared/audit'
import { buildRefund, normaliseReceiptNo, refundable, type Refunded } from '../../../shared/refund'
import type { SaleRecord } from '../../../shared/sale'
import type { Binding } from '../../../shared/local'
import type { TillTools } from './Till'

const time = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
const clean = (err: unknown) => (err as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')

export function Refund({ binding, online, tools, onClose }: { binding: Binding; online: boolean; tools: TillTools; onClose: () => void }) {
  const [typed, setTyped] = useState('')
  const [recent, setRecent] = useState<SaleRecord[]>([])
  const [record, setRecord] = useState<SaleRecord | null>(null)
  const [already, setAlready] = useState<Refunded>({})
  const [picks, setPicks] = useState<Record<string, number>>({})
  const [toShelf, setToShelf] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ refundId: string; receiptNo: string; totalPence: number } | null>(null)
  const [printNote, setPrintNote] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => { void window.till.local.recentSales(8).then(setRecent) }, [])

  async function open(receiptNo: string) {
    setBusy(true)
    setError(null)
    try {
      const found = await findSale(receiptNo, online)
      if (!found) setError(`No sale with receipt ${receiptNo} was found.`)
      else {
        setAlready(await alreadyRefunded(found, online))
        setPicks({})
        setRecord(found)
      }
    } catch (err) { setError(clean(err)) }
    setBusy(false)
  }

  const lines = record ? refundable(record, already) : []
  const totalPence = lines.reduce((sum, l) => sum + l.unitPence * (picks[l.itemId] ?? 0), 0)
  const pick = (id: string, qty: number, max: number) => setPicks((p) => ({ ...p, [id]: Math.max(0, Math.min(max, qty)) }))

  async function refund() {
    if (!record || totalPence === 0 || busy) return
    const answer = await tools.ask({ title: `Refund ${formatPence(totalPence)} in cash?`, manager: true, reasons: REFUND_REASONS })
    if (!answer) return
    setBusy(true)
    setError(null)
    try {
      const draft = buildRefund({
        record, picks, already, reason: answer.reason, staffId: tools.staffId, approvedBy: answer.approvedBy, returnToStock: toShelf,
        orgId: binding.orgId, tillId: binding.tillId, at: new Date(), newId: () => crypto.randomUUID(),
      })
      const saved = await window.till.local.saveRefund(draft)
      await tools.log({
        action: 'refund', reason: answer.reason, approvedBy: answer.approvedBy, saleId: record.sale.id, refundId: saved.refundId, amountPence: totalPence,
        details: { receipt_no: saved.receiptNo, original_receipt_no: record.sale.receipt_no, items: draft.items.map((i) => ({ name: i.name, quantity: i.quantity })) },
      })
      setDone({ ...saved, totalPence })
      const result = await window.till.hardware.afterRefund(saved.refundId)
      if (!result.ok) setPrintNote({ ok: false, text: `The refund is saved, but the printer did not respond: ${result.message}` })
      else if (result.printed) setPrintNote({ ok: true, text: 'Refund slip printed.' })
    } catch (err) { setError(`The refund was NOT saved: ${clean(err)}`) }
    setBusy(false)
  }

  if (done) {
    return (
      <div className="overlay" role="dialog" aria-label="Refund complete">
        <div className="tender done">
          <p className="muted big">Give back in cash</p>
          <p className="change" data-testid="refund-total">{formatPence(done.totalPence)}</p>
          <p className="muted">Refund saved · {done.receiptNo}</p>
          {printNote && <p className={printNote.ok ? 'good' : 'error'} role="status">{printNote.text}</p>}
          <button className="reprint" onClick={() => void window.till.hardware.printRefund(done.refundId).then((r) => setPrintNote(r.ok ? { ok: true, text: 'Refund slip printed.' } : { ok: false, text: r.message }))}>Print refund slip</button>
          <button className="primary next" onClick={onClose}>Done</button>
        </div>
      </div>
    )
  }

  return (
    <div className="overlay" role="dialog" aria-label="Refund">
      <div className="tender">
        <header className="tender-top">
          <h2>{record ? `Refund from receipt ${record.sale.receipt_no}` : 'Refund'}</h2>
          <button onClick={record ? () => setRecord(null) : onClose} disabled={busy}>{record ? 'Different receipt' : 'Close'}</button>
        </header>
        {error && <p className="error" role="alert">{error}</p>}

        {!record ? (
          <>
            <form className="row" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) void open(normaliseReceiptNo(typed, binding.receiptPrefix)) }}>
              <input autoFocus data-testid="refund-receipt" placeholder={`Receipt number, for example ${binding.receiptPrefix}-000123 or just 123`} value={typed}
                onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => e.stopPropagation()} />
              <button className="primary" type="submit" disabled={busy || !typed.trim()}>Find</button>
            </form>
            <p className="muted">Or pick one of this till's latest sales:</p>
            <ul className="results">
              {recent.map((s) => (
                <li key={s.sale.id}><button onClick={() => void open(s.sale.receipt_no)} disabled={busy}>
                  <span className="name">{s.sale.receipt_no}<small>{time(s.sale.sold_at)} · {s.payments[0]?.method ?? ''}</small></span>
                  <span className="amount">{formatPence(Math.round(s.sale.total * 100))}</span>
                </button></li>
              ))}
              {recent.length === 0 && <li className="muted none">No sales have been made on this till yet.</li>}
            </ul>
          </>
        ) : (
          <>
            <p className="muted">Sold {time(record.sale.sold_at)} · paid by {record.payments[0]?.method ?? 'cash'}{record.payments[0]?.method === 'card' && ' · card refunds are not set up yet, so this refund is given in cash'}</p>
            <ul className="results">
              {lines.map((l) => (
                <li key={l.itemId} className="refund-line">
                  <span className="name">{l.name}<small>{formatPence(l.unitPence)} each · sold {l.sold}{l.left < l.sold && ` · ${l.sold - l.left} already refunded`}</small></span>
                  {l.left === 0 ? <span className="muted">Fully refunded</span> : (
                    <span className="stepper">
                      <button onClick={() => pick(l.itemId, (picks[l.itemId] ?? 0) - 1, l.left)} disabled={!picks[l.itemId]}>−</button>
                      <strong data-testid="refund-qty">{picks[l.itemId] ?? 0} of {l.left}</strong>
                      <button onClick={() => pick(l.itemId, (picks[l.itemId] ?? 0) + 1, l.left)} disabled={(picks[l.itemId] ?? 0) >= l.left}>+</button>
                      <button onClick={() => pick(l.itemId, l.left, l.left)}>All</button>
                    </span>
                  )}
                </li>
              ))}
            </ul>
            <label className="tick"><input type="checkbox" checked={toShelf} onChange={(e) => setToShelf(e.target.checked)} />The goods are going back on the shelf (untick if damaged or out of date)</label>
            <button className="primary take" onClick={() => void refund()} disabled={busy || totalPence === 0}>
              {totalPence === 0 ? 'Choose what to refund' : `Refund ${formatPence(totalPence)} in cash`}
            </button>
          </>
        )}
      </div>
    </div>
  )
}
