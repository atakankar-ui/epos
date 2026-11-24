// Setup cards for the receipt printer, the cash drawer and what the receipt says.
import { useEffect, useState } from 'react'
import { saveShopDetails } from '../lib/shopDetails'
import { defaultHardware, type HardwareConfig, type PrintResult } from '../../../shared/hardware'
import type { Binding } from '../../../shared/local'
import type { ShopDetails } from '../../../shared/receipt'

type Note = { kind: 'ok' | 'bad'; text: string } | null

function describe(result: PrintResult, done: string): Note {
  return result.ok ? { kind: 'ok', text: done } : { kind: 'bad', text: result.message }
}

export function PrinterCard() {
  const [config, setConfig] = useState<HardwareConfig>(defaultHardware)
  const [printers, setPrinters] = useState<string[]>([])
  const [note, setNote] = useState<Note>(null)
  const [busy, setBusy] = useState(false)
  const hw = window.till.hardware

  useEffect(() => {
    void hw.getConfig().then(setConfig)
    void hw.listPrinters().then(setPrinters, () => setPrinters([]))
  }, [hw])

  // Every change is saved straight away, so "Print test" always tests what is on screen.
  function change(next: HardwareConfig) {
    setConfig(next)
    setNote(null)
    void hw.setConfig(next)
  }

  async function run(work: () => Promise<PrintResult>, done: string) {
    setBusy(true)
    setNote(null)
    setNote(describe(await work(), done))
    setBusy(false)
  }

  const kind = config.printer.kind
  const none = kind === 'none'

  return (
    <section className="card wide">
      <h2>Receipt printer and cash drawer</h2>
      <label>
        Printer
        <select
          data-testid="printer-kind" value={kind}
          onChange={(e) => {
            const k = e.target.value
            change({ ...config, printer: k === 'system' ? { kind: 'system', name: printers[0] ?? '' } : k === 'network' ? { kind: 'network', host: '', port: 9100 } : { kind: 'none' } })
          }}
        >
          <option value="none">No printer</option>
          <option value="system">A printer installed on this PC (USB)</option>
          <option value="network">A printer on the shop's network</option>
        </select>
      </label>

      {config.printer.kind === 'system' && (
        <label>
          Which one
          <span className="row">
            <select value={config.printer.name} onChange={(e) => change({ ...config, printer: { kind: 'system', name: e.target.value } })}>
              {printers.length === 0 && <option value="">No printers found on this PC</option>}
              {config.printer.name && !printers.includes(config.printer.name) && <option value={config.printer.name}>{config.printer.name} (not found)</option>}
              {printers.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
            <button type="button" onClick={() => void hw.listPrinters().then(setPrinters)}>Look again</button>
          </span>
          <small className="muted">The printer must first be added in Windows (Settings, Printers &amp; scanners).</small>
        </label>
      )}

      {config.printer.kind === 'network' && (
        <label>
          Printer's address on the network
          <input
            data-testid="printer-host" placeholder="for example 192.168.1.50" value={config.printer.host} inputMode="decimal"
            onChange={(e) => change({ ...config, printer: { kind: 'network', host: e.target.value.trim(), port: 9100 } })}
          />
          <small className="muted">Most receipt printers print this address on their self-test page.</small>
        </label>
      )}

      {!none && (
        <>
          <label>
            Paper width
            <select value={config.columns} onChange={(e) => change({ ...config, columns: Number(e.target.value) as HardwareConfig['columns'] })}>
              <option value={48}>80mm paper (48 characters a line, most printers)</option>
              <option value={42}>80mm paper (42 characters a line)</option>
              <option value={32}>58mm paper (32 characters a line)</option>
            </select>
          </label>
          <label className="tick">
            <input type="checkbox" checked={config.autoPrint} onChange={(e) => change({ ...config, autoPrint: e.target.checked })} />
            Print a receipt for every sale
          </label>
          <label className="tick">
            <input type="checkbox" checked={config.drawer} onChange={(e) => change({ ...config, drawer: e.target.checked })} />
            A cash drawer is plugged into the printer (opens on cash sales)
          </label>
          <div className="bar-buttons">
            <button onClick={() => void run(hw.testPrint, 'Sent to the printer. Check the test receipt came out and the dashes fit on one line.')} disabled={busy}>Print test receipt</button>
            <button onClick={() => void run(hw.testDrawer, 'Sent to the printer. The drawer should have opened.')} disabled={busy || !config.drawer}>Open drawer</button>
          </div>
        </>
      )}
      {note && <p className={note.kind === 'ok' ? 'good' : 'error'} role="status" data-testid="printer-note">{note.text}</p>}
    </section>
  )
}

export function ReceiptDetailsCard({ binding }: { binding: Binding }) {
  const [details, setDetails] = useState<ShopDetails | null>(null)
  const [note, setNote] = useState<Note>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => { void window.till.hardware.getShopDetails().then(setDetails) }, [])
  if (!details) return null

  const set = (patch: Partial<ShopDetails>) => { setDetails({ ...details, ...patch }); setNote(null) }

  async function save() {
    if (!details) return
    setBusy(true)
    try {
      await saveShopDetails(binding, details)
      setNote({ kind: 'ok', text: 'Saved. Every till in this shop will print these.' })
    } catch (err) {
      setNote({ kind: 'bad', text: (err as Error).message })
    }
    setBusy(false)
  }

  return (
    <section className="card wide">
      <h2>What the receipt says</h2>
      <label>Shop name<input data-testid="shop-name" value={details.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} /></label>
      <label>Address<textarea data-testid="shop-address" rows={3} value={details.address ?? ''} maxLength={300} onChange={(e) => set({ address: e.target.value })} /></label>
      <label>VAT number<input data-testid="shop-vat" value={details.vatNumber ?? ''} maxLength={30} placeholder="leave empty if not VAT registered" onChange={(e) => set({ vatNumber: e.target.value })} /></label>
      <label>Message at the bottom<input data-testid="shop-footer" value={details.footer ?? ''} maxLength={300} placeholder="for example: Thank you for shopping with us" onChange={(e) => set({ footer: e.target.value })} /></label>
      <div className="bar-buttons"><button className="primary" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save receipt details'}</button></div>
      {note && <p className={note.kind === 'ok' ? 'good' : 'error'} role="status" data-testid="details-note">{note.text}</p>}
    </section>
  )
}
