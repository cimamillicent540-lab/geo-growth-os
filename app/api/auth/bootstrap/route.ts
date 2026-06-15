import { NextResponse } from 'next/server';
import { requireApiAuth } from '@/lib/auth';

export async function POST(req: Request) {
  const auth = await requireApiAuth(req);
  if (auth instanceof NextResponse) return auth;

  return NextResponse.json({
    user: auth.user,
    profile: auth.profile
  });
}
