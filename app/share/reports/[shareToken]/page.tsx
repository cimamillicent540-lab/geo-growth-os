import { ReportView } from '@/app/components/Console';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import type { Client, ContentTask, GeoAnswer, GeoInsight, GeoQuery, GeoRun } from '@/lib/types';

export default async function PublicReportPage({ params }: { params: Promise<{ shareToken: string }> }) {
  const { shareToken } = await params;
  const supabase = supabaseAdmin();
  const { data: run } = await supabase
    .from('geo_runs')
    .select('*')
    .eq('share_token', shareToken)
    .eq('status', 'completed')
    .single();

  if (!run) {
    return <div className="empty">Public report not found.</div>;
  }

  const [{ data: client }, { data: insight }, { data: answers }, { data: tasks }] = await Promise.all([
    supabase.from('clients').select('*').eq('id', run.client_id).single(),
    supabase.from('geo_insights').select('*').eq('run_id', run.id).single(),
    supabase.from('geo_answers').select('*, geo_queries(*)').eq('run_id', run.id).limit(50),
    supabase.from('content_tasks').select('*').eq('run_id', run.id).order('priority', { ascending: true })
  ]);

  return (
    <ReportView
      client={(client as Client | null) || null}
      run={(run as GeoRun | null) || null}
      insight={(insight as GeoInsight | null) || null}
      answers={(answers as Array<GeoAnswer & { geo_queries?: GeoQuery }>) || []}
      tasks={(tasks as ContentTask[]) || []}
    />
  );
}
