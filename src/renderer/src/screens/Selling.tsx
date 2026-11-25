import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addMiscItem, addProduct, discountAll, emptyBasket, hasLiveLines, lineDiscountPence, lineTotalPence, MAX_QTY,
  overridePrice, setDiscount, setQty, totals, voidLine,
  type Basket, type LineDiscount,
} from '../../../shared/basket'
import { formatPence, formatRate, keyedPence } from '../../../shared/money'
import { findByBarcode, searchProducts, type Product, type ProductIndex } from '../../../shared/products'
import type { Tender as TenderType } from '../../../shared/sale'
import { Tender } from './Tender'
import { DISCOUNT_REASONS, NO_SALE_REASONS, OVERRIDE_REASONS, REFUND_REASONS, VOID_REASONS } from '../../../shared/audit'
import type { ParkedSale } from '../../../shared/local'
import type { Answer } from './Approval'
import type { TillTools } from './Till'

type Message = { kind: 'info' | 'error'; text: string }

const KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '00', 'C']

// Each product button keeps the same soft colour every day, so staff learn where things are.
const TILE_COLOURS = ['#fef3c7', '#e0f2fe', '#dcfce7', '#fce7f3', '#ede9fe', '#fde8d0', '#fee2e2', '#e2e8f0', '#fef9c3', '#d1fae5']
function tileColour(name: string): string {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return TILE_COLOURS[h % TILE_COLOURS.length]
}
const MAX_ENTRY = 14 // the longest barcode a scanner sends

