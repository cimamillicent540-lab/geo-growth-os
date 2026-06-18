import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const RUN_STALL_MS = 5 * 60 * 1000;

type RunForStatus = {
  id: string;
  status: string;
  total_queries: number;
  processed_queries: number;
  error_message: string | null;
  started_at?: string | null;
  created_at?: string | null;
};

export async function buildRunStatus(run: RunForStatus) {
  const supabase = supabaseAdmin();
  const { data: latestAnswer } = await supabase
    .from('geo_answers')
    .select('created_at')
    .eq('run_id', run.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const { count } = await supabase
    .from('geo_answers')
    .select('id', { count: 'exact', head: true })
    .eq('run_id', run.id);

  const lastProgressAt = latestAnswer?.created_at || run.started_at || run.created_at || null;
  const lastProgressTime = lastProgressAt ? new Date(lastProgressAt).getTime() : 0;
  const processedQueries = Math.max(Number(run.processed_queries || 0), count || 0);
  const hasRemaining = processedQueries < Number(run.total_queries || 0);
  const isStalled = run.status === 'running' && hasRemaining && lastProgressTime > 0 && Date.now() - lastProgressTime > RUN_STALL_MS;
  const canResume = hasRemaining && (run.status === 'pending' || run.status === 'running' || run.status === 'failed' || isStalled);

  return {
    ...run,
    processed_queries: processedQueries,
    is_stalled: isStalled,
    can_resume: canResume,
    last_progress_at: lastProgressAt
  };
}

export async function dispatchWorker(runId: string, baseUrl: string) {
  const workerSecret = process.env.INTERNAL_WORKER_SECRET || process.env.WORKER_SECRET;
  if (!workerSecret) {
    throw new Error('Missing INTERNAL_WORKER_SECRET');
  }

  const response = await fetch(`${baseUrl}/api/runs/worker`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-worker-secret': workerSecret
    },
    body: JSON.stringify({ run_id: runId })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Worker returned HTTP ${response.status}`);
  }

  return response.json();
}
