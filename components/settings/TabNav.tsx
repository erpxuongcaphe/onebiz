import React from 'react';
import { User, Building2, Users, FileText, Settings as SettingsIcon } from 'lucide-react';

type Tab = 'profile' | 'company' | 'users' | 'templates' | 'advanced';

type TabItem = {
    id: Tab;
    label: string;
    icon: React.ReactNode;
    adminOnly?: boolean;
    superAdminOnly?: boolean;
};

const tabs: TabItem[] = [
    { id: 'profile', label: 'Hồ Sơ', icon: <User className="w-4 h-4" /> },
    { id: 'company', label: 'Công Ty', icon: <Building2 className="w-4 h-4" />, adminOnly: true },
    { id: 'users', label: 'Người Dùng', icon: <Users className="w-4 h-4" />, adminOnly: true },
    { id: 'templates', label: 'Mẫu', icon: <FileText className="w-4 h-4" />, adminOnly: true },
    { id: 'advanced', label: 'Nâng Cao', icon: <SettingsIcon className="w-4 h-4" />, superAdminOnly: true },
];

type TabNavProps = {
    activeTab: Tab;
    onTabChange: (tab: Tab) => void;
    isAdmin?: boolean;
    isSuperAdmin?: boolean;
};

export function TabNav({ activeTab, onTabChange, isAdmin = false, isSuperAdmin = false }: TabNavProps) {
    const visibleTabs = tabs.filter((tab) => {
        if (tab.superAdminOnly) return isSuperAdmin;
        if (tab.adminOnly) return isAdmin || isSuperAdmin;
        return true;
    });

    return (
        <div className="border-b border-slate-200 dark:border-slate-800 mb-4">
            {/* Desktop: Horizontal tabs */}
            <div className="hidden md:flex gap-1">
                {visibleTabs.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => onTabChange(tab.id)}
                        className={`
              flex items-center gap-2 px-4 py-2.5 text-sm font-semibold border-b-2 transition-colors
              ${activeTab === tab.id
                                ? 'border-indigo-600 text-indigo-600 dark:text-indigo-400'
                                : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                            }
            `}
                    >
                        {tab.icon}
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Mobile: Dropdown select */}
            <div className="md:hidden">
                <select
                    value={activeTab}
                    onChange={(e) => onTabChange(e.target.value as Tab)}
                    className="w-full px-3 py-2 text-sm font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg"
                >
                    {visibleTabs.map((tab) => (
                        <option key={tab.id} value={tab.id}>
                            {tab.label}
                        </option>
                    ))}
                </select>
            </div>
        </div>
    );
}

export type { Tab, TabItem };
export { tabs };
