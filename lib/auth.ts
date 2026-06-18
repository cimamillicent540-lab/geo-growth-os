import { NextResponse } from 'next/server';
import { getEnv } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import type { UserProfile, UserRole } from '@/lib/types';

export type AuthContext = {
  user: {
    id: string;
    email?: string;
  };
  profile: UserProfile;
  agencyIds: string[];
  agencyRoleById: Record<string, 'owner' | 'admin' | 'member'>;
};

export function adminEmails() {
  return (getEnv('GEO_ADMIN_EMAILS') || '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email?: string) {
  return Boolean(email && adminEmails().includes(email.toLowerCase()));
}

export async function requireApiAuth(req: Request): Promise<AuthContext | NextResponse> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) {
    return NextResponse.json({ error: 'Missing authorization token' }, { status: 401 });
  }

  const supabase = supabaseAdmin();
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  const user = userData.user;
  if (userError || !user) {
    return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
  }

  const { data: existingProfile } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle();

  let profile = existingProfile as UserProfile | null;
  const shouldBootstrapAdmin = isAdminEmail(user.email || undefined);
  if (!profile && isAdminEmail(user.email || undefined)) {
    const { data: createdProfile, error: createError } = await supabase
      .from('user_profiles')
      .insert({
        user_id: user.id,
        full_name: user.user_metadata?.full_name || user.email || 'Admin',
        role: 'admin'
      })
      .select('*')
      .single();

    if (createError) {
      return NextResponse.json({ error: createError.message }, { status: 500 });
    }
    profile = createdProfile as UserProfile;
  }

  if (!profile) {
    return NextResponse.json({ error: 'No user profile has been assigned. Ask an admin to assign a role.' }, { status: 403 });
  }

  if (shouldBootstrapAdmin || profile.role === 'admin') {
    await ensureDefaultAgencyMembership(user.id);
  }

  let { data: memberships } = await supabase
    .from('agency_members')
    .select('agency_id, role')
    .eq('user_id', user.id);

  if (!memberships?.length && profile.role === 'admin') {
    await ensureDefaultAgencyMembership(user.id);
    const { data: refreshedMemberships } = await supabase
      .from('agency_members')
      .select('agency_id, role')
      .eq('user_id', user.id);
    memberships = refreshedMemberships;
  }

  const agencyRoleById: Record<string, 'owner' | 'admin' | 'member'> = {};
  for (const membership of memberships || []) {
    agencyRoleById[membership.agency_id] = membership.role;
  }

  return {
    user: {
      id: user.id,
      email: user.email || undefined
    },
    profile,
    agencyIds: Object.keys(agencyRoleById),
    agencyRoleById
  };
}

export function hasRole(profile: UserProfile, roles: UserRole[]) {
  return roles.includes(profile.role);
}

export function canAccessClient(profile: UserProfile, clientId: string) {
  return profile.role === 'admin' || profile.role === 'strategist' || profile.client_id === clientId;
}

export function forbidden(message = 'Forbidden') {
  return NextResponse.json({ error: message }, { status: 403 });
}

export async function ensureDefaultAgencyMembership(userId: string) {
  const supabase = supabaseAdmin();
  const { data: agency, error: agencyError } = await supabase
    .from('agencies')
    .upsert({ name: 'Default Agency', slug: 'default' }, { onConflict: 'slug' })
    .select('id')
    .single();

  if (agencyError || !agency) return null;

  await supabase
    .from('agency_members')
    .upsert({ agency_id: agency.id, user_id: userId, role: 'owner' }, { onConflict: 'agency_id,user_id' });

  return agency.id as string;
}

export async function requireClientInAgency(auth: AuthContext, clientId: string) {
  const supabase = supabaseAdmin();
  const { data: client, error } = await supabase
    .from('clients')
    .select('*')
    .eq('id', clientId)
    .single();

  if (error || !client) {
    return { error: NextResponse.json({ error: 'Client not found' }, { status: 404 }) };
  }

  if (!client.agency_id && auth.agencyIds[0] && hasRole(auth.profile, ['admin', 'strategist'])) {
    const { data: repairedClient } = await supabase
      .from('clients')
      .update({ agency_id: auth.agencyIds[0] })
      .eq('id', clientId)
      .select('*')
      .single();

    if (repairedClient) {
      return { client: repairedClient };
    }
  }

  if (!auth.agencyIds.includes(client.agency_id) && auth.profile.client_id !== clientId) {
    return { error: forbidden('Client is outside your agency.') };
  }

  return { client };
}

export function hasAgencyOperatorAccess(auth: AuthContext, agencyId: string) {
  const role = auth.agencyRoleById[agencyId];
  return role === 'owner' || role === 'admin' || role === 'member';
}
