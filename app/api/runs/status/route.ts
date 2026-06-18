import { NextResponse } from 'next/server';
import { requireApiAuth, requireClientInAgency } from '@/lib/auth';
import { buildRunStatus } from '@/lib/runWorker';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function GET(req: Request) {
  const auth = await requireApiAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { searchParams } = new URL(req.url);
  const runId = searchParams.get('run_id');
  if (!runId) return NextResponse.json({ error: 'run_id required' }, { status: 400 });

  const supabase = supabaseAdmin();
  const { data: run } = await supabase
    .from('geo_runs')
    .select('id, client_id, status, total_queries, processed_queries, error_message, started_at, created_at')
    .eq('id', runId)
    .single();

  if (!run) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const clientResult = await requireClientInAgency(auth, run.client_id);
  if (clientResult.error) return clientResult.error;

  return NextResponse.json(await buildRunStatus(run));
}
