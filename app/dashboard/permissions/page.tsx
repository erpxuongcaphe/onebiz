"use client";

import { useState, useEffect, useMemo } from "react";
import { Shield, Loader2, RotateCcw, Save, Check, X, Minus, User, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import {
    ALL_PERMISSIONS,
    getDefaultPermissionsByRole,
    getUserPermissionOverrides,
    bulkUpdateUserPermissions,
    resetUserPermissions,
    UserPermission
} from "@/lib/api/user-permissions";
import { UserRole } from "@/lib/database.types";

type UserRecord = {
    id: string;
    email: string;
    full_name?: string;
    role: UserRole;
};

// Permission state: true = granted override, false = revoked override, null = use role default
type PermissionState = boolean | null;

export default function PermissionsPage() {
    const { user } = useAuth();
    const [users, setUsers] = useState<UserRecord[]>([]);
    const [selectedUserId, setSelectedUserId] = useState<string>('');
    const [selectedUser, setSelectedUser] = useState<UserRecord | null>(null);

    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    // Role template permissions (default for this user's role)
    const [roleDefaults, setRoleDefaults] = useState<string[]>([]);
    // User's current overrides
    const [userOverrides, setUserOverrides] = useState<UserPermission[]>([]);
    // Local state for editing
    const [localPermissions, setLocalPermissions] = useState<Record<string, PermissionState>>({});
    const [hasChanges, setHasChanges] = useState(false);
    const [confirmReset, setConfirmReset] = useState<{ open: boolean; userName: string }>({ open: false, userName: '' });

    const isAdmin = user?.role === 'admin';

    // Group permissions by category
    const permissionGroups = useMemo(() => {
        const groups: Record<string, typeof ALL_PERMISSIONS[number][]> = {};
        for (const perm of ALL_PERMISSIONS) {
            if (!groups[perm.group]) groups[perm.group] = [];
            groups[perm.group].push(perm);
        }
        return groups;
    }, []);

    useEffect(() => {
        if (!isAdmin) return;
        fetchUsers();
    }, [isAdmin]);

    useEffect(() => {
        if (selectedUserId) {
            const foundUser = users.find(u => u.id === selectedUserId);
            setSelectedUser(foundUser || null);
            if (foundUser) {
                loadUserPermissions(foundUser);
            }
        } else {
            setSelectedUser(null);
            setRoleDefaults([]);
            setUserOverrides([]);
            setLocalPermissions({});
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedUserId, users]);

    const fetchUsers = async () => {
        setIsLoading(true);
        try {
            const { data: userData } = await supabase.from('users').select('*').order('full_name');
            if (userData) setUsers(userData as UserRecord[]);
        } catch (err) {
            console.error('Failed to fetch users:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const loadUserPermissions = async (targetUser: UserRecord) => {
        setIsLoading(true);
        try {
            const [defaults, overrides] = await Promise.all([
                getDefaultPermissionsByRole(targetUser.role),
                getUserPermissionOverrides(targetUser.id)
            ]);
            setRoleDefaults(defaults);
            setUserOverrides(overrides);

            // Initialize local state
            const local: Record<string, PermissionState> = {};
            for (const perm of ALL_PERMISSIONS) {
                const override = overrides.find(o => o.permission_code === perm.code);
                local[perm.code] = override ? override.granted : null;
            }
            setLocalPermissions(local);
            setHasChanges(false);
        } catch (err) {
            console.error('Failed to load permissions:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const isDefaultGranted = (code: string): boolean => {
        return roleDefaults.includes(code);
    };

    const handleSave = async () => {
        if (!selectedUser || !user) return;

        setIsSaving(true);
        try {
            const changes: { code: string; granted: boolean | null }[] = [];

            for (const perm of ALL_PERMISSIONS) {
                const current = localPermissions[perm.code];
                const originalOverride = userOverrides.find(o => o.permission_code === perm.code);
                const originalValue = originalOverride ? originalOverride.granted : null;

                if (current !== originalValue) {
                    changes.push({ code: perm.code, granted: current });
                }
            }

            if (changes.length > 0) {
                await bulkUpdateUserPermissions(selectedUser.id, changes, user.id);
                await loadUserPermissions(selectedUser);
            }

            alert('Đã lưu phân quyền thành công!');
        } catch (err) {
            console.error('Failed to save permissions:', err);
            alert('Lỗi khi lưu phân quyền');
        } finally {
            setIsSaving(false);
        }
    };

    const handleReset = () => {
        if (!selectedUser) return;
        setConfirmReset({
            open: true,
            userName: selectedUser.full_name || selectedUser.email
        });
    };

    const confirmResetAction = async () => {
        if (!selectedUser) return;
        setConfirmReset({ open: false, userName: '' });
        setIsSaving(true);
        try {
            await resetUserPermissions(selectedUser.id);
            await loadUserPermissions(selectedUser);
            toast.success('Đã reset về mặc định!');
        } catch (err: unknown) {
            console.error('Failed to reset permissions:', err);
            const errorMsg = err instanceof Error ? err.message : 'Lỗi không xác định';
            toast.error('Lỗi khi reset quyền', {
                description: errorMsg
            });
        } finally {
            setIsSaving(false);
        }
    };

    if (!isAdmin) {
        return (
            <div className="flex flex-col items-center justify-center h-96 text-center">
                <Shield className="w-16 h-16 text-red-400 mb-4" />
                <h2 className="text-xl font-bold text-slate-900 mb-2">Truy cập bị từ chối</h2>
                <p className="text-slate-500">Chỉ Admin mới có quyền truy cập trang này.</p>
            </div>
        );
    }

    const roleLabels: Record<UserRole, string> = {
        admin: 'Quản trị viên',
        accountant: 'Kế toán',
        branch_manager: 'Quản lý chi nhánh',
        member: 'Nhân viên'
    };

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Header */}
            <div>
                <h1 className="text-xl md:text-2xl font-bold tracking-tight text-slate-900">Phân quyền chi tiết</h1>
                <p className="text-slate-500 text-sm mt-0.5">Cấp hoặc thu hồi từng quyền cụ thể cho người dùng</p>
            </div>

            {/* User Selector */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 md:p-6">
                <label className="block text-sm font-medium text-slate-700 mb-2">
                    Chọn người dùng để phân quyền
                </label>
                <div className="relative">
                    <select
                        value={selectedUserId}
                        onChange={e => setSelectedUserId(e.target.value)}
                        className="w-full md:w-96 appearance-none px-4 py-3 pr-10 border border-slate-200 rounded-xl text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    >
                        <option value="">-- Chọn người dùng --</option>
                        {users.map(u => (
                            <option key={u.id} value={u.id}>
                                {u.full_name || u.email} ({roleLabels[u.role]})
                            </option>
                        ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none" />
                </div>
            </div>

            {/* Permission Editor */}
            {selectedUser && (
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                    {/* User Info Header */}
                    <div className="px-4 md:px-6 py-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
                                <User className="w-5 h-5 text-blue-600" />
                            </div>
                            <div>
                                <p className="font-semibold text-slate-900">{selectedUser.full_name || selectedUser.email}</p>
                                <p className="text-sm text-slate-500">
                                    Vai trò: <span className="font-medium text-slate-700">{roleLabels[selectedUser.role]}</span>
                                </p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={handleReset}
                                disabled={isSaving}
                                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                            >
                                <RotateCcw className="w-4 h-4" />
                                Reset
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={isSaving || !hasChanges}
                                className={cn(
                                    "inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-xl transition-all",
                                    hasChanges
                                        ? "bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-500/20"
                                        : "bg-slate-100 text-slate-400 cursor-not-allowed"
                                )}
                            >
                                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                Lưu thay đổi
                            </button>
                        </div>
                    </div>

                    {/* Legend */}
                    <div className="px-4 md:px-6 py-3 bg-slate-50 border-b border-slate-100 flex flex-wrap gap-4 text-sm">
                        <span className="flex items-center gap-1.5">
                            <span className="w-6 h-6 rounded-lg bg-green-100 flex items-center justify-center">
                                <Check className="w-4 h-4 text-green-600" />
                            </span>
                            Cấp quyền
                        </span>
                        <span className="flex items-center gap-1.5">
                            <span className="w-6 h-6 rounded-lg bg-red-100 flex items-center justify-center">
                                <X className="w-4 h-4 text-red-600" />
                            </span>
                            Thu hồi
                        </span>
                        <span className="flex items-center gap-1.5">
                            <span className="w-6 h-6 rounded-lg bg-slate-100 flex items-center justify-center">
                                <Minus className="w-4 h-4 text-slate-400" />
                            </span>
                            Theo mặc định
                        </span>
                    </div>

                    {/* Loading */}
                    {isLoading && (
                        <div className="flex items-center justify-center py-12">
                            <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
                        </div>
                    )}

                    {/* Permission Groups */}
                    {!isLoading && (
                        <div className="divide-y divide-slate-100">
                            {Object.entries(permissionGroups).map(([group, perms]) => (
                                <div key={group} className="px-4 md:px-6 py-4">
                                    <h3 className="text-sm font-semibold text-slate-900 mb-3">{group}</h3>
                                    <div className="space-y-2">
                                        {perms.map(perm => {
                                            const state = localPermissions[perm.code];
                                            const defaultGranted = isDefaultGranted(perm.code);
                                            // Effective value: if state is null, use default
                                            const isEnabled = state === null ? defaultGranted : state;
                                            const isOverridden = state !== null;

                                            return (
                                                <div
                                                    key={perm.code}
                                                    className={cn(
                                                        "flex items-center justify-between px-4 py-3 rounded-xl transition-all",
                                                        isOverridden
                                                            ? isEnabled
                                                                ? "bg-green-50 border border-green-200"
                                                                : "bg-red-50 border border-red-200"
                                                            : "bg-slate-50 border border-slate-200"
                                                    )}
                                                >
                                                    <div className="flex items-center gap-3">
                                                        <div className={cn(
                                                            "text-sm font-medium",
                                                            isOverridden
                                                                ? isEnabled ? "text-green-700" : "text-red-700"
                                                                : "text-slate-700"
                                                        )}>
                                                            {perm.label}
                                                        </div>
                                                        {isOverridden && (
                                                            <span className={cn(
                                                                "px-1.5 py-0.5 text-xs rounded",
                                                                isEnabled ? "bg-green-200 text-green-800" : "bg-red-200 text-red-800"
                                                            )}>
                                                                {isEnabled ? "Đã cấp" : "Đã thu hồi"}
                                                            </span>
                                                        )}
                                                        {!isOverridden && (
                                                            <span className="px-1.5 py-0.5 text-xs bg-slate-200 text-slate-600 rounded">
                                                                Mặc định: {defaultGranted ? "Có" : "Không"}
                                                            </span>
                                                        )}
                                                    </div>

                                                    {/* Toggle Switch */}
                                                    <div className="flex items-center gap-2">
                                                        {isOverridden && (
                                                            <button
                                                                onClick={() => {
                                                                    setLocalPermissions(prev => ({ ...prev, [perm.code]: null }));
                                                                    setHasChanges(true);
                                                                }}
                                                                className="text-xs text-slate-500 hover:text-slate-700 underline"
                                                            >
                                                                Reset
                                                            </button>
                                                        )}
                                                        <button
                                                            onClick={() => {
                                                                const newValue = !isEnabled;
                                                                // If toggling to same as default, set to null (reset)
                                                                if (newValue === defaultGranted) {
                                                                    setLocalPermissions(prev => ({ ...prev, [perm.code]: null }));
                                                                } else {
                                                                    setLocalPermissions(prev => ({ ...prev, [perm.code]: newValue }));
                                                                }
                                                                setHasChanges(true);
                                                            }}
                                                            className={cn(
                                                                "relative inline-flex h-7 w-12 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-offset-2",
                                                                isEnabled
                                                                    ? "bg-green-500 focus:ring-green-500"
                                                                    : "bg-slate-300 focus:ring-slate-400"
                                                            )}
                                                        >
                                                            <span
                                                                className={cn(
                                                                    "pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out",
                                                                    isEnabled ? "translate-x-5" : "translate-x-0"
                                                                )}
                                                            />
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Empty State */}
            {!selectedUser && !isLoading && (
                <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
                    <Shield className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                    <p className="text-slate-500">Chọn người dùng để xem và chỉnh sửa quyền</p>
                </div>
            )}

            {/* Reset Permissions Confirmation */}
            <ConfirmDialog
                open={confirmReset.open}
                onOpenChange={(open) => setConfirmReset({ ...confirmReset, open })}
                title="Reset quyền về mặc định?"
                description={`Tất cả quyền tùy chỉnh của "${confirmReset.userName}" sẽ bị xóa và quay về quyền mặc định theo vai trò. Hành động này không thể hoàn tác.`}
                confirmText="Reset"
                cancelText="Hủy"
                variant="destructive"
                onConfirm={confirmResetAction}
            />
        </div>
    );
}
