import React, { Suspense, useEffect, useMemo, useState } from 'react';
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import MobileNav from './components/MobileNav';
import { Tab } from './types';
import { getAppMode } from './lib/appMode';

const LazyDashboard = React.lazy(() => import('./components/Dashboard'));
const LazyInventory = React.lazy(() => import('./components/Inventory'));
const LazyOrders = React.lazy(() => import('./components/Orders'));
const LazyPOS = React.lazy(() => import('./components/POS'));
const LazyReports = React.lazy(() => import('./components/Reports'));
const LazyFinance = React.lazy(() => import('./components/Finance'));
const LazyCustomers = React.lazy(() => import('./components/Customers'));
const LazySettings = React.lazy(() => import('./components/Settings'));

const PageFallback = () => (
  <div className="text-[11px] text-slate-500 dark:text-slate-400 animate-fade-in">Đang tải...</div>
);

function App() {
  const appMode = getAppMode();
  const [activeTab, setActiveTab] = useState<Tab>(appMode === 'pos' ? Tab.POS : Tab.DASHBOARD);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);

  // Initialize Theme
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
  }, [isDarkMode]);

  const toggleTheme = () => {
    setIsDarkMode(!isDarkMode);
  };

  const content = useMemo(() => {
    switch (activeTab) {
      case Tab.DASHBOARD:
        return <LazyDashboard />;
      case Tab.INVENTORY:
        return <LazyInventory />;
      case Tab.ORDERS:
        return <LazyOrders />;
      case Tab.POS:
        return <LazyPOS />;
      case Tab.REPORTS:
        return <LazyReports />;
      case Tab.FINANCE:
        return <LazyFinance />;
      case Tab.CUSTOMERS:
        return <LazyCustomers />;
      case Tab.SETTINGS:
        return <LazySettings />;
      default:
        return (
          <div className="flex flex-col items-center justify-center h-[60vh] text-center animate-fade-in">
            <div className="w-16 h-16 bg-slate-100 dark:bg-slate-800/50 rounded-2xl flex items-center justify-center mb-4 text-slate-400 dark:text-slate-500 shadow-inner border border-slate-200 dark:border-slate-800">
              <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
            </div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Tính năng đang phát triển</h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1.5 max-w-xs mx-auto leading-relaxed">
              Module này sẽ sớm được cập nhật trong phiên bản tiếp theo của OneBiz ERP với nhiều công cụ mạnh mẽ hơn.
            </p>
            <button
              onClick={() => setActiveTab(Tab.DASHBOARD)}
              className="mt-6 px-5 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold rounded-lg hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors shadow-sm"
            >
              Quay lại tổng quan
            </button>
          </div>
        );
    }
  }, [activeTab]);

  return (
    <div className="min-h-screen bg-slate-50/50 dark:bg-slate-950 font-sans transition-colors duration-300">
      
      <Navbar 
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isDarkMode={isDarkMode}
        toggleTheme={toggleTheme}
        onMenuClick={() => setIsSidebarOpen(true)}
      />

      {/* Mobile Bottom Navigation - The "Future" Touch */}
      <MobileNav 
         activeTab={activeTab} 
         setActiveTab={setActiveTab}
         onMenuClick={() => setIsSidebarOpen(true)}
      />

      {/* Sidebar acts as "More" menu on mobile now */}
      <Sidebar 
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isOpen={isSidebarOpen}
        setIsOpen={setIsSidebarOpen}
      />

      {/* Added pb-20 to accommodate MobileNav */}
      <main className="p-3 sm:p-4 lg:p-6 pb-24 lg:pb-6 animate-in fade-in duration-500 ease-in-out">
        <div className="max-w-[1600px] mx-auto">
          <Suspense fallback={<PageFallback />}>
            {content}
          </Suspense>
        </div>
      </main>

    </div>
  );
}

export default App;
