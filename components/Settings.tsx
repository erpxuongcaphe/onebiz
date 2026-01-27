import React, { useEffect, useMemo, useState } from 'react';
import { KeyRound, LogOut, Database, AlertTriangle, CheckCircle2, UserPlus } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { useTenant, getCachedTenantId } from '../lib/tenantContext';
import { fetchCurrentBranchId } from '../lib/branches';
import { withTimeout } from '../lib/async';
import { bootstrapSuperAdmin, fetchProfiles, fetchRoles, fetchUserRoles, setUserBranch, setUserRole, type ProfileLite, type Role, type UserRole } from '../lib/roles';
import { fetchBranches, type Branch } from '../lib/branches';

const Settings: React.FC = () => {
  const { user, loading, isConfigured, permissionPatterns } = useAuth();
  const [roleUiUnlocked, setRoleUiUnlocked] = useState(false);
  const canManageRoles = roleUiUnlocked || permissionPatterns.some((p) => p === '*' || p.startsWith('roles.'));
  const { tenant } = useTenant();
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasProfile, setHasProfile] = useState<boolean | null>(null);
  const [branchId, setBranchId] = useState<string | null>(null);
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
  const [roleBusyKey, setRoleBusyKey] = useState<string>('');
  const [rolesLoading, setRolesLoading] = useState(false);

  useEffect(() => {
    if (!supabase || !user) {
      setHasProfile(null);
      return;
    }

    let isMounted = true;
    supabase
      .from('profiles')
      .select('id')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data, error: profileError }) => {
        if (!isMounted) return;
        if (profileError) {
          setHasProfile(false);
          return;
        }
        setHasProfile(Boolean(data?.id));
      });

    return () => {
      isMounted = false;
    };
  }, [user]);

  useEffect(() => {
    if (!supabase || !user) {
      setBranchId(null);
      return;
    }
    fetchCurrentBranchId().then((id) => setBranchId(id));
  }, [user]);

  useEffect(() => {
    if (!supabase || !user || !isConfigured) return;
    if (!canManageRoles) return;
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
    void loadRoleData();
  }, [user, isConfigured, canManageRoles]);

  const status = useMemo(() => {
    if (loading) return { tone: 'muted', label: 'Đang kiểm tra đăng nhập...' };
    if (!isConfigured) return { tone: 'warn', label: 'Chưa cấu hình Supabase (.env.local)' };
    if (!user) return { tone: 'muted', label: 'Chưa đăng nhập' };
    return { tone: 'ok', label: `Đăng nhập: ${user.email ?? 'unknown'}` };
  }, [loading, isConfigured, user]);

  const statusBadgeClass =
    status.tone === 'ok'
      ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400'
      : status.tone === 'warn'
        ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400'
        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300';

  const handleSignIn = async () => {
    setError(null);
    if (!supabase) {
      setError('Chưa cấu hình Supabase. Vui lòng thêm VITE_SUPABASE_URL và VITE_SUPABASE_ANON_KEY.');
      return;
    }
    if (!email.trim() || !password) {
      setError('Vui lòng nhập email và mật khẩu.');
      return;
    }

    setSubmitting(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) throw signInError;
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
      setError('Chưa cấu hình Supabase. Vui lòng thêm VITE_SUPABASE_URL và VITE_SUPABASE_ANON_KEY.');
      return;
    }
    if (!email.trim() || !password) {
      setError('Vui lòng nhập email và mật khẩu.');
      return;
    }

    setSubmitting(true);
    try {
      const tenantId = tenant?.id ?? getCachedTenantId();
      const { error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            full_name: fullName.trim() || undefined,
            tenant_id: tenantId || undefined,
          },
        },
      });
      if (signUpError) throw signUpError;
      setPassword('');
      setMode('signIn');
    } catch (e: any) {
      setError(e?.message ?? 'Tạo tài khoản thất bại.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSignOut = async () => {
    setError(null);
    if (!supabase) return;
    setSubmitting(true);
    try {
      const { error: signOutError } = await withTimeout(
        supabase.auth.signOut(),
        8000,
        'Đăng xuất quá lâu. Vui lòng kiểm tra mạng và thử lại.'
      );
      if (signOutError) throw signOutError;
    } catch (e: any) {
      try {
        await supabase.auth.signOut({ scope: 'local' });
        window.location.reload();
        return;
      } catch (localErr: any) {
        setError(localErr?.message ?? e?.message ?? 'Đăng xuất thất bại.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const tenantId = tenant?.id ?? getCachedTenantId() ?? null;

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

  const handleBootstrapRole = async () => {
    setRoleBusyKey('bootstrap');
    setRoleError(null);
    try {
      const ok = await bootstrapSuperAdmin();
      if (!ok) {
        setRoleError('Không bootstrap được vai trò (có thể tenant đã có role).');
        return;
      }
      setRoleUiUnlocked(true);
      const [roleList, profileList, userRoleList] = await Promise.all([
        fetchRoles(),
        fetchProfiles(),
        fetchUserRoles(),
      ]);
      setRoles(roleList);
      setProfiles(profileList);
      setUserRoles(userRoleList);
      setBranches(await fetchBranches());
    } finally {
      setRoleBusyKey('');
    }
  };

  const handleChangeBranch = (targetUserId: string, nextBranchId: string) => {
    setDraftBranchByUser((prev) => ({ ...prev, [targetUserId]: nextBranchId || null }));
    setDirtyByUser((prev) => ({ ...prev, [targetUserId]: true }));
    setSuccessByUser((prev) => ({ ...prev, [targetUserId]: false }));
    setErrorByUser((prev) => ({ ...prev, [targetUserId]: null }));
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

  return (
    <div className="space-y-3 lg:space-y-5 animate-fade-in pb-10">
      <div>
        <h1 className="text-lg lg:text-xl font-bold text-slate-900 dark:text-white">Cài đặt</h1>
        <p className="text-slate-500 dark:text-slate-400 text-[11px] mt-0.5">Kết nối tài khoản và cấu hình hệ thống.</p>
      </div>

      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-soft border border-slate-200 dark:border-slate-800 overflow-hidden">
        <div className="p-3 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-slate-400" />
            <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">Supabase</div>
          </div>
          <div className={`px-2 py-1 rounded-full text-[10px] font-bold ${statusBadgeClass} flex items-center gap-1.5`}>
            {status.tone === 'ok' ? <CheckCircle2 className="w-3 h-3" /> : status.tone === 'warn' ? <AlertTriangle className="w-3 h-3" /> : null}
            {status.label}
          </div>
        </div>

        <div className="p-3 space-y-3">
          <div className="text-[11px] text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-lg p-2.5">
            <div className="font-bold text-slate-800 dark:text-slate-200">Thông tin hệ thống</div>
            <div className="mt-1 grid grid-cols-1 sm:grid-cols-2 gap-1">
              <div><span className="text-slate-500 dark:text-slate-400">Tenant:</span> <span className="font-mono">{tenant?.id ?? getCachedTenantId() ?? '-'}</span></div>
              <div><span className="text-slate-500 dark:text-slate-400">Branch:</span> <span className="font-mono">{branchId ?? '-'}</span></div>
              <div className="sm:col-span-2"><span className="text-slate-500 dark:text-slate-400">Permissions:</span> <span className="font-mono">{permissionPatterns.length ? permissionPatterns.join(', ') : '-'}</span></div>
            </div>
          </div>
          {!isSupabaseConfigured && (
            <div className="text-[11px] text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 rounded-lg p-2.5">
              <div className="font-bold text-slate-800 dark:text-slate-200">Thiếu biến môi trường</div>
              <div className="mt-1">Tạo `.env.local` từ `.env.example` và điền:</div>
              <div className="mt-1 font-mono text-[10px]">VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY</div>
            </div>
          )}

          {error && (
            <div className="text-[11px] text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-900/40 rounded-lg p-2.5">
              {error}
            </div>
          )}

          {!user ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="sm:col-span-2 flex items-center justify-between">
                <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
                  <button
                    onClick={() => {
                      setMode('signIn');
                      setError(null);
                    }}
                    className={`px-3 py-1.5 text-[11px] font-bold ${mode === 'signIn' ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300'}`}
                  >
                    Đăng nhập
                  </button>
                  <button
                    onClick={() => {
                      setMode('signUp');
                      setError(null);
                    }}
                    className={`px-3 py-1.5 text-[11px] font-bold ${mode === 'signUp' ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300'}`}
                  >
                    Tạo tài khoản
                  </button>
                </div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400">
                  {mode === 'signUp' ? 'Tạo user + auto tạo profiles' : 'Supabase Auth'}
                </div>
              </div>

              {mode === 'signUp' && (
                <label className="block sm:col-span-2">
                  <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Họ tên</div>
                  <input
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
                    placeholder="Nguyễn Admin"
                    autoComplete="name"
                  />
                </label>
              )}
              <label className="block">
                <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Email</div>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
                  placeholder="admin@company.vn"
                  autoComplete="email"
                />
              </label>
              <label className="block">
                <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Mật khẩu</div>
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs"
                  type="password"
                  placeholder="••••••••"
                  autoComplete="current-password"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (mode === 'signUp') void handleSignUp();
                      else void handleSignIn();
                    }
                  }}
                />
              </label>

              <div className="sm:col-span-2 flex items-center justify-between gap-2">
                <div className="text-[10px] text-slate-500 dark:text-slate-400">
                  {mode === 'signUp'
                    ? 'Sau khi tạo tài khoản, profile sẽ tự sinh nếu đã chạy 006_triggers.sql.'
                    : 'Login dùng Supabase Auth (sau này sẽ dùng SSO giữa domain/subdomain).'}
                </div>
                <button
                  onClick={() => {
                    if (mode === 'signUp') void handleSignUp();
                    else void handleSignIn();
                  }}
                  disabled={submitting || !isSupabaseConfigured}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-xs font-bold"
                >
                  {mode === 'signUp' ? <UserPlus className="w-4 h-4" /> : <KeyRound className="w-4 h-4" />}
                  {mode === 'signUp' ? 'Tạo tài khoản' : 'Đăng nhập'}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-[11px] text-slate-600 dark:text-slate-300">
                  Tài khoản hiện tại: <span className="font-bold">{user.email}</span>
                </div>
                <button
                  onClick={() => void handleSignOut()}
                  disabled={submitting}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold"
                >
                  <LogOut className="w-4 h-4" />
                  Đăng xuất
                </button>
              </div>

              {isConfigured && hasProfile === false && (
                <div className="text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40 rounded-lg p-2.5 space-y-1">
                  <div className="font-bold">Thiếu hồ sơ (profiles)</div>
                  <div>Để bật dữ liệu thật theo tenant, cần tạo record trong `public.profiles` cho user này.</div>
                  <div className="font-mono text-[10px] bg-white/70 dark:bg-slate-950/40 border border-amber-200/60 dark:border-amber-900/40 rounded p-2 mt-1 overflow-x-auto">
                    {`insert into public.profiles (id, tenant_id, email, full_name)
select '${user.id}', t.id, '${user.email ?? ''}', 'Admin'
from public.tenants t
where t.custom_domain = 'onebiz.com.vn'
on conflict (id) do nothing;`}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-[11px] font-semibold text-slate-700 dark:text-slate-200">Phân quyền người dùng</div>
              {canManageRoles && (
                <button
                  onClick={async () => {
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
                  }}
                  className="px-2.5 py-1.5 rounded-lg text-[11px] font-bold border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                  disabled={rolesLoading}
                >
                  Tải lại
                </button>
              )}
            </div>

            {!canManageRoles && (
              <div className="text-[11px] text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40 rounded-lg p-2.5 space-y-2">
                <div className="font-bold">Chưa có quyền quản trị vai trò</div>
                <div>Nhấn nút dưới đây để bootstrap Super Admin cho user hiện tại nếu tenant chưa có role nào.</div>
                <button
                  onClick={() => void handleBootstrapRole()}
                  disabled={roleBusyKey === 'bootstrap'}
                  className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-bold"
                >
                  Cấp Super Admin cho tôi
                </button>
              </div>
            )}

            {roleError && (
              <div className="text-[11px] text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-900/40 rounded-lg p-2.5">
                {roleError}
              </div>
            )}

            {canManageRoles && (
              <div className="space-y-2">
                {rolesLoading && (
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Đang tải dữ liệu phân quyền...</div>
                )}
                {!rolesLoading && profiles.length === 0 && (
                  <div className="text-[11px] text-slate-500 dark:text-slate-400">Chưa có người dùng.</div>
                )}
                {profiles.map((p) => {
                  const roleSet = draftRolesByUser[p.id] ?? new Set<string>(userRoles.filter((ur) => ur.user_id === p.id).map((ur) => ur.role_id));
                  const isDirty = Boolean(dirtyByUser[p.id]);
                  const isSaving = Boolean(savingByUser[p.id]);
                  const errorMessage = errorByUser[p.id];
                  const isSuccess = Boolean(successByUser[p.id]);
                  return (
                    <div key={p.id} className="border border-slate-200 dark:border-slate-800 rounded-lg p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="text-[11px] font-bold text-slate-800 dark:text-slate-200 truncate">{p.full_name}</div>
                          <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">{p.email}</div>
                        </div>
                        <div className={`text-[10px] font-bold ${p.status === 'active' ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
                          {p.status}
                        </div>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        {isDirty && <div className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">Đã thay đổi (chưa lưu)</div>}
                        {isSaving && <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400">Đang lưu...</div>}
                        {isSuccess && !isDirty && !isSaving && (
                          <div className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">Lưu thành công</div>
                        )}
                      </div>
                      {errorMessage && (
                        <div className="mt-1 text-[10px] text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-900/40 rounded-lg p-2">
                          Lỗi: {errorMessage}
                        </div>
                      )}
                      <div className="mt-2 flex flex-wrap gap-2">
                        {roles.map((r) => {
                          const checked = roleSet.has(r.id);
                          const busy = isSaving;
                          return (
                            <label key={r.id} className={`flex items-center gap-1.5 px-2 py-1 rounded-md border text-[10px] font-bold ${checked ? 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300'}`}>
                              <input
                                type="checkbox"
                                className="accent-indigo-600"
                                checked={checked}
                                disabled={busy}
                                onChange={(e) => handleToggleRole(p.id, r.id, e.target.checked)}
                              />
                              <span>{r.name}</span>
                            </label>
                          );
                        })}
                      </div>
                      <div className="mt-2">
                        <div className="text-[10px] font-bold text-slate-500 dark:text-slate-400 mb-1">Chi nhánh</div>
                        <select
                          value={draftBranchByUser[p.id] ?? p.branch_id ?? ''}
                          disabled={isSaving || branches.length === 0}
                          onChange={(e) => handleChangeBranch(p.id, e.target.value)}
                          className="w-full px-2.5 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px]"
                        >
                          <option value="">Chưa gán</option>
                          {branches.map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="mt-2 flex items-center justify-end">
                        <button
                          onClick={() => void handleSaveUser(p.id)}
                          disabled={!isDirty || isSaving}
                          className="px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-[11px] font-bold"
                        >
                          Lưu
                        </button>
                      </div>
                    </div>
                  );
                })}
                <div className="text-[10px] text-slate-500 dark:text-slate-400">
                  Sau khi đổi quyền, user nên đăng xuất/đăng nhập lại để cập nhật permission mới.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;
