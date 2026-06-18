import { NextResponse } from 'next/server';
import { envSnapshot } from '@/lib/env';
import { hasRole, requireApiAuth } from '@/lib/auth';

export async function GET(req: Request) {
  const auth = await requireApiAuth(req);
  if (auth instanceof NextResponse) return auth;
  if (!hasRole(auth.profile, ['admin'])) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const snapshot = envSnapshot();
  return NextResponse.json({
    hasSupabaseUrl: snapshot.hasSupabaseUrl,
    hasAnonKey: snapshot.hasAnonKey,
    hasServiceRoleKey: snapshot.hasServiceRoleKey,
    hasOpenAIKey: snapshot.hasOpenAIKey,
    hasAppBaseUrl: snapshot.hasAppBaseUrl,
    runtime: snapshot.runtime
  });
}
