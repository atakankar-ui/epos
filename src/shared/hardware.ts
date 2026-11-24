// The receipt printer and cash drawer settings for one till PC.
import type { ShopDetails } from './receipt'

export type PrinterChoice =
  | { kind: 'none' }
  | { kind: 'system'; name: string } // a printer installed in Windows (USB printers appear here)
  | { kind: 'network'; host: string; port: number } // a printer on the shop's network (usually port 9100)

export type HardwareConfig = {
  printer: PrinterChoice
  columns: 32 | 42 | 48 // characters per line: 48 or 42 for 80mm paper, 32 for 58mm
  autoPrint: boolean // print a receipt for every sale
  drawer: boolean // a cash drawer is plugged into the printer
}

export const defaultHardware: HardwareConfig = { printer: { kind: 'none' }, columns: 48, autoPrint: true, drawer: true }

export type PrintResult = { ok: true; printed: boolean; drawer: boolean } | { ok: false; message: string }

export type HardwareApi = {
  getConfig(): Promise<HardwareConfig>
  setConfig(config: HardwareConfig): Promise<void>
  listPrinters(): Promise<string[]>
  // Right after a sale is saved: open the drawer for cash, print if receipts are automatic.
  afterSale(saleId: string): Promise<PrintResult>
  printReceipt(saleId: string, copy: boolean): Promise<PrintResult>
  receiptText(saleId: string): Promise<string> // what the receipt says, for showing on screen
  testPrint(): Promise<PrintResult>
  testDrawer(): Promise<PrintResult>
  setShopDetails(details: ShopDetails): Promise<void>
  getShopDetails(): Promise<ShopDetails>
}

export function validHardware(value: unknown): HardwareConfig {
  const v = value as Partial<HardwareConfig> | null
  const p = v?.printer as PrinterChoice | undefined
  let printer: PrinterChoice = { kind: 'none' }
  if (p?.kind === 'system' && typeof p.name === 'string' && p.name.trim() && p.name.length <= 200) {
    printer = { kind: 'system', name: p.name }
  } else if (p?.kind === 'network' && typeof p.host === 'string' && /^[A-Za-z0-9.-]{1,253}$/.test(p.host)) {
    const port = Number(p.port)
    printer = { kind: 'network', host: p.host, port: Number.isInteger(port) && port > 0 && port < 65536 ? port : 9100 }
  }
  return {
    printer,
    columns: v?.columns === 32 || v?.columns === 42 ? v.columns : 48,
    autoPrint: v?.autoPrint !== false,
    drawer: v?.drawer !== false,
  }
}
