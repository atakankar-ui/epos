import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addMiscItem, addProduct, emptyBasket, hasLiveLines, lineTotalPence, MAX_QTY, overridePrice, setQty, totals, voidLine,
  type Basket,
} from '../../../shared/basket'
import { formatPence, formatRate, keyedPence } from '../../../shared/money'
import { findByBarcode, searchProducts, type Product, type ProductIndex } from '../../../shared/products'
import type { Tender as TenderType } from '../../../shared/sale'
import { Tender } from './Tender'
import { NO_SALE_REASONS, OVERRIDE_REASONS, VOID_REASONS } from '../../../shared/audit'
import type { TillTools } from './Till'

type Message = { kind: 'info' | 'error'; text: string }

const KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '00', 'C']
const MAX_ENTRY = 14 // the longest barcode a scanner sends

export function Selling({ index, onPay, online, tillId, tools, blocked, onRefund, onLock }: {
  index: ProductIndex
  // Saves the sale on this PC and returns its receipt number.
  onPay: (basket: Basket, tender: TenderType, saleId?: string) => Promise<{ receiptNo: string; saleId: string }>
  online: boolean
  tillId: string
  tools: TillTools
  blocked: boolean // another page (refund, manager approval) is on top
  onRefund: () => void
  onLock?: () => void
}) {
  // The basket and which line is selected change together, so they live together.
  const [sale, setSale] = useState<{ basket: Basket; selectedId: string | null }>({ basket: emptyBasket, selectedId: null })
  const { basket, selectedId } = sale
  const setSelectedId = (id: string | null) => setSale((current) => ({ ...current, selectedId: id }))
  const [entry, setEntry] = useState('') // digits typed or scanned so far
  const [message, setMessage] = useState<Message | null>(null)
  const [needsPrice, setNeedsPrice] = useState<Product | null>(null) // scanned, but has no price
  const [searching, setSearching] = useState(false)
  const [query, setQuery] = useState('')
  const [menu, setMenu] = useState(false)
  const [paying, setPaying] = useState(false) // the payment page is open
  const listRef = useRef<HTMLUListElement>(null)

  const sums = useMemo(() => totals(basket), [basket])
  const selected = basket.lines.find((l) => l.id === selectedId && !l.voided) ?? null
  const results = useMemo(() => (searching ? searchProducts(index, query) : []), [index, query, searching])

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
      if (paying || blocked || menu) return // another page has the keyboard; a scan must not add items now
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      if (event.ctrlKey || event.altKey || event.metaKey) return
      if (/^\d$/.test(event.key)) press(event.key)
      else if (event.key === 'Enter') { event.preventDefault(); enter() }
      else if (event.key === 'Backspace') setEntry((current) => current.slice(0, -1))
      else if (event.key === 'Escape') press('C')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [blocked, enter, menu, paying, press])

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

  function saleFinished(done: { receiptNo: string; method: 'cash' | 'card'; changePence: number }) {
    const how = done.method === 'card' ? 'card' : done.changePence > 0 ? `cash, ${formatPence(done.changePence)} change` : 'cash'
    say('info', `Sale saved: ${formatPence(sums.totalPence)} ${how}. Receipt ${done.receiptNo}.`)
    setSale({ basket: emptyBasket, selectedId: null })
    setEntry('')
    setNeedsPrice(null)
    setPaying(false)
  }

  const entryText = needsPrice
    ? entry ? formatPence(Number(entry)) : 'Price?'
    : entry

  return (
    <div className="sell">
      <section className="basket" aria-label="Basket">
        {basket.lines.length === 0 ? (
          <div className="basket-empty">
            <p className="big">Scan an item to start</p>
            <p className="muted">or press Search to find it by name</p>
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
            <span>{sums.itemCount} {sums.itemCount === 1 ? 'item' : 'items'}</span>
            <strong data-testid="total">{formatPence(sums.totalPence)}</strong>
          </div>
        </footer>
      </section>

      <section className="pad" aria-label="Keypad">
        <div className={`entry${needsPrice ? ' price' : ''}`} data-testid="entry">{entryText || ' '}</div>
        <div className={`message ${message?.kind ?? ''}`} role="status">{message?.text ?? ' '}</div>

        <div className="keys">
          {KEYS.map((key) => (
            <button key={key} className={key === 'C' ? 'key clear' : 'key'} onClick={() => press(key)}>{key}</button>
          ))}
        </div>
        <button className="key enter" onClick={enter}>Enter</button>

        <div className="actions">
          <button onClick={() => selected && changeQty(selected.qty - 1)} disabled={!selected || selected.qty <= 1}>− 1</button>
          <button onClick={() => selected && changeQty(selected.qty + 1)} disabled={!selected || selected.qty >= MAX_QTY}>+ 1</button>
          <button onClick={qtyFromEntry} disabled={!selected}>Qty</button>
          <button onClick={() => { setSearching(true); setQuery('') }}>Search</button>
          <button onClick={misc}>Misc item</button>
          <button className="danger" onClick={() => void voidSelected()} disabled={!selected}>Void line</button>
        </div>

        <div className="actions">
          <button className="danger" onClick={() => void voidSale()} disabled={basket.lines.length === 0}>Void sale</button>
          <button onClick={() => void changePrice()} disabled={!selected}>Price</button>
          <button onClick={() => setMenu(true)}>More</button>
        </div>

        <button className="pay" onClick={() => { setSearching(false); setPaying(true) }} disabled={!hasLiveLines(basket)}>
          Pay {hasLiveLines(basket) ? formatPence(sums.totalPence) : ''}
        </button>
      </section>

      {paying && (
        <Tender
          totalPence={sums.totalPence} online={online} tillId={tillId}
          complete={(tender, saleId) => onPay(basket, tender, saleId)}
          onBack={() => setPaying(false)} onFinished={saleFinished}
        />
      )}

      {menu && (
        <div className="overlay" role="dialog" aria-label="More">
          <div className="tender approval">
            <h2>More</h2>
            <div className="reasons">
              <button onClick={() => { setMenu(false); onRefund() }}>Refund</button>
              <button onClick={() => void noSale()}>Open drawer (no sale)</button>
              {onLock && <button onClick={() => { setMenu(false); if (basket.lines.length > 0) say('error', 'Finish or void this sale before locking the till.'); else onLock() }}>Lock the till</button>}
            </div>
            <button onClick={() => setMenu(false)}>Close</button>
          </div>
        </div>
      )}

      {searching && (
        <div className="overlay" role="dialog" aria-label="Search products">
          <div className="search">
            <div className="search-top">
              <input
                autoFocus
                placeholder="Type part of the name"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setSearching(false)}
              />
              <button onClick={() => setSearching(false)}>Close</button>
            </div>
            <ul className="results">
              {results.map((product) => (
                <li key={product.id}>
                  <button onClick={() => { setSearching(false); sell(product) }}>
                    <span className="name">{product.name}<small>{product.barcode ?? 'no barcode'}</small></span>
                    <span className="amount">{product.pricePence === null ? 'No price' : formatPence(product.pricePence)}</span>
                  </button>
                </li>
              ))}
              {query.trim() && results.length === 0 && <li className="muted none">Nothing found for "{query.trim()}".</li>}
              {!query.trim() && <li className="muted none">{index.all.length.toLocaleString('en-GB')} products to search.</li>}
            </ul>
          </div>
        </div>
      )}
    </div>
  )
}
