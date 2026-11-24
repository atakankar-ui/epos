// Staff and their PINs. The PIN itself is never stored anywhere: only a scrambled
// version (a salted hash) that the till can check with no internet.
export type Staff = {
  id: string
  name: string
  role: 'cashier' | 'manager'
  pinSalt: string | null
  pinHash: string | null
  active: boolean
}

export type StaffRow = { id: string; name: string; role: string; pin_salt: string | null; pin_hash: string | null; active: boolean }

export const toStaff = (r: StaffRow): Staff => ({
  id: r.id, name: r.name, role: r.role === 'manager' ? 'manager' : 'cashier', pinSalt: r.pin_salt, pinHash: r.pin_hash, active: r.active,
})

export const validPin = (pin: string): boolean => /^\d{4,6}$/.test(pin)

const hex = (bytes: Uint8Array): string => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')

export function newSalt(): string {
  return hex(crypto.getRandomValues(new Uint8Array(16)))
}

// Deliberately slow to work out (100,000 rounds), so a stolen hash is hard to turn back into a PIN.
export async function hashPin(pin: string, salt: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(salt), iterations: 100_000 }, key, 256)
  return hex(new Uint8Array(bits))
}

export async function checkPin(staff: Staff, pin: string): Promise<boolean> {
  if (!staff.active || !staff.pinSalt || !staff.pinHash || !validPin(pin)) return false
  return (await hashPin(pin, staff.pinSalt)) === staff.pinHash
}

export const activeStaff = (list: Staff[]): Staff[] => list.filter((s) => s.active && s.pinHash).sort((a, b) => a.name.localeCompare(b.name))
export const managers = (list: Staff[]): Staff[] => activeStaff(list).filter((s) => s.role === 'manager')
