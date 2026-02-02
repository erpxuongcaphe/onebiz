import React, { useEffect, useState, useMemo } from 'react';
import { Users, RefreshCw, AlertTriangle, CheckCircle2, KeyRound, Search, Lock, Unlock } from 'lucide-react';
import {
    bootstrapSuperAdmin,
    fetchProfiles,
    fetchRoles,
    fetchUserRoles,
    setUserBranch,
    setUserRole,
    type ProfileLite,
    type Role,
    type UserRole,
} from '../../lib/roles';
import { fetchBranches, type Branch } from '../../lib/branches';
import { adminResetPassword } from '../../lib/adminPasswordReset';
import { PasswordResetModal } from './PasswordResetModal';
import { searchUsers, debounce } from '../../lib/userSearch';
import { toggleUserLock } from '../../lib/userLock';
import { PermissionsPanel } from './PermissionsPanel';

type UsersTabProps = {
    tenantId: string | null;
    canManageRoles: boolean;
    onBootstrapSuccess?: () => void;
};

// Helper function to format relative time
function formatRelativeTime(dateString: string): string {
    const now = new Date();
    const date = new Date(dateString);
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Vừa xong';
    if (diffMins < 60) return `${diffMins} phút trước`;
    if (diffHours < 24) return `${diffHours} giờ trước`;
    if (diffDays < 7) return `${diffDays} ngày trước`;
    return date.toLocaleDateString('vi-VN');
}

