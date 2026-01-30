import React, { useEffect, useState } from 'react';
import { Database, KeyRound, UserPlus, AlertTriangle } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { supabase, isSupabaseConfigured } from '../lib/supabaseClient';
import { useTenant, getCachedTenantId } from '../lib/tenantContext';
import { fetchCurrentBranchId } from '../lib/branches';
import { withTimeout } from '../lib/async';
import { TabNav, type Tab } from './settings/TabNav';
import { ProfileTab } from './settings/ProfileTab';
import { CompanyTab } from './settings/CompanyTab';
import { UsersTab } from './settings/UsersTab';
import { TemplatesTab } from './settings/TemplatesTab';
import { AdvancedTab } from './settings/AdvancedTab';
import { bootstrapSuperAdmin } from '../lib/roles';

const Settings: React.FC = () => {
  const { user, loading, isConfigured, permissionPatterns } = useAuth();
  const { tenant } = useTenant();
  const [activeTab, setActiveTab] = useState<Tab>('profile');
  const [branchId, setBranchId] = useState<string | null>(null);
  const [roleUiUnlocked, setRoleUiUnlocked] = useState(false);

  // Login/Signup state
  const [mode, setMode] = useState<'signIn' | 'signUp'>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tenantId = tenant?.id ?? getCachedTenantId() ?? null;
  const canManageRoles = roleUiUnlocked || permissionPatterns.some((p) => p === '*' || p.startsWith('roles.'));
  const canManageTemplates = permissionPatterns.some((p) => p === '*' || p.startsWith('settings.'));
  const isSuperAdmin = permissionPatterns.includes('*');
  const isAdmin = canManageRoles || canManageTemplates || isSuperAdmin;

  useEffect(() => {
    if (!user) {
      setBranchId(null);
      return;
    }
    fetchCurrentBranchId().then((id) => setBranchId(id));
  }, [user]);

  const handleBootstrapSuperAdmin = async () => {
    const ok = await bootstrapSuperAdmin();
    if (ok) {
      setRoleUiUnlocked(true);
      setActiveTab('users');
    }
  };

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

  // If not logged in, show login/signup form
  if (!user) {
    return (
      <div className="space-y-4 animate-fade-in pb-10">
        <div>
          <h1 className="text-lg lg:text-xl font-bold text-slate-900 dark:text-white">Cài Đặt</h1>
          <p className="text-slate-500 dark:text-slate-400 text-xs mt-0.5">
            Kết nối tài khoản và cấu hình Supabase.
          </p>
        </div>

        {/* Login/Signup Card */}
        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-soft border border-slate-200 dark:border-slate-800 p-4">
          <div className="flex items-center gap-2 mb-4">
            <Database className="w-5 h-5 text-indigo-600" />
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">Tài Khoản & Kết Nối</h3>
          </div>

          {!isSupabaseConfigured && (
            <div className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40 rounded-lg p-3 mb-4">
              <div className="font-bold mb-1">Thiếu biến môi trường</div>
              <div>Tạo `.env.local` từ `.env.example` và điền:</div>
              <div className="font-mono text-[10px] mt-1">VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY</div>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 text-xs text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-900/40 rounded-lg p-3 mb-4">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          {/* Mode Toggle */}
          <div className="flex items-center justify-between mb-4">
            <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-800 overflow-hidden">
              <button
                onClick={() => {
                  setMode('signIn');
                  setError(null);
                }}
                className={`px-4 py-2 text-xs font-semibold ${mode === 'signIn'
                    ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white'
                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300'
                  }`}
              >
                Đăng Nhập
              </button>
              <button
                onClick={() => {
                  setMode('signUp');
                  setError(null);
                }}
                className={`px-4 py-2 text-xs font-semibold ${mode === 'signUp'
                    ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-white'
                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300'
                  }`}
              >
                Tạo Tài Khoản
              </button>
            </div>
            <div className="text-[10px] text-slate-500 dark:text-slate-400">
              {mode === 'signUp' ? 'Tạo user + auto tạo profiles' : 'Supabase Auth'}
            </div>
          </div>

          {/* Form */}
          <div className="space-y-3">
            {mode === 'signUp' && (
              <div>
                <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">
                  Họ Tên
                </label>
                <input
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm"
                  placeholder="Nguyễn Admin"
                  autoComplete="name"
                />
              </div>
            )}

            <div>
              <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">
                Email
              </label>
              <input
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm"
                placeholder="admin@company.vn"
                autoComplete="email"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">
                Mật Khẩu
              </label>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type="password"
                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm"
                placeholder="••••••••"
                autoComplete="current-password"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    if (mode === 'signUp') handleSignUp();
                    else handleSignIn();
                  }
                }}
              />
            </div>

            <div className="flex items-center justify-between gap-3 pt-2">
              <div className="text-[10px] text-slate-500 dark:text-slate-400 flex-1">
                {mode === 'signUp'
                  ? 'Sau khi tạo tài khoản, profile sẽ tự sinh nếu đã chạy 006_triggers.sql.'
                  : 'Login dùng Supabase Auth (sau này sẽ dùng SSO giữa domain/subdomain).'}
              </div>
              <button
                onClick={() => {
                  if (mode === 'signUp') handleSignUp();
                  else handleSignIn();
                }}
                disabled={submitting || !isSupabaseConfigured}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold shrink-0"
              >
                {mode === 'signUp' ? <UserPlus className="w-4 h-4" /> : <KeyRound className="w-4 h-4" />}
                {mode === 'signUp' ? 'Tạo Tài Khoản' : 'Đăng Nhập'}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in pb-10">
      {/* Header */}
      <div>
        <h1 className="text-lg lg:text-xl font-bold text-slate-900 dark:text-white">Cài Đặt</h1>
        <p className="text-slate-500 dark:text-slate-400 text-xs mt-0.5">
          Quản lý thông tin cá nhân, công ty, và hệ thống.
        </p>
      </div>

      {/* Tab Navigation */}
      <TabNav
        activeTab={activeTab}
        onTabChange={setActiveTab}
        isAdmin={isAdmin}
        isSuperAdmin={isSuperAdmin}
      />

      {/* Tab Content */}
      <div>
        {activeTab === 'profile' && (
          <ProfileTab
            branchName={branchId ? 'Chi nhánh' : undefined}
            roleName={canManageRoles ? 'Quản trị viên' : 'Người dùng'}
          />
        )}

        {activeTab === 'company' && <CompanyTab />}

        {activeTab === 'users' && (
          <UsersTab
            tenantId={tenantId}
            canManageRoles={canManageRoles}
            onBootstrapSuccess={() => setRoleUiUnlocked(true)}
          />
        )}

        {activeTab === 'templates' && (
          <TemplatesTab
            tenantId={tenantId}
            canManageTemplates={canManageTemplates}
          />
        )}

        {activeTab === 'advanced' && (
          <AdvancedTab
            tenantId={tenantId}
            branchId={branchId}
            permissionPatterns={permissionPatterns}
            onBootstrapSuperAdmin={handleBootstrapSuperAdmin}
          />
        )}
      </div>
    </div>
  );
};

export default Settings;
