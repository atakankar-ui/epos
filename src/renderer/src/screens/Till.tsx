// The working till. Everything it needs to sell is on this PC: it opens and sells
// with no internet, and sends its sales when there is a connection.
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { refreshProducts } from '../lib/connect'
import { pullShopDetails } from '../lib/shopDetails'
import { syncOnce, type SyncStatus } from '../lib/sync'
import { buildIndex, type ProductIndex } from '../../../shared/products'
import { buildSale, type Tender } from '../../../shared/sale'
import type { Basket } from '../../../shared/basket'
import type { Binding } from '../../../shared/local'
import { Selling } from './Selling'
import { Setup } from './Setup'

const SYNC_EVERY_MS = 15_000
const PRODUCTS_EVERY_MS = 10 * 60_000

export function Till({ binding, onDisconnected }: { binding: Binding; onDisconnected: () => void }) {
  const [index, setIndex] = useState<ProductIndex | null>(null)
  const [status, setStatus] = useState<SyncStatus>({ link: 'offline', waiting: 0, refused: 0, lastRefusal: null })
  const [productsAt, setProductsAt] = useState<string | null>(null)
  const [wrongShop, setWrongShop] = useState(false)
  const [setup, setSetup] = useState(false)
  const busy = useRef(false)
  const lastProducts = useRef(0)

  const loadLocal = useCallback(async () => {
    const [products, state] = await Promise.all([window.till.local.getProducts(), window.till.local.getState()])
    setIndex(buildIndex(products))
    setProductsAt(state.productsSyncedAt)
  }, [])

  // One round: send waiting sales, and now and then fetch fresh prices.
  const sync = useCallback(async (forceProducts = false) => {
    if (busy.current) return
    busy.current = true
    try {
      const next = await syncOnce(binding)
      setStatus(next)
      if (next.link === 'online' && (forceProducts || Date.now() - lastProducts.current > PRODUCTS_EVERY_MS)) {
        lastProducts.current = Date.now()
        const ok = await refreshProducts(binding)
        setWrongShop(!ok)
        if (ok) await loadLocal()
        if (ok) await pullShopDetails(binding)
      }
    } catch {
      // A failed round changes nothing on this PC; the next round tries again.
    } finally {
      busy.current = false
    }
  }, [binding, loadLocal])

  useEffect(() => {
    void loadLocal().then(() => sync())
    const timer = setInterval(() => void sync(), SYNC_EVERY_MS)
    const kick = () => void sync()
    window.addEventListener('online', kick)
    window.addEventListener('offline', kick)
    return () => {
      clearInterval(timer)
      window.removeEventListener('online', kick)
      window.removeEventListener('offline', kick)
    }
  }, [loadLocal, sync])

  // Save the sale on this PC first. Only then is it "done"; sending happens after.
  const completeSale = useCallback(async (basket: Basket, tender: Tender, saleId?: string) => {
    const draft = buildSale({
      basket, orgId: binding.orgId, tillId: binding.tillId, soldAt: new Date(),
      tender, saleId, newId: () => crypto.randomUUID(),
    })
    const saved = await window.till.local.saveSale(draft)
    setStatus((s) => ({ ...s, waiting: s.waiting + 1 }))
    void sync()
    return saved
  }, [binding, sync])

  if (setup) {
    return (
      <Setup
        binding={binding} status={status} productsAt={productsAt} wrongShop={wrongShop}
        onBack={() => setSetup(false)} onSync={() => sync(true)} onDisconnected={onDisconnected}
      />
    )
  }

  const isTest = /test/i.test(binding.orgName)
  const linkText = { online: 'Online', offline: 'Offline · cash only', signin: 'Sign-in needed' }[status.link]

  return (
    <div className="till">
      <header className="topbar">
        <strong>{binding.orgName}</strong>
        <span className="muted">{binding.tillName}</span>
        {isTest && <span className="test-pill">TEST SHOP</span>}
        <span className="grow" />
        {status.waiting > 0 && (
          <span className={`waiting${status.refused > 0 ? ' bad' : ''}`} data-testid="waiting">
            {status.waiting} {status.waiting === 1 ? 'sale' : 'sales'} waiting to send
          </span>
        )}
        <span className={`link ${status.link}`} data-testid="link"><i />{linkText}</span>
        <button className="small-btn" onClick={() => setSetup(true)}>Setup</button>
      </header>

      {!index ? (
        <main className="centre muted"><p className="big">Opening…</p></main>
      ) : (
        <Selling index={index} onPay={completeSale} online={status.link === 'online'} tillId={binding.tillId} />
      )}
    </div>
  )
}

export async function signOutQuietly(): Promise<void> {
  // "local" = forget the sign-in on this PC even if the server cannot be reached.
  await supabase.auth.signOut({ scope: 'local' })
}
