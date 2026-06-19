import { NextResponse } from 'next/server';
import { requireApiAuth, requireClientInAgency } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(req: Request) {
  const auth = await requireApiAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);
  const clientId = searchParams.get('client_id');
  const status = searchParams.get('status');
  const limit = Math.min(Number(searchParams.get('limit') || 50), 100);
  const supabase = supabaseAdmin();

  let query = supabase
    .from('geo_runs')
    .select('*, clients(id,name,website,industry), geo_insights(visibility_score,mention_rate,recommendation_rate)')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (clientId) {
    const clientResult = await requireClientInAgency(auth, clientId);
    if (clientResult.error) return clientResult.error;
    query = query.eq('client_id', clientId);
  } else if (auth.profile.role === 'client' && auth.profile.client_id) {
    query = query.eq('client_id', auth.profile.client_id);
  } else if (auth.agencyIds.length) {
    query = query.in('agency_id', auth.agencyIds);
  } else {
    return NextResponse.json({ runs: [] });
  }

  if (status) query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ runs: data || [] });
}
