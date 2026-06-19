import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { compliancePrompt, normalizeContentType, normalizePriority, scoreInsight } from '@/lib/geo';
import { normalizeCompetitors } from '@/lib/normalize';
import { describeOpenAIError, jsonCompletion, openAIModel, textCompletion } from '@/lib/openai';
import { dispatchWorker } from '@/lib/runWorker';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

export const maxDuration = 60;

const BATCH_SIZE = 3;
const ANSWER_TIMEOUT_MS = 8000;
const ANALYSIS_TIMEOUT_MS = 6000;
const INSIGHT_TIMEOUT_MS = 12000;

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

type RunStepInput = {
  step_type: string;
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  title: string;
  message?: string;
  query_id?: string | null;
  metadata?: Record<string, unknown>;
  started_at?: string | null;
  completed_at?: string | null;
};

export async function POST(req: Request) {
  const workerSecret = getEnv('INTERNAL_WORKER_SECRET') || getEnv('WORKER_SECRET');
  if (!workerSecret || req.headers.get('x-worker-secret') !== workerSecret) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 });
  }

  const { run_id } = await req.json().catch(() => ({ run_id: '' }));
  if (!run_id) return NextResponse.json({ error: 'run_id required' }, { status: 400 });

  const baseUrl = getEnv('APP_BASE_URL') || new URL(req.url).origin;
  const supabase = supabaseAdmin();

  try {
    const context = await loadRunContext(supabase, run_id);
    if ('response' in context) return context.response;

    const { run, client, queries, completedQueryIds } = context;
    if (run.status === 'completed') return NextResponse.json({ ok: true, status: 'completed' });

    await supabase
      .from('geo_runs')
      .update({
        status: 'running',
        started_at: run.started_at || new Date().toISOString(),
        error_message: null
      })
      .eq('id', run_id);

    const totalQueries = Number(run.total_queries || queries.length || 0);
    const pendingQueries = queries.filter((query) => !completedQueryIds.has(query.id)).slice(0, BATCH_SIZE);
    await logRunStep(supabase, run, client, {
      step_type: 'batch_started',
      status: 'running',
      title: 'Worker batch started',
      message: `Processing ${pendingQueries.length} pending questions.`,
      metadata: { processed_count: completedQueryIds.size, total_queries: totalQueries, batch_size: pendingQueries.length },
      started_at: new Date().toISOString()
    });

    for (const query of pendingQueries) {
      await processOneQuerySafely({ supabase, run, client, query });
    }

    const processedCount = await syncProcessedCount(supabase, run_id);

    if (processedCount >= totalQueries || pendingQueries.length === 0) {
      await finalizeRun({ supabase, run: { ...run, total_queries: totalQueries }, client });
      await logRunStep(supabase, run, client, {
        step_type: 'run_completed',
        status: 'completed',
        title: 'Run completed',
        message: 'Insights and content tasks are ready.',
        metadata: { processed_count: processedCount, total_queries: totalQueries },
        completed_at: new Date().toISOString()
      });
      return NextResponse.json({ ok: true, status: 'completed', processed: processedCount, total: totalQueries });
    }

    await dispatchWorker(run_id, baseUrl, {
      background: true,
      onError: (error) => markRunFailed(supabase, run_id, error instanceof Error ? error.message : 'Worker dispatch failed')
    });
    await logRunStep(supabase, run, client, {
      step_type: 'next_batch_dispatched',
      status: 'completed',
      title: 'Next worker batch dispatched',
      message: 'The next batch was registered with the Cloudflare execution context.',
      metadata: { processed_count: processedCount, total_queries: totalQueries },
      completed_at: new Date().toISOString()
    });
    return NextResponse.json({ ok: true, status: 'running', processed: processedCount, total: totalQueries });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown worker error';
    await markRunFailed(supabase, run_id, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function loadRunContext(supabase: ReturnType<typeof supabaseAdmin>, runId: string) {
  const { data: run } = await supabase
    .from('geo_runs')
    .select('*, clients(*)')
    .eq('id', runId)
    .single();

  if (!run) return { response: NextResponse.json({ error: 'run not found' }, { status: 404 }) };

  const client = Array.isArray(run.clients) ? run.clients[0] : run.clients;
  if (!client) return { response: NextResponse.json({ error: 'client not found' }, { status: 404 }) };

  const { data: existingAnswers } = await supabase
    .from('geo_answers')
    .select('query_id')
    .eq('run_id', runId)
    .not('query_id', 'is', null);
  const completedQueryIds = new Set((existingAnswers || []).map((answer) => answer.query_id).filter(Boolean));

  const { data: queries } = await supabase
    .from('geo_queries')
    .select('*')
    .eq('client_id', client.id)
    .eq('agency_id', run.agency_id)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(Number(run.total_queries || 20));

  return { run, client, queries: queries || [], completedQueryIds };
}

async function processOneQuerySafely({
  supabase,
  run,
  client,
  query
}: {
  supabase: ReturnType<typeof supabaseAdmin>;
  run: any;
  client: any;
  query: any;
}) {
  const { data: existingAnswer } = await supabase
    .from('geo_answers')
    .select('id')
    .eq('run_id', run.id)
    .eq('query_id', query.id)
    .maybeSingle();

  if (existingAnswer) {
    await logRunStep(supabase, run, client, {
      step_type: 'query_skipped',
      status: 'skipped',
      title: 'Query already answered',
      query_id: query.id,
      message: query.query_text,
      completed_at: new Date().toISOString()
    });
    await syncProcessedCount(supabase, run.id);
    return;
  }

  try {
    await logRunStep(supabase, run, client, {
      step_type: 'query_started',
      status: 'running',
      title: 'Query processing started',
      query_id: query.id,
      message: query.query_text,
      metadata: { intent_type: query.intent_type, priority: query.priority },
      started_at: new Date().toISOString()
    });
    await processOneQuery({ supabase, run, client, query });
    await logRunStep(supabase, run, client, {
      step_type: 'query_completed',
      status: 'completed',
      title: 'Query answered and analyzed',
      query_id: query.id,
      message: query.query_text,
      completed_at: new Date().toISOString()
    });
  } catch (error) {
    const message = describeOpenAIError(error);
    await insertFallbackAnswer({ supabase, run, client, query, message });
    await logRunStep(supabase, run, client, {
      step_type: 'query_failed',
      status: 'failed',
      title: 'Query failed with fallback answer',
      query_id: query.id,
      message,
      metadata: { query_text: query.query_text },
      completed_at: new Date().toISOString()
    });
  } finally {
    await syncProcessedCount(supabase, run.id);
  }
}

async function processOneQuery({
  supabase,
  run,
  client,
  query
}: {
  supabase: ReturnType<typeof supabaseAdmin>;
  run: any;
  client: any;
  query: any;
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
Question: ${query.query_text}`,
    { timeoutMs: ANSWER_TIMEOUT_MS, maxTokens: 800 }
  );

  const analysis = await jsonCompletion<Analysis>(
    'Analyze the answer for GEO visibility. Return strict JSON only.',
    `Client brand: ${client.name}
Known competitors: ${knownCompetitors.join(', ')}
Question: ${query.query_text}
Answer:
${answer}

Return JSON exactly as:
{"brand_mentioned":true,"brand_position":1,"competitors_mentioned":["..."],"sentiment":"positive|neutral|negative|mixed","recommendation_status":"recommended|mentioned_only|not_mentioned|competitor_recommended","citations":[],"content_gap":"...","risk_notes":["..."]}`,
    { timeoutMs: ANALYSIS_TIMEOUT_MS, maxTokens: 700 }
  );

  const { error: answerError } = await supabase.from('geo_answers').insert({
    run_id: run.id,
    client_id: client.id,
    agency_id: run.agency_id,
    query_id: query.id,
    model_provider: 'openai',
    model_name: openAIModel(),
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
  });

  if (answerError) throw answerError;
}

async function insertFallbackAnswer({
  supabase,
  run,
  client,
  query,
  message
}: {
  supabase: ReturnType<typeof supabaseAdmin>;
  run: any;
  client: any;
  query: any;
  message: string;
}) {
  const { error } = await supabase.from('geo_answers').insert({
    run_id: run.id,
    client_id: client.id,
    agency_id: run.agency_id,
    query_id: query.id,
    model_provider: 'openai',
    model_name: openAIModel(),
    answer_text: `Worker could not complete this query. ${message}`,
    brand_mentioned: false,
    brand_position: null,
    competitors_mentioned: [],
    sentiment: 'neutral',
    recommendation_status: 'not_mentioned',
    citations: [],
    content_gap: `Worker error: ${message}`,
    risk_notes: [message]
  });

  if (error) throw error;

  await supabase
    .from('geo_runs')
    .update({ error_message: `Some questions failed and were recorded as neutral: ${message}` })
    .eq('id', run.id);
}

async function syncProcessedCount(supabase: ReturnType<typeof supabaseAdmin>, runId: string) {
  const { count } = await supabase
    .from('geo_answers')
    .select('id', { count: 'exact', head: true })
    .eq('run_id', runId);
  const processed = count || 0;
  await supabase
    .from('geo_runs')
    .update({ processed_queries: processed })
    .eq('id', runId);
  return processed;
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
  const insight = await buildInsight(client, savedAnswers);
  await logRunStep(supabase, run, client, {
    step_type: 'insight_generated',
    status: 'completed',
    title: 'Insight generated',
    message: 'Visibility score, summaries, and action plan were generated.',
    metadata: { visibility_score: visibilityScore, answers: savedAnswers.length },
    completed_at: new Date().toISOString()
  });

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

  await ensureContentTasks({ supabase, run, client, insight, savedAnswers });
  await logRunStep(supabase, run, client, {
    step_type: 'content_tasks_ready',
    status: 'completed',
    title: 'Content tasks ready',
    message: 'Content tasks were checked or created for this run.',
    completed_at: new Date().toISOString()
  });

  await supabase
    .from('geo_runs')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      processed_queries: Math.max(savedAnswers.length, Number(run.total_queries || 0))
    })
    .eq('id', run.id);
}

async function logRunStep(
  supabase: ReturnType<typeof supabaseAdmin>,
  run: any,
  client: any,
  step: RunStepInput
) {
  try {
    const { error } = await supabase.from('geo_run_steps').insert({
      agency_id: run.agency_id,
      client_id: client.id,
      run_id: run.id,
      query_id: step.query_id || null,
      step_type: step.step_type,
      status: step.status || 'completed',
      title: step.title,
      message: step.message || null,
      metadata: step.metadata || {},
      started_at: step.started_at || null,
      completed_at: step.completed_at || (step.status === 'completed' ? new Date().toISOString() : null)
    });
    if (error) console.warn('[geo_run_steps:insert_failed]', { run_id: run.id, step_type: step.step_type, error: error.message });
  } catch (error) {
    console.warn('[geo_run_steps:insert_error]', { run_id: run.id, step_type: step.step_type, error: error instanceof Error ? error.message : 'Unknown step insert error' });
  }
}

async function buildInsight(client: any, savedAnswers: SavedAnswer[]): Promise<InsightResult> {
  try {
    return await jsonCompletion<InsightResult>(
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
}))).slice(0, 12000)}

Create concise JSON:
{"executive_summary":"...","competitor_summary":[{"name":"...","mentions":3,"notes":"..."}],"sentiment_summary":{"positive":0,"neutral":0,"negative":0,"mixed":0,"notes":"..."},"content_gaps":["..."],"action_plan":["..."],"risk_notes":["..."],"content_tasks":[{"title":"...","content_type":"faq|comparison_page|blog|landing_page|third_party_review|reddit_quora_answer|ad_creative_angle","target_query":"...","priority":1,"brief":"..."}]}`,
      { timeoutMs: INSIGHT_TIMEOUT_MS, maxTokens: 2500 }
    );
  } catch (error) {
    const gaps = savedAnswers.map((answer) => answer.content_gap).filter(Boolean).slice(0, 8) as string[];
    return {
      executive_summary: 'The run completed with automated fallback reporting because the insight generation request failed.',
      competitor_summary: summarizeCompetitors(savedAnswers),
      sentiment_summary: summarizeSentiment(savedAnswers),
      content_gaps: gaps.length ? gaps : ['Create clearer category, trust, comparison, and risk-disclosure content for AI answer coverage.'],
      action_plan: ['Publish trust and safety FAQ content.', 'Create competitor comparison pages.', 'Add clearer fee, withdrawal, and risk disclosure pages.'],
      risk_notes: [`Insight generation fallback: ${describeOpenAIError(error)}`],
      content_tasks: buildFallbackTasks(savedAnswers)
    };
  }
}

async function ensureContentTasks({
  supabase,
  run,
  client,
  insight,
  savedAnswers
}: {
  supabase: ReturnType<typeof supabaseAdmin>;
  run: any;
  client: any;
  insight: InsightResult;
  savedAnswers: SavedAnswer[];
}) {
  const { data: existingTasks } = await supabase
    .from('content_tasks')
    .select('id')
    .eq('run_id', run.id)
    .limit(1);

  if (existingTasks?.length) return;

  const sourceTasks = insight.content_tasks?.length ? insight.content_tasks : buildFallbackTasks(savedAnswers);
  const tasks = sourceTasks.slice(0, 20).map((task) => ({
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

function summarizeCompetitors(savedAnswers: SavedAnswer[]) {
  const counts: Record<string, number> = {};
  savedAnswers.forEach((answer) => answer.competitors_mentioned.forEach((name) => { counts[name] = (counts[name] || 0) + 1; }));
  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, mentions]) => ({ name, mentions, notes: 'Mentioned by AI answers during this run.' }));
}

function summarizeSentiment(savedAnswers: SavedAnswer[]) {
  return savedAnswers.reduce<Record<string, number>>((summary, answer) => {
    summary[answer.sentiment] = (summary[answer.sentiment] || 0) + 1;
    return summary;
  }, { positive: 0, neutral: 0, negative: 0, mixed: 0 });
}

function buildFallbackTasks(savedAnswers: SavedAnswer[]) {
  const targetQuery = savedAnswers.find((answer) => answer.content_gap)?.query_id || null;
  return [
    {
      title: 'Build a trust and safety FAQ',
      content_type: 'faq',
      target_query: targetQuery || '',
      priority: 1,
      brief: 'Answer common AI-search trust questions with clear compliance-safe language.'
    },
    {
      title: 'Publish a competitor comparison page',
      content_type: 'comparison_page',
      target_query: targetQuery || '',
      priority: 2,
      brief: 'Compare the brand against top competitors using factual, non-misleading claims.'
    },
    {
      title: 'Create a fees, withdrawal, and risk guide',
      content_type: 'blog',
      target_query: targetQuery || '',
      priority: 2,
      brief: 'Clarify fees, withdrawal expectations, security practices, and risk disclosures.'
    }
  ];
}

async function markRunFailed(supabase: ReturnType<typeof supabaseAdmin>, runId: string, message: string) {
  await supabase
    .from('geo_runs')
    .update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      error_message: message
    })
    .eq('id', runId);
}
