import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'

export function SignInForm({ onSignedIn, fixedEmail }: { onSignedIn?: () => void; fixedEmail?: string }) {
  const [email, setEmail] = useState(fixedEmail ?? '')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    const { error: signInError } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (signInError) {
      setError(
        signInError.message === 'Invalid login credentials'
          ? 'That email or password is not right.'
          : /failed to fetch/i.test(signInError.message)
            ? 'No internet. Signing in needs to be online.'
            : signInError.message,
      )
      return
    }
    setPassword('')
    onSignedIn?.()
  }

  return (
    <form className="form" onSubmit={submit}>
      <label>
        Email
        <input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required readOnly={!!fixedEmail} autoFocus={!fixedEmail} />
      </label>
      <label>
        Password
        <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      {error && <p className="error" role="alert">{error}</p>}
      <button className="primary" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  )
}

// The till PC is signed in to its shop once, with a Retail Aid login.
// Day to day, staff will use their PIN instead (Phase 6).
export function SignIn() {
  return (
    <main className="centre">
      <div className="card">
        <h1>Connect this till to a shop</h1>
        <p className="muted">Sign in with the shop's Retail Aid email and password. You only do this once per till, and it needs internet.</p>
        <SignInForm />
      </div>
    </main>
  )
}
