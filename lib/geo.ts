import type { Client } from '@/lib/types';

export const QUERY_INTENTS = ['brand', 'category', 'competitor', 'trust', 'conversion', 'comparison'] as const;
export const CONTENT_TYPES = ['faq', 'comparison_page', 'blog', 'landing_page', 'third_party_review', 'reddit_quora_answer', 'ad_creative_angle'] as const;

export function compliancePrompt(client: Pick<Client, 'industry' | 'compliance_notes'>) {
  const industry = client.industry.toLowerCase();
  const base = [
    'Keep all outputs factual, compliance-safe, and suitable for B2B marketing operations.',
    'Do not invent regulatory approvals, payouts, guarantees, ranking claims, or customer outcomes.'
  ];

  if (industry.includes('casino') || industry.includes('bet')) {
    base.push(
      'Gambling guardrails: never target minors, never promise winnings, never frame gambling as income, never invent bonuses, never mislead withdrawal speed, include local legality and responsible gambling considerations.'
    );
  }

  if (industry.includes('crypto') || industry.includes('exchange') || industry.includes('fintech') || industry.includes('trading')) {
    base.push(
      'Trading and financial guardrails: never promise returns, never say risk-free or guaranteed profit, never downplay leverage risk, never mislead withdrawal, security, or regulatory information, include trading risk considerations.'
    );
  }

  if (client.compliance_notes) {
    base.push(`Client-specific compliance notes: ${client.compliance_notes}`);
  }

  return base.join(' ');
}

export function normalizeIntent(value: unknown) {
  const text = String(value || '').toLowerCase();
  return QUERY_INTENTS.includes(text as (typeof QUERY_INTENTS)[number]) ? text : 'category';
}

export function normalizePriority(value: unknown) {
  const priority = Number(value || 3);
  if (Number.isNaN(priority)) return 3;
  return Math.min(5, Math.max(1, Math.round(priority)));
}

export function normalizeContentType(value: unknown) {
  const text = String(value || '').toLowerCase();
  if (CONTENT_TYPES.includes(text as (typeof CONTENT_TYPES)[number])) return text;
  if (text === 'comparison') return 'comparison_page';
  if (text === 'review_brief') return 'third_party_review';
  if (text === 'social_answer') return 'reddit_quora_answer';
  if (text === 'ad_angle') return 'ad_creative_angle';
  return 'blog';
}

export function scoreInsight(answers: Array<{
  brand_mentioned: boolean;
  brand_position: number | null;
  competitors_mentioned: string[];
  sentiment: string;
  recommendation_status: string;
  citations: unknown[];
}>) {
  const total = Math.max(answers.length, 1);
  const mentioned = answers.filter((answer) => answer.brand_mentioned).length;
  const recommended = answers.filter((answer) => answer.recommendation_status === 'recommended').length;
  const positionValues = answers
    .map((answer) => answer.brand_position)
    .filter((position): position is number => typeof position === 'number' && position > 0);
  const avgPosition = positionValues.length
    ? positionValues.reduce((sum, position) => sum + position, 0) / positionValues.length
    : 10;
  const positive = answers.filter((answer) => answer.sentiment === 'positive').length;
  const mixed = answers.filter((answer) => answer.sentiment === 'mixed').length;
  const negative = answers.filter((answer) => answer.sentiment === 'negative').length;
  const citationCoverage = answers.filter((answer) => (answer.citations || []).length > 0).length / total;
  const competitorPressure = answers.filter((answer) => (answer.competitors_mentioned || []).length > 0 && !answer.brand_mentioned).length / total;

  const mentionScore = (mentioned / total) * 30;
  const recommendationScore = (recommended / total) * 25;
  const positionScore = mentioned ? Math.max(0, 15 - (avgPosition - 1) * 2.5) : 0;
  const sentimentScore = Math.max(0, ((positive + mixed * 0.5 - negative * 0.75) / total) * 10);
  const citationScore = citationCoverage * 10;
  const competitorScore = Math.max(0, 10 - competitorPressure * 10);

  return Math.round(Math.max(0, Math.min(100, mentionScore + recommendationScore + positionScore + sentimentScore + citationScore + competitorScore)));
}
