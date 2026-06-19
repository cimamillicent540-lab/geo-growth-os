'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { AuthGate } from '@/app/components/AuthGate';
import { supabaseBrowser, supabaseConfigured } from '@/lib/supabaseBrowser';
import type { Client, ContentTask, GeoAnswer, GeoInsight, GeoQuery, GeoRun, GeoRunStep, UserProfile } from '@/lib/types';

type LoadState<T> = {
  loading: boolean;
  data: T;
  error: string | null;
};

type ClientForm = {
  name: string;
  website: string;
  industry: string;
  target_country: string;
  target_language: string;
  description: string;
  main_products: string;
  competitors: string;
  compliance_notes: string;
};

const emptyClientForm: ClientForm = {
  name: '',
  website: '',
  industry: 'online casino',
  target_country: 'United States',
  target_language: 'English',
  description: '',
  main_products: '',
  competitors: '',
  compliance_notes: ''
};

function useSupabase() {
  return useMemo(() => supabaseBrowser(), []);
}

async function getToken(supabase: ReturnType<typeof supabaseBrowser>) {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || '';
}

async function getCurrentAgencyId(supabase: ReturnType<typeof supabaseBrowser>) {
  const { data } = await supabase
    .from('agency_members')
    .select('agency_id')
    .limit(1)
    .maybeSingle();
  return data?.agency_id as string | undefined;
}

function percent(value?: number | null) {
  return `${Math.round(Number(value || 0) * 100)}%`;
}

function jsonList(value: unknown) {
  return Array.isArray(value) ? value.map(String) : [];
}

function formatDateTime(value?: string | null) {
  return value ? new Date(value).toLocaleString() : '-';
}

async function parseActionResponse(response: Response) {
  const text = await response.text();
  if (!text) return {} as Record<string, string>;
  try {
    return JSON.parse(text) as Record<string, string>;
  } catch {
    return { error: cleanResponseText(text) || `HTTP ${response.status}` };
  }
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    window.clearTimeout(timeout);
  }
}

function cleanResponseText(text: string) {
  return text
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400);
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="card">
      <div className="muted">{label}</div>
      <div className="kpi">{value}</div>
    </div>
  );
}

function RoleNotice({ profile }: { profile: UserProfile | null }) {
  if (!profile) return null;
  return <span className="pill">{profile.role}</span>;
}

