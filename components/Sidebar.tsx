import React from 'react';
import { Settings, LogOut, Hexagon, X } from 'lucide-react';
import { Tab } from '../types';
import { getDesktopNavItems } from '../lib/navigation';
import { useTenant } from '../lib/tenantContext';
import { getAppMode } from '../lib/appMode';
import { getPosBaseUrl } from '../lib/posUrl';
import { supabase } from '../lib/supabaseClient';
import { withTimeout } from '../lib/async';

interface SidebarProps {
  activeTab: Tab;
  setActiveTab: (tab: Tab) => void;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ activeTab, setActiveTab, isOpen, setIsOpen }) => {
  const { tenant } = useTenant();
  const menuItems = getDesktopNavItems();
  const appMode = getAppMode();
  const posUrl = getPosBaseUrl({ tenant, hostname: window.location.hostname });

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
    } catch (e: any) {
      window.alert(e?.message ?? 'Đăng xuất thất bại.');
    }
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

          <div className="flex grow flex-col gap-y-4 overflow-y-auto bg-slate-950 px-4 pb-4 border-r border-slate-800">
            <div className="flex h-14 shrink-0 items-center gap-2 border-b border-slate-800/50">
               <div className="bg-gradient-to-br from-indigo-600 to-violet-600 p-1 rounded-md shadow-lg shadow-indigo-900/50">
                 <Hexagon className="w-4 h-4 text-white fill-current" />
               </div>
                <span className="text-base font-bold tracking-tight text-white font-sans">{tenant?.name ?? 'OneBiz'} ERP</span>
            </div>
            
            <nav className="flex flex-1 flex-col">
              <ul role="list" className="flex flex-1 flex-col gap-y-6">
                <li>
                  <ul role="list" className="-mx-2 space-y-1">
                    {menuItems.map((item) => {
                       const Icon = item.icon;
                       const isActive = activeTab === item.id;
                       return (
                        <li key={item.id}>
                          <button
                            onClick={() => {
                              if (item.id === Tab.POS && appMode === 'main') {
                                window.open(posUrl, '_blank', 'noopener,noreferrer');
                                return;
                              }
                              setActiveTab(item.id);
                              setIsOpen(false);
                            }}
                            className={`
                              group flex gap-x-3 rounded-lg p-2 text-xs font-semibold w-full items-center transition-all duration-200
                              ${isActive 
                                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-900/30' 
                                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                              }
                            `}
                          >
                            <Icon className={`h-4 w-4 shrink-0 ${isActive ? 'text-white' : 'text-slate-500 group-hover:text-slate-300'}`} aria-hidden="true" />
                            {item.label}
                          </button>
                        </li>
                       )
                    })}
                  </ul>
                </li>
                
                <li className="mt-auto space-y-1 border-t border-slate-800/50 pt-4">
                  <button 
                    onClick={() => {
                        setActiveTab(Tab.SETTINGS);
                        setIsOpen(false);
                    }}
                    className={`group -mx-2 flex gap-x-3 rounded-lg p-2 text-xs font-semibold leading-6 w-full ${activeTab === Tab.SETTINGS ? 'bg-slate-900 text-white' : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'}`}
                  >
                    <Settings className="h-4 w-4 shrink-0" aria-hidden="true" />
                    Cài đặt
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSignOut()}
                    className="group -mx-2 flex gap-x-3 rounded-lg p-2 text-xs font-semibold leading-6 text-slate-400 hover:bg-slate-900 hover:text-slate-200 w-full"
                  >
                    <LogOut className="h-4 w-4 shrink-0 text-slate-500 group-hover:text-slate-300" aria-hidden="true" />
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
