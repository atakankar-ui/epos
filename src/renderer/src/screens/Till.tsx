// The working till. Everything it needs to sell is on this PC: it opens and sells
// with no internet, and sends its sales when there is a connection.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { refreshProducts } from '../lib/connect'
import { pullShopDetails } from '../lib/shopDetails'
import { pullStaff } from '../lib/staff'
import { syncOnce, type SyncStatus } from '../lib/sync'
import { buildIndex, type ProductIndex } from '../../../shared/products'
import { buildSale, type Tender } from '../../../shared/sale'
import { auditRow, type AuditAction } from '../../../shared/audit'
import { activeStaff, type Staff } from '../../../shared/staff'
import type { Basket } from '../../../shared/basket'
import type { Binding } from '../../../shared/local'
import { Selling } from './Selling'
import { Setup } from './Setup'
import { Refund } from './Refund'
import { Approval, StaffGate, type Answer, type Ask } from './Approval'
import { Reports, StartDay } from './Reports'
import type { DayInfo } from '../../../shared/report'

const SYNC_EVERY_MS = 15_000
const PRODUCTS_EVERY_MS = 10 * 60_000

// What the selling and refund pages can ask the till to do.
export type TillTools = {
  staffId: string | null
  hasStaff: boolean // false until the first staff member is added in Setup
  // Ask for a reason and, for manager-only actions, a manager's PIN. null = cancelled.
  ask: (ask: Ask) => Promise<Answer | null>
  // Write one entry in the audit trail.
  log: (entry: {
    action: AuditAction; reason: string | null; approvedBy?: string | null
    saleId?: string | null; refundId?: string | null; amountPence?: number | null; details?: Record<string, unknown>
  }) => Promise<void>
}

