import React, { useEffect, useState, useMemo } from 'react';
import { useAuth } from '../lib/auth';
import { fetchCurrentBranchId } from '../lib/branches';
import { useTenant } from '../lib/tenantContext';
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

  const tenantId = tenant?.id ?? null;

  // Safety net: Should never reach here due to ProtectedRoute, but just in case
  if (!user && !loading) {
    return null;
  }
  const canManageRoles = useMemo(() =>
    roleUiUnlocked || permissionPatterns.some((p) => p === '*' || p.startsWith('roles.'))
  , [roleUiUnlocked, permissionPatterns]);

  const canManageTemplates = useMemo(() =>
    permissionPatterns.some((p) => p === '*' || p.startsWith('settings.'))
  , [permissionPatterns]);

  const isSuperAdmin = useMemo(() =>
    permissionPatterns.includes('*')
  , [permissionPatterns]);

  const isAdmin = useMemo(() =>
    canManageRoles || canManageTemplates || isSuperAdmin
  , [canManageRoles, canManageTemplates, isSuperAdmin]);

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
