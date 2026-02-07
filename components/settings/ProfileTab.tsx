import React, { useState, useMemo, useEffect } from 'react';
import { LogOut, KeyRound, AlertTriangle } from 'lucide-react';
import { useAuth } from '../../lib/auth';
import { supabase } from '../../lib/supabaseClient';
import { withTimeout } from '../../lib/async';
import { validatePassword } from '../../lib/validation';
import { forceLogout } from '../../lib/logout';

type ProfileTabProps = {
    branchName?: string;
    roleName?: string;
};

export function ProfileTab({ branchName, roleName }: ProfileTabProps) {
    const { user, permissionPatterns } = useAuth();

    // ✅ NUCLEAR FIX: Compute roleName DIRECTLY from permissionPatterns
    // This bypasses all prop passing and context propagation issues
    const computedRoleName = useMemo(() => {
        const isSuperAdmin = permissionPatterns.includes('*');
        const canManageRoles = permissionPatterns.some((p) => p === '*' || p.startsWith('roles.'));

        if (isSuperAdmin) return 'Super Admin';
        if (canManageRoles) return 'Quản trị viên';
        return 'Người dùng';
    }, [permissionPatterns]);

    // ✅ FIX: Force re-render when permissions update (CASE B - Context race fix)
    useEffect(() => {
        console.log('[ProfileTab] Permissions updated, forcing re-render:', permissionPatterns);
    }, [permissionPatterns]);

    // Use computed role instead of prop (prop kept for backward compatibility)
    const displayRoleName = computedRoleName || roleName || 'Người dùng';

    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showChangePassword, setShowChangePassword] = useState(false);
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    const handleSignOut = async () => {
        setError(null);
        setSubmitting(true);

        // Use forceLogout helper to clear browser cache and redirect
        // This fixes browser-specific localStorage issues where stale tokens
        // prevent proper logout
        await forceLogout();

        // Note: No need to setSubmitting(false) because page will reload
    };

    const handleChangePassword = async () => {
        setError(null);
        if (!supabase || !user?.email) return;

        // 1. Validate current password is provided
        if (!currentPassword.trim()) {
            setError('Vui lòng nhập mật khẩu hiện tại.');
            return;
        }

        // 2. Validate new password strength
        const validation = validatePassword(newPassword);
        if (!validation.valid) {
            setError(validation.errors.join(', '));
            return;
        }

        // 3. Check password confirmation
        if (newPassword !== confirmPassword) {
            setError('Mật khẩu xác nhận không khớp.');
            return;
        }

        setSubmitting(true);
        try {
            // 4. Verify current password by re-authenticating
            const { error: reAuthError } = await supabase.auth.signInWithPassword({
                email: user.email,
                password: currentPassword
            });

            if (reAuthError) {
                setError('Mật khẩu hiện tại không đúng.');
                setSubmitting(false);
                return;
            }

            // 5. Update to new password
            const { error: updateError } = await supabase.auth.updateUser({
                password: newPassword,
            });

            if (updateError) throw updateError;

            // Success - reset form
            setShowChangePassword(false);
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
            alert('Đổi mật khẩu thành công!');
        } catch (e: any) {
            setError(e?.message ?? 'Đổi mật khẩu thất bại.');
        } finally {
            setSubmitting(false);
        }
    };

    const [fullName, setFullName] = useState('');
    const [phone, setPhone] = useState('');
    const [savingProfile, setSavingProfile] = useState(false);

    // Initialize profile data
    React.useEffect(() => {
        if (user) {
            setFullName(user.user_metadata?.full_name || user.email?.split('@')[0] || '');
            setPhone(user.user_metadata?.phone || '');
            // Optionally fetch from DB if metadata is stale, but metadata is usually faster for UI
        }
    }, [user]);

    const handleUpdateProfile = async () => {
        if (!supabase) return;
        setSavingProfile(true);
        setError(null);

        try {
            // 1. Update in Database via RPC
            const { error: rpcError } = await supabase.rpc('user_update_own_profile', {
                p_full_name: fullName,
                p_phone: phone
            });
            if (rpcError) throw rpcError;

            // 2. Update Auth Metadata (to keep session in sync without relogin)
            const { error: authError } = await supabase.auth.updateUser({
                data: { full_name: fullName, phone: phone }
            });
            if (authError) throw authError;

            alert('Cập nhật thông tin thành công!');
        } catch (e: any) {
            setError(e?.message ?? 'Cập nhật thất bại.');
        } finally {
            setSavingProfile(false);
        }
    };

    if (!user) {
        return (
            <div className="text-center py-12 text-slate-500 dark:text-slate-400">
                Vui lòng đăng nhập để xem thông tin hồ sơ.
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Profile Info */}
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-soft border border-slate-200 dark:border-slate-800 p-4">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">Thông Tin Cá Nhân</h3>
                    <button
                        onClick={handleUpdateProfile}
                        disabled={savingProfile}
                        className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold"
                    >
                        {savingProfile ? 'Đang lưu...' : 'Lưu Thông Tin'}
                    </button>
                </div>

                <div className="space-y-3">
                    {/* Editable Fields */}
                    <div>
                        <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">
                            Họ và Tên
                        </label>
                        <input
                            value={fullName}
                            onChange={(e) => setFullName(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-white"
                            placeholder="Nhập họ và tên"
                        />
                    </div>

                    <div>
                        <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">
                            Số Điện Thoại
                        </label>
                        <input
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-white"
                            placeholder="Nhập số điện thoại"
                        />
                    </div>

                    <div>
                        <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">Email</label>
                        <div className="w-full px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 text-sm text-slate-500 cursor-not-allowed">
                            {user.email}
                        </div>
                    </div>

                    {branchName && (
                        <div>
                            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Chi Nhánh</div>
                            <div className="text-sm text-slate-900 dark:text-white">{branchName}</div>
                        </div>
                    )}

                    {displayRoleName && (
                        <div>
                            <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Vai Trò</div>
                            <div className="text-sm text-slate-900 dark:text-white">{displayRoleName}</div>
                        </div>
                    )}
                </div>
            </div>

            {/* Change Password */}
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-soft border border-slate-200 dark:border-slate-800 p-4">
                <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">Bảo Mật</h3>
                    {!showChangePassword && (
                        <button
                            onClick={() => setShowChangePassword(true)}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold"
                        >
                            <KeyRound className="w-3.5 h-3.5" />
                            Đổi Mật Khẩu
                        </button>
                    )}
                </div>

                {showChangePassword && (
                    <div className="space-y-3 mt-3">
                        {error && (
                            <div className="flex items-start gap-2 text-xs text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-900/40 rounded-lg p-2.5">
                                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                                {error}
                            </div>
                        )}

                        <div>
                            <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">
                                Mật khẩu hiện tại
                                <span className="text-rose-500 ml-0.5">*</span>
                            </label>
                            <input
                                type="password"
                                value={currentPassword}
                                onChange={(e) => setCurrentPassword(e.target.value)}
                                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm"
                                placeholder="Nhập mật khẩu hiện tại"
                                autoComplete="current-password"
                            />
                        </div>

                        <div>
                            <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">
                                Mật khẩu mới
                                <span className="text-rose-500 ml-0.5">*</span>
                            </label>
                            <input
                                type="password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm"
                                placeholder="Tối thiểu 8 ký tự, có chữ hoa, chữ thường, số"
                                autoComplete="new-password"
                            />
                        </div>

                        <div>
                            <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">
                                Xác nhận mật khẩu mới
                                <span className="text-rose-500 ml-0.5">*</span>
                            </label>
                            <input
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm"
                                placeholder="Nhập lại mật khẩu mới"
                                autoComplete="new-password"
                            />
                        </div>

                        <div className="flex gap-2">
                            <button
                                onClick={handleChangePassword}
                                disabled={submitting}
                                className="px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-semibold"
                            >
                                Lưu Thay Đổi
                            </button>
                            <button
                                onClick={() => {
                                    setShowChangePassword(false);
                                    setError(null);
                                    setCurrentPassword('');
                                    setNewPassword('');
                                    setConfirmPassword('');
                                }}
                                disabled={submitting}
                                className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold disabled:opacity-50"
                            >
                                Hủy
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Sign Out */}
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-soft border border-slate-200 dark:border-slate-800 p-4">
                <div className="flex items-center justify-between">
                    <div>
                        <div className="text-sm font-semibold text-slate-900 dark:text-white">Đăng Xuất</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                            Thoát khỏi tài khoản hiện tại
                        </div>
                    </div>
                    <button
                        onClick={handleSignOut}
                        disabled={submitting}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-semibold"
                    >
                        <LogOut className="w-4 h-4" />
                        Đăng Xuất
                    </button>
                </div>
            </div>
        </div>
    );
}
