import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    { error: 'Use POST /api/clients/[id]/run-geo-test with a Supabase bearer token.' },
    { status: 410 }
  );
}
