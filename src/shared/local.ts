// The shapes passed between the screen and the till PC's own storage.
import type { Product } from './products'
import type { SaleDraft, SaleRecord } from './sale'
import type { RefundDraft, RefundRecord, Refunded } from './refund'
import type { AuditRow } from './audit'
import type { Staff } from './staff'

// Which shop and which till this PC is. Saved on the PC so the till opens with no internet.
export type Binding = {
  orgId: string
  orgName: string
  userId: string
  email: string
  tillId: string
  tillName: string
  receiptPrefix: string
}

export type LocalState = {
  binding: Binding | null
  productCount: number
  productsSyncedAt: string | null
  waiting: number // sales saved here, not yet sent to the database
  refused: number // of those, how many the database turned down on the last try
  lastRefusal: string | null
}

export type PendingSale = { id: string; record: SaleRecord }

// Refunds and audit entries waiting to be sent, in the order they happened.
export type PendingOther =
  | { id: string; kind: 'refund'; record: RefundRecord }
  | { id: string; kind: 'audit'; record: AuditRow }

export type LocalApi = {
  getState(): Promise<LocalState>
  bind(binding: Binding): Promise<void>
  unbind(): Promise<void>
  getProducts(): Promise<Product[]>
  replaceProducts(products: Product[]): Promise<void>
  saveSale(draft: SaleDraft): Promise<{ receiptNo: string; saleId: string }>
  pendingSales(limit: number): Promise<PendingSale[]>
  markSynced(id: string): Promise<void>
  markRefused(id: string, reason: string): Promise<void>
  // staff, refunds and the audit trail
  getStaff(): Promise<Staff[]>
  setStaff(staff: Staff[]): Promise<void>
  logAudit(row: AuditRow): Promise<void>
  saveRefund(draft: RefundDraft): Promise<{ receiptNo: string; refundId: string }>
  findSale(receiptNo: string): Promise<SaleRecord | null>
  recentSales(limit: number): Promise<SaleRecord[]>
  refundedHere(saleId: string, onlyUnsent: boolean): Promise<Refunded>
  pendingOther(limit: number): Promise<PendingOther[]>
  markOtherSynced(id: string): Promise<void>
  markOtherRefused(id: string, reason: string): Promise<void>
}
