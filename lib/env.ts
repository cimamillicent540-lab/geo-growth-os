import { getCloudflareContext } from '@opennextjs/cloudflare';

type AppEnv = {
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  APP_BASE_URL?: string;
  GEO_ADMIN_EMAILS?: string;
  INTERNAL_WORKER_SECRET?: string;
  WORKER_SECRET?: string;
  ASSETS?: unknown;
};

function cloudflareEnv(): AppEnv {
  try {
    return (getCloudflareContext().env || {}) as AppEnv;
  } catch {
    return {};
  }
}

export function getEnv(name: keyof AppEnv) {
  const value = cloudflareEnv()[name];
  if (typeof value === 'string') return value;
  return process.env[name] || '';
}

export function envSnapshot() {
  return {
    hasSupabaseUrl: Boolean(getEnv('NEXT_PUBLIC_SUPABASE_URL')),
    hasAnonKey: Boolean(getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY')),
    hasServiceRoleKey: Boolean(getEnv('SUPABASE_SERVICE_ROLE_KEY')),
    hasOpenAIKey: Boolean(getEnv('OPENAI_API_KEY')),
    hasAppBaseUrl: Boolean(getEnv('APP_BASE_URL')),
    hasInternalWorkerSecret: Boolean(getEnv('INTERNAL_WORKER_SECRET') || getEnv('WORKER_SECRET')),
    runtime: cloudflareEnv().ASSETS ? 'cloudflare' : 'node'
  };
}

export function requireEnv(names: Array<keyof AppEnv>, label: string) {
  const missing = names.filter((name) => !getEnv(name));
  if (missing.length) {
    throw new Error(`Missing ${label} env vars: ${missing.join(', ')}`);
  }
}