export function DashboardPage() {
  const supabase = useSupabase();
  const [state, setState] = useState<LoadState<{
    profile: UserProfile | null;
    clients: Client[];
    runs: GeoRun[];
    insights: GeoInsight[];
    tasks: ContentTask[];
  }>>({ loading: true, data: { profile: null, clients: [], runs: [], insights: [], tasks: [] }, error: null });

  useEffect(() => {
    async function load() {
      if (!supabaseConfigured()) {
        setState((current) => ({ ...current, loading: false }));
        return;
      }
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id || '';
      const [{ data: profile }, { data: clients, error: clientsError }, { data: runs }, { data: insights }, { data: tasks }] = await Promise.all([
        supabase.from('user_profiles').select('*').eq('user_id', userId).maybeSingle(),
        supabase.from('clients').select('*').order('created_at', { ascending: false }),
        supabase.from('geo_runs').select('*').order('created_at', { ascending: false }).limit(10),
        supabase.from('geo_insights').select('*').order('created_at', { ascending: false }).limit(30),
        supabase.from('content_tasks').select('*').order('created_at', { ascending: false }).limit(10)
      ]);

      setState({
        loading: false,
        data: {
          profile: (profile as UserProfile | null) || null,
          clients: (clients as Client[]) || [],
          runs: (runs as GeoRun[]) || [],
          insights: (insights as GeoInsight[]) || [],
          tasks: (tasks as ContentTask[]) || []
        },
        error: clientsError?.message || null
      });
    }

    load();
  }, [supabase]);

  if (state.loading) return <div className="empty">Loading dashboard...</div>;
  if (state.error) return <div className="empty dangerText">{state.error}</div>;

  const avgScore = state.data.insights.length
    ? Math.round(state.data.insights.reduce((sum, insight) => sum + Number(insight.visibility_score || 0), 0) / state.data.insights.length)
    : 0;
  const riskClients = state.data.insights.filter((insight) => Number(insight.visibility_score || 0) < 50).length;

  return (
    <AuthGate>
      <div className="hero">
        <div>
          <h1>AI Visibility Dashboard</h1>
          <p className="muted">Monitor GEO visibility, competitor pressure, sentiment risk, and execution tasks.</p>
        </div>
        <div className="actions">
          <RoleNotice profile={state.data.profile} />
          {state.data.profile?.role === 'admin' && <Link className="btn primary" href="/clients/new">Create Client</Link>}
        </div>
      </div>

      <div className="grid section">
        <Stat label="Total Clients" value={state.data.clients.length} />
        <Stat label="Recent GEO Runs" value={state.data.runs.length} />
        <Stat label="Avg AI Visibility Score" value={avgScore} />
        <Stat label="Risk Clients" value={riskClients} />
      </div>

      <div className="row section">
        <div>
          <h2>Recent GEO Runs</h2>
          <table className="table">
            <thead><tr><th>Run</th><th>Status</th><th>Started</th><th></th></tr></thead>
            <tbody>{state.data.runs.map((run) => (
              <tr key={run.id}>
                <td>{run.run_name}</td>
                <td><span className="pill">{run.status}</span></td>
                <td>{run.started_at ? new Date(run.started_at).toLocaleString() : '-'}</td>
                <td><Link className="btn small" href={`/clients/${run.client_id}/runs/${run.id}`}>Open</Link></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <div>
          <h2>Recent Content Tasks</h2>
          <table className="table">
            <thead><tr><th>Task</th><th>Status</th><th>Priority</th></tr></thead>
            <tbody>{state.data.tasks.map((task) => (
              <tr key={task.id}>
                <td>{task.title}</td>
                <td>{task.status}</td>
                <td>{task.priority}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </AuthGate>
  );
}

type RunWithClient = GeoRun & {
  clients?: Pick<Client, 'id' | 'name' | 'website' | 'industry'> | null;
  geo_insights?: Pick<GeoInsight, 'visibility_score' | 'mention_rate' | 'recommendation_rate'>[] | null;
};

export function RunListPage() {
  const supabase = useSupabase();
  const [runs, setRuns] = useState<RunWithClient[]>([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken(supabase);
      if (!token) throw new Error('Missing login session. Please sign in again.');
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      const response = await fetch(`/api/geo/runs${params.size ? `?${params}` : ''}`, {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store'
      });
      const result = await parseActionResponse(response) as { runs?: RunWithClient[]; error?: string };
      if (!response.ok) throw new Error(result.error || 'Could not load runs.');
      setRuns(result.runs || []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load runs.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [status]);

  return (
    <AuthGate>
      <div className="hero">
        <div>
          <h1>GEO Runs</h1>
          <p className="muted">Track run status, progress, and generated insights across client workspaces.</p>
        </div>
        <div className="filters">
          <select className="input compact" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="">All statuses</option>
            <option value="pending">Pending</option>
            <option value="running">Running</option>
            <option value="completed">Completed</option>
            <option value="failed">Failed</option>
          </select>
          <button className="btn" onClick={load}>Refresh</button>
        </div>
      </div>

      {loading && <div className="empty section">Loading runs...</div>}
      {error && <div className="empty dangerText section">{error}</div>}

      <table className="table section">
        <thead><tr><th>Run</th><th>Client</th><th>Status</th><th>Progress</th><th>Score</th><th>Started</th><th></th></tr></thead>
        <tbody>{runs.map((run) => {
          const progress = run.total_queries ? Math.round((Number(run.processed_queries || 0) / Number(run.total_queries || 1)) * 100) : 0;
          const insight = run.geo_insights?.[0];
          return (
            <tr key={run.id}>
              <td>{run.run_name}</td>
              <td>{run.clients?.name || run.client_id}</td>
              <td><span className={`pill ${run.status === 'completed' ? 'ok' : run.status === 'failed' ? 'danger' : ''}`}>{run.status}</span></td>
              <td>
                <div className="bar"><i style={{ width: `${progress}%` }} /></div>
                <p className="muted tableNote">{run.processed_queries} / {run.total_queries}</p>
              </td>
              <td>{insight ? Math.round(Number(insight.visibility_score || 0)) : '-'}</td>
              <td>{formatDateTime(run.started_at || run.created_at)}</td>
              <td><Link className="btn small" href={`/clients/${run.client_id}/runs/${run.id}`}>Open</Link></td>
            </tr>
          );
        })}</tbody>
      </table>
    </AuthGate>
  );
}

export function ClientsPage() {
  const supabase = useSupabase();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!supabaseConfigured()) {
      setClients([]);
      return;
    }
    const { data: userData } = await supabase.auth.getUser();
    const { data: profileData } = await supabase.from('user_profiles').select('*').eq('user_id', userData.user?.id || '').maybeSingle();
    const { data, error: listError } = await supabase.from('clients').select('*').order('created_at', { ascending: false });
    setProfile((profileData as UserProfile | null) || null);
    setClients((data as Client[]) || []);
    setError(listError?.message || null);
  }

  useEffect(() => {
    load();
  }, []);

  async function deleteClient(client: Client) {
    if (!confirm(`Delete ${client.name}? This also deletes runs, answers, insights, and tasks.`)) return;
    const { error: deleteError } = await supabase.from('clients').delete().eq('id', client.id);
    if (deleteError) setError(deleteError.message);
    await load();
  }

  return (
    <AuthGate>
      <div className="hero">
        <div>
          <h1>Clients</h1>
          <p className="muted">Client role users only see their assigned project through RLS.</p>
        </div>
        {profile?.role === 'admin' && <Link className="btn primary" href="/clients/new">Create Client</Link>}
      </div>
      {error && <p className="dangerText">{error}</p>}
      <table className="table section">
        <thead><tr><th>Name</th><th>Industry</th><th>Market</th><th>Website</th><th></th></tr></thead>
        <tbody>{clients.map((client) => (
          <tr key={client.id}>
            <td><strong>{client.name}</strong></td>
            <td>{client.industry}</td>
            <td>{client.target_country} / {client.target_language}</td>
            <td><a href={client.website} target="_blank">{client.website}</a></td>
            <td className="actions">
              <Link className="btn small" href={`/clients/${client.id}`}>Open</Link>
              {profile?.role === 'admin' && <button className="btn small danger" onClick={() => deleteClient(client)}>Delete</button>}
            </td>
          </tr>
        ))}</tbody>
      </table>
    </AuthGate>
  );
}

export function ClientFormPage({ clientId }: { clientId?: string }) {
  const router = useRouter();
  const supabase = useSupabase();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [agencyId, setAgencyId] = useState<string | null>(null);
  const [form, setForm] = useState<ClientForm>(emptyClientForm);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      if (!supabaseConfigured()) {
        setProfile(null);
        return;
      }
      const { data: userData } = await supabase.auth.getUser();
      const { data: profileData } = await supabase.from('user_profiles').select('*').eq('user_id', userData.user?.id || '').maybeSingle();
      const currentAgencyId = await getCurrentAgencyId(supabase);
      setProfile((profileData as UserProfile | null) || null);
      setAgencyId(currentAgencyId || null);
      if (clientId) {
        const { data } = await supabase.from('clients').select('*').eq('id', clientId).single();
        const client = data as Client | null;
        if (client) {
          setAgencyId(client.agency_id);
          setForm({
            name: client.name,
            website: client.website,
            industry: client.industry,
            target_country: client.target_country,
            target_language: client.target_language,
            description: client.description || '',
            main_products: client.main_products || '',
            competitors: (client.competitors || []).join(', '),
            compliance_notes: client.compliance_notes || ''
          });
        }
      }
    }

    load();
  }, [clientId, supabase]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    const payload = {
      ...form,
      ...(agencyId ? { agency_id: agencyId } : {}),
      competitors: form.competitors.split(',').map((item) => item.trim()).filter(Boolean)
    };
    const result = clientId
      ? await supabase.from('clients').update(payload).eq('id', clientId).select('id').single()
      : await supabase.from('clients').insert(payload).select('id').single();
    if (result.error) {
      setError(result.error.message);
      return;
    }
    router.push(`/clients/${result.data.id}`);
  }

  return (
    <AuthGate>
      <div className="hero">
        <div>
          <h1>{clientId ? 'Edit Client' : 'Create Client'}</h1>
          <p className="muted">Admin-only client setup for GEO monitoring and client-ready reporting.</p>
        </div>
      </div>
      {profile?.role !== 'admin' ? (
        <div className="empty">Only admins can create or edit clients.</div>
      ) : (
        <form className="form card" onSubmit={submit}>
          {error && <p className="dangerText">{error}</p>}
          {!agencyId && <p className="dangerText">No agency membership found. Ask an owner to add this user to an agency.</p>}
          <div className="row">
            <label>Client Name<input className="input" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required /></label>
            <label>Website<input className="input" value={form.website} onChange={(event) => setForm({ ...form, website: event.target.value })} required /></label>
          </div>
          <div className="row">
            <label>Industry<input className="input" value={form.industry} onChange={(event) => setForm({ ...form, industry: event.target.value })} placeholder="online casino, crypto exchange, ecommerce, SaaS" required /></label>
            <label>Target Country<input className="input" value={form.target_country} onChange={(event) => setForm({ ...form, target_country: event.target.value })} required /></label>
          </div>
          <div className="row">
            <label>Target Language<input className="input" value={form.target_language} onChange={(event) => setForm({ ...form, target_language: event.target.value })} required /></label>
            <label>Main Competitors<input className="input" value={form.competitors} onChange={(event) => setForm({ ...form, competitors: event.target.value })} placeholder="Stake, Bet365, Binance" /></label>
          </div>
          <label>Product Description<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
          <label>Core Selling Points<textarea value={form.main_products} onChange={(event) => setForm({ ...form, main_products: event.target.value })} /></label>
          <label>Compliance Notes<textarea value={form.compliance_notes} onChange={(event) => setForm({ ...form, compliance_notes: event.target.value })} placeholder="No minors, no guaranteed winnings, local laws, risk disclosure..." /></label>
          <button className="btn primary" type="submit" disabled={!agencyId}>{clientId ? 'Save Changes' : 'Create Client'}</button>
        </form>
      )}
    </AuthGate>
  );
}

export function ClientDetailPage({ clientId }: { clientId: string }) {
  const supabase = useSupabase();
  const [state, setState] = useState<LoadState<{
    profile: UserProfile | null;
    client: Client | null;
    runs: GeoRun[];
    latestInsight: GeoInsight | null;
    tasks: ContentTask[];
    queryCount: number;
  }>>({ loading: true, data: { profile: null, client: null, runs: [], latestInsight: null, tasks: [], queryCount: 0 }, error: null });
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionNotice, setActionNotice] = useState<string | null>(null);

  async function load() {
    if (!supabaseConfigured()) {
      setState((current) => ({ ...current, loading: false }));
      return;
    }
    const { data: userData } = await supabase.auth.getUser();
    const [{ data: profile }, { data: client, error }, { data: runs }, { data: insights }, { data: tasks }, { count }] = await Promise.all([
      supabase.from('user_profiles').select('*').eq('user_id', userData.user?.id || '').maybeSingle(),
      supabase.from('clients').select('*').eq('id', clientId).single(),
      supabase.from('geo_runs').select('*').eq('client_id', clientId).order('created_at', { ascending: false }).limit(8),
      supabase.from('geo_insights').select('*').eq('client_id', clientId).order('created_at', { ascending: false }).limit(1),
      supabase.from('content_tasks').select('*').eq('client_id', clientId).order('created_at', { ascending: false }).limit(8),
      supabase.from('geo_queries').select('id', { count: 'exact', head: true }).eq('client_id', clientId)
    ]);
    setState({
      loading: false,
      data: {
        profile: (profile as UserProfile | null) || null,
        client: (client as Client | null) || null,
        runs: (runs as GeoRun[]) || [],
        latestInsight: ((insights as GeoInsight[] | null) || [])[0] || null,
        tasks: (tasks as ContentTask[]) || [],
        queryCount: count || 0
      },
      error: error?.message || null
    });
  }

  useEffect(() => {
    load();
  }, [clientId]);

  useEffect(() => {
    if (busy === 'generate' && state.data.queryCount > 0) {
      setBusy(null);
      setActionNotice(`Query library is ready with ${state.data.queryCount} questions.`);
    }
  }, [busy, state.data.queryCount]);

  async function runAction(kind: 'generate' | 'run') {
    setBusy(kind);
    setActionError(null);
    setActionNotice(null);
    try {
      const token = await getToken(supabase);
      if (!token) throw new Error('Missing login session. Please sign in again.');

      const endpoint = kind === 'generate'
        ? `/api/clients/${clientId}/generate-queries`
        : `/api/clients/${clientId}/run-geo-test`;
      const response = await fetchWithTimeout(endpoint, { method: 'POST', headers: { authorization: `Bearer ${token}` } }, kind === 'generate' ? 25000 : 45000);
      const result = await parseActionResponse(response);

      if (!response.ok) {
        const stage = result.stage ? ` [${result.stage}]` : '';
        const requestId = result.request_id ? ` Request ID: ${result.request_id}` : '';
        throw new Error(`${result.error || 'Action failed'}${stage}.${requestId}`);
      }
      if (kind === 'run') {
        location.href = `/clients/${clientId}/runs/${result.run_id}`;
        return;
      }
      setBusy(null);
      setActionNotice(result.source === 'fallback'
        ? `Generated ${result.inserted || 'the'} queries with fallback templates because OpenAI was slow or unavailable.`
        : `Generated ${result.inserted || 'the'} GEO queries.`);
      await load();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError' && kind === 'generate') {
        setActionNotice('Generation request timed out in the browser, but the server may have already inserted queries. Refreshing the count now.');
        await load();
        return;
      }
      setActionError(error instanceof Error ? error.message : 'Action failed');
    } finally {
      setBusy(null);
    }
  }

  if (state.loading) return <div className="empty">Loading client...</div>;
  if (state.error || !state.data.client) return <div className="empty dangerText">{state.error || 'Client not found'}</div>;

  const { client, latestInsight, profile } = state.data;
  const canOperate = profile?.role === 'admin' || profile?.role === 'strategist';
  const latestCompletedRun = state.data.runs.find((run) => run.status === 'completed');

  return (
    <AuthGate>
      <div className="hero">
        <div>
          <h1>{client.name}</h1>
          <p className="muted">{client.industry} | {client.target_country} | {client.target_language} | {client.website}</p>
          <p className="muted">MVP runs test up to 20 questions per run. Queue support can expand this to 100-300 questions later.</p>
        </div>
        <div className="actions">
          {profile?.role === 'admin' && <Link className="btn" href={`/clients/${clientId}/edit`}>Edit</Link>}
          {canOperate && <button className="btn" disabled={busy !== null} onClick={() => runAction('generate')}>{busy === 'generate' ? 'Generating...' : 'Generate GEO Queries'}</button>}
          {canOperate && <button className="btn primary" disabled={busy !== null} onClick={() => runAction('run')}>{busy === 'run' ? 'Running...' : 'Run GEO Test'}</button>}
          {latestCompletedRun && <Link className="btn" href={`/clients/${clientId}/reports/${latestCompletedRun.id}`}>View Latest Report</Link>}
        </div>
      </div>

      {actionNotice && <div className="empty section">{actionNotice}</div>}
      {actionError && <div className="empty dangerText section">{actionError}</div>}

      <div className="grid section">
        <Stat label="AI Visibility Score" value={Math.round(Number(latestInsight?.visibility_score || 0))} />
        <Stat label="Mention Rate" value={percent(Number(latestInsight?.mention_rate || 0))} />
        <Stat label="Recommendation Rate" value={percent(Number(latestInsight?.recommendation_rate || 0))} />
        <Stat label="GEO Queries" value={state.data.queryCount} />
      </div>

      <div className="card section">
        <h2>Client Brief</h2>
        <p>{client.description || 'No description yet.'}</p>
        <p><strong>Core selling points:</strong> {client.main_products || '-'}</p>
        <p><strong>Competitors:</strong> {(client.competitors || []).join(', ') || '-'}</p>
        <p><strong>Compliance:</strong> {client.compliance_notes || '-'}</p>
      </div>

      <div className="section actions">
        <Link className="btn" href={`/clients/${clientId}/queries`}>Open Query Library</Link>
        <Link className="btn" href={`/clients/${clientId}/content-tasks`}>Open Content Tasks</Link>
      </div>

      <h2 className="section">Recent GEO Runs</h2>
      <table className="table">
        <thead><tr><th>Run</th><th>Status</th><th>Started</th><th>Completed</th><th></th></tr></thead>
        <tbody>{state.data.runs.map((run) => (
          <tr key={run.id}>
            <td>{run.run_name}</td>
            <td><span className="pill">{run.status}</span></td>
            <td>{run.started_at ? new Date(run.started_at).toLocaleString() : '-'}</td>
            <td>{run.completed_at ? new Date(run.completed_at).toLocaleString() : '-'}</td>
            <td><Link className="btn small" href={`/clients/${clientId}/runs/${run.id}`}>Open</Link></td>
          </tr>
        ))}</tbody>
      </table>

      <h2 className="section">Recent Content Tasks</h2>
      <table className="table">
        <thead><tr><th>Title</th><th>Type</th><th>Status</th><th>Priority</th></tr></thead>
        <tbody>{state.data.tasks.map((task) => (
          <tr key={task.id}><td>{task.title}</td><td>{task.content_type}</td><td>{task.status}</td><td>{task.priority}</td></tr>
        ))}</tbody>
      </table>
    </AuthGate>
  );
}

export function QueriesPage({ clientId }: { clientId: string }) {
  const supabase = useSupabase();
  const [queries, setQueries] = useState<GeoQuery[]>([]);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [intent, setIntent] = useState('');
  const [priority, setPriority] = useState('');
  const [newQuery, setNewQuery] = useState('');

  async function load() {
    if (!supabaseConfigured()) return;
    const { data: userData } = await supabase.auth.getUser();
    const { data: profileData } = await supabase.from('user_profiles').select('*').eq('user_id', userData.user?.id || '').maybeSingle();
    let request = supabase.from('geo_queries').select('*').eq('client_id', clientId).order('priority', { ascending: false });
    if (intent) request = request.eq('intent_type', intent);
    if (priority) request = request.eq('priority', Number(priority));
    const { data } = await request;
    setProfile((profileData as UserProfile | null) || null);
    setQueries((data as GeoQuery[]) || []);
  }

  useEffect(() => {
    load();
  }, [clientId, intent, priority]);

  async function addQuery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const { data: client } = await supabase.from('clients').select('*').eq('id', clientId).single();
    await supabase.from('geo_queries').insert({
      client_id: clientId,
      agency_id: client?.agency_id,
      query_text: newQuery,
      language: client?.target_language || 'English',
      country: client?.target_country || 'Global',
      intent_type: 'category',
      funnel_stage: 'consideration',
      priority: 3
    });
    setNewQuery('');
    await load();
  }

  async function remove(id: string) {
    await supabase.from('geo_queries').delete().eq('id', id);
    await load();
  }

  return (
    <AuthGate>
      <div className="hero">
        <div>
          <h1>GEO Query Library</h1>
          <p className="muted">Filter, add, delete, or batch-generate AI search questions.</p>
        </div>
        <Link className="btn" href={`/clients/${clientId}`}>Back to Client</Link>
      </div>
      <div className="filters section">
        <select className="input" value={intent} onChange={(event) => setIntent(event.target.value)}>
          <option value="">All intents</option>
          {['brand', 'category', 'competitor', 'trust', 'conversion', 'comparison'].map((item) => <option key={item}>{item}</option>)}
        </select>
        <select className="input" value={priority} onChange={(event) => setPriority(event.target.value)}>
          <option value="">All priorities</option>
          {[1, 2, 3, 4, 5].map((item) => <option key={item}>{item}</option>)}
        </select>
      </div>
      {(profile?.role === 'admin' || profile?.role === 'strategist') && (
        <form className="form card section" onSubmit={addQuery}>
          <label>Manual Query<input className="input" value={newQuery} onChange={(event) => setNewQuery(event.target.value)} required /></label>
          <button className="btn primary" type="submit">Add Query</button>
        </form>
      )}
      <table className="table section">
        <thead><tr><th>Query</th><th>Intent</th><th>Stage</th><th>Priority</th><th></th></tr></thead>
        <tbody>{queries.map((query) => (
          <tr key={query.id}>
            <td>{query.query_text}</td>
            <td>{query.intent_type}</td>
            <td>{query.funnel_stage}</td>
            <td>{query.priority}</td>
            <td>{(profile?.role === 'admin' || profile?.role === 'strategist') && <button className="btn small danger" onClick={() => remove(query.id)}>Delete</button>}</td>
          </tr>
        ))}</tbody>
      </table>
    </AuthGate>
  );
}

