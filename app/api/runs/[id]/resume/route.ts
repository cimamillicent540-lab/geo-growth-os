import { NextResponse } from 'next/server';
import { requireApiAuth, requireClientInAgency } from '@/lib/auth';
import { getEnv } from '@/lib/env';
import { dispatchWorker } from '@/lib/runWorker';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireApiAuth(req);
  if (auth instanceof NextResponse) return auth;

  const { id } = await params;
  const supabase = supabaseAdmin();
  const { data: run } = await supabase
    .from('geo_runs')
    .select('id, client_id, status, total_queries, processed_queries')
    .eq('id', id)
    .single();

  if (!run) return NextResponse.json({ error: 'not found' }, { status: 404 });

  const clientResult = await requireClientInAgency(auth, run.client_id);
  if (clientResult.error) return clientResult.error;

  if (run.status === 'completed') {
    return NextResponse.json({ ok: true, status: 'completed' });
  }

  const baseUrl = getEnv('APP_BASE_URL') || new URL(req.url).origin;
  await supabase
    .from('geo_runs')
    .update({ status: 'running', error_message: null })
    .eq('id', id);

  await dispatchWorker(id, baseUrl, {
    background: true,
    onError: async (error) => {
      await supabase
        .from('geo_runs')
        .update({ status: 'failed', error_message: error instanceof Error ? error.message : 'Worker dispatch failed' })
        .eq('id', id);
    }
  });
  return NextResponse.json({ ok: true, status: 'running' });
}
