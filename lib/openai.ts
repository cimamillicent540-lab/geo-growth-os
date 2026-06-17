import OpenAI from 'openai';

export const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

export function openaiClient() {
  if (!process.env.OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY');
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

export class OpenAIJsonParseError extends Error {
  constructor(message: string, public readonly rawContent: string) {
    super(message);
    this.name = 'OpenAIJsonParseError';
  }
}

export function extractJsonObject(content: string) {
  const trimmed = content.trim();
  const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [
    trimmed,
    codeBlock?.[1]?.trim(),
    sliceBetween(trimmed, '{', '}')
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next extraction strategy.
    }
  }

  throw new OpenAIJsonParseError(
    `OpenAI returned text that could not be parsed as JSON. Preview: ${trimmed.slice(0, 240)}`,
    content
  );
}

function sliceBetween(content: string, open: string, close: string) {
  const start = content.indexOf(open);
  const end = content.lastIndexOf(close);
  return start >= 0 && end > start ? content.slice(start, end + 1) : '';
}

export function describeOpenAIError(error: unknown) {
  if (error instanceof OpenAIJsonParseError) return error.message;
  if (error instanceof Error) {
    const details = error as Error & { status?: number; code?: string; type?: string };
    const parts = [
      details.status ? `status ${details.status}` : '',
      details.code ? `code ${details.code}` : '',
      details.type ? `type ${details.type}` : '',
      details.message
    ].filter(Boolean);
    return parts.join(' | ');
  }
  return 'Unknown OpenAI error';
}

export async function jsonCompletion<T>(system: string, user: string): Promise<T> {
  const openai = openaiClient();
  const res = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0.3,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ]
  });
  const content = res.choices[0]?.message?.content || '{}';
  return extractJsonObject(content) as T;
}

export async function textCompletion(system: string, user: string): Promise<string> {
  const openai = openaiClient();
  const res = await openai.chat.completions.create({
    model: OPENAI_MODEL,
    temperature: 0.2,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ]
  });
  return res.choices[0]?.message?.content || '';
}
