import React, { useState, useEffect } from 'react';
import { Shield, Plus, X, Search, Check } from 'lucide-react';
import { supabase } from '../../lib/supabaseClient';
import { PERMISSION_DEFINITIONS, getPermissionLabel, searchPermissions } from '../../lib/permissionDefinitions';

type SpecialPermission = {
  permission_code: string;
  granted: boolean;
  assigned_at: string;
  assigned_by_name: string;
};

type PermissionsPanelProps = {
  userId: string;
  rolePermissions: string[]; // Permissions from user's roles
};

export function PermissionsPanel({ userId, rolePermissions }: PermissionsPanelProps) {
  const [specialPermissions, setSpecialPermissions] = useState<SpecialPermission[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [expandedModules, setExpandedModules] = useState<Record<string, boolean>>({});

  useEffect(() => {
    loadSpecialPermissions();
  }, [userId]);

  const loadSpecialPermissions = async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('get_user_special_permissions', {
      p_user_id: userId
    });

    if (!error && data) {
      setSpecialPermissions(data);
    }
    setLoading(false);
  };

  const handleRemovePermission = async (permCode: string) => {
    if (!confirm(`Xóa quyền "${getPermissionLabel(permCode)}"?`)) return;

    const { error } = await supabase.rpc('remove_user_permission', {
      p_user_id: userId,
      p_permission_code: permCode
    });

    if (!error) {
      await loadSpecialPermissions();
    } else {
      alert(`Lỗi: ${error.message}`);
    }
  };

  const toggleModule = (moduleKey: string) => {
    setExpandedModules(prev => ({ ...prev, [moduleKey]: !prev[moduleKey] }));
  };

  // Group role permissions by module
  const rolePermsByModule: Record<string, string[]> = {};
  rolePermissions.forEach(perm => {
    const moduleKey = perm.split('.')[0];
    if (!rolePermsByModule[moduleKey]) {
      rolePermsByModule[moduleKey] = [];
    }
    rolePermsByModule[moduleKey].push(perm);
  });

  return (
    <div className="space-y-4">
      {/* Role Permissions Section */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <Shield className="w-4 h-4 text-blue-600" />
            Quyền Từ Vai Trò
          </h4>
          <button
            onClick={() => setExpandedModules(prev => {
              const allExpanded = Object.keys(PERMISSION_DEFINITIONS).every(k => prev[k]);
              return Object.keys(PERMISSION_DEFINITIONS).reduce((acc, k) => {
                acc[k] = !allExpanded;
                return acc;
              }, {} as Record<string, boolean>);
            })}
            className="text-xs text-indigo-600 dark:text-indigo-400 hover:underline"
          >
            {Object.values(expandedModules).every(v => v) ? 'Thu Gọn' : 'Xem Tất Cả'}
          </button>
        </div>

        {rolePermissions.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400 italic">
            User chưa có vai trò nào
          </p>
        ) : (
          <div className="space-y-2">
            {Object.entries(PERMISSION_DEFINITIONS).map(([moduleKey, module]) => {
              const modulePerms = rolePermsByModule[moduleKey] || [];
              if (modulePerms.length === 0) return null;

              const isExpanded = expandedModules[moduleKey];

              return (
                <div key={moduleKey} className="border-l-2 border-blue-300 dark:border-blue-700 pl-3">
                  <button
                    onClick={() => toggleModule(moduleKey)}
                    className="text-sm font-medium text-slate-700 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors"
                  >
                    {module.label} ({modulePerms.length})
                  </button>
                  {isExpanded && (
                    <div className="mt-1 space-y-1">
                      {modulePerms.map(perm => (
                        <div key={perm} className="text-xs text-slate-600 dark:text-slate-400 flex items-center gap-1">
                          <Check className="w-3 h-3 text-green-600" />
                          {getPermissionLabel(perm)}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Special Permissions Section */}
      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40 rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h4 className="font-semibold text-slate-900 dark:text-white flex items-center gap-2">
            <Shield className="w-4 h-4 text-amber-600" />
            Quyền Đặc Biệt
          </h4>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-1 px-3 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold transition-colors"
          >
            <Plus className="w-3 h-3" />
            Thêm Quyền
          </button>
        </div>

        {loading ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Đang tải...</p>
        ) : specialPermissions.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400 italic">
            Chưa có quyền đặc biệt nào
          </p>
        ) : (
          <div className="space-y-2">
            {specialPermissions.map(sp => (
              <div
                key={sp.permission_code}
                className="flex items-center justify-between bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-800 rounded-lg px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium text-slate-900 dark:text-white">
                    {getPermissionLabel(sp.permission_code)}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    Gán bởi: {sp.assigned_by_name || 'N/A'} • {new Date(sp.assigned_at).toLocaleDateString('vi-VN')}
                  </p>
                </div>
                <button
                  onClick={() => handleRemovePermission(sp.permission_code)}
                  className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300 transition-colors"
                  title="Xóa quyền này"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Permission Modal */}
      {showAddModal && (
        <AddPermissionModal
          userId={userId}
          existingPermissions={[...rolePermissions, ...specialPermissions.map(sp => sp.permission_code)]}
          onClose={() => setShowAddModal(false)}
          onAdded={() => {
            loadSpecialPermissions();
            setShowAddModal(false);
          }}
        />
      )}
    </div>
  );
}

// ========================================
// Add Permission Modal Component
// ========================================
type AddPermissionModalProps = {
  userId: string;
  existingPermissions: string[];
  onClose: () => void;
  onAdded: () => void;
};

function AddPermissionModal({ userId, existingPermissions, onClose, onAdded }: AddPermissionModalProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedPerm, setSelectedPerm] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const availablePermissions = searchPermissions(searchTerm).filter(
    p => !existingPermissions.includes(p.code)
  );

  const handleAdd = async () => {
    if (!selectedPerm) return;

    setAdding(true);
    const { error } = await supabase.rpc('add_user_permission', {
      p_user_id: userId,
      p_permission_code: selectedPerm,
      p_granted: true
    });

    setAdding(false);

    if (!error) {
      onAdded();
    } else {
      alert(`Lỗi: ${error.message}`);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-200 dark:border-slate-800 p-6 max-w-2xl w-full max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">
            Thêm Quyền Đặc Biệt
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="mb-4">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Tìm kiếm quyền..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-slate-300 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-950 text-slate-900 dark:text-white text-sm"
              autoFocus
            />
          </div>
        </div>

        {/* Permission List */}
        <div className="flex-1 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-lg mb-4">
          {availablePermissions.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400 p-4 text-center">
              {searchTerm ? 'Không tìm thấy quyền nào' : 'Tất cả quyền đã được gán'}
            </p>
          ) : (
            <div className="divide-y divide-slate-200 dark:divide-slate-800">
              {availablePermissions.map(perm => (
                <button
                  key={perm.code}
                  onClick={() => setSelectedPerm(perm.code)}
                  className={`w-full text-left px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-950 transition-colors ${
                    selectedPerm === perm.code ? 'bg-indigo-50 dark:bg-indigo-900/20 border-l-4 border-indigo-600' : ''
                  }`}
                >
                  <p className="text-sm font-medium text-slate-900 dark:text-white">
                    {perm.label}
                  </p>
                  <p className="text-xs text-slate-500 dark:text-slate-400">
                    {perm.module} • {perm.code}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-sm transition-colors"
          >
            Hủy
          </button>
          <button
            onClick={handleAdd}
            disabled={!selectedPerm || adding}
            className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:bg-slate-400 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors"
          >
            {adding ? 'Đang thêm...' : 'Thêm Quyền'}
          </button>
        </div>
      </div>
    </div>
  );
}
