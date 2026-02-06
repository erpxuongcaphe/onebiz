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
 *
 * Trade-off: User must re-login after role change to refresh JWT
 */
export async function fetchMyPermissionPatterns(): Promise<PermissionPattern[]> {
  if (!supabase) return [];

  const { data: { session } } = await supabase.auth.getSession();
  if (!session?.user) return [];

  // Read from user.user_metadata.permissions (synced from DB via trigger)
  const permissions = session.user.user_metadata?.permissions;

  if (Array.isArray(permissions)) {
    return permissions as PermissionPattern[];
  }

  // Fallback: empty array if no permissions in metadata yet
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
