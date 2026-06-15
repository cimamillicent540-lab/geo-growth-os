import OpenAI from 'openai';

export function openaiClient() {
  if (!process.env.OPENAI_API_KEY) throw new Error('Missing OPENAI_API_KEY');
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
}

export async function jsonCompletion<T>(system: string, user: string): Promise<T> {
  const openai = openaiClient();
  const res = await openai.chat.completions.create({
    model: 'gpt-4.1-mini',
    temperature: 0.3,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ]
  });
  const content = res.choices[0]?.message?.content || '{}';
  try {
    return JSON.parse(content) as T;
  } catch {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start >= 0 && end > start) {
      return JSON.parse(content.slice(start, end + 1)) as T;
    }
    throw new Error('OpenAI did not return valid JSON');
  }
}

export async function textCompletion(system: string, user: string): Promise<string> {
  const openai = openaiClient();
  const res = await openai.chat.completions.create({
    model: 'gpt-4.1-mini',
    temperature: 0.2,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ]
  });
  return res.choices[0]?.message?.content || '';
}
