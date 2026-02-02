import { supabase } from './supabaseClient';

export type UserSearchFilters = {
  searchTerm?: string;
  status?: 'active' | 'inactive' | null;
  branchId?: string | null;
  isLocked?: boolean | null;
  limit?: number;
};

export type UserSearchResult = {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  status: string;
  branch_id: string | null;
  is_locked: boolean;
  locked_until: string | null;
  last_login_at: string | null;
  created_at: string;
};

/**
 * Search users with filters
 * Uses server-side RPC function for efficient querying
 */
export async function searchUsers(
  filters: UserSearchFilters
): Promise<{ data: UserSearchResult[]; error: string | null }> {
  if (!supabase) {
    return { data: [], error: 'Supabase chưa được cấu hình' };
  }

  try {
    const { data, error } = await supabase.rpc('search_users', {
      p_search_term: filters.searchTerm || null,
      p_status: filters.status || null,
      p_branch_id: filters.branchId || null,
      p_is_locked: filters.isLocked,
      p_limit: filters.limit || 50
    });

    if (error) {
      return { data: [], error: error.message };
    }

    return { data: (data as UserSearchResult[]) || [], error: null };
  } catch (err: any) {
    return { data: [], error: err?.message ?? 'Tìm kiếm thất bại' };
  }
}

/**
 * Debounce helper for search input
 * Delays function execution until after wait milliseconds have elapsed
 * since the last time the debounced function was invoked
 */
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: NodeJS.Timeout;

  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => func(...args), delay);
  };
}
