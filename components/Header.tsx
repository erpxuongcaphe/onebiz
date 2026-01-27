import React from 'react';
import { Menu, Bell, Search } from 'lucide-react';

interface HeaderProps {
  onMenuClick: () => void;
  title: string;
}

const Header: React.FC<HeaderProps> = ({ onMenuClick, title }) => {
  return (
    <header className="h-14 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 flex items-center justify-between px-4 sticky top-0 z-10 transition-all">
      <div className="flex items-center gap-3">
        <button 
          onClick={onMenuClick}
          className="lg:hidden p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 rounded-lg transition-colors"
        >
          <Menu className="w-5 h-5" />
        </button>
        {/* Breadcrumb or Title placeholder for mobile */}
        <h2 className="lg:hidden text-sm font-bold text-slate-900 dark:text-white">{title}</h2>
      </div>

      <div className="flex items-center gap-2 sm:gap-3">
        {/* Global Search - Hidden on small mobile */}
        <div className="hidden sm:flex items-center bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-1.5 focus-within:ring-2 focus-within:ring-indigo-500/20 focus-within:border-indigo-500 transition-all w-60">
          <Search className="w-3.5 h-3.5 text-slate-400" />
          <input 
            className="bg-transparent border-none outline-none text-xs ml-2 w-full text-slate-700 dark:text-slate-200 placeholder:text-slate-400"
            placeholder="Tìm kiếm nhanh (Ctrl + K)"
          />
        </div>

        <button className="relative p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors">
          <Bell className="w-4 h-4" />
          <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-rose-500 rounded-full ring-2 ring-white dark:ring-slate-900"></span>
        </button>

        <div className="h-6 w-px bg-slate-200 dark:bg-slate-700 hidden sm:block"></div>

        <div className="hidden sm:flex items-center gap-2">
          <div className="text-right hidden md:block">
            <div className="text-xs font-bold text-slate-900 dark:text-white">Nguyễn Admin</div>
            <div className="text-[10px] text-slate-500 dark:text-slate-400">nexus@business.com</div>
          </div>
          <img 
            src="https://picsum.photos/40/40?grayscale" 
            alt="Profile" 
            className="w-8 h-8 rounded-full border border-slate-200 dark:border-slate-700 shadow-sm cursor-pointer hover:ring-2 hover:ring-indigo-500/50 transition-all" 
          />
        </div>
      </div>
    </header>
  );
};

export default Header;