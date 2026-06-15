'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useMemo, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const next = search.get('next') || '/dashboard';

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);

    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setMessage(error.message);
      return;
    }

    if (data.session?.access_token) {
      await fetch('/api/auth/bootstrap', {
        method: 'POST',
        headers: { authorization: `Bearer ${data.session.access_token}` }
      });
    }
    router.replace(next);
  }

  async function magicLink() {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}${next}` }
    });
    setMessage(error ? error.message : 'Magic link sent. Check your email.');
  }

  return (
    <div className="loginWrap">
      <form className="card loginCard" onSubmit={submit}>
        <h1>Sign in</h1>
        <p className="muted">Access the GEO Growth OS client dashboard.</p>
        {message && <p className="dangerText">{message}</p>}
        <label>Email<input className="input" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>
        <label>Password<input className="input" type="password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
        <button className="btn primary" type="submit">Sign in</button>
        <button className="btn" type="button" onClick={magicLink}>Send magic link</button>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="empty">Loading...</div>}>
      <LoginForm />
    </Suspense>
  );
}
