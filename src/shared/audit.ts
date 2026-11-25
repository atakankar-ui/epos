// The audit trail: every void, refund, price override and drawer opening, with who, when and why.
// Rows are only ever added. Nothing on the till or in the database can change or remove one.
export type AuditAction = 'void_line' | 'void_sale' | 'price_override' | 'refund' | 'no_sale' | 'x_report' | 'z_report' | 'discount'

export type AuditRow = {
  id: string
  org_id: string
  till_id: string
  staff_id: string | null // who did it
  approved_by: string | null // the manager who allowed it, when one was needed
  action: AuditAction
  reason: string | null
  sale_id: string | null
  refund_id: string | null
  amount: number | null // pounds
  details: Record<string, unknown> | null
  occurred_at: string
}

export function auditRow(input: {
  id: string; orgId: string; tillId: string; at: Date
  staffId: string | null; approvedBy?: string | null
  action: AuditAction; reason: string | null
  saleId?: string | null; refundId?: string | null; amountPence?: number | null; details?: Record<string, unknown>
}): AuditRow {
  return {
    id: input.id, org_id: input.orgId, till_id: input.tillId,
    staff_id: input.staffId, approved_by: input.approvedBy ?? null,
    action: input.action, reason: input.reason?.trim() || null,
    sale_id: input.saleId ?? null, refund_id: input.refundId ?? null,
    amount: input.amountPence === null || input.amountPence === undefined ? null : input.amountPence / 100,
    details: input.details ?? null,
    occurred_at: input.at.toISOString(),
  }
}

export const VOID_REASONS = ['Scanned by mistake', 'Customer changed their mind', 'Wrong item or price']
export const REFUND_REASONS = ['Faulty or damaged', 'Out of date', 'Customer changed their mind', 'Charged the wrong price']
export const OVERRIDE_REASONS = ['Reduced to clear', 'Shelf price was different', 'Damaged packaging']
export const DISCOUNT_REASONS = ['Reduced to clear', 'Damaged packaging', 'Regular customer', 'Staff discount']
export const NO_SALE_REASONS = ['Giving change', 'Checking the float', 'Putting money in or taking it out']
