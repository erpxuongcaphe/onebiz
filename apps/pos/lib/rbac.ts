import { supabase } from './supabaseClient';

export type PermissionPattern = string;

export async function fetchMyPermissionPatterns(): Promise<PermissionPattern[]> {
  if (!supabase) return [];
  const { data: sessionData } = await supabase.auth.getSession();
  if (!sessionData.session) return [];

  const { data, error } = await supabase.rpc('get_my_permission_patterns');
  if (error) return [];
  if (!Array.isArray(data)) return [];
  return data as PermissionPattern[];
}

function matches(pattern: string, permission: string): boolean {
  if (pattern === '*') return true;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`^${escaped.replace(/\*/g, '.*')}$`);
  return re.test(permission);
}

export function buildCan(patterns: PermissionPattern[]) {
  return (permission: string) => patterns.some((p) => matches(p, permission));
}
