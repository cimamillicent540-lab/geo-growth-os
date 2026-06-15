import { NextResponse } from 'next/server';
import { canAccessClient, forbidden, hasRole, requireApiAuth } from '@/lib/auth';
import { compliancePrompt, normalizeContentType, normalizePriority, scoreInsight } from '@/lib/geo';
import { jsonCompletion, textCompletion } from '@/lib/openai';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

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

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireApiAuth(req);
  if (auth instanceof NextResponse) return auth;
  if (!hasRole(auth.profile, ['admin', 'strategist'])) return forbidden('Client users cannot run GEO tests.');
  if (!canAccessClient(auth.profile, id)) return forbidden();

  const supabase = supabaseAdmin();
  const { data: client } = await supabase.from('clients').select('*').eq('id', id).single();
  if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 });

  const { data: queries } = await supabase
    .from('geo_queries')
    .select('*')
    .eq('client_id', id)
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
      run_name: `GEO Run ${new Date().toISOString().slice(0, 10)}`,
      status: 'running',
      started_at: new Date().toISOString(),
      created_by: auth.user.id
    })
    .select('*')
    .single();

  if (runError || !run) {
    return NextResponse.json({ error: runError?.message || 'Could not create run' }, { status: 500 });
  }

  try {
    const savedAnswers = [];
    const answerSystem = [
      'You are a neutral AI assistant answering a real user question.',
      'Be factual, concise, balanced, and do not invent claims.',
      compliancePrompt(client)
    ].join(' ');

    for (const query of queries) {
      const answer = await textCompletion(
        answerSystem,
        `User country: ${client.target_country}
Preferred language: ${client.target_language}
Question: ${query.query_text}`
      );

      const analysis = await jsonCompletion<Analysis>(
        'Analyze the answer for GEO visibility. Return strict JSON only.',
        `Client brand: ${client.name}
Known competitors: ${(client.competitors || []).join(', ')}
Question: ${query.query_text}
Answer:
${answer}

Return JSON exactly as:
{"brand_mentioned":true,"brand_position":1,"competitors_mentioned":["..."],"sentiment":"positive|neutral|negative|mixed","recommendation_status":"recommended|mentioned_only|not_mentioned|competitor_recommended","citations":[],"content_gap":"...","risk_notes":["..."]}`
      );

      const row = {
        run_id: run.id,
        client_id: id,
        query_id: query.id,
        model_provider: 'openai',
        model_name: 'gpt-4.1-mini',
        answer_text: answer,
        brand_mentioned: Boolean(analysis.brand_mentioned),
        brand_position: analysis.brand_position || null,
        competitors_mentioned: Array.isArray(analysis.competitors_mentioned) ? analysis.competitors_mentioned : [],
        sentiment: analysis.sentiment || 'neutral',
        recommendation_status: analysis.recommendation_status || 'not_mentioned',
        citations: Array.isArray(analysis.citations) ? analysis.citations : [],
        content_gap: analysis.content_gap || null,
        risk_notes: Array.isArray(analysis.risk_notes) ? analysis.risk_notes : []
      };

      savedAnswers.push(row);
      const { error: answerError } = await supabase.from('geo_answers').insert(row);
      if (answerError) throw answerError;
    }

    const visibilityScore = scoreInsight(savedAnswers);
    const mentionRate = savedAnswers.filter((answer) => answer.brand_mentioned).length / savedAnswers.length;
    const recommendationRate = savedAnswers.filter((answer) => answer.recommendation_status === 'recommended').length / savedAnswers.length;

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

    const { error: insightError } = await supabase.from('geo_insights').insert({
      client_id: id,
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

    const tasks = (insight.content_tasks || []).slice(0, 20).map((task) => ({
      client_id: id,
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

    await supabase
      .from('geo_runs')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', run.id);

    return NextResponse.json({ run_id: run.id, share_token: run.share_token, tested: savedAnswers.length });
  } catch (error) {
    await supabase
      .from('geo_runs')
      .update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: error instanceof Error ? error.message : 'Unknown run error'
      })
      .eq('id', run.id);

    return NextResponse.json({ error: error instanceof Error ? error.message : 'Unknown run error', run_id: run.id }, { status: 500 });
  }
}