export function RunResultPage({ clientId, runId }: { clientId: string; runId: string }) {
  const supabase = useSupabase();
  const [data, setData] = useState<{
    run: GeoRun | null;
    insight: GeoInsight | null;
    answers: Array<GeoAnswer & { geo_queries?: GeoQuery }>;
    steps: Array<GeoRunStep & { geo_queries?: Pick<GeoQuery, 'query_text' | 'intent_type' | 'priority'> }>;
  }>({ run: null, insight: null, answers: [], steps: [] });
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [resumeBusy, setResumeBusy] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    async function loadSteps() {
      const token = await getToken(supabase);
      if (!token || stop) return;
      const response = await fetch(`/api/geo/runs/${runId}/steps`, {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store'
      });
      if (!response.ok || stop) return;
      const result = await response.json() as { steps?: Array<GeoRunStep & { geo_queries?: Pick<GeoQuery, 'query_text' | 'intent_type' | 'priority'> }> };
      setData((current) => ({ ...current, steps: result.steps || [] }));
      setSelectedStepId((current) => current || result.steps?.[result.steps.length - 1]?.id || null);
    }
    async function load() {
      if (!supabaseConfigured()) {
        setData({ run: null, insight: null, answers: [], steps: [] });
        return;
      }
      const [{ data: run }, { data: insight }, { data: answers }] = await Promise.all([
        supabase.from('geo_runs').select('*').eq('id', runId).eq('client_id', clientId).single(),
        supabase.from('geo_insights').select('*').eq('run_id', runId).maybeSingle(),
        supabase.from('geo_answers').select('*, geo_queries(*)').eq('run_id', runId).order('created_at', { ascending: true })
      ]);
      setData((current) => ({
        ...current,
        run: (run as GeoRun | null) || null,
        insight: (insight as GeoInsight | null) || null,
        answers: (answers as Array<GeoAnswer & { geo_queries?: GeoQuery }>) || []
      }));
      await loadSteps();
    }
    load();
    const interval = setInterval(async () => {
      const token = await getToken(supabase);
      if (!token || stop) return;
      const response = await fetch(`/api/runs/${runId}/status`, {
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store'
      });
      if (!response.ok || stop) return;
      const nextRun = await response.json();
      setData((current) => ({ ...current, run: { ...(current.run || {}), ...nextRun } as GeoRun }));
      if (nextRun.status === 'completed') {
        clearInterval(interval);
        await load();
      } else {
        await loadSteps();
      }
    }, 2500);
    return () => {
      stop = true;
      clearInterval(interval);
    };
  }, [clientId, runId, supabase]);

  async function resumeRun() {
    setResumeBusy(true);
    setResumeError(null);
    try {
      const token = await getToken(supabase);
      if (!token) throw new Error('Missing login session. Please sign in again.');
      const response = await fetch(`/api/runs/${runId}/resume`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        cache: 'no-store'
      });
      const result = await parseActionResponse(response);
      if (!response.ok) throw new Error(result.error || 'Could not resume run.');
      setData((current) => ({
        ...current,
        run: current.run ? { ...current.run, status: 'running', error_message: null, is_stalled: false, can_resume: false } : current.run
      }));
    } catch (error) {
      setResumeError(error instanceof Error ? error.message : 'Could not resume run.');
    } finally {
      setResumeBusy(false);
    }
  }

  const competitorCounts: Record<string, number> = {};
  data.answers.forEach((answer) => answer.competitors_mentioned.forEach((name) => { competitorCounts[name] = (competitorCounts[name] || 0) + 1; }));
  const selectedStep = data.steps.find((step) => step.id === selectedStepId) || data.steps[data.steps.length - 1] || null;

  return (
    <AuthGate>
      <div className="hero">
        <div>
          <h1>{data.run?.run_name || 'GEO Run'}</h1>
          <p className="muted">Status: {data.run?.status || 'loading'} | Tested questions: {data.answers.length}</p>
        </div>
        <div className="actions">
          <Link className="btn" href={`/clients/${clientId}`}>Back to Client</Link>
          {data.run?.can_resume && <button className="btn" disabled={resumeBusy} onClick={resumeRun}>{resumeBusy ? 'Resuming...' : 'Resume Run'}</button>}
          {data.run?.status === 'completed' && <Link className="btn primary" href={`/clients/${clientId}/reports/${runId}`}>View Report</Link>}
        </div>
      </div>
      <div className="grid section">
        <Stat label="Visibility Score" value={Math.round(Number(data.insight?.visibility_score || 0))} />
        <Stat label="Mention Rate" value={percent(Number(data.insight?.mention_rate || 0))} />
        <Stat label="Recommendation Rate" value={percent(Number(data.insight?.recommendation_rate || 0))} />
      </div>
      <div className="row section">
        <div className="card">
          <h2>Run Timeline</h2>
          <div className="timeline">
            {data.steps.length ? data.steps.map((step) => (
              <button
                key={step.id}
                className={`timelineItem ${selectedStep?.id === step.id ? 'active' : ''}`}
                onClick={() => setSelectedStepId(step.id)}
              >
                <span className={`dot ${step.status}`} />
                <span>
                  <strong>{step.title}</strong>
                  <small>{step.status} | {formatDateTime(step.created_at)}</small>
                </span>
              </button>
            )) : <p className="muted">No run steps have been recorded yet. Apply the latest migration before running new tests.</p>}
          </div>
        </div>
        <div className="card">
          <h2>Step Viewer</h2>
          {selectedStep ? (
            <>
              <p><strong>{selectedStep.title}</strong></p>
              <p className="muted">{selectedStep.message || selectedStep.geo_queries?.query_text || 'No message recorded.'}</p>
              <div className="metaGrid">
                <p><span className="muted">Type</span><strong>{selectedStep.step_type}</strong></p>
                <p><span className="muted">Status</span><strong>{selectedStep.status}</strong></p>
              </div>
              <pre className="pre section">{JSON.stringify(selectedStep.metadata || {}, null, 2)}</pre>
            </>
          ) : <p className="muted">Select a timeline step to inspect metadata.</p>}
        </div>
      </div>
      <div className="card section">
        <h2>Insight Viewer</h2>
        {data.insight ? (
          <div className="row">
            <div>
              <p><strong>Executive Summary</strong></p>
              <p>{data.insight.executive_summary || 'No summary yet.'}</p>
              <p><strong>Content Gaps</strong></p>
              <ul>{jsonList(data.insight.content_gaps).map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
            <pre className="pre">{JSON.stringify({
              competitor_summary: data.insight.competitor_summary,
              sentiment_summary: data.insight.sentiment_summary,
              action_plan: data.insight.action_plan,
              risk_notes: data.insight.risk_notes
            }, null, 2)}</pre>
          </div>
        ) : <p className="muted">Insight will appear when the run completes.</p>}
      </div>
      {(data.run?.status === 'pending' || data.run?.status === 'running') && (
        <div className="card section">
          <h2>Run Progress</h2>
          <div className="bar">
            <i style={{ width: `${data.run.total_queries ? Math.round((data.run.processed_queries / data.run.total_queries) * 100) : 0}%` }} />
          </div>
          <p className="muted">{data.run.processed_queries} / {data.run.total_queries} questions processed. This page refreshes automatically.</p>
        </div>
      )}
      {data.run?.is_stalled && (
        <div className="empty dangerText section">
          Run appears stalled. Resume the worker to continue from the next unanswered question.
          <div className="section actions"><button className="btn primary" disabled={resumeBusy} onClick={resumeRun}>{resumeBusy ? 'Resuming...' : 'Resume Run'}</button></div>
        </div>
      )}
      {data.run?.status === 'failed' && (
        <div className="empty dangerText section">
          {data.run.error_message || 'Run failed.'}
          {data.run.can_resume && <div className="section actions"><button className="btn primary" disabled={resumeBusy} onClick={resumeRun}>{resumeBusy ? 'Retrying...' : 'Retry Run'}</button></div>}
        </div>
      )}
      {resumeError && <div className="empty dangerText section">{resumeError}</div>}
      <div className="card section">
        <h2>Competitor Mentions</h2>
        <p>{Object.entries(competitorCounts).sort((a, b) => b[1] - a[1]).map(([name, count]) => `${name}: ${count}`).join(' | ') || 'No competitor pressure detected yet.'}</p>
      </div>
      <table className="table section">
        <thead><tr><th>Query</th><th>Brand</th><th>Recommendation</th><th>Sentiment</th><th>Content Gap</th><th>Answer</th></tr></thead>
        <tbody>{data.answers.map((answer) => (
          <tr key={answer.id}>
            <td>{answer.geo_queries?.query_text}</td>
            <td>{answer.brand_mentioned ? 'Mentioned' : 'Not mentioned'}</td>
            <td>{answer.recommendation_status}</td>
            <td>{answer.sentiment}</td>
            <td>{answer.content_gap}</td>
            <td>{answer.answer_text.slice(0, 600)}</td>
          </tr>
        ))}</tbody>
      </table>
    </AuthGate>
  );
}

