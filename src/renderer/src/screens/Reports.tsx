// Start of day (the float), and the X and Z reports.
import { useCallback, useEffect, useState } from 'react'
import { formatPence, keyedPence } from '../../../shared/money'
import { toText } from '../../../shared/escpos'
import { buildReport, reportLines, type DayInfo, type Report } from '../../../shared/report'
import type { Binding } from '../../../shared/local'
import type { TillTools } from './Till'

const KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '00', 'C']
const clean = (err: unknown) => (err as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')
const date = (iso: string) => new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

// A keypad for typing an amount of money in pence. Scans and stray keys go here, not to the basket.
function MoneyPad({ value, onChange, onEnter }: { value: string; onChange: (v: string) => void; onEnter: () => void }) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      event.stopPropagation()
      if (/^\d$/.test(event.key)) onChange((value + event.key).slice(0, 7))
      else if (event.key === 'Backspace') onChange(value.slice(0, -1))
      else if (event.key === 'Enter') { event.preventDefault(); onEnter() }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onChange, onEnter, value])
  return (
    <>
      <div className="entry" data-testid="money">{formatPence(keyedPence(value) ?? 0)}</div>
      <div className="keys">
        {KEYS.map((key) => <button key={key} className={key === 'C' ? 'key clear' : 'key'} onClick={() => onChange(key === 'C' ? '' : (value + key).slice(0, 7))}>{key}</button>)}
      </div>
    </>
  )
}

// Shown when no trading day is open: the cashier says how much cash is in the drawer, and the day begins.
export function StartDay({ tools, onStarted, onReports }: { tools: TillTools; onStarted: (day: DayInfo) => void; onReports: () => void }) {
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string | null>(null)

  const start = useCallback(async () => {
    try {
      onStarted(await window.till.local.openDay({ id: crypto.randomUUID(), openedBy: tools.staffId, floatPence: keyedPence(typed) ?? 0, at: new Date().toISOString() }))
    } catch (err) { setError(clean(err)) }
  }, [onStarted, tools.staffId, typed])

  return (
    <main className="centre">
      <div className="card gate">
        <h1>Start the day</h1>
        <p className="muted">How much cash is in the drawer to start with (the float)? Type it in pence: 5000 is £50.00. Leave it at £0.00 if the drawer is empty.</p>
        <MoneyPad value={typed} onChange={setTyped} onEnter={() => void start()} />
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary take" onClick={() => void start()}>Start the day</button>
        <button onClick={onReports}>Past reports</button>
      </div>
    </main>
  )
}

type View = { report: Report; note?: string }

