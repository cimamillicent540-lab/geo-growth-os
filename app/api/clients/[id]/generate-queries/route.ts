import { NextResponse } from 'next/server';
import { forbidden, hasAgencyOperatorAccess, hasRole, requireApiAuth, requireClientInAgency } from '@/lib/auth';
import { compliancePrompt, normalizeIntent, normalizePriority } from '@/lib/geo';
import { jsonCompletion } from '@/lib/openai';
import { supabaseAdmin } from '@/lib/supabaseAdmin';

type GeneratedQuery = {
  query_text?: string;
  intent_type?: string;
  funnel_stage?: string;
  priority?: number;
};

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireApiAuth(req);
  if (auth instanceof NextResponse) return auth;
  if (!hasRole(auth.profile, ['admin', 'strategist'])) return forbidden('Client users cannot generate GEO queries.');

  const supabase = supabaseAdmin();
  const clientResult = await requireClientInAgency(auth, id);
  if (clientResult.error) return clientResult.error;
  const client = clientResult.client;
  if (!hasAgencyOperatorAccess(auth, client.agency_id)) return forbidden('You are not a member of this client agency.');

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

  const result = await jsonCompletion<{ queries?: GeneratedQuery[] }>(system, user);
  const rows = (result.queries || [])
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
    return NextResponse.json({ error: 'OpenAI returned no usable queries' }, { status: 502 });
  }

  await supabase.from('geo_queries').delete().eq('client_id', id);
  const { error: insertError } = await supabase.from('geo_queries').insert(rows);
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 });

  return NextResponse.json({ inserted: rows.length });
}
