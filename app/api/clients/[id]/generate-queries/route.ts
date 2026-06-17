import { NextResponse } from 'next/server';
import { forbidden, hasAgencyOperatorAccess, hasRole, requireApiAuth, requireClientInAgency } from '@/lib/auth';
import { compliancePrompt, normalizeIntent, normalizePriority } from '@/lib/geo';
import { describeOpenAIError, jsonCompletion, OPENAI_MODEL } from '@/lib/openai';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

type GeneratedQuery = {
  query_text?: string;
  intent_type?: string;
  funnel_stage?: string;
  priority?: number;
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = crypto.randomUUID();
  const { id } = await params;

  try {
    const auth = await requireApiAuth(req);
    if (auth instanceof NextResponse) return auth;
    if (!hasRole(auth.profile, ['admin', 'strategist'])) return forbidden('Client users cannot generate GEO queries.');

    if (!process.env.OPENAI_API_KEY) {
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
      model: OPENAI_MODEL
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

    const user = `Generate 100 realistic questions users may ask ChatGPT or AI search assistants.

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
    try {
      result = await jsonCompletion<{ queries?: GeneratedQuery[]; questions?: GeneratedQuery[] }>(system, user);
    } catch (error) {
      return fail(requestId, 'openai', describeOpenAIError(error), 502);
    }

    const generated = normalizeGeneratedQueries(result);
    const rows = generated
      .slice(0, 120)
      .map((query) => ({
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
      return fail(requestId, 'openai', 'OpenAI returned JSON but no usable queries were found.', 502, {
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
      inserted: rows.length
    });

    return NextResponse.json({ inserted: rows.length, request_id: requestId });
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
