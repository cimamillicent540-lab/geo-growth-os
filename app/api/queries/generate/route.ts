import { NextResponse } from 'next/server';

export async function POST() {
  return NextResponse.json(
    { error: 'Use POST /api/clients/[id]/generate-queries with a Supabase bearer token.' },
    { status: 410 }
  );
}
