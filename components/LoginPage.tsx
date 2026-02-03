import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, Mail, Phone } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { useTenant, getCachedTenantId } from '../lib/tenantContext';
import {
  validateEmail,
  validatePhone,
  detectLoginType,
} from '../lib/validation';
import { loginWithPhone } from '../lib/phoneLogin';

const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { tenant } = useTenant();

  // Form state
  const [identifier, setIdentifier] = useState(''); // Email or Phone
  const [password, setPassword] = useState('');

  // UI state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tenantId = tenant?.id ?? getCachedTenantId() ?? null;

  // Detect login type from identifier
  const loginType = detectLoginType(identifier);

  const handleSignIn = async () => {
    setError(null);

    if (!supabase) {
      setError('Chưa cấu hình Supabase. Vui lòng thêm VITE_SUPABASE_URL và VITE_SUPABASE_ANON_KEY.');
      return;
    }

    if (!identifier.trim() || !password) {
      setError('Vui lòng nhập email/số điện thoại và mật khẩu.');
      return;
    }

    // Validate based on type
    if (loginType === 'email') {
      if (!validateEmail(identifier)) {
        setError('Email không đúng định dạng.');
        return;
      }
    } else if (loginType === 'phone') {
      if (!validatePhone(identifier)) {
        setError('Số điện thoại không đúng định dạng. Vui lòng nhập theo format: 0xxxxxxxxx hoặc +84xxxxxxxxx');
        return;
      }
    }

    if (!tenantId) {
      setError('Không thể xác định tenant. Vui lòng thử lại.');
      return;
    }

    setSubmitting(true);

    try {
      if (loginType === 'email') {
        // Login with email directly (faster - check lock after login)
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: identifier.trim(),
          password,
        });

        if (signInError) throw signInError;

        // Check lock status after successful login
        const { data: profile } = await supabase
          .from('profiles')
          .select('is_locked')
          .eq('email', identifier.trim())
          .eq('tenant_id', tenantId)
          .maybeSingle();

        if (profile?.is_locked) {
          // Logout immediately if locked
          await supabase.auth.signOut();
          throw new Error('Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.');
        }
      } else {
        // Login with phone (query email first)
        // Note: phoneLogin.ts already checks is_locked
        const { error: phoneLoginError } = await loginWithPhone(
          identifier,
          password,
          tenantId
        );

        if (phoneLoginError) throw phoneLoginError;
      }

      // Success - navigation will be handled by AuthProvider
      setPassword('');
    } catch (e: any) {
      setError(e?.message ?? 'Đăng nhập thất bại.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    handleSignIn();
  };

  return (
    <div className="min-h-screen bg-slate-50/50 dark:bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md animate-fade-in">
        {/* Logo/Brand */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-slate-900 dark:text-white mb-2">
            OneBiz ERP
          </h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Đăng nhập vào hệ thống
          </p>
        </div>

        {/* Login Card */}
        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-soft border border-slate-200 dark:border-slate-800 p-6">
          {!isSupabaseConfigured && (
            <div className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40 rounded-lg p-3 mb-4">
              <div className="font-bold mb-1">Thiếu biến môi trường</div>
              <div>Tạo `.env.local` từ `.env.example` và điền:</div>
              <div className="font-mono text-[10px] mt-1">
                VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
              </div>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 text-xs text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-900/40 rounded-lg p-3 mb-4">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email/Phone Input */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Email hoặc Số điện thoại
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  className="w-full pl-10 pr-3 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  placeholder="user@example.com hoặc 0987654321"
                  disabled={submitting}
                />
                <div className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                  {loginType === 'email' ? (
                    <Mail className="w-4 h-4" />
                  ) : (
                    <Phone className="w-4 h-4" />
                  )}
                </div>
              </div>
              {identifier && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {loginType === 'email' ? '📧 Đăng nhập bằng email' : '📱 Đăng nhập bằng số điện thoại'}
                </p>
              )}
            </div>

            {/* Password Input */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Mật khẩu
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                placeholder="••••••••"
                disabled={submitting}
              />
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={submitting || !isSupabaseConfigured}
              className="w-full py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
            >
              {submitting ? 'Đang xử lý...' : 'Đăng Nhập'}
            </button>

            {/* Forgot Password Link */}
            <div className="text-center">
              <Link
                to="/forgot-password"
                className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
              >
                Quên mật khẩu?
              </Link>
            </div>
          </form>
        </div>

        {/* Footer Note */}
        <p className="text-center text-xs text-slate-500 dark:text-slate-400 mt-6">
          {tenant?.name ? `Đăng nhập vào ${tenant.name}` : 'OneBiz ERP System'}
        </p>
      </div>
    </div>
  );
};

export default LoginPage;