export function Till({ binding, onDisconnected }: { binding: Binding; onDisconnected: () => void }) {
  const [index, setIndex] = useState<ProductIndex | null>(null)
  const [status, setStatus] = useState<SyncStatus>({ link: 'offline', waiting: 0, refused: 0, lastRefusal: null })
  const [productsAt, setProductsAt] = useState<string | null>(null)
  const [wrongShop, setWrongShop] = useState(false)
  const [setup, setSetup] = useState(false)
  const [staff, setStaff] = useState<Staff[]>([])
  const [current, setCurrent] = useState<Staff | null>(null)
  const [asking, setAsking] = useState<{ ask: Ask; resolve: (a: Answer | null) => void } | null>(null)
  const [refunding, setRefunding] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [day, setDay] = useState<DayInfo | null | undefined>(undefined) // undefined = not read yet
  const busy = useRef(false)
  const again = useRef(false)
  const syncRef = useRef<() => Promise<void>>(async () => undefined)
  const lastProducts = useRef(0)

  const loadLocal = useCallback(async () => {
    const [products, state, people, openDay] = await Promise.all([window.till.local.getProducts(), window.till.local.getState(), window.till.local.getStaff(), window.till.local.currentDay()])
    setDay(openDay)
    setIndex(buildIndex(products))
    setProductsAt(state.productsSyncedAt)
    setStaff(people)
  }, [])

  // One round: send waiting sales, and now and then fetch fresh prices, staff and receipt details.
  const sync = useCallback(async (forceProducts = false) => {
    if (busy.current) {
      again.current = true // something new to send arrived mid-round: go round once more straight after
      return
    }
    busy.current = true
    try {
      const next = await syncOnce(binding)
      setStatus(next)
      if (next.link === 'online' && (forceProducts || Date.now() - lastProducts.current > PRODUCTS_EVERY_MS)) {
        lastProducts.current = Date.now()
        const ok = await refreshProducts(binding)
        setWrongShop(!ok)
        if (ok) {
          await pullShopDetails(binding)
          await pullStaff(binding)
          await loadLocal()
        }
      }
    } catch {
      // A failed round changes nothing on this PC; the next round tries again.
    } finally {
      busy.current = false
      if (again.current) {
        again.current = false
        void syncRef.current()
      }
    }
  }, [binding, loadLocal])
  syncRef.current = sync

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

  // Someone who has been removed (or whose PIN changed elsewhere) is signed out.
  useEffect(() => {
    if (current && !activeStaff(staff).some((s) => s.id === current.id && s.pinHash === current.pinHash)) setCurrent(null)
  }, [current, staff])

  const tools = useMemo<TillTools>(() => ({
    staffId: current?.id ?? null,
    hasStaff: activeStaff(staff).length > 0,
    ask: (ask) => new Promise((resolve) => setAsking({ ask, resolve })),
    log: async (entry) => {
      await window.till.local.logAudit(auditRow({
        id: crypto.randomUUID(), orgId: binding.orgId, tillId: binding.tillId, at: new Date(), staffId: current?.id ?? null, ...entry,
      }))
      setStatus((s) => ({ ...s, waiting: s.waiting + 1 }))
      void sync()
    },
  }), [binding, current, staff, sync])

  // Save the sale on this PC first. Only then is it "done"; sending happens after.
  const completeSale = useCallback(async (basket: Basket, tender: Tender, saleId?: string) => {
    const draft = buildSale({
      basket, orgId: binding.orgId, tillId: binding.tillId, staffId: current?.id ?? null, soldAt: new Date(),
      tender, saleId, newId: () => crypto.randomUUID(),
    })
    const saved = await window.till.local.saveSale(draft)
    setStatus((s) => ({ ...s, waiting: s.waiting + 1 }))
    void sync()
    return saved
  }, [binding, current, sync])

  if (setup) {
    return (
      <Setup
        binding={binding} status={status} productsAt={productsAt} wrongShop={wrongShop} staff={staff}
        onBack={() => setSetup(false)} onSync={() => sync(true)} onDisconnected={onDisconnected}
      />
    )
  }

  const isTest = /test/i.test(binding.orgName)
  const linkText = { online: 'Online', offline: 'Offline', signin: 'Sign-in needed' }[status.link]
  const locked = activeStaff(staff).length > 0 && !current

  return (
    <div className="till">
      <header className="topbar">
        <strong>{binding.orgName}</strong>
        <span className="muted">{binding.tillName}</span>
        {isTest && <span className="test-pill">TEST SHOP</span>}
        {current && <span className="who" data-testid="who">{current.name}</span>}
        <span className="grow" />
        {status.waiting > 0 && (
          <span className={`waiting${status.refused > 0 ? ' bad' : ''}`} data-testid="waiting">
            {status.waiting} waiting to send
          </span>
        )}
        <span className={`link ${status.link}`} data-testid="link"><i />{linkText}</span>
        <button className="small-btn" onClick={() => setSetup(true)}>Setup</button>
      </header>

      {!index ? (
        <main className="centre muted"><p className="big">Opening…</p></main>
      ) : locked ? (
        <StaffGate staff={staff} onSignedIn={setCurrent} />
      ) : !day ? (
        <StartDay tools={tools} onStarted={(d) => { setDay(d); setStatus((s) => ({ ...s, waiting: s.waiting + 1 })); void sync() }} onReports={() => setReporting(true)} />
      ) : (
        <Selling
          index={index} onPay={completeSale} online={status.link === 'online'} tillId={binding.tillId}
          tools={tools} blocked={!!asking || refunding || reporting}
          onRefund={() => setRefunding(true)} onReports={() => setReporting(true)} onLock={current ? () => setCurrent(null) : undefined}
        />
      )}

      {refunding && <Refund binding={binding} online={status.link === 'online'} tools={tools} onClose={() => setRefunding(false)} />}
      {reporting && (
        <Reports
          binding={binding} day={day ?? null} tools={tools} onClose={() => setReporting(false)}
          onClosed={() => { setDay(null); setStatus((s) => ({ ...s, waiting: s.waiting + 1 })); void sync() }}
        />
      )}
      {asking && (
        <Approval
          ask={asking.ask} staff={staff} current={current}
          onDone={(answer) => { asking.resolve(answer); setAsking(null) }}
        />
      )}
    </div>
  )
}

export async function signOutQuietly(): Promise<void> {
  // "local" = forget the sign-in on this PC even if the server cannot be reached.
  await supabase.auth.signOut({ scope: 'local' })
}
