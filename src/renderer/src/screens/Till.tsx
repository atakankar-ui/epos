// The signed-in till: loads the shop and its products, then shows the selling screen.
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { loadShop, type ShopInfo } from '../lib/shop'
import { loadProducts } from '../lib/products'
import { buildIndex, type ProductIndex } from '../../../shared/products'
import { Selling } from './Selling'
import { ConnectionCheck } from './ConnectionCheck'

export function Till({ userId, email }: { userId: string; email: string }) {
  const [shop, setShop] = useState<ShopInfo | null>(null)
  const [index, setIndex] = useState<ProductIndex | null>(null)
  const [loaded, setLoaded] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [setup, setSetup] = useState(false)

  const load = useCallback(async () => {
    setError(null)
    setIndex(null)
    setLoaded(0)
    try {
      setShop(await loadShop(userId))
      setIndex(buildIndex(await loadProducts(setLoaded)))
    } catch (err) {
      setError((err as Error).message)
    }
  }, [userId])

  useEffect(() => { void load() }, [load])

  if (setup) return <ConnectionCheck userId={userId} email={email} onBack={() => setSetup(false)} />

  const isTest = shop ? /test/i.test(shop.name) : false

  return (
    <div className="till">
      <header className="topbar">
        <strong>{shop?.name ?? 'Till'}</strong>
        {isTest && <span className="test-pill">TEST SHOP</span>}
        <span className="muted grow">{index ? `${index.all.length.toLocaleString('en-GB')} products` : ''}</span>
        <button className="small-btn" onClick={() => setSetup(true)}>Setup</button>
      </header>

      {error ? (
        <main className="centre">
          <div className="card">
            <h1>Could not load the shop</h1>
            <p className="error" role="alert">{error === 'Failed to fetch' ? 'No internet connection.' : error}</p>
            <button className="primary" onClick={() => void load()}>Try again</button>
            <button onClick={() => void supabase.auth.signOut()}>Sign out</button>
          </div>
        </main>
      ) : !index ? (
        <main className="centre muted">
          <p className="big">Loading products… {loaded > 0 && loaded.toLocaleString('en-GB')}</p>
        </main>
      ) : (
        <Selling index={index} />
      )}
    </div>
  )
}