export function ReportPageClient({ clientId, runId }: { clientId: string; runId: string }) {
  const supabase = useSupabase();
  const [data, setData] = useState<{
    client: Client | null;
    run: GeoRun | null;
    insight: GeoInsight | null;
    answers: Array<GeoAnswer & { geo_queries?: GeoQuery }>;
    tasks: ContentTask[];
    profile: UserProfile | null;
  }>({ client: null, run: null, insight: null, answers: [], tasks: [], profile: null });

  useEffect(() => {
    async function load() {
      if (!supabaseConfigured()) {
        setData({ client: null, run: null, insight: null, answers: [], tasks: [], profile: null });
        return;
      }
      const { data: userData } = await supabase.auth.getUser();
      const [{ data: profile }, { data: client }, { data: run }, { data: insight }, { data: answers }, { data: tasks }] = await Promise.all([
        supabase.from('user_profiles').select('*').eq('user_id', userData.user?.id || '').maybeSingle(),
        supabase.from('clients').select('*').eq('id', clientId).single(),
        supabase.from('geo_runs').select('*').eq('id', runId).eq('client_id', clientId).single(),
        supabase.from('geo_insights').select('*').eq('run_id', runId).maybeSingle(),
        supabase.from('geo_answers').select('*, geo_queries(*)').eq('run_id', runId).limit(50),
        supabase.from('content_tasks').select('*').eq('run_id', runId).order('priority', { ascending: true })
      ]);
      setData({
        profile: (profile as UserProfile | null) || null,
        client: (client as Client | null) || null,
        run: (run as GeoRun | null) || null,
        insight: (insight as GeoInsight | null) || null,
        answers: (answers as Array<GeoAnswer & { geo_queries?: GeoQuery }>) || [],
        tasks: (tasks as ContentTask[]) || []
      });
    }
    load();
  }, [clientId, runId, supabase]);

  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  const shareUrl = data.run?.share_token && origin ? `${origin}/share/reports/${data.run.share_token}` : '';

  return (
    <AuthGate>
      <ReportView
        client={data.client}
        run={data.run}
        insight={data.insight}
        answers={data.answers}
        tasks={data.tasks}
        shareUrl={shareUrl}
        canViewDebug={data.profile?.role === 'admin' || data.profile?.role === 'strategist'}
      />
    </AuthGate>
  );
}

