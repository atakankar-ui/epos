// The receipt printer and cash drawer, as the screen is allowed to use them.
import { ipcMain, type BrowserWindow } from 'electron'
import type { LocalDb } from './db'
import { sendToPrinter } from './printer'
import { drawerOnly, toEscPos, toText, type ReceiptLine } from '../shared/escpos'
import { buildReceipt, buildRefundReceipt, testReceipt, type ShopDetails } from '../shared/receipt'
import { defaultHardware, validHardware, type HardwareConfig, type PrintResult } from '../shared/hardware'

export function registerHardware(db: LocalDb, getWindow: () => BrowserWindow | undefined): void {
  const config = (): HardwareConfig => {
    const raw = db.getMeta('hardware')
    return raw ? validHardware(JSON.parse(raw)) : defaultHardware
  }

  const shop = (): ShopDetails => {
    const raw = db.getMeta('shop_details')
    const saved = raw ? (JSON.parse(raw) as Partial<ShopDetails>) : {}
    return {
      name: saved.name?.trim() || db.binding()?.orgName || 'Shop',
      address: saved.address ?? null,
      vatNumber: saved.vatNumber ?? null,
      footer: saved.footer ?? null,
    }
  }

  const receiptLines = (saleId: string, copy: boolean): ReceiptLine[] => {
    const record = db.getSale(String(saleId))
    if (!record) throw new Error('That sale is not on this till.')
    return buildReceipt({ record, shop: shop(), tillName: db.binding()?.tillName ?? 'Till', copy })
  }

  // A printing problem is reported, never thrown: it must not get in the way of a sale.
  const attempt = async (work: () => Promise<{ printed: boolean; drawer: boolean }>): Promise<PrintResult> => {
    try {
      return { ok: true, ...(await work()) }
    } catch (err) {
      return { ok: false, message: (err as Error).message }
    }
  }

  ipcMain.handle('hardware:getConfig', () => config())
  ipcMain.handle('hardware:setConfig', (_e, value: unknown) => db.setMeta('hardware', JSON.stringify(validHardware(value))))
  ipcMain.handle('hardware:listPrinters', async () => {
    const printers = (await getWindow()?.webContents.getPrintersAsync()) ?? []
    return printers.map((p) => p.name)
  })
  ipcMain.handle('hardware:getShopDetails', () => shop())
  ipcMain.handle('hardware:setShopDetails', (_e, d: ShopDetails) => db.setMeta('shop_details', JSON.stringify({
    name: String(d?.name ?? '').slice(0, 80),
    address: d?.address ? String(d.address).slice(0, 300) : null,
    vatNumber: d?.vatNumber ? String(d.vatNumber).slice(0, 30) : null,
    footer: d?.footer ? String(d.footer).slice(0, 300) : null,
  })))
  ipcMain.handle('hardware:receiptText', (_e, saleId: string) => toText(receiptLines(saleId, false), config().columns))

  ipcMain.handle('hardware:afterSale', (_e, saleId: string) => attempt(async () => {
    const c = config()
    if (c.printer.kind === 'none') return { printed: false, drawer: false }
    const record = db.getSale(String(saleId))
    if (!record) throw new Error('That sale is not on this till.')
    const kickDrawer = c.drawer && record.payments.some((p) => p.method === 'cash')
    if (c.autoPrint) {
      await sendToPrinter(c.printer, toEscPos(receiptLines(saleId, false), c.columns, { kickDrawer }))
    } else if (kickDrawer) {
      await sendToPrinter(c.printer, drawerOnly())
    }
    return { printed: c.autoPrint, drawer: kickDrawer }
  }))

  ipcMain.handle('hardware:printReceipt', (_e, saleId: string, copy: boolean) => attempt(async () => {
    const c = config()
    await sendToPrinter(c.printer, toEscPos(receiptLines(saleId, !!copy), c.columns))
    return { printed: true, drawer: false }
  }))

  const refundLines = (refundId: string): ReceiptLine[] => {
    const record = db.getRefund(String(refundId))
    if (!record) throw new Error('That refund is not on this till.')
    return buildRefundReceipt({ record, shop: shop(), tillName: db.binding()?.tillName ?? 'Till' })
  }

  ipcMain.handle('hardware:afterRefund', (_e, refundId: string) => attempt(async () => {
    const c = config()
    if (c.printer.kind === 'none') return { printed: false, drawer: false }
    if (c.autoPrint) await sendToPrinter(c.printer, toEscPos(refundLines(refundId), c.columns, { kickDrawer: c.drawer }))
    else if (c.drawer) await sendToPrinter(c.printer, drawerOnly())
    return { printed: c.autoPrint, drawer: c.drawer }
  }))

  ipcMain.handle('hardware:printRefund', (_e, refundId: string) => attempt(async () => {
    const c = config()
    await sendToPrinter(c.printer, toEscPos(refundLines(refundId), c.columns))
    return { printed: true, drawer: false }
  }))

  ipcMain.handle('hardware:printLines', (_e, lines: ReceiptLine[]) => attempt(async () => {
    const c = config()
    if (!Array.isArray(lines) || lines.length > 400) throw new Error('That is not something the till can print.')
    const safe: ReceiptLine[] = lines.map((l) => (l?.kind === 'pair'
      ? { kind: 'pair', left: String(l.left).slice(0, 200), right: String(l.right).slice(0, 60), bold: !!l.bold, big: !!l.big }
      : l?.kind === 'text' ? { kind: 'text', text: String(l.text).slice(0, 200), align: l.align, bold: !!l.bold, big: !!l.big }
        : l?.kind === 'rule' ? { kind: 'rule' } : { kind: 'blank' }))
    await sendToPrinter(c.printer, toEscPos(safe, c.columns))
    return { printed: true, drawer: false }
  }))

  ipcMain.handle('hardware:testPrint', () => attempt(async () => {
    const c = config()
    await sendToPrinter(c.printer, toEscPos(testReceipt(shop(), db.binding()?.tillName ?? 'Till', c.columns), c.columns))
    return { printed: true, drawer: false }
  }))

  ipcMain.handle('hardware:testDrawer', () => attempt(async () => {
    await sendToPrinter(config().printer, drawerOnly())
    return { printed: false, drawer: true }
  }))
}
