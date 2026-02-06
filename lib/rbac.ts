import { supabase } from './supabaseClient';

export type PermissionPattern = string;

/**
 * Fetch permission patterns from JWT user_metadata (no DB query)
 *
 * Permissions are synced to auth.users.raw_user_meta_data via trigger
 * (see migration 069_permissions_in_jwt.sql). This approach:
 * - Bypasses RLS issues with get_my_permission_patterns() RPC
 * - Faster (reads from JWT, no DB round-trip)
 * - Works offline once JWT is loaded
 * - Auto-refreshes token if permissions missing (fixes Ctrl+F5 losing permissions)
 */
export async function fetchMyPermissionPatterns(): Promise<PermissionPattern[]> {
  if (!supabase) return [];

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return [];

  // Read from user.user_metadata.permissions (synced from DB via trigger)
  let permissions = session.user.user_metadata?.permissions;

  // If permissions missing or empty → force token refresh
  // This handles cases like:
  // - Ctrl+F5 hard refresh (browser clears cache but keeps old JWT)
  // - User assigned role before migration 069 ran
  // - JWT issued before trigger synced permissions
  if (!Array.isArray(permissions) || permissions.length === 0) {
    console.warn('[rbac] Permissions missing in JWT, forcing token refresh...');
    try {
      const { data: refreshData, error } = await supabase.auth.refreshSession();
      if (error) {
        console.error('[rbac] Token refresh failed:', error);
      } else if (refreshData.session) {
        permissions = refreshData.session.user.user_metadata?.permissions;
        console.log('[rbac] Token refreshed, permissions:', permissions);
      }
    } catch (e) {
      console.error('[rbac] Token refresh error:', e);
    }
  }

  if (Array.isArray(permissions) && permissions.length > 0) {
    return permissions as PermissionPattern[];
  }

  // Final fallback: empty array (user has no roles assigned)
  return [];
}

function matches(pattern: string, permission: string): boolean {
  if (pattern === '*') return true;
  // '*' wildcard matching
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${escaped.replace(/\*/g, '.*')}$`);
  return re.test(permission);
}

export function buildCan(patterns: PermissionPattern[]) {
  return (permission: string) => patterns.some((p) => matches(p, permission));
}
