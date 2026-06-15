import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabaseAdmin';
import type { UserProfile, UserRole } from '@/lib/types';

export type AuthContext = {
  user: {
    id: string;
    email?: string;
  };
  profile: UserProfile;
};

export function adminEmails() {
  return (process.env.GEO_ADMIN_EMAILS || '')
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

  return {
    user: {
      id: user.id,
      email: user.email || undefined
    },
    profile
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
