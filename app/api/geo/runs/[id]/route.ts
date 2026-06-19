import { NextResponse } from 'next/server';
import { requireApiAuth, requireClientInAgency } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const supabase = supabaseAdmin();
  const { data: run, error } = await supabase
    .from('geo_runs')
    .select('*, clients(id,name,website,industry,target_country,target_language), geo_insights(*)')
    .eq('id', id)
    .single();

  if (error || !run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

  const clientResult = await requireClientInAgency(auth, run.client_id);
  if (clientResult.error) return clientResult.error;

  return NextResponse.json({ run });
}
