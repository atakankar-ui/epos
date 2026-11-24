// Shown once after sign-in on a new till PC: registers the till and downloads the products.
import { useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { connectTill } from '../lib/connect'
import type { Binding } from '../../../shared/local'

export function Connect({ userId, email, onDone }: { userId: string; email: string; onDone: (b: Binding) => void }) {
  const [progress, setProgress] = useState('Starting…')
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const started = useRef(-1)

  useEffect(() => {
    if (started.current === attempt) return // never register the till twice
    started.current = attempt
    setError(null)
    connectTill(userId, email, setProgress).then(onDone, (err: Error) => setError(err.message))
  }, [attempt, userId, email, onDone])

  return (
    <main className="centre">
      <div className="card">
        <h1>Setting up this till</h1>
        {error ? (
          <>
            <p className="error" role="alert">{/failed to fetch/i.test(error) ? 'No internet connection.' : error}</p>
            <button className="primary" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
            <button onClick={() => void supabase.auth.signOut()}>Sign out</button>
          </>
        ) : (
          <p className="big">{progress}</p>
        )}
      </div>
    </main>
  )
}