export function Selling({ index, onPay, onLooseRefund, online, tillId, tools, blocked, onRefund, onReports, onLock, onSetup, menu, setMenu }: {
  index: ProductIndex
  // Saves the sale on this PC and returns its receipt number.
  onPay: (basket: Basket, tender: TenderType | TenderType[], saleId?: string) => Promise<{ receiptNo: string; saleId: string }>
  // Refunds what is in the basket, in cash, with no receipt.
  onLooseRefund: (basket: Basket, answer: Answer) => Promise<{ receiptNo: string; totalPence: number }>
  online: boolean
  tillId: string
  tools: TillTools
  blocked: boolean // another page (refund, manager approval) is on top
  onRefund: () => void
  onReports: () => void
  onLock?: () => void
  onSetup: () => void
  menu: boolean // the Menu button lives in the top bar
  setMenu: (open: boolean) => void
}) {
  // The basket and which line is selected change together, so they live together.
  const [sale, setSale] = useState<{ basket: Basket; selectedId: string | null }>({ basket: emptyBasket, selectedId: null })
  const { basket, selectedId } = sale
  const setSelectedId = (id: string | null) => setSale((current) => ({ ...current, selectedId: id }))
  const [entry, setEntry] = useState('') // digits typed or scanned so far
  const [message, setMessage] = useState<Message | null>(null)
  const [needsPrice, setNeedsPrice] = useState<Product | null>(null) // scanned, but has no price
  const [query, setQuery] = useState('')
  const [paying, setPaying] = useState<'cash' | 'card' | null>(null) // the payment page is open, and how they are paying
  const [tab, setTab] = useState<'nobarcode' | 'top' | 'search'>('nobarcode')
  const [topIds, setTopIds] = useState<string[]>([])
  const [cardOn, setCardOn] = useState(true)
  const [discounting, setDiscounting] = useState<'line' | 'sale' | null>(null)
  const [parked, setParked] = useState<ParkedSale[]>([])
  const [showParked, setShowParked] = useState(false)
  const listRef = useRef<HTMLUListElement>(null)

  const sums = useMemo(() => totals(basket), [basket])
  const selected = basket.lines.find((l) => l.id === selectedId && !l.voided) ?? null
  const results = useMemo(() => (tab === 'search' ? searchProducts(index, query) : []), [index, query, tab])
  // Items with a price but no barcode: the ones a cashier cannot scan.
  const noBarcode = useMemo(() => index.all.filter((p) => !p.barcode && p.pricePence !== null).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 60), [index])
  const topSold = useMemo(() => {
    const byId = new Map(index.all.map((p) => [p.id, p]))
    return topIds.map((id) => byId.get(id)).filter((p): p is Product => !!p)
  }, [index, topIds])

  useEffect(() => {
    void window.till.local.topProductIds(24).then(setTopIds)
    void window.till.hardware.getConfig().then((c) => setCardOn(c.card !== 'off'))
    void window.till.local.getParked().then(setParked)
  }, [])

  const say = (kind: Message['kind'], text: string) => setMessage({ kind, text })

  const sell = useCallback((product: Product, keyedPrice?: number) => {
    if (product.pricePence === null && keyedPrice === undefined) {
      setNeedsPrice(product)
      setEntry('')
      say('info', `${product.name} has no price. Type the price in pence and press Enter.`)
      return
    }
    const newLineId = crypto.randomUUID()
    setSale((current) => {
      const added = addProduct(current.basket, product, newLineId, keyedPrice)
      return { basket: added.basket, selectedId: added.lineId }
    })
    setNeedsPrice(null)
    setEntry('')
    setMessage(null)
  }, [])

  // Enter (from the scanner, the keyboard or the on-screen key).
  const enter = useCallback(() => {
    if (needsPrice) {
      const price = keyedPence(entry)
      if (!price) return say('error', 'Type the price in pence first, for example 149 for £1.49.')
      return sell(needsPrice, price)
    }
    if (!entry) return
    const product = findByBarcode(index, entry)
    if (!product) {
      say('error', `No product with barcode ${entry}.`)
      setEntry('')
      return
    }
    sell(product)
  }, [entry, index, needsPrice, sell])

  const press = useCallback((key: string) => {
    if (key === 'C') {
      setEntry('')
      setNeedsPrice(null)
      setMessage(null)
      return
    }
    setEntry((current) => (current + key).slice(0, MAX_ENTRY))
  }, [])

  // A barcode scanner behaves like a keyboard: it types the digits, then Enter.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (paying || blocked || menu || discounting || showParked) return // another page has the keyboard; a scan must not add items now
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return // typing in the search box
      if (event.ctrlKey || event.altKey || event.metaKey) return
      if (/^\d$/.test(event.key)) press(event.key)
      else if (event.key === 'Enter') { event.preventDefault(); enter() }
      else if (event.key === 'Backspace') setEntry((current) => current.slice(0, -1))
      else if (event.key === 'Escape') press('C')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [blocked, discounting, enter, menu, paying, press, showParked])

  // Keep the newest or selected line in view.
  useEffect(() => {
    listRef.current?.querySelector('.line.selected')?.scrollIntoView({ block: 'nearest' })
  }, [selectedId, basket])

  function changeQty(qty: number) {
    if (!selected) return say('error', 'Tap a line in the basket first.')
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      return say('error', `Quantity must be between 1 and ${MAX_QTY}.`)
    }
    const lineId = selected.id
    setSale((current) => ({ ...current, basket: setQty(current.basket, lineId, qty) }))
    setEntry('')
    setMessage(null)
  }

  function qtyFromEntry() {
    if (!entry) return say('error', 'Type the quantity on the keypad, then press Qty.')
    changeQty(Number(entry))
  }

  // The log entry is written first. If it cannot be written, the action does not happen.
  async function logged(entry: Parameters<TillTools['log']>[0]): Promise<boolean> {
    try {
      await tools.log(entry)
      return true
    } catch (err) {
      say('error', `Not done: it could not be written to the log (${(err as Error).message}).`)
      return false
    }
  }

  async function voidSelected() {
    if (!selected) return say('error', 'Tap a line in the basket first.')
    const line = selected
    const answer = await tools.ask({ title: `Void ${line.name}?`, manager: false, reasons: VOID_REASONS })
    if (!answer) return
    if (!(await logged({
      action: 'void_line', reason: answer.reason, amountPence: line.unitPence * line.qty,
      details: { name: line.name, quantity: line.qty, barcode: line.barcode, product_id: line.productId },
    }))) return
    setSale((current) => ({ basket: voidLine(current.basket, line.id), selectedId: null }))
    say('info', `Voided: ${line.name}.`)
  }

  // Manager only: sell the selected line at a different price.
  async function changePrice() {
    if (!selected) return say('error', 'Tap a line in the basket first.')
    const price = keyedPence(entry)
    if (price === null) return say('error', 'Type the new price in pence on the keypad, then press Price. For example 99 for £0.99.')
    const line = selected
    const answer = await tools.ask({ title: `Change ${line.name} from ${formatPence(line.unitPence)} to ${formatPence(price)}?`, manager: true, reasons: OVERRIDE_REASONS })
    if (!answer) return
    if (!(await logged({
      action: 'price_override', reason: answer.reason, approvedBy: answer.approvedBy, amountPence: price,
      details: { name: line.name, from: line.unitPence / 100, to: price / 100, quantity: line.qty, product_id: line.productId },
    }))) return
    setSale((current) => ({ ...current, basket: overridePrice(current.basket, line.id, price) }))
    setEntry('')
    say('info', `Price changed: ${line.name} now ${formatPence(price)}.`)
  }

  // Manager only: money off the selected line or the whole sale (null = take the discount off again).
  async function applyDiscount(scope: 'line' | 'sale', discount: LineDiscount | null) {
    setDiscounting(null)
    const line = selected
    if (scope === 'line' && !line) return say('error', 'Tap a line in the basket first.')
    const next = scope === 'line' ? setDiscount(basket, line!.id, discount) : discountAll(basket, discount)
    const off = totals(next).discountPence
    const what = scope === 'line' ? line!.name : 'the whole sale'
    const how = !discount ? 'Remove the discount' : discount.kind === 'percent' ? `${discount.value}% off` : `${formatPence(discount.pence)} off`
    const answer = await tools.ask({ title: `${how}: ${what}?`, manager: true, reasons: discount ? DISCOUNT_REASONS : [] })
    if (!answer) return
    if (!(await logged({
      action: 'discount', reason: answer.reason || (discount ? null : 'Discount removed'), approvedBy: answer.approvedBy, amountPence: off,
      details: { scope, name: scope === 'line' ? line!.name : null, discount, total_before: sums.totalPence, total_after: totals(next).totalPence },
    }))) return
    setSale((current) => ({ ...current, basket: next }))
    setEntry('')
    say('info', discount ? `Discount applied: ${how} ${what}.` : 'Discount removed.')
  }

  // Put this sale to one side and serve the next customer.
  async function park() {
    if (!hasLiveLines(basket)) return say('error', 'There is nothing in the basket to park.')
    const next = [...parked, { id: crypto.randomUUID(), basket, parkedAt: new Date().toISOString(), staffId: tools.staffId }]
    await window.till.local.setParked(next)
    setParked(next)
    setSale({ basket: emptyBasket, selectedId: null })
    setEntry('')
    setNeedsPrice(null)
    say('info', `Sale parked (${formatPence(sums.totalPence)}). Press Parked to bring it back.`)
  }

  async function resume(sale: ParkedSale) {
    setShowParked(false)
    if (basket.lines.length > 0) return say('error', 'Finish, park or void the current sale first.')
    const next = parked.filter((p) => p.id !== sale.id)
    await window.till.local.setParked(next)
    setParked(next)
    setSale({ basket: sale.basket, selectedId: null })
    say('info', 'Parked sale brought back.')
  }

  // Manager only: the returned goods have been scanned into the basket; give the money back in cash.
  async function refundNoReceipt() {
    setMenu(false)
    if (!hasLiveLines(basket)) return say('error', 'Scan the items being returned first, then choose this again.')
    const answer = await tools.ask({ title: `Refund ${formatPence(sums.totalPence)} in cash with no receipt?`, manager: true, reasons: REFUND_REASONS })
    if (!answer) return
    try {
      const done = await onLooseRefund(basket, answer)
      setSale({ basket: emptyBasket, selectedId: null })
      setEntry('')
      say('info', `Refunded ${formatPence(done.totalPence)} in cash with no receipt. Slip ${done.receiptNo}.`)
    } catch (err) {
      say('error', `The refund was NOT saved: ${(err as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')}`)
    }
  }

  // Manager only: open the drawer with no sale.
  async function noSale() {
    setMenu(false)
    const answer = await tools.ask({ title: 'Open the drawer with no sale?', manager: true, reasons: NO_SALE_REASONS })
    if (!answer) return
    if (!(await logged({ action: 'no_sale', reason: answer.reason, approvedBy: answer.approvedBy }))) return
    const result = await window.till.hardware.openDrawer()
    say(result.ok ? 'info' : 'error', result.ok ? 'Drawer opened. This has been logged.' : `Logged, but the drawer did not open: ${result.message}`)
  }

  function misc() {
    const price = keyedPence(entry)
    if (!price) return say('error', 'Type the price in pence, then press Misc item. For example 149 for £1.49.')
    const id = crypto.randomUUID()
    setSale((current) => ({ basket: addMiscItem(current.basket, price, id), selectedId: id }))
    setEntry('')
    setMessage(null)
  }

  async function voidSale() {
    if (basket.lines.length === 0) return
    const answer = await tools.ask({ title: 'Void the whole sale?', manager: false, reasons: VOID_REASONS })
    if (!answer) return
    if (!(await logged({
      action: 'void_sale', reason: answer.reason, amountPence: sums.totalPence,
      details: { items: basket.lines.filter((l) => !l.voided).map((l) => ({ name: l.name, quantity: l.qty })) },
    }))) return
    setSale({ basket: emptyBasket, selectedId: null })
    setEntry('')
    setNeedsPrice(null)
    say('info', 'Sale voided. Ready for the next customer.')
  }

  function saleFinished(done: { receiptNo: string; method: 'cash' | 'card'; changePence: number; summary: string }) {
    const how = done.summary.includes('+') ? `(${done.summary})${done.changePence > 0 ? `, ${formatPence(done.changePence)} change` : ''}`
      : done.method === 'card' ? 'card' : done.changePence > 0 ? `cash, ${formatPence(done.changePence)} change` : 'cash'
    say('info', `Sale saved: ${formatPence(sums.totalPence)} ${how}. Receipt ${done.receiptNo}.`)
    setSale({ basket: emptyBasket, selectedId: null })
    setEntry('')
    setNeedsPrice(null)
    setPaying(null)
    void window.till.local.topProductIds(24).then(setTopIds)
  }

  const entryText = needsPrice
    ? entry ? formatPence(Number(entry)) : 'Price?'
    : entry

  const tiles = tab === 'search' ? results : tab === 'top' ? topSold : noBarcode
  const status = message?.text ?? (basket.lines.length === 0 ? 'Ready for the next customer' : `Sale in progress · ${basket.lines.length} ${basket.lines.length === 1 ? 'line' : 'lines'}`)

  return (
    <div className="sell">
      <section className="basket" aria-label="Basket">
        <header className={`message ${message?.kind ?? ''}`} role="status">{status}</header>
        {basket.lines.length === 0 ? (
          <div className="basket-empty">
            <p className="big">Scan an item to start</p>
            <p className="muted">or tap a button, or type a price and press Misc item</p>
          </div>
        ) : (
          <ul className="lines" ref={listRef}>
            {basket.lines.map((line) => (
              <li key={line.id}>
                <button
                  className={`line${line.id === selectedId && !line.voided ? ' selected' : ''}${line.voided ? ' voided' : ''}`}
                  onClick={() => !line.voided && setSelectedId(line.id)}
                  disabled={line.voided}
                >
                  <span className="qty">{line.qty}</span>
                  <span className="name">
                    {line.name}
                    <small>
                      {line.voided ? 'VOID · ' : ''}
                      {formatPence(line.unitPence)} each{line.originalUnitPence !== undefined && ` (was ${formatPence(line.originalUnitPence)})`} · VAT {formatRate(line.vatRate)}
                      {lineDiscountPence(line) > 0 && <b className="off"> · {line.discount?.kind === 'percent' ? `${line.discount.value}% off, ` : ''}saves {formatPence(lineDiscountPence(line))}</b>}
                    </small>
                  </span>
                  <span className="amount">{formatPence(line.voided ? line.unitPence * line.qty : lineTotalPence(line))}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <footer className="totals">
          <div className="vat">
            {sums.byRate.map((r) => (
              <span key={r.rate}>
                VAT {formatRate(r.rate)}: {formatPence(r.vatPence)} <small>on {formatPence(r.grossPence)}</small>
              </span>
            ))}
          </div>
          <div className="total">
            <span>{sums.itemCount} {sums.itemCount === 1 ? 'item' : 'items'}{sums.discountPence > 0 && <b className="off" data-testid="saved"> · saved {formatPence(sums.discountPence)}</b>}</span>
            <strong data-testid="total">{formatPence(sums.totalPence)}</strong>
          </div>
        </footer>
      </section>

      <section className="picker" aria-label="Products">
        <div className="tabs">
          <button className={tab === 'nobarcode' ? 'tab on' : 'tab'} onClick={() => setTab('nobarcode')}>No barcode</button>
          <button className={tab === 'top' ? 'tab on' : 'tab'} onClick={() => setTab('top')}>Most sold</button>
          <button className={tab === 'search' ? 'tab on' : 'tab'} onClick={() => { setTab('search'); setQuery('') }}>Search</button>
        </div>
        {tab === 'search' && (
          <input
            className="search-box" autoFocus placeholder="Type part of the name" value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setTab('nobarcode')}
          />
        )}
        <div className="tiles">
          {tiles.map((product) => (
            <button key={product.id} className="tile" style={{ background: tileColour(product.name) }} onClick={() => sell(product)}>
              <span>{product.name}</span>
              <em>{product.pricePence === null ? 'Ask price' : formatPence(product.pricePence)}</em>
            </button>
          ))}
        </div>
        {tiles.length === 0 && (
          <p className="muted none">
            {tab === 'search' ? (query.trim() ? `Nothing found for "${query.trim()}".` : `${index.all.length.toLocaleString('en-GB')} products to search.`)
              : tab === 'top' ? 'The products this till sells most will appear here.'
                : 'Products that have a price but no barcode (bread, papers, bags) appear here. Add them in Retail Aid.'}
          </p>
        )}
      </section>

      <section className="pad" aria-label="Keypad">
        <div className={`entry${needsPrice ? ' price' : ''}`}><small>{needsPrice ? 'Price' : 'Scan or type'}</small><b data-testid="entry">{entryText || '\u00a0'}</b></div>
        <div className="keys">
          {KEYS.map((key) => (
            <button key={key} className={key === 'C' ? 'key clear' : 'key'} onClick={() => press(key)}>{key === 'C' ? 'Clear' : key}</button>
          ))}
        </div>
        <div className="misc-row">
          <button className="misc" onClick={misc}>Misc item</button>
          <button className="key enter" onClick={enter}>Enter</button>
        </div>

        <div className="actions">
          <button onClick={() => selected && changeQty(selected.qty - 1)} disabled={!selected || selected.qty <= 1}>− 1</button>
          <button onClick={() => selected && changeQty(selected.qty + 1)} disabled={!selected || selected.qty >= MAX_QTY}>+ 1</button>
          <button onClick={qtyFromEntry} disabled={!selected}>Qty</button>
          <button onClick={() => void changePrice()} disabled={!selected}>Price</button>
          <button onClick={() => setDiscounting(selected ? 'line' : 'sale')} disabled={!hasLiveLines(basket)}>Discount</button>
          <button onClick={() => void park()} disabled={!hasLiveLines(basket)}>Park</button>
          <button className="danger" onClick={() => void voidSelected()} disabled={!selected}>Void line</button>
          <button className="danger" onClick={() => void voidSale()} disabled={basket.lines.length === 0}>Void sale</button>
          <button onClick={() => setShowParked(true)} disabled={parked.length === 0} data-testid="parked">Parked{parked.length > 0 ? ` (${parked.length})` : ''}</button>
        </div>

        <div className="pays">
          <button className="pay by-cash" onClick={() => setPaying('cash')} disabled={!hasLiveLines(basket)}>
            <span>Cash</span><small>{hasLiveLines(basket) ? formatPence(sums.totalPence) : '\u00a0'}</small>
          </button>
          {cardOn && (
            <button className="pay by-card" onClick={() => setPaying('card')} disabled={!hasLiveLines(basket)}>
              <span>Card</span><small>{hasLiveLines(basket) ? formatPence(sums.totalPence) : '\u00a0'}</small>
            </button>
          )}
        </div>
      </section>

      {paying && (
        <Tender
          totalPence={sums.totalPence} start={paying} online={online} tillId={tillId}
          complete={(tender, saleId) => onPay(basket, tender, saleId)}
          onBack={() => setPaying(null)} onFinished={saleFinished}
        />
      )}

      {discounting && (
        <div className="overlay" role="dialog" aria-label="Discount">
          <div className="tender approval">
            <h2>Discount</h2>
            <div className="split">
              <button className={discounting === 'line' ? 'tab on' : 'tab'} onClick={() => setDiscounting('line')} disabled={!selected}>{selected ? `This line: ${selected.name}` : 'Tap a line first'}</button>
              <button className={discounting === 'sale' ? 'tab on' : 'tab'} onClick={() => setDiscounting('sale')}>The whole sale</button>
            </div>
            <div className="quick">
              {[5, 10, 20, 50].map((value) => <button key={value} onClick={() => void applyDiscount(discounting, { kind: 'percent', value })}>{value}%</button>)}
            </div>
            {keyedPence(entry) ? (
              <div className="split">
                {Number(entry) <= 100 && <button onClick={() => void applyDiscount(discounting, { kind: 'percent', value: Number(entry) })}>{Number(entry)}% off</button>}
                <button onClick={() => void applyDiscount(discounting, { kind: 'amount', pence: Number(entry) })}>{formatPence(Number(entry))} off</button>
              </div>
            ) : <p className="muted">For any other amount: close this, type the number on the keypad, then press Discount again.</p>}
            {(discounting === 'line' ? !!selected?.discount : sums.discountPence > 0) && <button className="danger" onClick={() => void applyDiscount(discounting, null)}>Remove the discount</button>}
            <button onClick={() => setDiscounting(null)}>Cancel</button>
          </div>
        </div>
      )}

      {showParked && (
        <div className="overlay" role="dialog" aria-label="Parked sales">
          <div className="tender approval">
            <h2>Parked sales</h2>
            <ul className="results">
              {parked.map((sale) => (
                <li key={sale.id}><button onClick={() => void resume(sale)}>
                  <span className="name">{sale.basket.lines.filter((l) => !l.voided).map((l) => l.name).slice(0, 3).join(', ')}
                    <small>Parked at {new Date(sale.parkedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · {totals(sale.basket).itemCount} items</small></span>
                  <span className="amount">{formatPence(totals(sale.basket).totalPence)}</span>
                </button></li>
              ))}
            </ul>
            <button onClick={() => setShowParked(false)}>Close</button>
          </div>
        </div>
      )}

      {menu && (
        <div className="overlay" role="dialog" aria-label="Menu">
          <div className="tender approval">
            <h2>Menu</h2>
            <div className="reasons">
              <button onClick={() => { setMenu(false); onRefund() }}>Refund (with a receipt)</button>
              <button onClick={() => void refundNoReceipt()}>Refund the items in the basket (no receipt)</button>
              <button onClick={() => void noSale()}>Open drawer (no sale)</button>
              <button onClick={() => { setMenu(false); if (basket.lines.length > 0) say('error', 'Finish or void this sale before running a report.'); else onReports() }}>Reports (X and Z)</button>
              {onLock && <button onClick={() => { setMenu(false); if (basket.lines.length > 0) say('error', 'Finish or void this sale before locking the till.'); else onLock() }}>Lock the till</button>}
            </div>
            <button onClick={() => { setMenu(false); onSetup() }}>Setup</button>
            <button className="primary" onClick={() => setMenu(false)}>Close</button>
          </div>
        </div>
      )}
    </div>
  )
}
