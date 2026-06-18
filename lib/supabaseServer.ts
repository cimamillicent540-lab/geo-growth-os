import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { getEnv } from '@/lib/env';

export async function supabaseServer() {
  const store = await cookies();
  return createServerClient(
    getEnv('NEXT_PUBLIC_SUPABASE_URL') || 'https://example.supabase.co',
    getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY') || 'missing-anon-key',
    {
      cookies: {
        getAll: () => store.getAll(),
        setAll: () => {}
      }
    }
  );
}
