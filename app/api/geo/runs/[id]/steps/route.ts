import { NextResponse } from 'next/server';
import { requireApiAuth, requireClientInAgency } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const supabase = supabaseAdmin();
  const { data: run } = await supabase
    .from('geo_runs')
    .select('id, client_id')
    .eq('id', id)
    .single();

  if (!run) return NextResponse.json({ error: 'Run not found' }, { status: 404 });

  const clientResult = await requireClientInAgency(auth, run.client_id);
  if (clientResult.error) return clientResult.error;

  const { data: steps, error } = await supabase
    .from('geo_run_steps')
    .select('*, geo_queries(query_text,intent_type,priority)')
    .eq('run_id', id)
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ steps: steps || [] });
}
