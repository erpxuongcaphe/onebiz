import { supabase } from './supabaseClient';
import { generateRandomPassword } from './validation';

/**
 * Admin reset user password
 * Generates a temporary random password for the user
 * Returns the password so admin can communicate it to the user
 *
 * Note: This is MVP implementation. For production, consider:
 * - Creating a Supabase Edge Function to handle password reset server-side
 * - Or using Supabase Admin API with service role key (keep secret)
 */
export async function adminResetPassword(
  userId: string
): Promise<{ success: boolean; password?: string; error?: string }> {
  if (!supabase) {
    return { success: false, error: 'Supabase chưa được cấu hình' };
  }

  try {
    // Generate random password (12 characters)
    const newPassword = generateRandomPassword(12);

    // Call RPC to verify permissions and user exists
    const { data: canReset, error: rpcError } = await supabase.rpc(
      'admin_reset_user_password',
      {
        p_user_id: userId,
        p_new_password: newPassword
      }
    );

    if (rpcError || !canReset) {
      return {
        success: false,
        error: rpcError?.message ?? 'Không có quyền đặt lại mật khẩu'
      };
    }

    // TODO: Actual password update requires Supabase Admin API
    // For MVP: Return generated password for admin to communicate manually
    //
    // For production implementation, add one of these:
    // 1. Edge Function that uses Admin API to update auth.users password
    // 2. Backend service with service role key
    //
    // Example Edge Function code:
    // import { createClient } from '@supabase/supabase-js'
    // const supabaseAdmin = createClient(url, SERVICE_ROLE_KEY)
    // await supabaseAdmin.auth.admin.updateUserById(userId, { password: newPassword })

    return {
      success: true,
      password: newPassword
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message ?? 'Đặt lại mật khẩu thất bại'
    };
  }
}
