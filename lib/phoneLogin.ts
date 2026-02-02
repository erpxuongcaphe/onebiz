import { supabase } from './supabaseClient';
import { normalizePhone } from './validation';

/**
 * Login using phone number
 * Queries the profiles table to get email, then authenticates
 */
export async function loginWithPhone(
  phone: string,
  password: string,
  tenantId: string
): Promise<{ error: Error | null }> {
  try {
    // Normalize phone number
    const normalizedPhone = normalizePhone(phone);

    // Query profiles table to get email associated with this phone
    const { data: profile, error: queryError } = await supabase
      .from('profiles')
      .select('email, status, is_locked')
      .eq('phone', normalizedPhone)
      .eq('tenant_id', tenantId)
      .single();

    if (queryError || !profile) {
      return {
        error: new Error('Số điện thoại không tồn tại trong hệ thống')
      };
    }

    // Check if account is locked
    if (profile.is_locked) {
      return {
        error: new Error('Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.')
      };
    }

    // Check account status
    if (profile.status !== 'active') {
      return {
        error: new Error('Tài khoản chưa được kích hoạt')
      };
    }

    // Authenticate using the email
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: profile.email,
      password: password
    });

    if (authError) {
      return { error: authError };
    }

    return { error: null };
  } catch (err) {
    return {
      error: err instanceof Error ? err : new Error('Đã xảy ra lỗi khi đăng nhập')
    };
  }
}

/**
 * Check if phone number exists in the system
 */
export async function checkPhoneExists(
  phone: string,
  tenantId: string
): Promise<boolean> {
  const normalizedPhone = normalizePhone(phone);

  const { data, error } = await supabase
    .from('profiles')
    .select('id')
    .eq('phone', normalizedPhone)
    .eq('tenant_id', tenantId)
    .single();

  return !error && !!data;
}
