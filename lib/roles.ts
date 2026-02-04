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
  is_locked: boolean;
  locked_until: string | null;
  last_login_at: string | null;
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
    .select('id, email, full_name, status, branch_id, is_locked, locked_until, last_login_at')
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

// =====================================================
// USER MANAGEMENT FUNCTIONS
// =====================================================

export interface CreateUserData {
  email: string;
  password: string;
  full_name: string;
  phone?: string;
  branch_id?: string;
  role_ids?: string[];
}

export interface CreateUserResult {
  success: boolean;
  user_id?: string;
  email?: string;
  error?: string;
}

/**
 * Create new user via Edge Function (requires users.manage permission)
 */
export async function createUser(data: CreateUserData): Promise<CreateUserResult> {
  if (!supabase) {
    return { success: false, error: 'Supabase client not initialized' };
  }

  try {
    // Get current tenant ID
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData?.session?.user) {
      return { success: false, error: 'Not authenticated' };
    }

    // Get caller's tenant_id from profile
    const { data: profile } = await supabase
      .from('profiles')
      .select('tenant_id')
      .eq('id', sessionData.session.user.id)
      .single();

    if (!profile) {
      return { success: false, error: 'Profile not found' };
    }

    // Call Edge Function
    const { data: result, error } = await supabase.functions.invoke('admin-create-user', {
      body: {
        ...data,
        tenant_id: profile.tenant_id,
      },
    });

    if (error) {
      console.error('Edge function error:', error);
      return { success: false, error: error.message || 'Failed to create user' };
    }

    return result as CreateUserResult;
  } catch (err) {
    console.error('createUser error:', err);
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}

export interface UpdateUserProfileData {
  user_id: string;
  full_name: string;
  phone?: string;
  email?: string;
}

/**
 * Update user profile information (requires users.manage permission)
 */
export async function updateUserProfile(data: UpdateUserProfileData): Promise<boolean> {
  if (!supabase) return false;

  try {
    const { error } = await supabase.rpc('admin_update_user_profile', {
      p_user_id: data.user_id,
      p_full_name: data.full_name,
      p_phone: data.phone || null,
      p_email: data.email || null,
    });

    if (error) {
      console.error('updateUserProfile error:', error);
      throw new Error(error.message);
    }

    return true;
  } catch (err) {
    console.error('updateUserProfile error:', err);
    throw err;
  }
}

export interface DeactivateUserData {
  user_id: string;
  reason?: string;
}

/**
 * Deactivate user (soft delete) - prevents login (requires users.manage permission)
 */
export async function deactivateUser(data: DeactivateUserData): Promise<boolean> {
  if (!supabase) return false;

  try {
    const { error } = await supabase.rpc('deactivate_user', {
      p_user_id: data.user_id,
      p_reason: data.reason || null,
    });

    if (error) {
      console.error('deactivateUser error:', error);
      throw new Error(error.message);
    }

    return true;
  } catch (err) {
    console.error('deactivateUser error:', err);
    throw err;
  }
}

/**
 * Reactivate previously deactivated user (requires users.manage permission)
 */
export async function reactivateUser(userId: string): Promise<boolean> {
  if (!supabase) return false;

  try {
    const { error } = await supabase.rpc('reactivate_user', {
      p_user_id: userId,
    });

    if (error) {
      console.error('reactivateUser error:', error);
      throw new Error(error.message);
    }

    return true;
  } catch (err) {
    console.error('reactivateUser error:', err);
    throw err;
  }
}

/**
 * Update user branch assignment (requires users.manage permission)
 */
export async function updateUserBranch(userId: string, branchId: string | null): Promise<boolean> {
  if (!supabase) return false;

  try {
    const { error } = await supabase.rpc('admin_update_user_branch', {
      p_user_id: userId,
      p_branch_id: branchId,
    });

    if (error) {
      console.error('updateUserBranch error:', error);
      throw new Error(error.message);
    }

    return true;
  } catch (err) {
    console.error('updateUserBranch error:', err);
    throw err;
  }
}

/**
 * Assign roles to user (requires users.manage permission)
 */
export async function assignUserRoles(userId: string, roleIds: string[]): Promise<boolean> {
  if (!supabase) return false;

  try {
    const { error } = await supabase.rpc('admin_assign_user_roles', {
      p_user_id: userId,
      p_role_ids: roleIds,
    });

    if (error) {
      console.error('assignUserRoles error:', error);
      throw new Error(error.message);
    }

    return true;
  } catch (err) {
    console.error('assignUserRoles error:', err);
    throw err;
  }
}
