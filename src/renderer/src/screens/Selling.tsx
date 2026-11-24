import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  addMiscItem, addProduct, emptyBasket, hasLiveLines, lineTotalPence, MAX_QTY, setQty, totals, voidLine,
  type Basket,
} from '../../../shared/basket'
import { formatPence, formatRate, keyedPence } from '../../../shared/money'
import { findByBarcode, searchProducts, type Product, type ProductIndex } from '../../../shared/products'

type Message = { kind: 'info' | 'error'; text: string }

const KEYS = ['7', '8', '9', '4', '5', '6', '1', '2', '3', '0', '00', 'C']
const MAX_ENTRY = 14 // the longest barcode a scanner sends

export function Selling({ index, onPay }: {
  index: ProductIndex
  // Saves the sale on this PC and returns its receipt number.
  onPay: (basket: Basket, tenderedPence: number) => Promise<{ receiptNo: string }>
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
  const [confirmVoidSale, setConfirmVoidSale] = useState(false)
  const [paying, setPaying] = useState(false)
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
    setConfirmVoidSale(false)
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
  }, [enter, press])

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

  function voidSelected() {
    if (!selected) return say('error', 'Tap a line in the basket first.')
    const lineId = selected.id
    setSale((current) => ({ basket: voidLine(current.basket, lineId), selectedId: null }))
    say('info', `Voided: ${selected.name}.`)
  }

  function misc() {
    const price = keyedPence(entry)
    if (!price) return say('error', 'Type the price in pence, then press Misc item. For example 149 for £1.49.')
    const id = crypto.randomUUID()
    setSale((current) => ({ basket: addMiscItem(current.basket, price, id), selectedId: id }))
    setEntry('')
    setMessage(null)
  }

  function voidSale() {
    setSale({ basket: emptyBasket, selectedId: null })
    setEntry('')
    setNeedsPrice(null)
    setConfirmVoidSale(false)
    say('info', 'Sale voided. Ready for the next customer.')
  }

  // Phase 3 stand-in: cash for the exact amount. Phase 4 adds cash handed over, change and card.
  async function pay() {
    if (paying || !hasLiveLines(basket)) return
    setPaying(true)
    try {
      const { receiptNo } = await onPay(basket, sums.totalPence)
      setSale({ basket: emptyBasket, selectedId: null })
      setEntry('')
      setNeedsPrice(null)
      say('info', `Sale saved: ${formatPence(sums.totalPence)} cash. Receipt ${receiptNo}.`)
    } catch (err) {
      say('error', `The sale was NOT saved: ${(err as Error).message.replace(/^Error invoking remote method '[^']+': Error: /, '')}`)
    } finally {
      setPaying(false)
    }
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
                      {formatPence(line.unitPence)} each · VAT {formatRate(line.vatRate)}
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
          <button className="danger" onClick={voidSelected} disabled={!selected}>Void line</button>
        </div>

        {confirmVoidSale ? (
          <div className="confirm">
            <span>Void the whole sale?</span>
            <button className="danger" onClick={voidSale}>Yes, void it</button>
            <button onClick={() => setConfirmVoidSale(false)}>No</button>
          </div>
        ) : (
          <button className="danger wide-btn" onClick={() => setConfirmVoidSale(true)} disabled={basket.lines.length === 0}>Void sale</button>
        )}

        <button className="pay" onClick={() => void pay()} disabled={paying || !hasLiveLines(basket)}>
          Cash {hasLiveLines(basket) ? formatPence(sums.totalPence) : ''}
          <small>Exact amount for now · change and card come in Phase 4</small>
        </button>
      </section>

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
