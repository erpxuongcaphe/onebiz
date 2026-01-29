import React from 'react';
import { Menu } from 'lucide-react';
import { Tab } from '../types';
import { getMobileNavItems } from '../lib/navigation';
import { getAppMode } from '../lib/appMode';
import { getPosBaseUrl } from '../lib/posUrl';
import { useTenant } from '../lib/tenantContext';

import { useNavigate, useLocation } from 'react-router-dom';

interface MobileNavProps {
  onMenuClick: () => void;
}

const MobileNav: React.FC<MobileNavProps> = ({ onMenuClick }) => {
  const navItems = getMobileNavItems();
  const appMode = getAppMode();
  const { tenant } = useTenant();
  const navigate = useNavigate();
  const location = useLocation();
  const posUrl = getPosBaseUrl({ tenant, hostname: window.location.hostname });

  const activePath = location.pathname === '/' ? '/dashboard' : location.pathname;

  return (
    <div className="lg:hidden fixed bottom-0 left-0 right-0 bg-white/95 dark:bg-slate-900/95 backdrop-blur-lg border-t border-slate-200 dark:border-slate-800 pb-safe z-40 shadow-[0_-4px_20px_-5px_rgba(0,0,0,0.05)]">
      <div className="flex items-center justify-around h-16 px-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activePath.startsWith(item.path);
          return (
            <button
              key={item.id}
              onClick={() => {
                if (item.id === Tab.POS && appMode === 'main') {
                  window.open(posUrl, '_blank', 'noopener,noreferrer');
                  return;
                }
                navigate(item.path);
              }}
              className={`
                flex flex-col items-center justify-center w-full h-full gap-1
                transition-all duration-200 active:scale-90
                ${isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'}
              `}
            >
              <div className={`p-1 rounded-xl transition-all ${isActive ? 'bg-indigo-50 dark:bg-indigo-900/20' : ''}`}>
                <Icon className={`w-5 h-5 ${isActive ? 'stroke-[2.5px]' : 'stroke-2'}`} />
              </div>
              <span className={`text-[10px] leading-none ${isActive ? 'font-bold' : 'font-medium'}`}>{item.label}</span>
            </button>
          );
        })}

        {/* "More" Button triggers the sidebar */}
        <button
          onClick={onMenuClick}
          className="flex flex-col items-center justify-center w-full h-full gap-1 text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 transition-all duration-200 active:scale-90"
        >
          <div className="p-1">
            <Menu className="w-5 h-5 stroke-2" />
          </div>
          <span className="text-[10px] font-medium leading-none">Thêm</span>
        </button>
      </div>
    </div>
  );
};

export default MobileNav;
