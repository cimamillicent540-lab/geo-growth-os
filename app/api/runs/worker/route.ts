import { NextResponse } from 'next/server';
import { compliancePrompt, normalizeContentType, normalizePriority, scoreInsight } from '@/lib/geo';
import { normalizeCompetitors } from '@/lib/normalize';
import { jsonCompletion, OPENAI_MODEL, textCompletion } from '@/lib/openai';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const maxDuration = 60;

type Analysis = {
  brand_mentioned?: boolean;
  brand_position?: number | null;
  competitors_mentioned?: string[];
  sentiment?: 'positive' | 'neutral' | 'negative' | 'mixed';
  recommendation_status?: 'recommended' | 'mentioned_only' | 'not_mentioned' | 'competitor_recommended';
  citations?: unknown[];
  content_gap?: string;
  risk_notes?: string[];
};

type InsightResult = {
  executive_summary?: string;
  competitor_summary?: unknown[];
  sentiment_summary?: Record<string, unknown>;
  content_gaps?: string[];
  action_plan?: string[];
  risk_notes?: string[];
  content_tasks?: Array<{
    title?: string;
    content_type?: string;
    target_query?: string;
    priority?: number;
    brief?: string;
  }>;
};

type SavedAnswer = {
  brand_mentioned: boolean;
  brand_position: number | null;
  competitors_mentioned: string[];
  sentiment: string;
  recommendation_status: string;
  citations: unknown[];
  content_gap: string | null;
  risk_notes: unknown[];
  query_id: string | null;
};

export async function POST(req: Request) {
  const workerSecret = process.env.INTERNAL_WORKER_SECRET || process.env.WORKER_SECRET;
  if (!workerSecret || req.headers.get('x-worker-secret') !== workerSecret) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { run_id } = await req.json().catch(() => ({ run_id: '' }));
  if (!run_id) return NextResponse.json({ error: 'run_id required' }, { status: 400 });

  const baseUrl = process.env.APP_BASE_URL || new URL(req.url).origin;
  const supabase = supabaseAdmin();
  const { data: run } = await supabase
    .from('geo_runs')
    .select('*, clients(*)')
    .eq('id', run_id)
    .single();

  if (!run) return NextResponse.json({ error: 'run not found' }, { status: 404 });
  if (run.status === 'completed' || run.status === 'failed') return NextResponse.json({ ok: true, status: run.status });

  const client = Array.isArray(run.clients) ? run.clients[0] : run.clients;
  if (!client) return NextResponse.json({ error: 'client not found' }, { status: 404 });

  await supabase
    .from('geo_runs')
    .update({ status: 'running', started_at: run.started_at || new Date().toISOString(), error_message: null })
    .eq('id', run_id);

  try {
    const { data: existingAnswers } = await supabase
      .from('geo_answers')
      .select('query_id')
      .eq('run_id', run_id);
    const completedQueryIds = new Set((existingAnswers || []).map((answer) => answer.query_id).filter(Boolean));

    const { data: queries } = await supabase
      .from('geo_queries')
      .select('*')
      .eq('client_id', client.id)
      .eq('agency_id', run.agency_id)
      .order('priority', { ascending: false })
      .order('created_at', { ascending: true })
      .limit(Number(run.total_queries || 20));

    const nextQuery = (queries || []).find((query) => !completedQueryIds.has(query.id));

    if (nextQuery) {
      await processOneQuery({
        supabase,
        run,
        client,
        query: nextQuery,
        processedCount: completedQueryIds.size + 1
      });

      const nextProcessed = completedQueryIds.size + 1;
      if (nextProcessed < Number(run.total_queries || queries?.length || 0)) {
        dispatchNext(baseUrl, workerSecret, run_id);
        return NextResponse.json({ ok: true, status: 'running', processed: nextProcessed });
      }
    }

    await finalizeRun({ supabase, run, client });
    return NextResponse.json({ ok: true, status: 'completed' });
  } catch (error) {
    await supabase
      .from('geo_runs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: error instanceof Error ? error.message : 'Unknown worker error'
      })
      .eq('id', run_id);

    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown worker error' }, { status: 500 });
  }
}

function dispatchNext(baseUrl: string, workerSecret: string, runId: string) {
  fetch(`${baseUrl}/api/runs/worker`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-worker-secret': workerSecret
    },
    body: JSON.stringify({ run_id: runId })
  }).catch(() => {});
}

