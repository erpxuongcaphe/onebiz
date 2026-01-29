import React, { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth';
import { useTenant, getCachedTenantId } from '../lib/tenantContext';
import { fetchCurrentBranchId } from '../lib/branches';
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
      // Optionally switch to users tab after successful bootstrap
      setActiveTab('users');
    }
  };

  // If not logged in, show only profile tab which will show login form
  if (!user) {
    return (
      <div className="space-y-4 animate-fade-in pb-10">
        <div>
          <h1 className="text-lg lg:text-xl font-bold text-slate-900 dark:text-white">Cài Đặt</h1>
          <p className="text-slate-500 dark:text-slate-400 text-xs mt-0.5">
            Vui lòng đăng nhập để truy cập cài đặt.
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 rounded-xl shadow-soft border border-slate-200 dark:border-slate-800 p-8 text-center">
          <div className="text-sm text-slate-600 dark:text-slate-400">
            Chức năng đăng nhập sẽ được bổ sung trong phiên bản tiếp theo.
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
