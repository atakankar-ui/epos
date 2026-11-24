// The Setup page: what this till is connected to, what is waiting to be sent,
// the product checks, and disconnecting the till.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { runChecks, type Check } from '../lib/shop'
import type { SyncStatus } from '../lib/sync'
import type { Binding } from '../../../shared/local'
import { SignInForm } from './SignIn'
import { signOutQuietly } from './Till'
import { PrinterCard, ReceiptDetailsCard } from './Hardware'
import { StaffCard } from './StaffCard'
import type { Staff } from '../../../shared/staff'

const MARK: Record<Check['state'], string> = { ok: '✓', todo: '!', problem: '✕' }
const WORD: Record<Check['state'], string> = { ok: 'Ready', todo: 'To do', problem: 'Problem' }

function when(iso: string | null): string {
  if (!iso) return 'never'
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export function Setup(props: {
  binding: Binding
  status: SyncStatus
  productsAt: string | null
  wrongShop: boolean
  staff: Staff[]
  onBack: () => void
  onSync: () => Promise<void>
  onDisconnected: () => void
}) {
  const { binding, status, productsAt, wrongShop } = props
  const [checks, setChecks] = useState<Check[] | null>(null)
  const [version, setVersion] = useState('')
  const [working, setWorking] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setWorking(true)
    setError(null)
    await props.onSync()
    setWorking(false)
  }, [props.onSync])

  useEffect(() => {
    void window.till.appInfo().then((info) => setVersion(info.version))
  }, [])

  // The product checks ask the database, so they only run when it can be reached.
  useEffect(() => {
    if (status.link === 'online' && !wrongShop) void runChecks().then(setChecks, () => setChecks(null))
    else setChecks(null)
  }, [status.link, wrongShop])

  async function disconnect() {
    setError(null)
    try {
      await window.till.local.unbind()
      await signOutQuietly()
      props.onDisconnected()
    } catch (err) {
      setError((err as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, ''))
      setConfirm(false)
    }
  }

  const linkWord = { online: 'Online', offline: 'Offline', signin: 'Sign-in needed' }[status.link]

  return (
    <main className="page">
      {/test/i.test(binding.orgName) && <div className="test-strip">TEST SHOP</div>}
      <header className="bar">
        <div>
          <h1>{binding.orgName} · {binding.tillName}</h1>
          <p className="muted">Connected with {binding.email} · receipts start {binding.receiptPrefix}-</p>
        </div>
        <div className="bar-buttons">
          <button className="primary" onClick={props.onBack}>Back to till</button>
        </div>
      </header>

      {error && <p className="error" role="alert">{error}</p>}

      <section className="card wide">
        <h2>Connection</h2>
        <ul className="checks">
          <li className={status.link === 'online' ? 'ok' : 'todo'}>
            <span className="mark" aria-hidden="true">{status.link === 'online' ? '✓' : '!'}</span>
            <div>
              <strong>{linkWord}</strong>
              <p>
                {status.link === 'online' && 'Sales are sent to the shop\'s records as they are made.'}
                {status.link === 'offline' && 'The till keeps selling. Sales are saved on this PC and sent when the internet is back.'}
                {status.link === 'signin' && 'The till keeps selling, but its sign-in has run out, so sales cannot be sent until someone signs in again below.'}
              </p>
            </div>
          </li>
          <li className={status.waiting === 0 ? 'ok' : status.refused > 0 ? 'problem' : 'todo'}>
            <span className="mark" aria-hidden="true">{status.waiting === 0 ? '✓' : status.refused > 0 ? '✕' : '!'}</span>
            <div>
              <strong>Waiting to send: {status.waiting}</strong>
              <p>
                {status.waiting === 0 && 'Every sale, refund and log entry made on this till is in the shop\'s records.'}
                {status.waiting > 0 && status.refused === 0 && 'They are safe on this PC and will go as soon as there is a connection.'}
                {status.refused > 0 && `${status.refused} could not be accepted and will be tried again. They are safe on this PC. Reason given: ${status.lastRefusal}`}
              </p>
            </div>
          </li>
          <li className={wrongShop ? 'problem' : 'ok'}>
            <span className="mark" aria-hidden="true">{wrongShop ? '✕' : '✓'}</span>
            <div>
              <strong>Products last updated: {when(productsAt)}</strong>
              <p>
                {wrongShop
                  ? `This sign-in is currently working in a different shop in Retail Aid, so prices are not being updated. Switch it back to ${binding.orgName}, or use a login that only belongs to this shop.`
                  : 'Prices and new products are fetched every 10 minutes while online.'}
              </p>
            </div>
          </li>
        </ul>
        <div className="bar-buttons">
          <button onClick={() => void refresh()} disabled={working}>{working ? 'Working…' : 'Send and update now'}</button>
        </div>
      </section>

      {status.link === 'signin' && (
        <section className="card wide">
          <h2>Sign in again</h2>
          <SignInForm onSignedIn={() => void refresh()} fixedEmail={binding.email} />
        </section>
      )}

      <StaffCard binding={binding} staff={props.staff} online={status.link === 'online'} onChanged={() => props.onSync()} />
      <PrinterCard />
      <ReceiptDetailsCard binding={binding} />

      {checks && (
        <section className="card wide">
          <h2>Product check</h2>
          <ul className="checks">
            {checks.map((check) => (
              <li key={check.label} className={check.state}>
                <span className="mark" aria-hidden="true">{MARK[check.state]}</span>
                <div>
                  <strong>{check.label}</strong> <span className="tag">{WORD[check.state]}</span>
                  <p>{check.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="card wide">
        <h2>Disconnect this till</h2>
        <p className="muted">Only for moving this PC to another shop. Not possible while sales are waiting to send.</p>
        {confirm ? (
          <div className="bar-buttons">
            <button className="danger" onClick={() => void disconnect()}>Yes, disconnect</button>
            <button onClick={() => setConfirm(false)}>No</button>
          </div>
        ) : (
          <div className="bar-buttons">
            <button className="danger" onClick={() => setConfirm(true)} disabled={status.waiting > 0}>Disconnect</button>
          </div>
        )}
      </section>

      <footer className="muted small">Till {version && `v${version}`}</footer>
    </main>
  )
}
