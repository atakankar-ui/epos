// The shapes passed between the screen and the till PC's own storage.
import type { Product } from './products'
import type { SaleDraft, SaleRecord } from './sale'
import type { RefundDraft, RefundRecord, Refunded } from './refund'
import type { AuditRow } from './audit'
import type { Staff } from './staff'
import type { DayInfo, Report } from './report'

// Everything that happened in one trading day on this till.
export type DayData = { day: DayInfo; sales: SaleRecord[]; refunds: RefundRecord[]; audits: AuditRow[] }

// What is sent to the database for a trading day.
export type DayOpenRow = { id: string; org_id: string; till_id: string; z_number: number; opened_at: string; opened_by: string | null; opening_float: number }
export type DayCloseRow = { id: string; closed_at: string; closed_by: string | null; counted_cash: number | null; report: Report }

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
  | { id: string; kind: 'day_open'; record: DayOpenRow }
  | { id: string; kind: 'day_close'; record: DayCloseRow }

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
  pendingOther(limit: number, onlyDayOpens?: boolean): Promise<PendingOther[]>
  markOtherSynced(id: string): Promise<void>
  markOtherRefused(id: string, reason: string): Promise<void>
  // trading days and reports
  currentDay(): Promise<DayInfo | null>
  openDay(input: { id: string; openedBy: string | null; floatPence: number; at: string }): Promise<DayInfo>
  closeDay(input: { id: string; closedBy: string | null; countedPence: number | null; at: string; report: Report }): Promise<DayInfo>
  dayData(dayId: string): Promise<DayData>
  listDays(limit: number): Promise<DayInfo[]>
  topProductIds(limit: number): Promise<string[]> // most sold on this till, best first
}
