import React, { useState } from 'react';
import { Settings, LogOut, Hexagon, X, ChevronRight } from 'lucide-react';
import { Tab } from '../types';
import { getDesktopNavItems, getMobileNavItems, isNavGroup, type NavEntry, type NavGroup, type NavItem } from '../lib/navigation';
import { useTenant } from '../lib/tenantContext';
import { getAppMode } from '../lib/appMode';
import { getPosBaseUrl } from '../lib/posUrl';
import { supabase } from '../lib/supabaseClient';
import { withTimeout } from '../lib/async';

import { useNavigate, useLocation } from 'react-router-dom';

interface SidebarProps {
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ isOpen, setIsOpen }) => {
  const { tenant } = useTenant();
  const navigate = useNavigate();
  const location = useLocation();
  const desktopItems = getDesktopNavItems();
  const mobileItems = getMobileNavItems();
  const mobileItemIds = new Set(mobileItems.map(i => i.id));
  const menuItems = desktopItems.filter(item => {
    if (isNavGroup(item)) {
      // Include groups that have at least one item not in mobile
      return item.items.some(i => !mobileItemIds.has(i.id));
    }
    return !mobileItemIds.has(item.id);
  });
  const appMode = getAppMode();
  const posUrl = getPosBaseUrl({ tenant, hostname: window.location.hostname });

  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());

  const activePath = location.pathname === '/' ? '/dashboard' : location.pathname;

  const toggleGroup = (groupId: string) => {
    setOpenGroups(prev => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const handleSignOut = async () => {
    if (!supabase) {
      window.alert('Chưa cấu hình Supabase.');
      return;
    }
    try {
      const { error: signOutError } = await withTimeout(
        supabase.auth.signOut(),
        8000,
        'Đăng xuất quá lâu. Vui lòng kiểm tra mạng và thử lại.'
      );
      if (signOutError) throw signOutError;
      setIsOpen(false);
      // Redirect immediately after successful signOut
      navigate('/login');
    } catch (e: any) {
      window.alert(e?.message ?? 'Đăng xuất thất bại.');
    }
  };

  const renderNavItem = (item: NavItem, isSubItem = false) => {
    const Icon = item.icon;
    const isActive = activePath.startsWith(item.path);
    return (
      <li key={item.id}>
        <button
          onClick={() => {
            if (item.id === Tab.POS && appMode === 'main') {
              window.open(posUrl, '_blank', 'noopener,noreferrer');
              return;
            }
            navigate(item.path);
            setIsOpen(false);
          }}
          className={`
            group flex gap-x-3 rounded-lg p-2 text-xs font-semibold w-full items-center transition-all duration-200
            ${isSubItem ? 'pl-8' : ''}
            ${isActive
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/30'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-900'
            }
          `}
        >
          <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-500 dark:text-slate-500 group-hover:text-slate-900 dark:group-hover:text-slate-300'}`} aria-hidden="true" />
          {item.label}
        </button>
      </li>
    );
  };

  const renderNavGroup = (group: NavGroup) => {
    const Icon = group.icon;
    const isOpen = openGroups.has(group.id);
    const hasActiveChild = group.items.some(item => activePath.startsWith(item.path));

    return (
      <li key={group.id}>
        <button
          onClick={() => toggleGroup(group.id)}
          className={`
            group flex gap-x-3 rounded-lg p-2 text-xs font-semibold w-full items-center transition-all duration-200 justify-between
            ${hasActiveChild
              ? 'bg-indigo-50 dark:bg-indigo-900/10 text-indigo-600 dark:text-indigo-400'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-900'
            }
          `}
        >
          <div className="flex gap-x-3 items-center">
            <Icon className={`h-4 w-4 shrink-0 ${hasActiveChild ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-500 group-hover:text-slate-900 dark:group-hover:text-slate-300'}`} aria-hidden="true" />
            {group.label}
          </div>
          <ChevronRight className={`h-3 w-3 transition-transform duration-200 ${isOpen ? 'rotate-90' : ''}`} />
        </button>
        {isOpen && (
          <ul className="mt-1 space-y-1">
            {group.items.map(item => renderNavItem(item, true))}
          </ul>
        )}
      </li>
    );
  };

  const renderNavEntry = (entry: NavEntry) => {
    if (isNavGroup(entry)) {
      return renderNavGroup(entry);
    }
    return renderNavItem(entry);
  };

  return (
    <div className={`relative z-50 lg:hidden ${isOpen ? 'block' : 'hidden'}`} role="dialog" aria-modal="true">
      {/* Background backdrop */}
      <div
        className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm transition-opacity opacity-100"
        onClick={() => setIsOpen(false)}
      />

      <div className="fixed inset-0 flex">
        {/* Off-canvas menu */}
        <div className="relative mr-16 flex w-full max-w-[280px] flex-1 transform transition-transform duration-300 translate-x-0">
          <div className="absolute top-0 right-0 -mr-12 pt-2">
            <button
              type="button"
              className="ml-1 flex h-10 w-10 items-center justify-center rounded-full focus:outline-none focus:ring-2 focus:ring-inset focus:ring-white"
              onClick={() => setIsOpen(false)}
            >
              <span className="sr-only">Close sidebar</span>
              <X className="h-5 w-5 text-white" aria-hidden="true" />
            </button>
          </div>

          <div className="flex grow flex-col gap-y-4 overflow-y-auto bg-white dark:bg-slate-950 px-4 pb-4 border-r border-slate-200 dark:border-slate-800">
            <div className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-200 dark:border-slate-800/50">
              <div className="bg-gradient-to-br from-indigo-600 to-violet-600 p-1 rounded-md shadow-lg shadow-indigo-900/50">
                <Hexagon className="w-4 h-4 text-white fill-current" />
              </div>
              <span className="text-base font-bold tracking-tight text-white font-sans">{tenant?.name ?? 'OneBiz'} ERP</span>
            </div>

            <nav className="flex flex-1 flex-col">
              <ul role="list" className="flex flex-1 flex-col gap-y-6">
                <li>
                  <ul role="list" className="-mx-2 space-y-1">
                    {menuItems.map(entry => renderNavEntry(entry))}
                  </ul>
                </li>

                <li className="mt-auto space-y-1 border-t border-slate-200 dark:border-slate-800/50 pt-4">

                  <button
                    type="button"
                    onClick={() => void handleSignOut()}
                    className="group -mx-2 flex gap-x-3 rounded-lg p-2 text-xs font-semibold leading-6 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-900 hover:text-slate-900 dark:hover:text-slate-200 w-full"
                  >
                    <LogOut className="h-4 w-4 shrink-0 text-slate-400 dark:text-slate-500 group-hover:text-slate-600 dark:group-hover:text-slate-300" aria-hidden="true" />
                    Đăng xuất
                  </button>
                </li>
              </ul>
            </nav>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Sidebar;
