import { describe, expect, it } from 'vitest'
import { addMiscItem, addProduct, emptyBasket, setQty, totals, vatInside, voidLine } from '../src/shared/basket'
import { formatPence, formatRate, keyedPence, poundsToPence } from '../src/shared/money'
import { buildIndex, findByBarcode, searchProducts, toProduct, type Product } from '../src/shared/products'

const cola: Product = { id: 'p1', name: 'Cola 500ml', barcode: '5000112637922', pricePence: 149, vatRate: 0.2 }
const bread: Product = { id: 'p2', name: 'White Bread', barcode: '0012345678905', pricePence: 120, vatRate: 0 }
const mystery: Product = { id: 'p3', name: 'Mystery Tin', barcode: '111', pricePence: 99, vatRate: null }
const unpriced: Product = { id: 'p4', name: 'New Biscuits', barcode: '222', pricePence: null, vatRate: 0.2 }

describe('money', () => {
  it('turns pounds into whole pence without rounding slips', () => {
    expect(poundsToPence(1.49)).toBe(149)
    expect(poundsToPence('0.29')).toBe(29)
    expect(poundsToPence(19.99)).toBe(1999)
    expect(poundsToPence(null)).toBeNull()
  })
  it('formats pence as pounds', () => {
    expect(formatPence(149)).toBe('£1.49')
    expect(formatPence(5)).toBe('£0.05')
    expect(formatPence(123456)).toBe('£1,234.56')
    expect(formatPence(0)).toBe('£0.00')
  })
  it('reads keypad digits as pence', () => {
    expect(keyedPence('149')).toBe(149)
    expect(keyedPence('')).toBeNull()
    expect(keyedPence('12345678')).toBeNull()
  })
  it('formats VAT rates', () => {
    expect(formatRate(0.2)).toBe('20%')
    expect(formatRate(0.05)).toBe('5%')
    expect(formatRate(0)).toBe('0%')
  })
})

describe('VAT inside a VAT-inclusive price', () => {
  it('20%: £1.20 holds 20p VAT', () => expect(vatInside(120, 0.2)).toBe(20))
  it('5%: £1.05 holds 5p VAT', () => expect(vatInside(105, 0.05)).toBe(5))
  it('0%: none', () => expect(vatInside(500, 0)).toBe(0))
  it('rounds to the nearest penny', () => expect(vatInside(149, 0.2)).toBe(25)) // 24.83
})

