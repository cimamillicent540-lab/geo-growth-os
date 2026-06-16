export function normalizeCompetitors(raw: string[] | undefined, known: string[]) {
  if (!raw?.length) return [];

  const canon = (value: string) =>
    value
      .toLowerCase()
      .replace(/\b(exchange|casino|inc|ltd|llc|limited|official|app|\.com)\b/g, '')
      .replace(/[^a-z0-9]/g, '')
      .trim();

  const knownMap = new Map(known.map((name) => [canon(name), name]));
  const out = new Set<string>();

  for (const item of raw) {
    const key = canon(item);
    if (!key) continue;
    out.add(knownMap.get(key) || item.trim());
  }

  return [...out];
}
