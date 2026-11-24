// The till PC's own storage: a small SQLite database file in the app's data folder.
// It holds the shop this till belongs to, a copy of the products, and every sale made
// here. A sale is written to this file BEFORE anything else happens, so a power cut or
// lost connection cannot lose it.
import { DatabaseSync } from 'node:sqlite'
import type { Product } from '../shared/products'
import type { Binding, LocalState, PendingSale } from '../shared/local'
import { withReceipt, type SaleDraft, type SaleRecord } from '../shared/sale'

export class LocalDb {
  private db: DatabaseSync

  constructor(file: string) {
    this.db = new DatabaseSync(file)
    // WAL + FULL: once a save returns, it is on the disk.
    this.db.exec(`
      pragma journal_mode = wal;
      pragma synchronous = full;
      create table if not exists meta (key text primary key, value text not null);
      create table if not exists products (
        id text primary key, name text not null, barcode text, price_pence integer, vat_rate real
      );
      create table if not exists sales (
        id text primary key,
        receipt_seq integer not null,
        payload text not null,
        created_at text not null,
        synced_at text,
        attempts integer not null default 0,
        last_error text
      );
      create index if not exists sales_waiting on sales (receipt_seq) where synced_at is null;
    `)
  }

  private getMeta(key: string): string | null {
    const row = this.db.prepare('select value from meta where key = ?').get(key) as { value: string } | undefined
    return row?.value ?? null
  }

  private setMeta(key: string, value: string): void {
    this.db.prepare('insert into meta (key, value) values (?, ?) on conflict (key) do update set value = excluded.value').run(key, value)
  }

  private transaction<T>(work: () => T): T {
    this.db.exec('begin immediate')
    try {
      const result = work()
      this.db.exec('commit')
      return result
    } catch (err) {
      this.db.exec('rollback')
      throw err
    }
  }

  binding(): Binding | null {
    const raw = this.getMeta('binding')
    return raw ? (JSON.parse(raw) as Binding) : null
  }

  getState(): LocalState {
    const products = this.db.prepare('select count(*) as n from products').get() as { n: number }
    const waiting = this.db.prepare(
      'select count(*) as n, sum(last_error is not null) as refused from sales where synced_at is null',
    ).get() as { n: number; refused: number | null }
    const last = this.db.prepare(
      'select last_error from sales where synced_at is null and last_error is not null order by receipt_seq limit 1',
    ).get() as { last_error: string } | undefined
    return {
      binding: this.binding(),
      productCount: products.n,
      productsSyncedAt: this.getMeta('products_synced_at'),
      waiting: waiting.n,
      refused: waiting.refused ?? 0,
      lastRefusal: last?.last_error ?? null,
    }
  }

  bind(binding: Binding): void {
    this.transaction(() => {
      this.setMeta('binding', JSON.stringify(binding))
      if (this.getMeta(`next_seq:${binding.tillId}`) === null) this.setMeta(`next_seq:${binding.tillId}`, '1')
    })
  }

  // Disconnect this PC from its shop. Refused while any sale is still waiting to be sent.
  unbind(): void {
    this.transaction(() => {
      const waiting = this.db.prepare('select count(*) as n from sales where synced_at is null').get() as { n: number }
      if (waiting.n > 0) throw new Error(`${waiting.n} sales are still waiting to be sent. Connect to the internet and send them first.`)
      this.db.exec("delete from meta where key in ('binding', 'products_synced_at'); delete from products;")
    })
  }

  getProducts(): Product[] {
    const rows = this.db.prepare('select id, name, barcode, price_pence, vat_rate from products').all() as Array<{
      id: string; name: string; barcode: string | null; price_pence: number | null; vat_rate: number | null
    }>
    return rows.map((r) => ({ id: r.id, name: r.name, barcode: r.barcode, pricePence: r.price_pence, vatRate: r.vat_rate }))
  }

  // Swap the whole product copy in one go: the till never sees a half-updated list.
  replaceProducts(products: Product[]): void {
    this.transaction(() => {
      this.db.exec('delete from products')
      const insert = this.db.prepare('insert into products (id, name, barcode, price_pence, vat_rate) values (?, ?, ?, ?, ?)')
      for (const p of products) insert.run(p.id, p.name, p.barcode, p.pricePence, p.vatRate)
      this.setMeta('products_synced_at', new Date().toISOString())
    })
  }

  // Give the sale the next receipt number and store it, as one step.
  saveSale(draft: SaleDraft): SaleRecord {
    return this.transaction(() => {
      const binding = this.binding()
      if (!binding) throw new Error('This till is not connected to a shop.')
      if (draft.sale.till_id !== binding.tillId || draft.sale.org_id !== binding.orgId) {
        throw new Error('This sale belongs to a different till.')
      }
      const key = `next_seq:${binding.tillId}`
      const seq = Number(this.getMeta(key) ?? '1')
      const record = withReceipt(draft, binding.receiptPrefix, seq)
      this.db.prepare('insert into sales (id, receipt_seq, payload, created_at) values (?, ?, ?, ?)')
        .run(record.sale.id, seq, JSON.stringify(record), new Date().toISOString())
      this.setMeta(key, String(seq + 1))
      return record
    })
  }

  pendingSales(limit: number): PendingSale[] {
    const rows = this.db.prepare(
      'select id, payload from sales where synced_at is null order by receipt_seq limit ?',
    ).all(Math.max(1, Math.min(200, Math.floor(limit)))) as Array<{ id: string; payload: string }>
    return rows.map((r) => ({ id: r.id, record: JSON.parse(r.payload) as SaleRecord }))
  }

  markSynced(id: string): void {
    this.db.prepare('update sales set synced_at = ?, last_error = null where id = ?').run(new Date().toISOString(), id)
  }

  // The database said no. The sale stays here and is tried again; it is never dropped.
  markRefused(id: string, reason: string): void {
    this.db.prepare('update sales set attempts = attempts + 1, last_error = ? where id = ? and synced_at is null')
      .run(String(reason).slice(0, 500), id)
  }

  close(): void {
    this.db.close()
  }
}
