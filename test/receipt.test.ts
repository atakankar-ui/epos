import { describe, expect, it } from 'vitest'
import { createServer } from 'node:net'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { addMiscItem, addProduct, emptyBasket, setQty, voidLine } from '../src/shared/basket'
import { buildSale, withReceipt } from '../src/shared/sale'
import { buildReceipt } from '../src/shared/receipt'
import { drawerOnly, pairLine, toEscPos, toText } from '../src/shared/escpos'
import { validHardware } from '../src/shared/hardware'
import { sendToPrinter } from '../src/main/printer'
import type { Product } from '../src/shared/products'

const cola: Product = { id: 'p1', name: 'Cola 500ml', barcode: '111', pricePence: 149, vatRate: 0.2 }
const bread: Product = { id: 'p2', name: 'White Bread 800g', barcode: '222', pricePence: 120, vatRate: 0 }
const heater: Product = { id: 'p3', name: 'Fan Heater 2kW With A Very Long Name Indeed', barcode: '333', pricePence: 2100, vatRate: 0.05 }
const shop = { name: 'Corner Shop', address: '1 High Street\nLeeds LS1 1AA', vatNumber: 'GB123456789', footer: 'Thank you!' }

function record(tender: Parameters<typeof buildSale>[0]['tender']) {
  let n = 0
  let b = addProduct(emptyBasket, cola, 'l1').basket
  b = setQty(b, 'l1', 3)
  b = addProduct(b, bread, 'l2').basket
  b = addProduct(b, heater, 'l3').basket
  b = addMiscItem(b, 50, 'l4')
  b = voidLine(b, 'l2')
  return withReceipt(buildSale({ basket: b, orgId: 'o', tillId: 't', soldAt: new Date('2026-11-24T19:30:00Z'), tender, newId: () => `id-${++n}` }), 'T1', 42)
}

describe('receipt wording', () => {
  const text = toText(buildReceipt({ record: record({ method: 'cash', tenderedPence: 3000 }), shop, tillName: 'Till 1', timeZone: 'UTC' }), 32)

  it('has everything a UK VAT receipt needs', () => {
    expect(text).toBe([
      '  Corner Shop',
      '         1 High Street',
      '         Leeds LS1 1AA',
      '      VAT No. GB123456789',
      '',
      '24/11/2026 19:30          Till 1',
      'Receipt T1-000042',
      '--------------------------------',
      'Cola 500ml                 £4.47',
      '  3 x £1.49',
      'Fan Heater 2kW With A Ve. £21.00',
      'Misc item                  £0.50',
      '--------------------------------',
      'TOTAL     £25.97',
      '5 items',
      '',
      'Cash                      £30.00',
      'Change                     £4.03',
      '',
      'VAT included in the total:',
      '20% on £3.72 net           £0.75',
      '5% on £20.00 net           £1.00',
      '0% on £0.50 net            £0.00',
      'Total VAT                  £1.75',
      '',
      '           Thank you!',
    ].join('\n'))
  })

  it('leaves voided lines off', () => expect(text).not.toContain('Bread'))

  it('card receipts show the card, not change', () => {
    const card = toText(buildReceipt({ record: record({ method: 'card', paymentIntentId: 'pi', brand: 'visa', last4: '4242' }), shop, tillName: 'Till 1', timeZone: 'UTC', copy: true }), 48)
    expect(card).toContain(pairLine('Card visa ****4242', '£25.97', 48))
    expect(card).not.toContain('Change')
    expect(card).toContain('** COPY **')
  })

  it('works with no address, VAT number or footer', () => {
    const bare = toText(buildReceipt({ record: record({ method: 'cash', tenderedPence: 2597 }), shop: { name: 'Shop', address: null, vatNumber: null, footer: null }, tillName: 'Till 1', timeZone: 'UTC' }), 48)
    expect(bare).not.toContain('VAT No.')
    expect(bare.split('\n')[1]).toBe('')
  })
})

