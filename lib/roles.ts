import { supabase } from './supabaseClient';

export type Role = {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  is_system: boolean;
};

export type ProfileLite = {
  id: string;
  email: string;
  full_name: string;
  status: string;
  branch_id: string | null;
};

export type UserRole = {
  user_id: string;
  role_id: string;
};

export async function fetchRoles(): Promise<Role[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('roles')
    .select('id, name, description, permissions, is_system')
    .order('name', { ascending: true });

  if (error || !data) return [];
  return (data as any[]).map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    permissions: Array.isArray(r.permissions) ? r.permissions.map(String) : [],
    is_system: Boolean(r.is_system),
  }));
}

export async function fetchProfiles(): Promise<ProfileLite[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email, full_name, status, branch_id')
    .order('created_at', { ascending: true });

  if (error || !data) return [];
  return data as ProfileLite[];
}

export async function fetchUserRoles(): Promise<UserRole[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from('user_roles')
    .select('user_id, role_id');

  if (error || !data) return [];
  return data as UserRole[];
}

export async function setUserRole(params: {
  tenantId: string;
  userId: string;
  roleId: string;
  enabled: boolean;
}): Promise<boolean> {
  if (!supabase) return false;
  const { tenantId, userId, roleId, enabled } = params;
  if (enabled) {
    const { error } = await supabase
      .from('user_roles')
      .insert({ tenant_id: tenantId, user_id: userId, role_id: roleId });
    return !error;
  }

  const { error } = await supabase
    .from('user_roles')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .eq('role_id', roleId);
  return !error;
}

export async function setUserBranch(params: {
  tenantId: string;
  userId: string;
  branchId: string | null;
}): Promise<boolean> {
  if (!supabase) return false;
  const { tenantId, userId, branchId } = params;
  const { error } = await supabase
    .from('profiles')
    .update({ branch_id: branchId })
    .eq('tenant_id', tenantId)
    .eq('id', userId);
  return !error;
}

export async function bootstrapSuperAdmin(): Promise<boolean> {
  if (!supabase) return false;
  const { error } = await supabase.rpc('bootstrap_super_admin');
  return !error;
}
