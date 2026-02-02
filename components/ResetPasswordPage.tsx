import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { KeyRound, CheckCircle2, AlertTriangle, Eye, EyeOff } from 'lucide-react';
import { supabase } from '../lib/supabaseClient';
import { validatePassword } from '../lib/validation';

const ResetPasswordPage: React.FC = () => {
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validation = validatePassword(newPassword);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    // Validate new password
    if (!newPassword) {
      setError('Vui lòng nhập mật khẩu mới.');
      return;
    }

    if (!validation.valid) {
      setError(validation.errors.join(', '));
      return;
    }

    // Check confirmation
    if (newPassword !== confirmPassword) {
      setError('Mật khẩu xác nhận không khớp.');
      return;
    }

    if (!supabase) {
      setError('Hệ thống chưa được cấu hình. Vui lòng liên hệ quản trị viên.');
      return;
    }

    setSubmitting(true);

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) {
        if (updateError.message.includes('session') || updateError.message.includes('token')) {
          setError('Link đặt lại mật khẩu đã hết hạn hoặc không hợp lệ. Vui lòng yêu cầu link mới.');
        } else {
          setError(updateError.message || 'Đặt lại mật khẩu thất bại.');
        }
        return;
      }

      // Success
      alert('Đổi mật khẩu thành công! Bạn có thể đăng nhập với mật khẩu mới.');
      navigate('/login');
    } catch (err: any) {
      console.error('Unexpected error:', err);
      setError('Có lỗi xảy ra. Vui lòng thử lại sau.');
    } finally {
      setSubmitting(false);
    }
  };

  // Password strength indicator
  const getStrengthColor = () => {
    if (!newPassword) return 'bg-slate-200 dark:bg-slate-700';
    switch (validation.strength) {
      case 'strong':
        return 'bg-emerald-500';
      case 'medium':
        return 'bg-yellow-500';
      case 'weak':
        return 'bg-rose-500';
      default:
        return 'bg-slate-200 dark:bg-slate-700';
    }
  };

  const getStrengthText = () => {
    if (!newPassword) return '';
    switch (validation.strength) {
      case 'strong':
        return '✅ Mật khẩu mạnh';
      case 'medium':
        return '⚠️ Mật khẩu trung bình';
      case 'weak':
        return '❌ Mật khẩu yếu';
      default:
        return '';
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900 p-4">
      <div className="w-full max-w-md">
        {/* Card */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-800 p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-indigo-100 dark:bg-indigo-900/30 mb-4">
              <KeyRound className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">
              Đặt Lại Mật Khẩu
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Nhập mật khẩu mới cho tài khoản của bạn
            </p>
          </div>

          {/* Error Message */}
          {error && (
            <div className="mb-6 p-4 rounded-lg bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-900/40">
              <div className="flex items-start gap-3">
                <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                <p className="text-sm text-rose-900 dark:text-rose-100">
                  {error}
                </p>
              </div>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleResetPassword} className="space-y-6">
            {/* New Password */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                Mật khẩu mới
                <span className="text-rose-500 ml-1">*</span>
              </label>
              <div className="relative">
                <input
                  type={showNewPassword ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="Tối thiểu 8 ký tự, có chữ hoa, chữ thường, số"
                  className="w-full px-4 py-3 pr-12 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                  autoComplete="new-password"
                  disabled={submitting}
                />
                <button
                  type="button"
                  onClick={() => setShowNewPassword(!showNewPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                >
                  {showNewPassword ? (
                    <EyeOff className="w-5 h-5" />
                  ) : (
                    <Eye className="w-5 h-5" />
                  )}
                </button>
              </div>

              {/* Password Strength Meter */}
              {newPassword && (
                <div className="mt-2">
                  <div className="flex gap-1">
                    <div className={`h-1 flex-1 rounded transition-colors ${
                      validation.strength !== 'weak' ? 'bg-yellow-500' : 'bg-slate-200 dark:bg-slate-700'
                    }`} />
                    <div className={`h-1 flex-1 rounded transition-colors ${
                      validation.strength === 'strong' ? 'bg-emerald-500' : 'bg-slate-200 dark:bg-slate-700'
                    }`} />
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                    {getStrengthText()}
                  </p>
                  {validation.errors.length > 0 && (
                    <ul className="text-xs text-rose-600 dark:text-rose-400 mt-1 space-y-0.5">
                      {validation.errors.map((err) => (
                        <li key={err}>• {err}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {/* Confirm Password */}
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                Xác nhận mật khẩu
                <span className="text-rose-500 ml-1">*</span>
              </label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Nhập lại mật khẩu mới"
                  className="w-full px-4 py-3 pr-12 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent transition-all"
                  autoComplete="new-password"
                  disabled={submitting}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
                >
                  {showConfirmPassword ? (
                    <EyeOff className="w-5 h-5" />
                  ) : (
                    <Eye className="w-5 h-5" />
                  )}
                </button>
              </div>
              {confirmPassword && newPassword !== confirmPassword && (
                <p className="text-xs text-rose-600 dark:text-rose-400 mt-1">
                  Mật khẩu không khớp
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={submitting || !validation.valid || newPassword !== confirmPassword}
              className="w-full py-3 px-4 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold transition-colors flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Đang xử lý...
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4" />
                  Đặt Lại Mật Khẩu
                </>
              )}
            </button>
          </form>
        </div>

        {/* Footer Note */}
        <div className="mt-6 text-center">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Sau khi đặt lại thành công, bạn có thể đăng nhập với mật khẩu mới
          </p>
        </div>
      </div>
    </div>
  );
};

export default ResetPasswordPage;
