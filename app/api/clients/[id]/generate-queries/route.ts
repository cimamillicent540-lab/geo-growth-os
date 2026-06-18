import { NextResponse } from 'next/server';
import { forbidden, hasAgencyOperatorAccess, hasRole, requireApiAuth, requireClientInAgency } from '@/lib/auth';
import { getEnv } from '@/lib/env';
import { compliancePrompt, normalizeIntent, normalizePriority } from '@/lib/geo';
import { describeOpenAIError, jsonCompletion, openAIModel } from '@/lib/openai';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import type { Client } from '@/lib/types';

type GeneratedQuery = {
  query_text?: string;
  intent_type?: string;
  funnel_stage?: string;
  priority?: number;
};

type QueryRow = {
  client_id: string;
  agency_id: string;
  query_text: string;
  language: string;
  country: string;
  intent_type: string;
  funnel_stage: string;
  priority: number;
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  const { id } = await params;

  try {
    const auth = await requireApiAuth(req);
    if (auth instanceof NextResponse) return auth;
    if (!hasRole(auth.profile, ['admin', 'strategist'])) return forbidden('Client users cannot generate GEO queries.');

    if (!getEnv('OPENAI_API_KEY')) {
      return fail(requestId, 'env', 'Missing OPENAI_API_KEY on the server.', 500);
    }

    const supabase = supabaseAdmin();
    const clientResult = await requireClientInAgency(auth, id);
    if (clientResult.error) return clientResult.error;
    const client = clientResult.client;

    if (!client.agency_id) {
      return fail(requestId, 'agency', 'Client is missing agency_id. Re-save the client or rerun the multitenant migration.', 500);
    }

    if (!hasAgencyOperatorAccess(auth, client.agency_id)) {
      return forbidden('You are not a member of this client agency.');
    }

    console.info('[generate-queries:start]', {
      requestId,
      clientId: id,
      agencyId: client.agency_id,
      userId: auth.user.id,
      model: openAIModel()
    });

    const industry = String(client.industry || '').toLowerCase();
    const gamblingTerms = industry.includes('casino') || industry.includes('bet')
      ? 'Must include bonus, no deposit, fast withdrawal, crypto casino, sports betting, safety, legality, and responsible gambling.'
      : '';
    const exchangeTerms = industry.includes('exchange') || industry.includes('crypto') || industry.includes('trading')
      ? 'Must include copy trading, crypto exchange, AI trading, fees, withdrawal, security, leverage risk, and beginner guide.'
      : '';

    const system = [
      'You generate GEO and AI-search question libraries for commercial client visibility testing.',
      'Return strict JSON only. No markdown.',
      compliancePrompt(client)
    ].join(' ');

    const user = `Generate 40 realistic questions users may ask ChatGPT or AI search assistants.

Client profile:
Name: ${client.name}
Website: ${client.website}
Industry: ${client.industry}
Target country: ${client.target_country}
Target language: ${client.target_language}
Description: ${client.description || ''}
Main products: ${client.main_products || ''}
Competitors: ${(client.competitors || []).join(', ')}
Compliance notes: ${client.compliance_notes || ''}

Coverage requirements:
- brand queries
- category queries
- competitor queries
- trust and safety queries
- conversion queries
- comparison queries
- localized questions
- risk and legality questions
- fees, withdrawal, security, beginner questions where relevant
${gamblingTerms}
${exchangeTerms}

Return JSON exactly as:
{"queries":[{"query_text":"...","intent_type":"brand|category|competitor|trust|conversion|comparison","funnel_stage":"awareness|consideration|decision|retention","priority":1}]}`;

    let result: { queries?: GeneratedQuery[]; questions?: GeneratedQuery[] };
    let source: 'openai' | 'fallback' = 'openai';
    let openaiWarning: string | null = null;
    try {
      result = await jsonCompletion<{ queries?: GeneratedQuery[]; questions?: GeneratedQuery[] }>(system, user, {
        maxTokens: 4500,
        timeoutMs: 15000
      });
    } catch (error) {
      source = 'fallback';
      openaiWarning = describeOpenAIError(error);
      console.warn('[generate-queries:openai-fallback]', {
        requestId,
        clientId: id,
        agencyId: client.agency_id,
        error: openaiWarning
      });
      result = buildFallbackQueries(client);
    }

    const generated = normalizeGeneratedQueries(result);
    let rows = generated
      .slice(0, 120)
      .map((query): QueryRow => ({
        client_id: id,
        agency_id: client.agency_id,
        query_text: String(query.query_text || '').trim(),
        language: client.target_language,
        country: client.target_country,
        intent_type: normalizeIntent(query.intent_type),
        funnel_stage: String(query.funnel_stage || 'consideration').toLowerCase(),
        priority: normalizePriority(query.priority)
      }))
      .filter((query) => query.query_text.length > 8);

    if (!rows.length) {
      source = 'fallback';
      openaiWarning = 'OpenAI returned JSON but no usable queries were found.';
      rows = normalizeGeneratedQueries(buildFallbackQueries(client))
        .map((query): QueryRow => ({
          client_id: id,
          agency_id: client.agency_id,
          query_text: String(query.query_text || '').trim(),
          language: client.target_language,
          country: client.target_country,
          intent_type: normalizeIntent(query.intent_type),
          funnel_stage: String(query.funnel_stage || 'consideration').toLowerCase(),
          priority: normalizePriority(query.priority)
        }))
        .filter((query) => query.query_text.length > 8);
    }

    if (!rows.length) {
      return fail(requestId, 'generation', 'No usable queries could be generated.', 502, {
        keys: Object.keys(result || {})
      });
    }

    const { error: deleteError } = await supabase
      .from('geo_queries')
      .delete()
      .eq('client_id', id)
      .eq('agency_id', client.agency_id);

    if (deleteError) {
      return fail(requestId, 'supabase_delete', `Supabase delete failed: ${deleteError.message}`, 500, {
        code: deleteError.code,
        details: deleteError.details
      });
    }

    const { error: insertError } = await supabase.from('geo_queries').insert(rows);
    if (insertError) {
      return fail(requestId, 'supabase_insert', `Supabase insert failed: ${insertError.message}`, 500, {
        code: insertError.code,
        details: insertError.details,
        hint: insertError.hint
      });
    }

    console.info('[generate-queries:success]', {
      requestId,
      clientId: id,
      agencyId: client.agency_id,
      inserted: rows.length,
      source,
      openaiWarning
    });

    return NextResponse.json({
      inserted: rows.length,
      source,
      warning: openaiWarning,
      request_id: requestId
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown generate queries error';
    return fail(requestId, 'unexpected', message, 500);
  }
}

function normalizeGeneratedQueries(result: { queries?: GeneratedQuery[]; questions?: GeneratedQuery[] } | GeneratedQuery[]) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result.queries)) return result.queries;
  if (Array.isArray(result.questions)) return result.questions;
  return [];
}