export function Reports({ binding, day, tools, onClosed, onClose }: {
  binding: Binding
  day: DayInfo | null // the open day, if there is one
  tools: TillTools
  onClosed: () => void // a Z report closed the day
  onClose: () => void
}) {
  const [view, setView] = useState<View | null>(null)
  const [counting, setCounting] = useState(false)
  const [counted, setCounted] = useState('')
  const [past, setPast] = useState<DayInfo[]>([])
  const [columns, setColumns] = useState(48)
  const [shop, setShop] = useState({ name: binding.orgName, address: null as string | null, vatNumber: null as string | null, footer: null as string | null })
  const [error, setError] = useState<string | null>(null)
  const [printNote, setPrintNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const loadPast = useCallback(() => window.till.local.listDays(30).then((days) => setPast(days.filter((d) => d.report))), [])
  useEffect(() => {
    void loadPast()
    void window.till.hardware.getConfig().then((c) => setColumns(c.columns))
    void window.till.hardware.getShopDetails().then(setShop)
  }, [loadPast])

  // Reports show the takings, so with staff set up they need a manager.
  const allowed = async (title: string) => !tools.hasStaff || (await tools.ask({ title, manager: true, reasons: [] })) !== null

  async function print(report: Report) {
    setPrintNote(null)
    const result = await window.till.hardware.printLines(reportLines(report, shop))
    setPrintNote(result.ok ? { ok: true, text: 'Report printed.' } : { ok: false, text: `Not printed: ${result.message}` })
  }

  async function xReport() {
    if (!day || busy || !(await allowed('X report'))) return
    setBusy(true)
    setError(null)
    try {
      const report = buildReport({ kind: 'X', tillName: binding.tillName, ...(await window.till.local.dayData(day.id)), at: new Date() })
      await tools.log({ action: 'x_report', reason: null, amountPence: report.netPence, details: { z_number: report.zNumber, report } })
      setView({ report })
      void print(report)
    } catch (err) { setError(clean(err)) }
    setBusy(false)
  }

  async function zReport() {
    if (!day || busy) return
    setBusy(true)
    setError(null)
    try {
      const at = new Date()
      const countedPence = keyedPence(counted)
      const report = buildReport({ kind: 'Z', tillName: binding.tillName, ...(await window.till.local.dayData(day.id)), at, countedPence })
      await window.till.local.closeDay({ id: day.id, closedBy: tools.staffId, countedPence, at: at.toISOString(), report })
      await tools.log({ action: 'z_report', reason: null, amountPence: report.netPence, details: { z_number: report.zNumber, day_session_id: day.id } })
      setCounting(false)
      setCounted('')
      setView({ report, note: 'The day is closed. Start a new day when you are ready to sell again.' })
      onClosed()
      void loadPast()
      void print(report)
    } catch (err) { setError(clean(err)) }
    setBusy(false)
  }

  if (view) {
    return (
      <div className="overlay" role="dialog" aria-label={`${view.report.kind} report`}>
        <div className="tender report">
          <header className="tender-top">
            <h2>{view.report.kind} report · Z number {view.report.zNumber}</h2>
            <span className="row3">
              <button onClick={() => void print(view.report)}>Print</button>
              <button className="primary" onClick={() => { setView(null); setPrintNote(null) }}>Back</button>
            </span>
          </header>
          {view.note && <p className="good">{view.note}</p>}
          {printNote && <p className={printNote.ok ? 'good' : 'error'} role="status">{printNote.text}</p>}
          <pre className="paper" data-testid="report">{toText(reportLines(view.report, shop), columns)}</pre>
        </div>
      </div>
    )
  }

  if (counting) {
    return (
      <div className="overlay" role="dialog" aria-label="Count the cash">
        <div className="tender approval">
          <h2>Z report: count the cash</h2>
          <p className="muted">Count all the cash in the drawer, float included, and type the total in pence. The report will show whether it is over or short. Leave it at £0.00 and press Skip if you are not counting today.</p>
          <MoneyPad value={counted} onChange={setCounted} onEnter={() => undefined} />
          {error && <p className="error" role="alert">{error}</p>}
          <button className="primary take" onClick={() => void zReport()} disabled={busy || !counted}>Close the day</button>
          <button onClick={() => { setCounted(''); void zReport() }} disabled={busy}>Skip the count and close the day</button>
          <button onClick={() => { setCounting(false); setCounted('') }} disabled={busy}>Cancel</button>
        </div>
      </div>
    )
  }

  return (
    <div className="overlay" role="dialog" aria-label="Reports">
      <div className="tender approval">
        <header className="tender-top"><h2>Reports</h2><button onClick={onClose}>Close</button></header>
        {error && <p className="error" role="alert">{error}</p>}
        {day ? (
          <div className="reasons">
            <button onClick={() => void xReport()} disabled={busy}>X report<small className="muted"> · the day so far, nothing is reset</small></button>
            <button onClick={async () => { if (await allowed('Z report: close the day')) setCounting(true) }} disabled={busy}>Z report<small className="muted"> · end of day, closes the day</small></button>
          </div>
        ) : <p className="muted">No day is open. Start the day to sell and to run an X or Z report.</p>}
        <p className="muted">Past Z reports on this till:</p>
        <ul className="results">
          {past.map((d) => (
            <li key={d.id}><button onClick={async () => { if (await allowed(`Z report ${d.zNumber}`)) setView({ report: d.report! }) }}>
              <span className="name">Z number {d.zNumber}<small>{date(d.openedAt)} to {date(d.closedAt!)}</small></span>
              <span className="amount">{formatPence(d.report!.netPence)}</span>
            </button></li>
          ))}
          {past.length === 0 && <li className="muted none">None yet.</li>}
        </ul>
      </div>
    </div>
  )
}
