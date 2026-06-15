'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabaseBrowser';
import type { UserProfile } from '@/lib/types';

type AuthState = {
  loading: boolean;
  token: string | null;
  profile: UserProfile | null;
  error: string | null;
};

export function AuthGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const supabase = useMemo(() => supabaseBrowser(), []);
  const [state, setState] = useState<AuthState>({ loading: true, token: null, profile: null, error: null });

  useEffect(() => {
    let active = true;

    async function load() {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token || null;

      if (!token) {
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
        return;
      }

      await fetch('/api/auth/bootstrap', {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` }
      });

      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) {
        router.replace(`/login?next=${encodeURIComponent(pathname)}`);
        return;
      }

      const { data: profile, error } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();

      if (!active) return;
      setState({
        loading: false,
        token,
        profile: (profile as UserProfile | null) || null,
        error: error?.message || (!profile ? 'No user profile assigned yet.' : null)
      });
    }

    load();
    const { data: listener } = supabase.auth.onAuthStateChange(() => load());
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, [pathname, router, supabase]);

  if (state.loading) {
    return <div className="empty">Loading workspace...</div>;
  }

  if (state.error || !state.profile) {
    return (
      <div className="card narrow">
        <h1>Access pending</h1>
        <p className="muted">{state.error || 'Your account needs a role before you can access the dashboard.'}</p>
        <button
          className="btn"
          onClick={async () => {
            await supabase.auth.signOut();
            router.replace('/login');
          }}
        >
          Sign out
        </button>
      </div>
    );
  }

  return <>{children}</>;
}

export function AppNav() {
  const router = useRouter();
  const supabase = useMemo(() => supabaseBrowser(), []);

  return (
    <nav className="nav">
      <Link href="/dashboard" className="brand">GEO Growth OS</Link>
      <div className="navlinks">
        <Link href="/dashboard">Dashboard</Link>
        <Link href="/clients">Clients</Link>
        <Link href="/clients/new">New Client</Link>
        <button
          className="navbutton"
          onClick={async () => {
            await supabase.auth.signOut();
            router.replace('/login');
          }}
        >
          Sign out
        </button>
      </div>
    </nav>
  );
}