function buildFallbackQueries(client: Client): { queries: GeneratedQuery[] } {
  const brand = client.name;
  const country = client.target_country || 'my country';
  const language = client.target_language || 'English';
  const competitors = (client.competitors || []).filter(Boolean).slice(0, 6);
  const industry = `${client.industry} ${client.description || ''}`.toLowerCase();
  const isTrading = industry.includes('crypto') || industry.includes('exchange') || industry.includes('trading');
  const isGambling = industry.includes('casino') || industry.includes('bet');

  const base: GeneratedQuery[] = [
    q(`What is ${brand}?`, 'brand', 'awareness', 5),
    q(`Is ${brand} available in ${country}?`, 'brand', 'consideration', 5),
    q(`Is ${brand} safe to use?`, 'trust', 'consideration', 5),
    q(`Is ${brand} legit or a scam?`, 'trust', 'consideration', 5),
    q(`What are the main pros and cons of ${brand}?`, 'brand', 'consideration', 4),
    q(`How does ${brand} compare with leading competitors?`, 'comparison', 'decision', 5),
    q(`What fees does ${brand} charge?`, 'conversion', 'decision', 4),
    q(`How fast are withdrawals on ${brand}?`, 'conversion', 'decision', 4),
    q(`What should beginners know before using ${brand}?`, 'trust', 'consideration', 4),
    q(`What are the best alternatives to ${brand} in ${country}?`, 'competitor', 'consideration', 4),
    q(`Which platform is best for beginners in ${country}?`, 'category', 'awareness', 4),
    q(`What should users check before choosing a platform like ${brand}?`, 'trust', 'consideration', 4),
    q(`Does ${brand} have good customer support?`, 'trust', 'decision', 3),
    q(`What payment or deposit methods does ${brand} support?`, 'conversion', 'decision', 3),
    q(`What are common user complaints about ${brand}?`, 'trust', 'decision', 3),
    q(`Can ${brand} be used on mobile?`, 'conversion', 'decision', 2)
  ];

  const trading: GeneratedQuery[] = isTrading ? [
    q(`Is ${brand} a good crypto exchange for beginners in ${country}?`, 'category', 'consideration', 5),
    q(`Does ${brand} support copy trading?`, 'brand', 'consideration', 5),
    q(`How does AI copy trading work on ${brand}?`, 'brand', 'consideration', 5),
    q(`What are the risks of copy trading on ${brand}?`, 'trust', 'decision', 5),
    q(`Does ${brand} offer AI trading signals?`, 'brand', 'consideration', 4),
    q(`How secure is ${brand} for crypto trading?`, 'trust', 'decision', 5),
    q(`What are the trading fees on ${brand}?`, 'conversion', 'decision', 5),
    q(`How does ${brand} handle crypto withdrawals?`, 'conversion', 'decision', 4),
    q(`Does ${brand} support leverage trading and what are the risks?`, 'trust', 'decision', 5),
    q(`What is the best crypto exchange for copy trading in ${country}?`, 'category', 'awareness', 5),
    q(`Which crypto exchange has the lowest fees in ${country}?`, 'category', 'consideration', 4),
    q(`What is the safest crypto exchange for beginners?`, 'category', 'consideration', 4),
    q(`Can beginners use ${brand} without prior trading experience?`, 'conversion', 'decision', 4),
    q(`What should users know about trading risk before using ${brand}?`, 'trust', 'decision', 5)
  ] : [];

  const gambling: GeneratedQuery[] = isGambling ? [
    q(`Is ${brand} a safe online casino in ${country}?`, 'trust', 'consideration', 5),
    q(`Does ${brand} offer no deposit bonus promotions?`, 'conversion', 'decision', 4),
    q(`How fast are withdrawals from ${brand} casino?`, 'conversion', 'decision', 4),
    q(`Is ${brand} legal for users in ${country}?`, 'trust', 'decision', 5),
    q(`Does ${brand} support responsible gambling tools?`, 'trust', 'decision', 5),
    q(`What are the best crypto casinos in ${country}?`, 'category', 'awareness', 4),
    q(`How does ${brand} compare with sports betting sites?`, 'comparison', 'consideration', 4)
  ] : [];

  const competitorQueries = competitors.flatMap((competitor) => [
    q(`${brand} vs ${competitor}: which is better?`, 'comparison', 'decision', 5),
    q(`Is ${brand} safer than ${competitor}?`, 'comparison', 'decision', 4),
    q(`Why choose ${brand} instead of ${competitor}?`, 'competitor', 'decision', 4)
  ]);

  const localized = [
    q(`What do ${language}-speaking users in ${country} say about ${brand}?`, 'trust', 'consideration', 3),
    q(`Is ${brand} suitable for users in ${country}?`, 'brand', 'consideration', 4),
    q(`What local rules should ${country} users know before using ${brand}?`, 'trust', 'decision', 5)
  ];

  return {
    queries: dedupeQueries([...base, ...trading, ...gambling, ...competitorQueries, ...localized]).slice(0, 60)
  };
}

function q(query_text: string, intent_type: string, funnel_stage: string, priority: number): GeneratedQuery {
  return { query_text, intent_type, funnel_stage, priority };
}

function dedupeQueries(queries: GeneratedQuery[]) {
  const seen = new Set<string>();
  return queries.filter((query) => {
    const key = String(query.query_text || '').toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function fail(requestId: string, stage: string, message: string, status: number, details?: Record<string, unknown>) {
  console.error('[generate-queries:error]', {
    requestId,
    stage,
    message,
    details
  });

  return NextResponse.json(
    {
      error: message,
      stage,
      request_id: requestId,
      details
    },
    { status }
  );
}