describe('basket', () => {
  it('adds a scanned product and totals it', () => {
    const { basket } = addProduct(emptyBasket, cola, 'l1')
    const t = totals(basket)
    expect(t.totalPence).toBe(149)
    expect(t.vatPence).toBe(25)
    expect(t.itemCount).toBe(1)
  })

  it('scanning the same item again raises the quantity on the same line', () => {
    let { basket } = addProduct(emptyBasket, cola, 'l1')
    const second = addProduct(basket, cola, 'l2')
    basket = second.basket
    expect(basket.lines).toHaveLength(1)
    expect(second.lineId).toBe('l1')
    expect(basket.lines[0].qty).toBe(2)
    expect(totals(basket).totalPence).toBe(298)
  })

  it('sells a product with no VAT code at 0% VAT', () => {
    const { basket } = addProduct(emptyBasket, mystery, 'l1')
    expect(basket.lines[0].vatRate).toBe(0)
    expect(totals(basket).vatPence).toBe(0)
  })

  it('refuses a product with no price unless one is typed', () => {
    expect(() => addProduct(emptyBasket, unpriced, 'l1')).toThrow()
    const { basket } = addProduct(emptyBasket, unpriced, 'l1', 250)
    expect(basket.lines[0].unitPence).toBe(250)
    expect(basket.lines[0].priceKeyed).toBe(true)
  })

  it('changes quantity within limits', () => {
    const { basket } = addProduct(emptyBasket, cola, 'l1')
    expect(totals(setQty(basket, 'l1', 6)).totalPence).toBe(894)
    expect(() => setQty(basket, 'l1', 0)).toThrow()
    expect(() => setQty(basket, 'l1', 1000)).toThrow()
    expect(() => setQty(basket, 'l1', 1.5)).toThrow()
  })

  it('a voided line stays in the basket but counts for nothing', () => {
    let basket = addProduct(emptyBasket, cola, 'l1').basket
    basket = addProduct(basket, bread, 'l2').basket
    basket = voidLine(basket, 'l1')
    expect(basket.lines).toHaveLength(2)
    const t = totals(basket)
    expect(t.totalPence).toBe(120)
    expect(t.itemCount).toBe(1)
    expect(t.vatPence).toBe(0)
  })

  it('scanning an item again after voiding it starts a fresh line', () => {
    let basket = addProduct(emptyBasket, cola, 'l1').basket
    basket = voidLine(basket, 'l1')
    basket = addProduct(basket, cola, 'l2').basket
    expect(basket.lines).toHaveLength(2)
    expect(totals(basket).totalPence).toBe(149)
  })

  it('breaks VAT down by rate, adding up line by line', () => {
    let basket = addProduct(emptyBasket, cola, 'l1').basket // 149 @20% -> 25
    basket = setQty(basket, 'l1', 3) // 447 @20% -> 74.5 -> 75 (one line, worked out on the line total)
    basket = addProduct(basket, bread, 'l2').basket // 120 @0%
    basket = addProduct(basket, { ...cola, id: 'p9', name: 'Heater', pricePence: 2100, vatRate: 0.05 }, 'l3').basket
    basket = addMiscItem(basket, 50, 'l4') // 0%
    const t = totals(basket)
    expect(t.totalPence).toBe(447 + 120 + 2100 + 50)
    expect(t.byRate.map((r) => r.rate)).toEqual([0.2, 0.05, 0])
    expect(t.byRate[0]).toEqual({ rate: 0.2, grossPence: 447, vatPence: 75, netPence: 372 })
    expect(t.byRate[1]).toEqual({ rate: 0.05, grossPence: 2100, vatPence: 100, netPence: 2000 })
    expect(t.byRate[2]).toEqual({ rate: 0, grossPence: 170, vatPence: 0, netPence: 170 })
    expect(t.vatPence).toBe(175)
    expect(t.itemCount).toBe(6)
  })

  it('a misc item needs a price', () => {
    expect(() => addMiscItem(emptyBasket, 0, 'l1')).toThrow()
  })
})

describe('products', () => {
  it('reads a database row, preferring the till name', () => {
    const p = toProduct({ id: 'x', name: 'Coca-Cola Original Taste 500ml', till_name: 'COKE 500', barcode: ' 5449000000996 ', retail_price: '1.85', vat_rate: '0.2000' })
    expect(p).toEqual({ id: 'x', name: 'COKE 500', barcode: '5449000000996', pricePence: 185, vatRate: 0.2 })
  })
  it('treats a missing or zero price as "no price"', () => {
    expect(toProduct({ id: 'x', name: 'A', till_name: null, barcode: null, retail_price: 0, vat_rate: null }).pricePence).toBeNull()
    expect(toProduct({ id: 'x', name: 'A', till_name: '  ', barcode: '', retail_price: null, vat_rate: null })).toEqual({ id: 'x', name: 'A', barcode: null, pricePence: null, vatRate: null })
  })
  it('finds a barcode whether or not the scanner sends the zero in front', () => {
    const index = buildIndex([cola, bread, mystery])
    expect(findByBarcode(index, '5000112637922')?.id).toBe('p1')
    expect(findByBarcode(index, '12345678905')?.id).toBe('p2')
    expect(findByBarcode(index, '0012345678905')?.id).toBe('p2')
    expect(findByBarcode(index, '00012345678905')?.id).toBe('p2')
    expect(findByBarcode(index, '999')).toBeNull()
    expect(findByBarcode(index, '  ')).toBeNull()
  })
  it('searches by every word typed, names starting with the first word first', () => {
    const index = buildIndex([bread, { ...bread, id: 'p5', name: 'Bread Rolls White 6pk', barcode: null }, cola])
    expect(searchProducts(index, 'white bread').map((p) => p.id)).toEqual(['p2', 'p5'])
    expect(searchProducts(index, 'bread').map((p) => p.id)).toEqual(['p5', 'p2'])
    expect(searchProducts(index, '500011').map((p) => p.id)).toEqual(['p1'])
    expect(searchProducts(index, '   ')).toEqual([])
  })
})
