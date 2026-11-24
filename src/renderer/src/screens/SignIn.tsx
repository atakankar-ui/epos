import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

// The till PC is signed in to its shop once, with a Retail Aid login.
// Day to day, staff will use their PIN instead (Phase 6).
export function SignIn() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    })
    setBusy(false)
    if (signInError) {
      setError(
        signInError.message === 'Invalid login credentials'
          ? 'That email or password is not right.'
          : signInError.message === 'Failed to fetch'
            ? 'No internet. Connecting this till to its shop needs to be online.'
            : signInError.message,
      )
    }
  }

  return (
    <main className="centre">
      <form className="card" onSubmit={submit}>
        <h1>Connect this till to a shop</h1>
        <p className="muted">Sign in with the shop's Retail Aid email and password. You only do this once per till.</p>
        <label>
          Email
          <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </label>
        <label>
          Password
          <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="primary" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}
