// Setup: who works the till, their role and PIN.
import { useState } from 'react'
import { addStaff, changePin, removeStaff } from '../lib/staff'
import { activeStaff, type Staff } from '../../../shared/staff'
import type { Binding } from '../../../shared/local'

export function StaffCard({ binding, staff, online, onChanged }: { binding: Binding; staff: Staff[]; online: boolean; onChanged: () => Promise<void> }) {
  const [name, setName] = useState('')
  const [role, setRole] = useState<Staff['role']>('cashier')
  const [pin, setPin] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const [newPin, setNewPin] = useState('')
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const people = activeStaff(staff)

  async function run(work: () => Promise<void>, done: string) {
    setBusy(true)
    setNote(null)
    try {
      await work()
      await onChanged()
      setNote({ ok: true, text: done })
    } catch (err) { setNote({ ok: false, text: (err as Error).message }) }
    setBusy(false)
  }

  return (
    <section className="card wide">
      <h2>Staff and PINs</h2>
      <p className="muted">
        {people.length === 0
          ? 'No staff yet, so the till opens without a PIN and manager-only actions (refunds, price changes, opening the drawer) are switched off. Add a manager first.'
          : 'Everyone signs in to the till with their own PIN. Managers can allow refunds, price changes and opening the drawer.'}
      </p>
      <ul className="staff">
        {people.map((s) => (
          <li key={s.id}>
            <span className="name">{s.name}<small>{s.role === 'manager' ? 'Manager' : 'Cashier'}</small></span>
            {editing === s.id ? (
              <span className="row3">
                <input placeholder="New PIN" inputMode="numeric" type="password" maxLength={6} value={newPin} onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))} />
                <button onClick={() => void run(() => changePin(s.id, newPin), `${s.name}'s PIN was changed.`).then(() => { setEditing(null); setNewPin('') })} disabled={busy}>Save</button>
                <button onClick={() => { setEditing(null); setNewPin('') }}>Cancel</button>
              </span>
            ) : (
              <span className="row3">
                <button onClick={() => { setEditing(s.id); setNewPin('') }} disabled={busy || !online}>Change PIN</button>
                <button className="danger" onClick={() => void run(() => removeStaff(s.id), `${s.name} was removed.`)} disabled={busy || !online}>Remove</button>
              </span>
            )}
          </li>
        ))}
      </ul>
      <div className="add-staff">
        <label>Name<input data-testid="staff-name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} /></label>
        <label>Role
          <select data-testid="staff-role" value={role} onChange={(e) => setRole(e.target.value as Staff['role'])}>
            <option value="cashier">Cashier</option>
            <option value="manager">Manager</option>
          </select>
        </label>
        <label>PIN (4 to 6 digits)<input data-testid="staff-pin" inputMode="numeric" type="password" maxLength={6} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} /></label>
        <button className="primary" disabled={busy || !online}
          onClick={() => void run(() => addStaff(binding, name, role, pin), `${name.trim()} was added.`).then(() => { setName(''); setPin('') })}>Add</button>
      </div>
      {!online && <p className="muted">Changing staff needs the internet.</p>}
      {note && <p className={note.ok ? 'good' : 'error'} role="status" data-testid="staff-note">{note.text}</p>}
    </section>
  )
}