type CompetitorReportItem = {
  name: string;
  mentions: number;
  notes: string;
};

function stringifyReportValue(value: unknown) {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value && typeof value === 'object') return JSON.stringify(value);
  return '';
}

function normalizeCompetitorSummary(insight: GeoInsight, answers: Array<GeoAnswer & { geo_queries?: GeoQuery }>) {
  const raw = Array.isArray(insight.competitor_summary) ? insight.competitor_summary : [];
  const fromInsight = raw
    .map((item): CompetitorReportItem | null => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const name = stringifyReportValue(record.name || record.competitor || record.brand).trim();
      if (!name) return null;
      return {
        name,
        mentions: Number(record.mentions || record.count || 0),
        notes: stringifyReportValue(record.notes || record.summary || 'Mentioned in AI answers.')
      };
    })
    .filter((item): item is CompetitorReportItem => Boolean(item));

  if (fromInsight.length) return fromInsight.sort((a, b) => b.mentions - a.mentions);

  const counts: Record<string, number> = {};
  answers.forEach((answer) => answer.competitors_mentioned.forEach((name) => { counts[name] = (counts[name] || 0) + 1; }));
  return Object.entries(counts)
    .map(([name, mentions]) => ({ name, mentions, notes: 'Mentioned in AI answers during this run.' }))
    .sort((a, b) => b.mentions - a.mentions);
}

