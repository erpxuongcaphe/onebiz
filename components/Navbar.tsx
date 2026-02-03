import React, { useState, useRef, useEffect } from 'react';
import { Settings, Moon, Sun, Bell, Search, Hexagon, Menu, ChevronDown } from 'lucide-react';
import { Tab } from '../types';
import { getDesktopNavItems, isNavGroup, type NavEntry, type NavGroup, type NavItem } from '../lib/navigation';
import AuthStatus from './AuthStatus';
import { useTenant } from '../lib/tenantContext';
import { getAppMode } from '../lib/appMode';
import { getPosBaseUrl } from '../lib/posUrl';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';

interface NavbarProps {
  isDarkMode: boolean;
  toggleTheme: () => void;
  onMenuClick: () => void;
}

const Navbar: React.FC<NavbarProps> = ({ isDarkMode, toggleTheme, onMenuClick }) => {
  const { tenant } = useTenant();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const menuItems = getDesktopNavItems();
  const appMode = getAppMode();
  const posUrl = getPosBaseUrl({ tenant, hostname: window.location.hostname });

  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const activePath = location.pathname === '/' ? '/dashboard' : location.pathname;

  // Get user display name and avatar
  const userName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'User';
  const userAvatar = user?.user_metadata?.avatar_url;
  const userInitial = userName.charAt(0).toUpperCase();

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setOpenGroup(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleNavItemClick = (item: NavItem) => {
    if (item.id === Tab.POS && appMode === 'main') {
      window.open(posUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    navigate(item.path);
    setOpenGroup(null);
  };

  const renderNavItem = (item: NavItem) => {
    const Icon = item.icon;
    const isActive = activePath.startsWith(item.path);
    return (
      <button
        key={item.id}
        onClick={() => handleNavItemClick(item)}
        className={`
          flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ease-in-out whitespace-nowrap
          ${isActive
            ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm ring-1 ring-slate-200 dark:ring-slate-600'
            : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-white/50 dark:hover:bg-slate-700/50'
          }
        `}
      >
        <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 dark:text-slate-500'}`} />
        {item.label}
      </button>
    );
  };

  const renderNavGroup = (group: NavGroup) => {
    const Icon = group.icon;
    const isOpen = openGroup === group.id;
    const hasActiveChild = group.items.some(item => activePath.startsWith(item.path));

    return (
      <div key={group.id} className="relative" ref={isOpen ? dropdownRef : null}>
        <button
          onClick={() => setOpenGroup(isOpen ? null : group.id)}
          className={`
            flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ease-in-out whitespace-nowrap
            ${hasActiveChild
              ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm ring-1 ring-slate-200 dark:ring-slate-600'
              : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-white/50 dark:hover:bg-slate-700/50'
            }
          `}
        >
          <Icon className={`w-3.5 h-3.5 ${hasActiveChild ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 dark:text-slate-500'}`} />
          {group.label}
          <ChevronDown className={`w-3 h-3 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
        </button>

        {isOpen && (
          <div className="absolute top-full left-0 mt-1 w-48 bg-white dark:bg-slate-800 rounded-lg shadow-lg ring-1 ring-slate-200 dark:ring-slate-700 py-1 z-50">
            {group.items.map(item => {
              const ItemIcon = item.icon;
              const isActive = activePath.startsWith(item.path);
              return (
                <button
                  key={item.id}
                  onClick={() => handleNavItemClick(item)}
                  className={`
                    w-full flex items-center gap-2 px-3 py-2 text-xs font-medium transition-colors
                    ${isActive
                      ? 'bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700/50'
                    }
                  `}
                >
                  <ItemIcon className={`w-3.5 h-3.5 ${isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 dark:text-slate-500'}`} />
                  {item.label}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const renderNavEntry = (entry: NavEntry) => {
    if (isNavGroup(entry)) {
      return renderNavGroup(entry);
    }
    return renderNavItem(entry);
  };

  return (
    <nav className="sticky top-0 z-40 w-full bg-white/80 dark:bg-slate-900/90 backdrop-blur-xl border-b border-slate-200/60 dark:border-slate-800 transition-colors duration-200">
      <div className="max-w-[1920px] mx-auto px-3 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-11 lg:h-14"> {/* Ultra slim h-11 mobile */}

          {/* Logo & Mobile Menu */}
          <div className="flex items-center gap-2 lg:gap-5">
            {/* Mobile Menu Button - HIDDEN now because we use Bottom Nav */}
            <button
              onClick={onMenuClick}
              className="hidden p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 rounded-lg transition-colors"
            >
              <Menu className="w-4 h-4" />
            </button>

            <div className="flex items-center gap-1.5 cursor-pointer" onClick={() => navigate('/')}>
              <div className="bg-gradient-to-br from-indigo-600 to-violet-600 p-0.5 rounded-md shadow-md shadow-indigo-500/20">
                <Hexagon className="w-4 h-4 text-white fill-current" />
              </div>
              <span className="text-sm lg:text-base font-bold tracking-tight text-slate-900 dark:text-white">{tenant?.name ?? 'OneBiz'}</span>
            </div>
          </div>

          {/* Desktop Navigation */}
          <div className="hidden lg:flex items-center space-x-1 mx-6 bg-slate-100/50 dark:bg-slate-800/50 p-1 rounded-xl border border-slate-200/50 dark:border-slate-700/50">
            {menuItems.map(entry => renderNavEntry(entry))}
          </div>

          {/* Right Actions */}
          <div className="flex items-center gap-1 sm:gap-3">
            {/* Search - Collapsed on mobile */}
            <button className="md:hidden p-1.5 text-slate-500">
              <Search className="w-3.5 h-3.5" />
            </button>

            <div className="hidden md:flex items-center bg-slate-100 dark:bg-slate-800 rounded-lg px-2.5 py-1.5 focus-within:ring-2 focus-within:ring-indigo-500/20 border border-transparent focus-within:border-indigo-500 transition-all w-48 group">
              <Search className="w-3 h-3 text-slate-400 group-focus-within:text-indigo-500 transition-colors" />
              <input
                className="bg-transparent border-none outline-none text-xs ml-2 w-full text-slate-700 dark:text-slate-200 placeholder:text-slate-400"
                placeholder="Tìm kiếm..."
              />
            </div>

            <div className="flex items-center gap-0.5">
              <button
                onClick={toggleTheme}
                className="p-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors"
              >
                {isDarkMode ? <Sun className="w-3.5 h-3.5" /> : <Moon className="w-3.5 h-3.5" />}
              </button>

              <button
                onClick={() => navigate('/settings')}
                className={`p-1.5 rounded-full transition-colors ${activePath === '/settings' ? 'bg-indigo-50 text-indigo-600 dark:bg-indigo-900/30 dark:text-indigo-400' : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}
              >
                <Settings className="w-3.5 h-3.5" />
              </button>

              <button className="relative p-1.5 text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors">
                <Bell className="w-3.5 h-3.5" />
                <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-rose-500 rounded-full ring-1 ring-white dark:ring-slate-900"></span>
              </button>
            </div>

            <AuthStatus />

            <div className="h-4 w-px bg-slate-200 dark:bg-slate-700 hidden sm:block mx-1"></div>

            <button
              onClick={() => navigate('/settings')}
              className="flex items-center gap-2 pl-1 group"
            >
              {userAvatar ? (
                <img
                  src={userAvatar}
                  alt={userName}
                  className="w-6 h-6 lg:w-7 lg:h-7 rounded-full border border-slate-200 dark:border-slate-700 group-hover:ring-2 ring-indigo-500/50 transition-all object-cover"
                />
              ) : (
                <div className="w-6 h-6 lg:w-7 lg:h-7 rounded-full border border-slate-200 dark:border-slate-700 bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-300 flex items-center justify-center text-xs font-semibold group-hover:ring-2 ring-indigo-500/50 transition-all">
                  {userInitial}
                </div>
              )}
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