export function UsersTab({ tenantId, canManageRoles, onBootstrapSuccess }: UsersTabProps) {
    const [roles, setRoles] = useState<Role[]>([]);
    const [profiles, setProfiles] = useState<ProfileLite[]>([]);
    const [userRoles, setUserRoles] = useState<UserRole[]>([]);
    const [branches, setBranches] = useState<Branch[]>([]);
    const [draftRolesByUser, setDraftRolesByUser] = useState<Record<string, Set<string>>>({});
    const [draftBranchByUser, setDraftBranchByUser] = useState<Record<string, string | null>>({});
    const [dirtyByUser, setDirtyByUser] = useState<Record<string, boolean>>({});
    const [savingByUser, setSavingByUser] = useState<Record<string, boolean>>({});
    const [errorByUser, setErrorByUser] = useState<Record<string, string | null>>({});
    const [successByUser, setSuccessByUser] = useState<Record<string, boolean>>({});
    const [roleError, setRoleError] = useState<string | null>(null);
    const [rolesLoading, setRolesLoading] = useState(false);
    const [bootstrapping, setBootstrapping] = useState(false);
    const [resetPasswordUserId, setResetPasswordUserId] = useState<string | null>(null);
    const [generatedPassword, setGeneratedPassword] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState<string>('');
    const [branchFilter, setBranchFilter] = useState<string>('');
    const [lockFilter, setLockFilter] = useState<string>('');
    const [searching, setSearching] = useState(false);
    const [lockingByUser, setLockingByUser] = useState<Record<string, boolean>>({});

    const loadRoleData = async () => {
        setRolesLoading(true);
        setRoleError(null);
        try {
            const [roleList, profileList, userRoleList, branchList] = await Promise.all([
                fetchRoles(),
                fetchProfiles(),
                fetchUserRoles(),
                fetchBranches(),
            ]);
            setRoles(roleList);
            setProfiles(profileList);
            setUserRoles(userRoleList);
            setBranches(branchList);

            const draftRoles: Record<string, Set<string>> = {};
            const draftBranches: Record<string, string | null> = {};
            const dirtyMap: Record<string, boolean> = {};
            const errorMap: Record<string, string | null> = {};
            const successMap: Record<string, boolean> = {};

            profileList.forEach((p) => {
                const roleSet = new Set<string>(userRoleList.filter((ur) => ur.user_id === p.id).map((ur) => ur.role_id));
                draftRoles[p.id] = roleSet;
                draftBranches[p.id] = p.branch_id ?? null;
                dirtyMap[p.id] = false;
                errorMap[p.id] = null;
                successMap[p.id] = false;
            });

            setDraftRolesByUser(draftRoles);
            setDraftBranchByUser(draftBranches);
            setDirtyByUser(dirtyMap);
            setErrorByUser(errorMap);
            setSuccessByUser(successMap);
        } catch (e: any) {
            setRoleError(e?.message ?? 'Không tải được dữ liệu phân quyền.');
        } finally {
            setRolesLoading(false);
        }
    };

    useEffect(() => {
        if (canManageRoles) {
            loadRoleData();
        }
    }, [canManageRoles]);

    // Debounced search effect
    const debouncedSearch = useMemo(
        () => debounce(async (term: string, status: string, branch: string, lock: string) => {
            setSearching(true);
            const result = await searchUsers({
                searchTerm: term || undefined,
                status: (status === 'active' || status === 'inactive') ? status : null,
                branchId: branch || null,
                isLocked: lock === 'locked' ? true : lock === 'unlocked' ? false : null,
                limit: 500
            });

            if (!result.error && result.data) {
                setProfiles(result.data);
                // Re-init draft states for new profiles
                const draftRoles: Record<string, Set<string>> = {};
                const draftBranches: Record<string, string | null> = {};
                result.data.forEach((p) => {
                    const roleSet = new Set<string>(userRoles.filter((ur) => ur.user_id === p.id).map((ur) => ur.role_id));
                    draftRoles[p.id] = roleSet;
                    draftBranches[p.id] = p.branch_id ?? null;
                });
                setDraftRolesByUser(draftRoles);
                setDraftBranchByUser(draftBranches);
            }
            setSearching(false);
        }, 300),
        [userRoles]
    );

    useEffect(() => {
        if (canManageRoles && (searchTerm || statusFilter || branchFilter || lockFilter)) {
            debouncedSearch(searchTerm, statusFilter, branchFilter, lockFilter);
        }
    }, [searchTerm, statusFilter, branchFilter, lockFilter, canManageRoles, debouncedSearch]);

    const handleToggleLock = async (userId: string, currentlyLocked: boolean) => {
        const action = currentlyLocked ? 'mở khóa' : 'khóa';

        if (!confirm(`Bạn có chắc muốn ${action} tài khoản này?`)) {
            return;
        }

        setLockingByUser(prev => ({ ...prev, [userId]: true }));
        setErrorByUser(prev => ({ ...prev, [userId]: null }));

        const result = await toggleUserLock(userId, !currentlyLocked, 24);

        if (result.success) {
            await loadRoleData();
        } else {
            setErrorByUser(prev => ({
                ...prev,
                [userId]: result.error ?? 'Thao tác thất bại'
            }));
        }

        setLockingByUser(prev => ({ ...prev, [userId]: false }));
    };

    const handleToggleRole = (targetUserId: string, roleId: string, enabled: boolean) => {
        setDraftRolesByUser((prev) => {
            const current = new Set<string>(prev[targetUserId] ?? []);
            if (enabled) current.add(roleId);
            else current.delete(roleId);
            return { ...prev, [targetUserId]: current };
        });
        setDirtyByUser((prev) => ({ ...prev, [targetUserId]: true }));
        setSuccessByUser((prev) => ({ ...prev, [targetUserId]: false }));
        setErrorByUser((prev) => ({ ...prev, [targetUserId]: null }));
    };

    const handleChangeBranch = (targetUserId: string, nextBranchId: string) => {
        setDraftBranchByUser((prev) => ({ ...prev, [targetUserId]: nextBranchId || null }));
        setDirtyByUser((prev) => ({ ...prev, [targetUserId]: true }));
        setSuccessByUser((prev) => ({ ...prev, [targetUserId]: false }));
        setErrorByUser((prev) => ({ ...prev, [targetUserId]: null }));
    };

    const handleResetPassword = async (userId: string) => {
        setErrorByUser((prev) => ({ ...prev, [userId]: null }));

        const result = await adminResetPassword(userId);

        if (result.success && result.password) {
            setGeneratedPassword(result.password);
            setResetPasswordUserId(userId);
        } else {
            setErrorByUser((prev) => ({
                ...prev,
                [userId]: result.error ?? 'Đặt lại mật khẩu thất bại'
            }));
        }
    };

    const handleSaveUser = async (targetUserId: string) => {
        if (!tenantId) {
            setErrorByUser((prev) => ({ ...prev, [targetUserId]: 'Chưa xác định tenant.' }));
            return;
        }

        const draftRoles = (draftRolesByUser[targetUserId] ?? new Set<string>()) as Set<string>;
        const currentRoles = new Set<string>(userRoles.filter((ur) => ur.user_id === targetUserId).map((ur) => ur.role_id));
        const toAdd = Array.from(draftRoles.values()).filter((r) => !currentRoles.has(r));
        const toRemove = Array.from(currentRoles.values()).filter((r) => !draftRoles.has(r));
        const nextBranch = draftBranchByUser[targetUserId] ?? null;
        const currentBranch = profiles.find((p) => p.id === targetUserId)?.branch_id ?? null;

        setSavingByUser((prev) => ({ ...prev, [targetUserId]: true }));
        setErrorByUser((prev) => ({ ...prev, [targetUserId]: null }));
        setSuccessByUser((prev) => ({ ...prev, [targetUserId]: false }));

        try {
            for (const roleId of toAdd) {
                const ok = await setUserRole({ tenantId, userId: targetUserId, roleId, enabled: true });
                if (!ok) throw new Error(`Không thêm được role ${roleId}`);
            }
            for (const roleId of toRemove) {
                const ok = await setUserRole({ tenantId, userId: targetUserId, roleId, enabled: false });
                if (!ok) throw new Error(`Không gỡ được role ${roleId}`);
            }
            if (nextBranch !== currentBranch) {
                const ok = await setUserBranch({ tenantId, userId: targetUserId, branchId: nextBranch });
                if (!ok) throw new Error('Không cập nhật được chi nhánh.');
            }

            const [profileList, userRoleList, branchList] = await Promise.all([
                fetchProfiles(),
                fetchUserRoles(),
                fetchBranches(),
            ]);
            setProfiles(profileList);
            setUserRoles(userRoleList);
            setBranches(branchList);

            setDirtyByUser((prev) => ({ ...prev, [targetUserId]: false }));
            setSuccessByUser((prev) => ({ ...prev, [targetUserId]: true }));
        } catch (e: any) {
            setErrorByUser((prev) => ({ ...prev, [targetUserId]: e?.message ?? 'Lưu thất bại.' }));
        } finally {
            setSavingByUser((prev) => ({ ...prev, [targetUserId]: false }));
        }
    };

    const handleBootstrap = async () => {
        setBootstrapping(true);
        setRoleError(null);
        try {
            const ok = await bootstrapSuperAdmin();
            if (!ok) {
                setRoleError('Không bootstrap được vai trò (có thể tenant đã có role).');
                return;
            }
            await loadRoleData();
            onBootstrapSuccess?.();
        } catch (e: any) {
            setRoleError(e?.message ?? 'Bootstrap thất bại.');
        } finally {
            setBootstrapping(false);
        }
    };

    if (!canManageRoles) {
        return (
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40 rounded-xl p-4">
                <div className="flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                    <div className="flex-1 space-y-2">
                        <div className="text-sm font-bold text-amber-900 dark:text-amber-200">
                            Chưa Có Quyền Quản Trị
                        </div>
                        <div className="text-xs text-amber-800 dark:text-amber-300">
                            Nhấn nút dưới đây để bootstrap Super Admin cho user hiện tại nếu tenant chưa có role nào.
                        </div>
                        <button
                            onClick={handleBootstrap}
                            disabled={bootstrapping}
                            className="px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-semibold"
                        >
                            {bootstrapping ? 'Đang xử lý...' : 'Cấp Super Admin Cho Tôi'}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Users className="w-5 h-5 text-indigo-600" />
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">Quản Lý Người Dùng</h3>
                </div>
                <button
                    onClick={loadRoleData}
                    disabled={rolesLoading}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 text-xs font-semibold"
                >
                    <RefreshCw className={`w-3.5 h-3.5 ${rolesLoading ? 'animate-spin' : ''}`} />
                    Tải Lại
                </button>
            </div>

            {/* Error */}
            {roleError && (
                <div className="flex items-start gap-2 text-xs text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-900/40 rounded-lg p-2.5">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    {roleError}
                </div>
            )}

            {/* Loading */}
            {rolesLoading && (
                <div className="text-sm text-slate-500 dark:text-slate-400 text-center py-8">
                    Đang tải dữ liệu phân quyền...
                </div>
            )}

            {/* Search & Filter Controls */}
            {!rolesLoading && canManageRoles && (
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-soft border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                    <div>
                        <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">
                            <Search className="w-3.5 h-3.5 inline mr-1" />
                            Tìm Kiếm
                        </label>
                        <input
                            type="text"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="Tìm theo tên, email, hoặc số điện thoại..."
                            className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm"
                        />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Trạng Thái</label>
                            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm">
                                <option value="">Tất cả</option>
                                <option value="active">Hoạt động</option>
                                <option value="inactive">Không hoạt động</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Chi Nhánh</label>
                            <select value={branchFilter} onChange={(e) => setBranchFilter(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm">
                                <option value="">Tất cả</option>
                                {branches.map(b => (<option key={b.id} value={b.id}>{b.name}</option>))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1">Trạng Thái Khóa</label>
                            <select value={lockFilter} onChange={(e) => setLockFilter(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm">
                                <option value="">Tất cả</option>
                                <option value="unlocked">Đang hoạt động</option>
                                <option value="locked">Đã khóa</option>
                            </select>
                        </div>
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                        {searching ? 'Đang tìm kiếm...' : `Tìm thấy ${profiles.length} người dùng`}
                    </div>
                </div>
            )}

            {/* Empty */}
            {!rolesLoading && profiles.length === 0 && (
                <div className="text-sm text-slate-500 dark:text-slate-400 text-center py-8">
                    Chưa có người dùng.
                </div>
            )}

            {/* User Cards */}
            {!rolesLoading && profiles.length > 0 && (
                <div className="space-y-3">
                    {profiles.map((p) => {
                        const roleSet = draftRolesByUser[p.id] ?? new Set<string>(userRoles.filter((ur) => ur.user_id === p.id).map((ur) => ur.role_id));
                        const isDirty = Boolean(dirtyByUser[p.id]);
                        const isSaving = Boolean(savingByUser[p.id]);
                        const errorMessage = errorByUser[p.id];
                        const isSuccess = Boolean(successByUser[p.id]);

                        return (
                            <div key={p.id} className="bg-white dark:bg-slate-900 rounded-xl shadow-soft border border-slate-200 dark:border-slate-800 p-4">
                                {/* User Info */}
                                <div className="flex items-center justify-between mb-3">
                                    <div className="flex-1">
                                        <div className="text-sm font-bold text-slate-900 dark:text-white">{p.full_name}</div>
                                        <div className="text-xs text-slate-500 dark:text-slate-400">{p.email}</div>
                                        {/* Last Login - Phase 4 */}
                                        {p.last_login_at && (
                                            <div className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                                                Đăng nhập gần nhất: {formatRelativeTime(p.last_login_at)}
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {p.status === 'active' && !p.is_locked && (
                                            <div className="text-xs font-semibold px-2 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400">
                                                Hoạt động
                                            </div>
                                        )}
                                        {p.is_locked && (
                                            <div className="text-xs font-semibold px-2 py-1 rounded-full bg-rose-50 dark:bg-rose-900/20 text-rose-700 dark:text-rose-400 flex items-center gap-1">
                                                <Lock className="w-3 h-3" />
                                                Đã Khóa
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Locked Until Info */}
                                {p.is_locked && p.locked_until && (
                                    <div className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                                        Khóa đến: {new Date(p.locked_until).toLocaleString('vi-VN')}
                                    </div>
                                )}

                                {/* Status Messages */}
                                <div className="mb-2 space-y-1">
                                    {isDirty && (
                                        <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-600 dark:text-amber-400">
                                            <AlertTriangle className="w-3.5 h-3.5" />
                                            Đã thay đổi (chưa lưu)
                                        </div>
                                    )}
                                    {isSaving && (
                                        <div className="text-xs font-semibold text-slate-500 dark:text-slate-400">Đang lưu...</div>
                                    )}
                                    {isSuccess && !isDirty && !isSaving && (
                                        <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                                            <CheckCircle2 className="w-3.5 h-3.5" />
                                            Lưu thành công
                                        </div>
                                    )}
                                    {errorMessage && (
                                        <div className="flex items-start gap-2 text-xs text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-900/40 rounded-lg p-2">
                                            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                            Lỗi: {errorMessage}
                                        </div>
                                    )}
                                </div>

                                {/* Roles */}
                                <div className="mb-3">
                                    <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">Vai Trò</div>
                                    <div className="flex flex-wrap gap-2">
                                        {roles.map((r) => {
                                            const checked = roleSet.has(r.id);
                                            return (
                                                <label
                                                    key={r.id}
                                                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer transition-colors ${checked
                                                            ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300'
                                                            : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
                                                        }`}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        className="accent-indigo-600"
                                                        checked={checked}
                                                        disabled={isSaving}
                                                        onChange={(e) => handleToggleRole(p.id, r.id, e.target.checked)}
                                                    />
                                                    <span>{r.name}</span>
                                                </label>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Branch */}
                                <div className="mb-3">
                                    <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2 block">
                                        Chi Nhánh
                                    </label>
                                    <select
                                        value={draftBranchByUser[p.id] ?? p.branch_id ?? ''}
                                        disabled={isSaving || branches.length === 0}
                                        onChange={(e) => handleChangeBranch(p.id, e.target.value)}
                                        className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm"
                                    >
                                        <option value="">Chưa gán</option>
                                        {branches.map((b) => (
                                            <option key={b.id} value={b.id}>
                                                {b.name}
                                            </option>
                                        ))}
                                    </select>
                                </div>

                                {/* Permissions Panel - Phase 3 */}
                                <div className="mb-3 border-t border-slate-200 dark:border-slate-800 pt-3">
                                    <PermissionsPanel
                                        userId={p.id}
                                        rolePermissions={Array.from(roleSet)
                                            .map(roleId => roles.find(r => r.id === roleId))
                                            .filter(r => r !== undefined)
                                            .flatMap(r => r.permissions)}
                                    />
                                </div>

                                {/* Action Buttons */}
                                <div className="flex justify-between items-center gap-2 flex-wrap">
                                    <div className="flex gap-2">
                                        <button
                                            onClick={() => handleResetPassword(p.id)}
                                            disabled={isSaving || lockingByUser[p.id]}
                                            className="px-3 py-2 rounded-lg border border-amber-500 text-amber-600 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/10 disabled:opacity-50 text-xs font-semibold flex items-center gap-1.5 transition-colors"
                                        >
                                            <KeyRound className="w-3.5 h-3.5" />
                                            Đặt Lại MK
                                        </button>

                                        <button
                                            onClick={() => handleToggleLock(p.id, p.is_locked)}
                                            disabled={isSaving || lockingByUser[p.id]}
                                            className={`px-3 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                                                p.is_locked
                                                    ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                                                    : 'border border-rose-500 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-900/10'
                                            } disabled:opacity-50`}
                                        >
                                            {lockingByUser[p.id] ? (
                                                'Đang xử lý...'
                                            ) : p.is_locked ? (
                                                <>
                                                    <Unlock className="w-3.5 h-3.5" />
                                                    Mở Khóa
                                                </>
                                            ) : (
                                                <>
                                                    <Lock className="w-3.5 h-3.5" />
                                                    Khóa TK
                                                </>
                                            )}
                                        </button>
                                    </div>

                                    <button
                                        onClick={() => handleSaveUser(p.id)}
                                        disabled={!isDirty || isSaving || lockingByUser[p.id]}
                                        className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold transition-colors"
                                    >
                                        Lưu Thay Đổi
                                    </button>
                                </div>
                            </div>
                        );
                    })}

                    {/* Note */}
                    <div className="text-xs text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-lg p-3">
                        💡 Sau khi đổi quyền, user nên đăng xuất/đăng nhập lại để cập nhật permission mới.
                    </div>
                </div>
            )}

            {/* Password Reset Modal */}
            {resetPasswordUserId && generatedPassword && (
                <PasswordResetModal
                    password={generatedPassword}
                    onClose={() => {
                        setResetPasswordUserId(null);
                        setGeneratedPassword(null);
                    }}
                />
            )}
        </div>
    );
}