function priorityGroup(priority: number) {
  if (priority <= 2) return 'High';
  if (priority === 3) return 'Medium';
  return 'Low';
}

function groupedRecommendations(tasks: ContentTask[], insight: GeoInsight) {
  const groups: Record<string, Array<{ title: string; brief: string; priority?: number }>> = { High: [], Medium: [], Low: [] };
  if (tasks.length) {
    tasks.forEach((task) => {
      groups[priorityGroup(Number(task.priority || 3))].push({
        title: task.title,
        brief: task.brief || task.target_query || '',
        priority: task.priority
      });
    });
    return groups;
  }

  jsonList(insight.action_plan).forEach((item) => groups.Medium.push({ title: item, brief: '' }));
  return groups;
}

function buildExecutiveSummaryMarkdown(client: Client, run: GeoRun, insight: GeoInsight) {
  return [
    `# ${client.name} GEO Report`,
    '',
    `Run: ${run.run_name}`,
    `Status: ${run.status}`,
    `AI Visibility Score: ${Math.round(Number(insight.visibility_score || 0))}`,
    `Mention Rate: ${percent(Number(insight.mention_rate || 0))}`,
    `Recommendation Rate: ${percent(Number(insight.recommendation_rate || 0))}`,
    '',
    '## Executive Summary',
    insight.executive_summary || 'No executive summary generated.'
  ].join('\n');
}

