import { supabase } from './supabaseClient';

/**
 * Toggle user lock status
 * Locks or unlocks a user account
 *
 * @param userId - The user ID to lock/unlock
 * @param isLocked - true to lock, false to unlock
 * @param lockDurationHours - Duration in hours for temporary lock (default 24)
 * @returns Success status and error message if any
 */
export async function toggleUserLock(
  userId: string,
  isLocked: boolean,
  lockDurationHours: number = 24
): Promise<{ success: boolean; error?: string }> {
  if (!supabase) {
    return { success: false, error: 'Supabase chưa được cấu hình' };
  }

  try {
    const { data, error } = await supabase.rpc('toggle_user_lock', {
      p_user_id: userId,
      p_is_locked: isLocked,
      p_lock_duration_hours: lockDurationHours
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message ?? 'Thao tác thất bại' };
  }
}
