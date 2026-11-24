// PIN entry, the "who is using the till?" lock page, and the box that asks for a reason
// (and, for manager-only actions, a manager's PIN).
import { useCallback, useEffect, useState } from 'react'
import { activeStaff, checkPin, managers, type Staff } from '../../../shared/staff'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', 'OK']
const MAX_WRONG = 5
const LOCK_SECONDS = 30

export function PinPad({ who, onOk, onBack }: { who: Staff; onOk: () => void; onBack?: () => void }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [wrong, setWrong] = useState(0)
  const [lockedUntil, setLockedUntil] = useState(0)
  const [checking, setChecking] = useState(false)
  const [, tick] = useState(0)

  const locked = Date.now() < lockedUntil
  useEffect(() => {
    if (!locked) return
    const t = setInterval(() => tick((n) => n + 1), 500)
    return () => clearInterval(t)
  }, [locked])

  const submit = useCallback(async (value: string) => {
    if (checking || Date.now() < lockedUntil || value.length < 4) return
    setChecking(true)
    const ok = await checkPin(who, value)
    setChecking(false)
    if (ok) return onOk()
    setPin('')
    const count = wrong + 1
    setWrong(count)
    if (count >= MAX_WRONG) {
      setWrong(0)
      setLockedUntil(Date.now() + LOCK_SECONDS * 1000)
      setError(`Too many wrong tries. Wait ${LOCK_SECONDS} seconds.`)
    } else setError('Wrong PIN.')
  }, [checking, lockedUntil, onOk, who, wrong])

  const press = useCallback((key: string) => {
    if (key === 'C') { setPin(''); setError(null) }
    else if (key === 'OK') void submit(pin)
    else setPin((p) => (p + key).slice(0, 6))
  }, [pin, submit])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      event.stopPropagation()
      if (/^\d$/.test(event.key)) press(event.key)
      else if (event.key === 'Enter') { event.preventDefault(); press('OK') }
      else if (event.key === 'Backspace') setPin((p) => p.slice(0, -1))
      else if (event.key === 'Escape') onBack?.()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onBack, press])

  return (
    <div className="pinpad">
      <p className="big">{who.name}</p>
      <div className="pin" data-testid="pin" aria-label="PIN">{pin ? '●'.repeat(pin.length) : 'PIN'}</div>
      <p className={`message ${error ? 'error' : ''}`} role="status">{locked ? `Too many wrong tries. Wait ${Math.ceil((lockedUntil - Date.now()) / 1000)} seconds.` : error ?? ' '}</p>
      <div className="keys">
        {KEYS.map((key) => (
          <button key={key} className={key === 'C' ? 'key clear' : key === 'OK' ? 'key enter' : 'key'} onClick={() => press(key)} disabled={locked || checking}>{key}</button>
        ))}
      </div>
      {onBack && <button onClick={onBack}>Back</button>}
    </div>
  )
}

// Shown whenever staff exist and nobody is signed in.
export function StaffGate({ staff, onSignedIn }: { staff: Staff[]; onSignedIn: (who: Staff) => void }) {
  const [who, setWho] = useState<Staff | null>(null)
  return (
    <main className="centre">
      <div className="card gate">
        {who ? (
          <PinPad who={who} onOk={() => onSignedIn(who)} onBack={() => setWho(null)} />
        ) : (
          <>
            <h1>Who is using the till?</h1>
            <div className="tiles">
              {activeStaff(staff).map((s) => (
                <button key={s.id} onClick={() => setWho(s)}>{s.name}<small>{s.role === 'manager' ? 'Manager' : 'Cashier'}</small></button>
              ))}
            </div>
          </>
        )}
      </div>
    </main>
  )
}

export type Ask = { title: string; manager: boolean; reasons: string[] } // no reasons = no reason needed
export type Answer = { reason: string; approvedBy: string | null }

export function Approval({ ask, staff, current, onDone }: {
  ask: Ask
  staff: Staff[]
  current: Staff | null
  onDone: (answer: Answer | null) => void
}) {
  const selfApproved = ask.manager && current?.role === 'manager'
  const [approver, setApprover] = useState<Staff | null>(selfApproved ? current : null)
  const [choosing, setChoosing] = useState<Staff | null>(null)
  const [other, setOther] = useState('')
  const needPin = ask.manager && !approver
  const list = managers(staff)

  const finish = useCallback((reason: string) => onDone({ reason, approvedBy: ask.manager ? approver?.id ?? null : null }), [ask.manager, approver, onDone])

  // Nothing to ask once the PIN is in: done.
  useEffect(() => {
    if (!needPin && ask.reasons.length === 0) finish('')
  }, [ask.reasons.length, finish, needPin])

  // Keep scans and stray keys away from the basket while this box is open.
  useEffect(() => {
    if (needPin && choosing) return // the PIN pad has the keyboard
    function onKey(event: KeyboardEvent) {
      event.stopPropagation()
      if (event.key === 'Escape') onDone(null)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [choosing, needPin, onDone])

  return (
    <div className="overlay top" role="dialog" aria-label={ask.title}>
      <div className="tender approval">
        <h2>{ask.title}</h2>
        {needPin ? (
          list.length === 0 ? (
            <p className="error" role="alert">This needs a manager, and no manager has been set up yet. Add one in Setup.</p>
          ) : choosing ? (
            <PinPad who={choosing} onOk={() => { setApprover(choosing); setChoosing(null) }} onBack={() => setChoosing(null)} />
          ) : (
            <>
              <p className="muted">A manager needs to allow this. Which manager?</p>
              <div className="tiles">{list.map((m) => <button key={m.id} onClick={() => setChoosing(m)}>{m.name}<small>Manager</small></button>)}</div>
            </>
          )
        ) : (
          <>
            {ask.manager && approver && <p className="good">Allowed by {approver.name}</p>}
            <p className="muted">Why?</p>
            <div className="reasons">{ask.reasons.map((r) => <button key={r} onClick={() => finish(r)}>{r}</button>)}</div>
            <div className="row">
              <input placeholder="Another reason" value={other} maxLength={120} onChange={(e) => setOther(e.target.value)}
                onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && other.trim()) finish(other.trim()) }} />
              <button onClick={() => finish(other.trim())} disabled={!other.trim()}>Use this</button>
            </div>
          </>
        )}
        <button onClick={() => onDone(null)}>Cancel</button>
      </div>
    </div>
  )
}