function buildFullReportMarkdown({
  client,
  run,
  insight,
  competitors,
  gaps,
  recommendations
}: {
  client: Client;
  run: GeoRun;
  insight: GeoInsight;
  competitors: CompetitorReportItem[];
  gaps: string[];
  recommendations: Record<string, Array<{ title: string; brief: string; priority?: number }>>;
}) {
  const lines = [
    buildExecutiveSummaryMarkdown(client, run, insight),
    '',
    '## Competitor Mentions',
    ...(competitors.length ? competitors.map((item) => `- ${item.name}: ${item.mentions} mentions. ${item.notes}`) : ['- No competitor mentions recorded.']),
    '',
    '## Content Gaps',
    ...(gaps.length ? gaps.map((gap) => `- ${gap}`) : ['- No content gaps recorded.']),
    '',
    '## Recommendations'
  ];

  Object.entries(recommendations).forEach(([group, items]) => {
    if (!items.length) return;
    lines.push('', `### ${group} Priority`, ...items.map((item) => `- ${item.title}${item.brief ? `: ${item.brief}` : ''}`));
  });

  return lines.join('\n');
}

export function ReportView({
  client,
  run,
  insight,
  answers,
  tasks,
  shareUrl,
  canViewDebug = false
}: {
  client: Client | null;
  run: GeoRun | null;
  insight: GeoInsight | null;
  answers: Array<GeoAnswer & { geo_queries?: GeoQuery }>;
  tasks: ContentTask[];
  shareUrl?: string;
  canViewDebug?: boolean;
}) {
  if (!client || !run) return <div className="empty">Report not ready.</div>;
  if (!insight) {
    return (
      <div className="report">
        <div className="hero reportHero">
          <div>
            <h1>{client.name} AI Visibility Report</h1>
            <p className="muted">{run.run_name} | Status: {run.status}</p>
          </div>
        </div>
        <div className="empty section">Insight is not ready yet. Open this report again after the run completes.</div>
      </div>
    );
  }

  const competitors = normalizeCompetitorSummary(insight, answers);
  const gaps = jsonList(insight.content_gaps);
  const recommendations = groupedRecommendations(tasks, insight);
  const summaryMarkdown = buildExecutiveSummaryMarkdown(client, run, insight);
  const fullMarkdown = buildFullReportMarkdown({ client, run, insight, competitors, gaps, recommendations });
  const runDate = run.completed_at || run.started_at || run.created_at;

  return (
    <div className="report">
      <div className="hero reportHero reportHeader">
        <div>
          <h1>{client.name} AI Visibility Report</h1>
          <p className="muted">{run.run_name} | {formatDateTime(runDate)} | {client.industry} | {client.target_country} | {client.target_language}</p>
          <div className="actions reportStatusLine">
            <span className={`pill ${run.status === 'completed' ? 'ok' : run.status === 'failed' ? 'danger' : ''}`}>{run.status}</span>
            <span className="pill">{answers.length} answers reviewed</span>
          </div>
        </div>
      </div>

      <div className="reportMetrics section">
        <div>
          <span className="muted">AI Visibility Score</span>
          <strong>{Math.round(Number(insight.visibility_score || 0))}</strong>
        </div>
        <div>
          <span className="muted">Mention Rate</span>
          <strong>{percent(Number(insight.mention_rate || 0))}</strong>
        </div>
        <div>
          <span className="muted">Recommendation Rate</span>
          <strong>{percent(Number(insight.recommendation_rate || 0))}</strong>
        </div>
      </div>

      <div className="actions noPrint section">
        <button className="btn" onClick={() => navigator.clipboard.writeText(summaryMarkdown)}>Copy Executive Summary</button>
        <button className="btn" onClick={() => navigator.clipboard.writeText(fullMarkdown)}>Copy Full Report</button>
        {shareUrl && (
          <>
          <button className="btn" onClick={() => navigator.clipboard.writeText(shareUrl)}>Copy Share Link</button>
          <a className="btn" href={shareUrl} target="_blank">Open Public Report</a>
          </>
        )}
        <button className="btn primary" onClick={() => window.print()}>Print / Save PDF</button>
      </div>

      <section className="reportSection section">
        <h2>Executive Summary</h2>
        <div className="summaryCard">
          <p>{insight.executive_summary || 'No executive summary generated yet.'}</p>
        </div>
      </section>

      <section className="reportSection section">
        <h2>Competitor Mentions</h2>
        <div className="reportCards">
          {competitors.length ? competitors.map((competitor) => (
            <div className="reportMiniCard" key={competitor.name}>
              <div className="miniCardTop">
                <strong>{competitor.name}</strong>
                <span className="pill">{competitor.mentions} mentions</span>
              </div>
              <p className="muted">{competitor.notes}</p>
            </div>
          )) : <div className="empty">No competitor mentions recorded in this run.</div>}
        </div>
      </section>

      <section className="reportSection section">
        <h2>Content Gaps</h2>
        {gaps.length ? (
          <ul className="reportList">{gaps.map((item) => <li key={item}>{item}</li>)}</ul>
        ) : (
          <div className="empty">No content gaps were generated for this report.</div>
        )}
      </section>

      <section className="reportSection section">
        <h2>Recommendations</h2>
        <div className="recommendationGroups">
          {Object.entries(recommendations).map(([group, items]) => (
            <div className="recommendationGroup" key={group}>
              <h3>{group} Priority</h3>
              {items.length ? items.map((item) => (
                <div className="recommendationItem" key={`${group}-${item.title}`}>
                  <strong>{item.title}</strong>
                  {item.brief && <p className="muted">{item.brief}</p>}
                </div>
              )) : <p className="muted">No {group.toLowerCase()} priority recommendations.</p>}
            </div>
          ))}
        </div>
      </section>

      <h2 className="section">Content Tasks</h2>
      <table className="table">
        <thead><tr><th>Task</th><th>Type</th><th>Target Query</th><th>Priority</th><th>Brief</th></tr></thead>
        <tbody>{tasks.length ? tasks.map((task) => <tr key={task.id}><td>{task.title}</td><td>{task.content_type}</td><td>{task.target_query || '-'}</td><td>{task.priority}</td><td>{task.brief || '-'}</td></tr>) : <tr><td colSpan={5}>No content tasks generated.</td></tr>}</tbody>
      </table>

      <h2 className="section">Example AI Answers</h2>
      <table className="table">
        <thead><tr><th>Question</th><th>Status</th><th>Sentiment</th><th>Answer</th></tr></thead>
        <tbody>{answers.length ? answers.slice(0, 12).map((answer) => (
          <tr key={answer.id}>
            <td>{answer.geo_queries?.query_text}</td>
            <td>{answer.recommendation_status}</td>
            <td>{answer.sentiment}</td>
            <td>{answer.answer_text.slice(0, 700)}</td>
          </tr>
        )) : <tr><td colSpan={4}>No AI answers are available yet.</td></tr>}</tbody>
      </table>

      {canViewDebug && (
        <details className="debugPanel noPrint section">
          <summary>Raw Data / Debug</summary>
          <pre className="pre">{JSON.stringify({
            run: { id: run.id, status: run.status, processed_queries: run.processed_queries, total_queries: run.total_queries },
            sentiment_summary: insight.sentiment_summary,
            competitor_summary: insight.competitor_summary,
            action_plan: insight.action_plan,
            risk_notes: insight.risk_notes
          }, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}

export function ContentTasksPage({ clientId }: { clientId: string }) {
  const supabase = useSupabase();
  const [tasks, setTasks] = useState<ContentTask[]>([]);
  const [status, setStatus] = useState('');
  const [priority, setPriority] = useState('');

  async function load() {
    if (!supabaseConfigured()) return;
    let request = supabase.from('content_tasks').select('*').eq('client_id', clientId).order('priority', { ascending: true });
    if (status) request = request.eq('status', status);
    if (priority) request = request.eq('priority', Number(priority));
    const { data } = await request;
    setTasks((data as ContentTask[]) || []);
  }

  useEffect(() => {
    load();
  }, [clientId, status, priority]);

  async function updateTask(id: string, patch: Partial<Pick<ContentTask, 'status' | 'brief' | 'assigned_to'>>) {
    await supabase.from('content_tasks').update(patch).eq('id', id);
    await load();
  }

  return (
    <AuthGate>
      <div className="hero">
        <div>
          <h1>Content Tasks</h1>
          <p className="muted">Execution backlog generated from GEO gaps and risk notes.</p>
        </div>
        <Link className="btn" href={`/clients/${clientId}`}>Back to Client</Link>
      </div>
      <div className="filters section">
        <select className="input" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="">All statuses</option>
          {['todo', 'in_progress', 'done', 'skipped'].map((item) => <option key={item}>{item}</option>)}
        </select>
        <select className="input" value={priority} onChange={(event) => setPriority(event.target.value)}>
          <option value="">All priorities</option>
          {[1, 2, 3, 4, 5].map((item) => <option key={item}>{item}</option>)}
        </select>
      </div>
      <table className="table section">
        <thead><tr><th>Task</th><th>Type</th><th>Status</th><th>Priority</th><th>Owner</th><th>Brief</th></tr></thead>
        <tbody>{tasks.map((task) => (
          <tr key={task.id}>
            <td><strong>{task.title}</strong><br /><span className="muted">{task.target_query}</span></td>
            <td>{task.content_type}</td>
            <td>
              <select className="input compact" value={task.status} onChange={(event) => updateTask(task.id, { status: event.target.value as ContentTask['status'] })}>
                {['todo', 'in_progress', 'done', 'skipped'].map((item) => <option key={item}>{item}</option>)}
              </select>
            </td>
            <td>{task.priority}</td>
            <td><input className="input compact" defaultValue={task.assigned_to || ''} onBlur={(event) => updateTask(task.id, { assigned_to: event.target.value })} /></td>
            <td><textarea className="compactArea" defaultValue={task.brief || ''} onBlur={(event) => updateTask(task.id, { brief: event.target.value })} /></td>
          </tr>
        ))}</tbody>
      </table>
    </AuthGate>
  );
}