describe('printer bytes (ESC/POS)', () => {
  const lines = buildReceipt({ record: record({ method: 'cash', tenderedPence: 3000 }), shop, tillName: 'Till 1', timeZone: 'UTC' })
  const has = (bytes: Uint8Array, seq: number[]) => Buffer.from(bytes).includes(Buffer.from(seq))

  it('starts with a reset, ends with a cut, and prints £ as the printer\'s own pound sign', () => {
    const bytes = toEscPos(lines, 48)
    expect([...bytes.slice(0, 2)]).toEqual([0x1b, 0x40])
    expect([...bytes.slice(-4)]).toEqual([0x1d, 0x56, 0x42, 0x00])
    expect(has(bytes, [0x9c, 0x34, 0x2e, 0x34, 0x37])).toBe(true) // £4.47
    expect(has(bytes, [...Buffer.from('Cola 500ml')])).toBe(true)
    expect([...bytes].every((b) => b <= 0x7e || b === 0x9c || b === 0xfa)).toBe(true) // nothing the printer would garble
  })

  it('opens the drawer only when asked, and before any paper moves', () => {
    const kick = [0x1b, 0x70, 0x00, 0x19, 0xfa]
    expect(has(toEscPos(lines, 48), kick)).toBe(false)
    expect([...toEscPos(lines, 48, { kickDrawer: true }).slice(2, 7)]).toEqual(kick)
    expect([...drawerOnly()]).toEqual([0x1b, 0x40, ...kick])
  })

  it('accented or unusual letters never break the printer', () => {
    const bytes = toEscPos([{ kind: 'text', text: 'Café Żywiec 🍺 – 50p' }], 48)
    expect(Buffer.from(bytes).toString('latin1')).toContain('Cafe Zywiec ? ? 50p')
  })
})

describe('hardware settings', () => {
  it('falls back to safe values for anything odd', () => {
    expect(validHardware(null)).toEqual({ printer: { kind: 'none' }, columns: 48, autoPrint: true, drawer: true })
    expect(validHardware({ printer: { kind: 'network', host: '192.168.1.50', port: 'x' }, columns: 32, autoPrint: false, drawer: false }))
      .toEqual({ printer: { kind: 'network', host: '192.168.1.50', port: 9100 }, columns: 32, autoPrint: false, drawer: false })
    expect(validHardware({ printer: { kind: 'network', host: 'bad host; rm -rf' } }).printer).toEqual({ kind: 'none' })
    expect(validHardware({ printer: { kind: 'system', name: 'EPSON TM-T20III Receipt' } }).printer).toEqual({ kind: 'system', name: 'EPSON TM-T20III Receipt' })
  })
})

describe('sending to a printer', () => {
  it('network: the printer receives exactly the bytes sent', async () => {
    const got: Buffer[] = []
    const server = createServer((socket) => socket.on('data', (d: Buffer) => got.push(d)))
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as { port: number }).port
    const bytes = toEscPos([{ kind: 'text', text: 'Hello £1' }], 48, { kickDrawer: true })
    await sendToPrinter({ kind: 'network', host: '127.0.0.1', port }, bytes)
    await new Promise((r) => setTimeout(r, 50))
    await new Promise((r) => server.close(r))
    expect(Buffer.concat(got).equals(Buffer.from(bytes))).toBe(true)
  })

  it('network: a printer that is not there gives a plain reason, quickly', async () => {
    const server = createServer()
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const port = (server.address() as { port: number }).port
    await new Promise((r) => server.close(r))
    await expect(sendToPrinter({ kind: 'network', host: '127.0.0.1', port }, drawerOnly())).rejects.toThrow(/refused the print job/)
  })

  it('no printer chosen: says so', async () => {
    await expect(sendToPrinter({ kind: 'none' }, drawerOnly())).rejects.toThrow(/No printer has been chosen/)
  })

  it('test mode writes jobs to files instead of printing', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'till-jobs-'))
    process.env.TILL_PRINT_TO_FILE = dir
    try {
      await sendToPrinter({ kind: 'system', name: 'Any' }, drawerOnly())
      expect([...readFileSync(join(dir, readdirSync(dir)[0]))]).toEqual([...drawerOnly()])
    } finally {
      delete process.env.TILL_PRINT_TO_FILE
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
