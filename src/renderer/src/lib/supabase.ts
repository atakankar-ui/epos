// One connection to the shared database (the same one Retail Aid uses).
//
// The address and key below are the PUBLIC ones. They are safe to ship inside the
// app: on their own they open nothing. What a signed-in person may see or change is
// decided by the database's row rules, shop by shop. The secret "service_role" key
// is never used in this app.
import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL ?? 'https://gobbuzoypsfbrkayfuod.supabase.co'
const key = import.meta.env.VITE_SUPABASE_KEY ?? 'sb_publishable_RVYIvEqGIaUGuP_3f9rPaQ_c_QbmAUO'

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
})
