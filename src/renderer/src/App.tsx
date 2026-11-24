import { useCallback, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import type { Binding } from '../../shared/local'
import { SignIn } from './screens/SignIn'
import { Connect } from './screens/Connect'
import { Till } from './screens/Till'

export function App() {
  // undefined = still finding out
  const [binding, setBinding] = useState<Binding | null | undefined>(undefined)
  const [session, setSession] = useState<Session | null | undefined>(undefined)

  useEffect(() => {
    // What this PC already knows comes first: a connected till opens with no internet.
    void window.till.local.getState().then((state) => setBinding(state.binding))
    void supabase.auth.getSession().then(({ data }) => setSession(data.session), () => setSession(null))
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])

  const disconnected = useCallback(() => setBinding(null), [])

  if (binding === undefined) return <main className="centre muted">Starting…</main>
  if (binding) return <Till binding={binding} onDisconnected={disconnected} />
  if (session === undefined) return <main className="centre muted">Starting…</main>
  if (!session) return <SignIn />
  return <Connect userId={session.user.id} email={session.user.email ?? ''} onDone={setBinding} />
}
