import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Database, KeyRound, UserPlus, AlertTriangle, Mail, Phone } from 'lucide-react';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { useTenant, getCachedTenantId } from '../lib/tenantContext';
import {
  validateEmail,
  validatePhone,
  validatePassword,
  detectLoginType,
  getPasswordStrengthText,
  getPasswordStrengthColor
} from '../lib/validation';
import { loginWithPhone } from '../lib/phoneLogin';

type Mode = 'signIn' | 'signUp';

const LoginPage: React.FC = () => {
  const navigate = useNavigate();
  const { tenant } = useTenant();

  // Form state
  const [mode, setMode] = useState<Mode>('signIn');
  const [identifier, setIdentifier] = useState(''); // Email or Phone
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');

  // UI state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPasswordStrength, setShowPasswordStrength] = useState(false);

  const tenantId = tenant?.id ?? getCachedTenantId() ?? null;

  // Detect login type from identifier
  const loginType = detectLoginType(identifier);

  // Get password validation
  const passwordValidation = validatePassword(password);

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
        // Check if user is locked before login
        const { data: profile } = await supabase
          .from('profiles')
          .select('is_locked')
          .eq('email', identifier.trim())
          .eq('tenant_id', tenantId)
          .single();

        if (profile?.is_locked) {
          throw new Error('Tài khoản đã bị khóa. Vui lòng liên hệ quản trị viên.');
        }

        // Login with email directly
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: identifier.trim(),
          password,
        });

        if (signInError) throw signInError;
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

  const handleSignUp = async () => {
    setError(null);

    if (!supabase) {
      setError('Chưa cấu hình Supabase.');
      return;
    }

    if (!identifier.trim() || !password) {
      setError('Vui lòng nhập đầy đủ thông tin.');
      return;
    }

    // Email is required for signup
    if (!validateEmail(identifier)) {
      setError('Vui lòng nhập email hợp lệ để đăng ký.');
      return;
    }

    // Validate password
    if (!passwordValidation.valid) {
      setError(passwordValidation.errors.join(', '));
      return;
    }

    // Check password confirmation
    if (password !== confirmPassword) {
      setError('Mật khẩu xác nhận không khớp.');
      return;
    }

    // Validate phone if provided
    if (phone.trim() && !validatePhone(phone)) {
      setError('Số điện thoại không đúng định dạng.');
      return;
    }

    setSubmitting(true);

    try {
      const { error: signUpError } = await supabase.auth.signUp({
        email: identifier.trim(),
        password,
        options: {
          data: {
            full_name: fullName.trim() || undefined,
            tenant_id: tenantId || undefined,
            phone: phone.trim() || undefined,
          },
        },
      });

      if (signUpError) throw signUpError;

      // Success
      setPassword('');
      setConfirmPassword('');
      setMode('signIn');
      setError(null);
    } catch (e: any) {
      setError(e?.message ?? 'Tạo tài khoản thất bại.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'signIn') {
      handleSignIn();
    } else {
      handleSignUp();
    }
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
            {mode === 'signIn' ? 'Đăng nhập vào hệ thống' : 'Tạo tài khoản mới'}
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

          {/* Mode Toggle */}
          <div className="flex items-center justify-center mb-6">
            <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
              <button
                onClick={() => {
                  setMode('signIn');
                  setError(null);
                }}
                className={`px-4 py-2 text-xs font-semibold transition-colors ${
                  mode === 'signIn'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center gap-2">
                  <KeyRound className="w-3.5 h-3.5" />
                  Đăng Nhập
                </div>
              </button>
              <button
                onClick={() => {
                  setMode('signUp');
                  setError(null);
                }}
                className={`px-4 py-2 text-xs font-semibold transition-colors ${
                  mode === 'signUp'
                    ? 'bg-indigo-600 text-white'
                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <div className="flex items-center gap-2">
                  <UserPlus className="w-3.5 h-3.5" />
                  Đăng Ký
                </div>
              </button>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email/Phone Input */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                {mode === 'signIn' ? 'Email hoặc Số điện thoại' : 'Email'}
                {mode === 'signUp' && <span className="text-rose-500 ml-0.5">*</span>}
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  className="w-full pl-10 pr-3 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  placeholder={mode === 'signIn' ? 'user@example.com hoặc 0987654321' : 'user@example.com'}
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
              {mode === 'signIn' && identifier && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  {loginType === 'email' ? '📧 Đăng nhập bằng email' : '📱 Đăng nhập bằng số điện thoại'}
                </p>
              )}
            </div>

            {/* Phone Input (Signup only, optional) */}
            {mode === 'signUp' && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Số điện thoại (tùy chọn)
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  placeholder="0987654321"
                  disabled={submitting}
                />
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Có thể dùng để đăng nhập sau này
                </p>
              </div>
            )}

            {/* Full Name (Signup only) */}
            {mode === 'signUp' && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Họ và tên
                </label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  placeholder="Nguyễn Văn A"
                  disabled={submitting}
                />
              </div>
            )}

            {/* Password Input */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Mật khẩu
                {mode === 'signUp' && <span className="text-rose-500 ml-0.5">*</span>}
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (mode === 'signUp') setShowPasswordStrength(true);
                }}
                className="w-full px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                placeholder="••••••••"
                disabled={submitting}
              />

              {/* Password Strength Meter (Signup only) */}
              {mode === 'signUp' && showPasswordStrength && password && (
                <div className="mt-2">
                  <div className="flex gap-1 h-1">
                    <div
                      className={`flex-1 rounded ${
                        password.length > 0 ? getPasswordStrengthColor(passwordValidation.strength) : 'bg-slate-200'
                      }`}
                    />
                    <div
                      className={`flex-1 rounded ${
                        passwordValidation.strength !== 'weak' ? getPasswordStrengthColor(passwordValidation.strength) : 'bg-slate-200'
                      }`}
                    />
                    <div
                      className={`flex-1 rounded ${
                        passwordValidation.strength === 'strong' ? getPasswordStrengthColor(passwordValidation.strength) : 'bg-slate-200'
                      }`}
                    />
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                    {getPasswordStrengthText(passwordValidation.strength)}
                  </p>
                  {passwordValidation.errors.length > 0 && (
                    <ul className="text-xs text-rose-600 dark:text-rose-400 mt-1 space-y-0.5">
                      {passwordValidation.errors.map((err) => (
                        <li key={err}>• {err}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {/* Confirm Password (Signup only) */}
            {mode === 'signUp' && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Xác nhận mật khẩu
                  <span className="text-rose-500 ml-0.5">*</span>
                </label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                  placeholder="••••••••"
                  disabled={submitting}
                />
                {confirmPassword && password !== confirmPassword && (
                  <p className="text-xs text-rose-600 dark:text-rose-400 mt-1">
                    Mật khẩu không khớp
                  </p>
                )}
              </div>
            )}

            {/* Submit Button */}
            <button
              type="submit"
              disabled={submitting || !isSupabaseConfigured}
              className="w-full py-2.5 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-semibold transition-colors"
            >
              {submitting ? 'Đang xử lý...' : mode === 'signIn' ? 'Đăng Nhập' : 'Tạo Tài Khoản'}
            </button>

            {/* Forgot Password Link (SignIn only) */}
            {mode === 'signIn' && (
              <div className="text-center">
                <Link
                  to="/forgot-password"
                  className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
                >
                  Quên mật khẩu?
                </Link>
              </div>
            )}
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
