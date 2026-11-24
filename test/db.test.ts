// The till PC's own storage, tested against a real database file.
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalDb } from '../src/main/db'
import { addProduct, emptyBasket } from '../src/shared/basket'
import { buildSale } from '../src/shared/sale'
import type { Binding } from '../src/shared/local'
import type { Product } from '../src/shared/products'

const cola: Product = { id: 'p1', name: 'Cola', barcode: '111', pricePence: 149, vatRate: 0.2 }
const tin: Product = { id: 'p2', name: 'Tin', barcode: null, pricePence: null, vatRate: null }
const binding: Binding = { orgId: 'org', orgName: 'Test Shop', userId: 'u', email: 'e', tillId: 'till', tillName: 'Till 1', receiptPrefix: 'T1' }

let dir: string
let file: string
let db: LocalDb
let n = 0
const draft = (tillId = 'till') => buildSale({
  basket: addProduct(emptyBasket, cola, 'l').basket, orgId: 'org', tillId, soldAt: new Date(),
  tender: { method: 'cash', tenderedPence: 149 }, newId: () => `id-${++n}`,
})

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'till-db-'))
  file = join(dir, 'till.sqlite')
  db = new LocalDb(file)
})
afterEach(() => {
  db.close()
  rmSync(dir, { recursive: true, force: true })
})

describe('local storage', () => {
  it('starts empty and unconnected', () => {
    expect(db.getState()).toEqual({ binding: null, productCount: 0, productsSyncedAt: null, waiting: 0, refused: 0, lastRefusal: null })
    expect(() => db.saveSale(draft())).toThrow(/not connected/)
  })

  it('keeps the products exactly, including missing prices and VAT', () => {
    db.replaceProducts([cola, tin])
    expect(db.getProducts()).toEqual([cola, tin])
    db.replaceProducts([tin])
    expect(db.getProducts()).toEqual([tin])
    expect(db.getState().productsSyncedAt).not.toBeNull()
  })

  it('gives each sale the next receipt number', () => {
    db.bind(binding)
    expect(db.saveSale(draft()).sale.receipt_no).toBe('T1-000001')
    expect(db.saveSale(draft()).sale.receipt_no).toBe('T1-000002')
    expect(db.getState().waiting).toBe(2)
  })

  it('survives the app closing: sales and numbering are still there', () => {
    db.bind(binding)
    const first = db.saveSale(draft())
    db.close()
    db = new LocalDb(file)
    expect(db.getState().binding).toEqual(binding)
    const waiting = db.pendingSales(10)
    expect(waiting).toHaveLength(1)
    expect(waiting[0].record).toEqual(first)
    expect(db.saveSale(draft()).sale.receipt_no).toBe('T1-000002')
  })

  it('hands back waiting sales oldest first and forgets them once sent', () => {
    db.bind(binding)
    const a = db.saveSale(draft()), b = db.saveSale(draft()), c = db.saveSale(draft())
    expect(db.pendingSales(2).map((s) => s.id)).toEqual([a.sale.id, b.sale.id])
    db.markSynced(a.sale.id)
    expect(db.pendingSales(10).map((s) => s.id)).toEqual([b.sale.id, c.sale.id])
    expect(db.getState().waiting).toBe(2)
  })

  it('a refused sale is kept, counted and tried again; sending it later clears the refusal', () => {
    db.bind(binding)
    const a = db.saveSale(draft())
    db.markRefused(a.sale.id, 'new row violates row-level security policy')
    expect(db.getState()).toMatchObject({ waiting: 1, refused: 1, lastRefusal: 'new row violates row-level security policy' })
    expect(db.pendingSales(10)).toHaveLength(1)
    db.markSynced(a.sale.id)
    expect(db.getState()).toMatchObject({ waiting: 0, refused: 0, lastRefusal: null })
  })

  it('refuses a sale made for a different till', () => {
    db.bind(binding)
    expect(() => db.saveSale(draft('other-till'))).toThrow(/different till/)
    expect(db.getState().waiting).toBe(0)
  })

  it('will not disconnect while sales are waiting, and never reuses a receipt number after reconnecting', () => {
    db.bind(binding)
    db.replaceProducts([cola])
    const a = db.saveSale(draft())
    expect(() => db.unbind()).toThrow(/still waiting/)
    expect(db.getState().binding).not.toBeNull()
    db.markSynced(a.sale.id)
    db.unbind()
    expect(db.getState()).toMatchObject({ binding: null, productCount: 0 })
    db.bind(binding)
    expect(db.saveSale(draft()).sale.receipt_no).toBe('T1-000002')
  })
})
