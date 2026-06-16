import { NextResponse } from 'next/server';
import { forbidden, hasAgencyOperatorAccess, hasRole, requireApiAuth, requireClientInAgency } from '@/lib/auth';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireApiAuth(req);
  if (auth instanceof NextResponse) return auth;
  if (!hasRole(auth.profile, ['admin', 'strategist'])) return forbidden('Client users cannot run GEO tests.');

  const supabase = supabaseAdmin();
  const clientResult = await requireClientInAgency(auth, id);
  if (clientResult.error) return clientResult.error;
  const client = clientResult.client;
  if (!hasAgencyOperatorAccess(auth, client.agency_id)) return forbidden('You are not a member of this client agency.');

  const { data: queries } = await supabase
    .from('geo_queries')
    .select('id')
    .eq('client_id', id)
    .eq('agency_id', client.agency_id)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(20);

  if (!queries?.length) {
    return NextResponse.json({ error: 'Generate GEO queries before running a test.' }, { status: 400 });
  }

  const { data: run, error: runError } = await supabase
    .from('geo_runs')
    .insert({
      client_id: id,
      agency_id: client.agency_id,
      run_name: `GEO Run ${new Date().toISOString().slice(0, 10)}`,
      status: 'pending',
      total_queries: queries.length,
      processed_queries: 0,
      created_by: auth.user.id
    })
    .select('*')
    .single();

  if (runError || !run) {
    return NextResponse.json({ error: runError?.message || 'Could not create run' }, { status: 500 });
  }

  const workerSecret = process.env.INTERNAL_WORKER_SECRET || process.env.WORKER_SECRET;
  if (!workerSecret) {
    await supabase
      .from('geo_runs')
      .update({ status: 'failed', error_message: 'Missing INTERNAL_WORKER_SECRET' })
      .eq('id', run.id);
    return NextResponse.json({ error: 'Missing INTERNAL_WORKER_SECRET', run_id: run.id }, { status: 500 });
  }

  const baseUrl = process.env.APP_BASE_URL || new URL(req.url).origin;
  fetch(`${baseUrl}/api/runs/worker`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-worker-secret': workerSecret
    },
    body: JSON.stringify({ run_id: run.id })
  }).catch(async (error) => {
    await supabase
      .from('geo_runs')
      .update({ status: 'failed', error_message: error instanceof Error ? error.message : 'Worker dispatch failed' })
      .eq('id', run.id);
  });

  return NextResponse.json({ run_id: run.id, share_token: run.share_token, queued: true, total_queries: queries.length });
}