async function processOneQuery({
  supabase,
  run,
  client,
  query,
  processedCount
}: {
  supabase: ReturnType<typeof supabaseAdmin>;
  run: any;
  client: any;
  query: any;
  processedCount: number;
}) {
  const knownCompetitors: string[] = client.competitors || [];
  const answerSystem = [
    'You are a neutral AI assistant answering a real user question.',
    'Be factual, concise, balanced, and do not invent claims.',
    compliancePrompt(client)
  ].join(' ');

  const answer = await textCompletion(
    answerSystem,
    `User country: ${client.target_country}
Preferred language: ${client.target_language}
Question: ${query.query_text}`
  );

  const analysis = await jsonCompletion<Analysis>(
    'Analyze the answer for GEO visibility. Return strict JSON only.',
    `Client brand: ${client.name}
Known competitors: ${knownCompetitors.join(', ')}
Question: ${query.query_text}
Answer:
${answer}

Return JSON exactly as:
{"brand_mentioned":true,"brand_position":1,"competitors_mentioned":["..."],"sentiment":"positive|neutral|negative|mixed","recommendation_status":"recommended|mentioned_only|not_mentioned|competitor_recommended","citations":[],"content_gap":"...","risk_notes":["..."]}`
  );

  const row = {
    run_id: run.id,
    client_id: client.id,
    agency_id: run.agency_id,
    query_id: query.id,
    model_provider: 'openai',
    model_name: OPENAI_MODEL,
    answer_text: answer,
    brand_mentioned: Boolean(analysis.brand_mentioned),
    brand_position: analysis.brand_position || null,
    competitors_mentioned: normalizeCompetitors(
      Array.isArray(analysis.competitors_mentioned) ? analysis.competitors_mentioned : [],
      knownCompetitors
    ),
    sentiment: analysis.sentiment || 'neutral',
    recommendation_status: analysis.recommendation_status || 'not_mentioned',
    citations: Array.isArray(analysis.citations) ? analysis.citations : [],
    content_gap: analysis.content_gap || null,
    risk_notes: Array.isArray(analysis.risk_notes) ? analysis.risk_notes : []
  };

  const { error: answerError } = await supabase.from('geo_answers').insert(row);
  if (answerError) throw answerError;

  await supabase
    .from('geo_runs')
    .update({ processed_queries: processedCount })
    .eq('id', run.id);
}

async function finalizeRun({
  supabase,
  run,
  client
}: {
  supabase: ReturnType<typeof supabaseAdmin>;
  run: any;
  client: any;
}) {
  const { data: answers } = await supabase
    .from('geo_answers')
    .select('*')
    .eq('run_id', run.id)
    .order('created_at', { ascending: true });

  const savedAnswers = ((answers || []) as SavedAnswer[]).map((answer) => ({
    brand_mentioned: answer.brand_mentioned,
    brand_position: answer.brand_position,
    competitors_mentioned: answer.competitors_mentioned || [],
    sentiment: answer.sentiment,
    recommendation_status: answer.recommendation_status,
    citations: answer.citations || [],
    content_gap: answer.content_gap,
    risk_notes: answer.risk_notes || [],
    query_id: answer.query_id
  }));

  const visibilityScore = scoreInsight(savedAnswers);
  const mentionRate = savedAnswers.filter((answer) => answer.brand_mentioned).length / Math.max(savedAnswers.length, 1);
  const recommendationRate = savedAnswers.filter((answer) => answer.recommendation_status === 'recommended').length / Math.max(savedAnswers.length, 1);

  const insight = await jsonCompletion<InsightResult>(
    ['You are a senior GEO strategist creating a client-ready report.', 'Return strict JSON only.', compliancePrompt(client)].join(' '),
    `Client:
${JSON.stringify(client)}

Run answer analysis:
${JSON.stringify(savedAnswers.map((answer) => ({
  brand_mentioned: answer.brand_mentioned,
  competitors_mentioned: answer.competitors_mentioned,
  sentiment: answer.sentiment,
  recommendation_status: answer.recommendation_status,
  content_gap: answer.content_gap,
  risk_notes: answer.risk_notes
}))).slice(0, 14000)}

Create concise JSON:
{"executive_summary":"...","competitor_summary":[{"name":"...","mentions":3,"notes":"..."}],"sentiment_summary":{"positive":0,"neutral":0,"negative":0,"mixed":0,"notes":"..."},"content_gaps":["..."],"action_plan":["..."],"risk_notes":["..."],"content_tasks":[{"title":"...","content_type":"faq|comparison_page|blog|landing_page|third_party_review|reddit_quora_answer|ad_creative_angle","target_query":"...","priority":1,"brief":"..."}]}`
  );

  const { data: existingInsight } = await supabase
    .from('geo_insights')
    .select('id')
    .eq('run_id', run.id)
    .maybeSingle();

  if (!existingInsight) {
    const { error: insightError } = await supabase.from('geo_insights').insert({
      client_id: client.id,
      agency_id: run.agency_id,
      run_id: run.id,
      visibility_score: visibilityScore,
      mention_rate: mentionRate,
      recommendation_rate: recommendationRate,
      competitor_summary: insight.competitor_summary || [],
      sentiment_summary: insight.sentiment_summary || {},
      content_gaps: insight.content_gaps || [],
      action_plan: insight.action_plan || [],
      risk_notes: insight.risk_notes || [],
      executive_summary: insight.executive_summary || ''
    });

    if (insightError) throw insightError;
  }

  const { data: existingTasks } = await supabase
    .from('content_tasks')
    .select('id')
    .eq('run_id', run.id)
    .limit(1);

  if (!existingTasks?.length) {
    const tasks = (insight.content_tasks || []).slice(0, 20).map((task) => ({
      client_id: client.id,
      agency_id: run.agency_id,
      run_id: run.id,
      title: String(task.title || 'Content task').trim(),
      content_type: normalizeContentType(task.content_type),
      target_query: task.target_query || null,
      priority: normalizePriority(task.priority),
      status: 'todo',
      brief: task.brief || ''
    }));

    if (tasks.length) {
      const { error: taskError } = await supabase.from('content_tasks').insert(tasks);
      if (taskError) throw taskError;
    }
  }

  await supabase
    .from('geo_runs')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      processed_queries: savedAnswers.length
    })
    .eq('id', run.id);
}
