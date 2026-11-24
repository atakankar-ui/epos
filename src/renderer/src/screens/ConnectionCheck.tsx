import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { loadShop, runChecks, type Check, type ShopInfo } from '../lib/shop'

const MARK: Record<Check['state'], string> = { ok: '✓', todo: '!', problem: '✕' }
const WORD: Record<Check['state'], string> = { ok: 'Ready', todo: 'To do', problem: 'Problem' }

export function ConnectionCheck({ userId, email, onBack }: { userId: string; email: string; onBack: () => void }) {
  const [shop, setShop] = useState<ShopInfo | null>(null)
  const [checks, setChecks] = useState<Check[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState('')

  const refresh = useCallback(async () => {
    setError(null)
    setChecks(null)
    try {
      setShop(await loadShop(userId))
      setChecks(await runChecks())
    } catch (err) {
      setError((err as Error).message)
    }
  }, [userId])

  useEffect(() => {
    void refresh()
    void window.till?.appInfo().then((info) => setVersion(info.version))
  }, [refresh])

  const isTest = shop ? /test/i.test(shop.name) : false

  return (
    <main className="page">
      {isTest && <div className="test-strip">TEST SHOP</div>}
      <header className="bar">
        <div>
          <h1>{shop ? shop.name : 'Connecting…'}</h1>
          <p className="muted">
            Signed in as {email}
            {shop && ` · ${shop.role === 'buyer' ? 'Buyer' : 'Staff'}`}
          </p>
        </div>
        <div className="bar-buttons">
          <button className="primary" onClick={onBack}>Back to till</button>
          <button onClick={() => void refresh()}>Check again</button>
          <button onClick={() => void supabase.auth.signOut()}>Sign out</button>
        </div>
      </header>

      {error && <p className="error" role="alert">Could not reach the shop's data: {error}</p>}

      <section className="card wide">
        <h2>Connection check</h2>
        {!checks && !error && <p className="muted">Checking…</p>}
        {checks && (
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
        )}
      </section>

      <footer className="muted small">Till {version && `v${version}`} · Setup</footer>
    </main>
  )
}
