// ESC/POS: the simple command language nearly every thermal receipt printer understands.
// A receipt is described as a list of plain "lines" first (so it can be shown on screen and
// tested), then turned into the bytes the printer wants.

export type ReceiptLine =
  | { kind: 'text'; text: string; align?: 'left' | 'centre' | 'right'; bold?: boolean; big?: boolean }
  | { kind: 'pair'; left: string; right: string; bold?: boolean; big?: boolean } // name on the left, amount on the right
  | { kind: 'rule' }
  | { kind: 'blank' }

const ESC = 0x1b
const GS = 0x1d

// Receipt printers do not speak Unicode. Use the classic PC437 table: plain ASCII plus £.
function encode(text: string): number[] {
  const out: number[] = []
  for (const ch of text.normalize('NFD').replace(/[̀-ͯ]/g, '')) {
    const code = ch.codePointAt(0)!
    if (ch === '£') out.push(0x9c)
    else if (code >= 0x20 && code <= 0x7e) out.push(code)
    else if (ch === '·' || ch === '•') out.push(0x2d)
    else if (ch === '’' || ch === '‘') out.push(0x27)
    else out.push(0x3f) // "?"
  }
  return out
}

function fit(text: string, width: number): string {
  return text.length <= width ? text : text.slice(0, Math.max(0, width - 1)) + '.'
}

// "COLA 500ML            £2.98" across exactly `width` characters.
export function pairLine(left: string, right: string, width: number): string {
  const room = Math.max(1, width - right.length - 1)
  return fit(left, room).padEnd(width - right.length, ' ') + right
}

// The receipt as plain text, for showing on screen and for tests.
export function toText(lines: ReceiptLine[], columns: number): string {
  return lines.map((line) => {
    const width = 'big' in line && line.big ? Math.floor(columns / 2) : columns
    switch (line.kind) {
      case 'rule': return '-'.repeat(columns)
      case 'blank': return ''
      case 'pair': return pairLine(line.left, line.right, width)
      case 'text': {
        const text = fit(line.text, width)
        if (line.align === 'centre') return ' '.repeat(Math.floor((width - text.length) / 2)) + text
        if (line.align === 'right') return text.padStart(width, ' ')
        return text
      }
    }
  }).join('\n')
}

// Pulse on drawer pin 2, the usual wiring for a drawer plugged into the printer.
export const DRAWER_KICK = [ESC, 0x70, 0x00, 0x19, 0xfa]

export function toEscPos(lines: ReceiptLine[], columns: number, options: { kickDrawer?: boolean } = {}): Uint8Array {
  const out: number[] = []
  out.push(ESC, 0x40) // reset the printer
  if (options.kickDrawer) out.push(...DRAWER_KICK) // first, so the drawer opens before the paper moves
  out.push(ESC, 0x74, 0x00) // character table PC437
  for (const line of lines) {
    const big = 'big' in line && !!line.big
    const bold = 'bold' in line && !!line.bold
    const width = big ? Math.floor(columns / 2) : columns
    const align = line.kind === 'text' ? line.align ?? 'left' : 'left'
    out.push(ESC, 0x61, align === 'centre' ? 1 : align === 'right' ? 2 : 0)
    out.push(ESC, 0x45, bold ? 1 : 0)
    out.push(GS, 0x21, big ? 0x11 : 0x00) // double width + height, or normal
    if (line.kind === 'rule') out.push(...encode('-'.repeat(columns)))
    else if (line.kind === 'pair') out.push(...encode(pairLine(line.left, line.right, width)))
    else if (line.kind === 'text') out.push(...encode(fit(line.text, width)))
    out.push(0x0a)
  }
  out.push(ESC, 0x61, 0, ESC, 0x45, 0, GS, 0x21, 0)
  out.push(ESC, 0x64, 4) // feed 4 lines so the text clears the cutter
  out.push(GS, 0x56, 0x42, 0x00) // cut (printers with no cutter ignore this)
  return Uint8Array.from(out)
}

export function drawerOnly(): Uint8Array {
  return Uint8Array.from([ESC, 0x40, ...DRAWER_KICK])
}
