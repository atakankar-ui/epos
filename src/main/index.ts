// The Windows program. It opens one window and shows the till screen in it.
// Later phases add the local database, the receipt printer and the cash drawer here.
import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { LocalDb } from './db'
import { registerHardware } from './hardware'
import type { Binding } from '../shared/local'
import type { Product } from '../shared/products'
import type { SaleDraft } from '../shared/sale'
import type { RefundDraft } from '../shared/refund'
import type { AuditRow } from '../shared/audit'
import type { Staff } from '../shared/staff'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 700,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#0f172a',
    title: 'Till',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // The screen cannot touch the PC directly; it must ask through the preload bridge.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.once('ready-to-show', () => win.show())

  // Links never open inside the till window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event) => event.preventDefault())

  if (process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

ipcMain.handle('app:info', () => ({
  version: app.getVersion(),
  platform: process.platform,
}))

// Only one copy of the till may run on a PC: two would fight over the same sales file.
if (!app.requestSingleInstanceLock()) app.quit()

let db: LocalDb

function registerLocalStorage(): void {
  db = new LocalDb(join(app.getPath('userData'), 'till.sqlite'))
  ipcMain.handle('local:getState', () => db.getState())
  ipcMain.handle('local:bind', (_e, binding: Binding) => db.bind(binding))
  ipcMain.handle('local:unbind', () => db.unbind())
  ipcMain.handle('local:getProducts', () => db.getProducts())
  ipcMain.handle('local:replaceProducts', (_e, products: Product[]) => db.replaceProducts(products))
  ipcMain.handle('local:saveSale', (_e, draft: SaleDraft) => {
    const record = db.saveSale(draft)
    return { receiptNo: record.sale.receipt_no, saleId: record.sale.id }
  })
  ipcMain.handle('local:pendingSales', (_e, limit: number) => db.pendingSales(limit))
  ipcMain.handle('local:markSynced', (_e, id: string) => db.markSynced(id))
  ipcMain.handle('local:markRefused', (_e, id: string, reason: string) => db.markRefused(id, reason))
  ipcMain.handle('local:getStaff', () => db.getStaff())
  ipcMain.handle('local:setStaff', (_e, staff: Staff[]) => db.setStaff(staff))
  ipcMain.handle('local:logAudit', (_e, row: AuditRow) => db.logAudit(row))
  ipcMain.handle('local:saveRefund', (_e, draft: RefundDraft) => {
    const record = db.saveRefund(draft)
    return { receiptNo: record.refund.receipt_no, refundId: record.refund.id }
  })
  ipcMain.handle('local:findSale', (_e, receiptNo: string) => db.findSale(receiptNo))
  ipcMain.handle('local:recentSales', (_e, limit: number) => db.recentSales(limit))
  ipcMain.handle('local:refundedHere', (_e, saleId: string, onlyUnsent: boolean) => db.refundedHere(saleId, !!onlyUnsent))
  ipcMain.handle('local:pendingOther', (_e, limit: number) => db.pendingOther(limit))
  ipcMain.handle('local:markOtherSynced', (_e, id: string) => db.markOtherSynced(id))
  ipcMain.handle('local:markOtherRefused', (_e, id: string, reason: string) => db.markOtherRefused(id, reason))
  registerHardware(db, () => BrowserWindow.getAllWindows()[0])
}

void app.whenReady().then(() => {
  registerLocalStorage()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('second-instance', () => BrowserWindow.getAllWindows()[0]?.focus())
app.on('will-quit', () => db?.close())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
