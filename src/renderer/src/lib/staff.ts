// Staff are kept in the shared database (so every till in the shop knows them) with a
// copy on each PC so PINs can be checked with no internet. Only a Buyer login can change them.
import { supabase } from './supabase'
import type { Binding } from '../../../shared/local'
import { hashPin, newSalt, toStaff, validPin, type Staff, type StaffRow } from '../../../shared/staff'

function plain(error: { message: string }): Error {
  return new Error(/row-level security|permission/i.test(error.message)
    ? 'Only a Buyer login can change staff. This till is signed in with a Staff login.'
    : /failed to fetch/i.test(error.message) ? 'No internet. Staff are saved online, so this needs a connection.' : error.message)
}

export async function pullStaff(binding: Binding): Promise<Staff[]> {
  const { data, error } = await supabase.from('staff').select('id, name, role, pin_salt, pin_hash, active').eq('org_id', binding.orgId)
  if (error) throw plain(error)
  const staff = ((data ?? []) as StaffRow[]).map(toStaff)
  await window.till.local.setStaff(staff)
  return staff
}

export async function addStaff(binding: Binding, name: string, role: Staff['role'], pin: string): Promise<void> {
  if (!name.trim()) throw new Error('Type a name.')
  if (!validPin(pin)) throw new Error('A PIN is 4 to 6 digits.')
  const salt = newSalt()
  const { data, error } = await supabase.from('staff')
    .insert({ org_id: binding.orgId, name: name.trim(), role, pin_salt: salt, pin_hash: await hashPin(pin, salt) }).select('id')
  if (error) throw plain(error)
  if (!data?.length) throw new Error('Nothing was saved. Only a Buyer login can add staff.')
}

export async function changePin(staffId: string, pin: string): Promise<void> {
  if (!validPin(pin)) throw new Error('A PIN is 4 to 6 digits.')
  const salt = newSalt()
  const { data, error } = await supabase.from('staff')
    .update({ pin_salt: salt, pin_hash: await hashPin(pin, salt), updated_at: new Date().toISOString() }).eq('id', staffId).select('id')
  if (error) throw plain(error)
  if (!data?.length) throw new Error('Nothing was saved. Only a Buyer login can change a PIN.')
}

// Staff are never deleted (their name stays on past sales and the audit trail); they are switched off.
export async function removeStaff(staffId: string): Promise<void> {
  const { data, error } = await supabase.from('staff').update({ active: false, updated_at: new Date().toISOString() }).eq('id', staffId).select('id')
  if (error) throw plain(error)
  if (!data?.length) throw new Error('Nothing was saved. Only a Buyer login can remove staff.')
}
