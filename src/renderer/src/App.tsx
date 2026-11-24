import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { SignIn } from './screens/SignIn'
import { ConnectionCheck } from './screens/ConnectionCheck'

export function App() {
  // undefined = still finding out, null = signed out
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])

  if (session === undefined) return <main className="centre muted">Starting…</main>
  if (!session) return <SignIn />
  return <ConnectionCheck userId={session.user.id} email={session.user.email ?? ''} />
}
