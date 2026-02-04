import React, { Suspense, useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation, Outlet } from 'react-router-dom';
import Navbar from './components/Navbar';
import Sidebar from './components/Sidebar';
import MobileNav from './components/MobileNav';
import { getAppMode } from './lib/appMode';
import { useAuth } from './lib/auth';
import DomainGuard from './components/utility/DomainGuard';

const LazyDashboard = React.lazy(() => import('./components/Dashboard'));
const LazyInventory = React.lazy(() => import('./components/Inventory'));
const LazySuppliers = React.lazy(() => import('./components/Suppliers'));
const LazyPurchaseOrders = React.lazy(() => import('./components/PurchaseOrders'));
const LazyGoodsReceipts = React.lazy(() => import('./components/GoodsReceipts'));
const LazySalesOrders = React.lazy(() => import('./components/SalesOrders'));
const LazyDeliveryOrders = React.lazy(() => import('./components/DeliveryOrders'));
const LazyPOS = React.lazy(() => import('./components/POS'));
const LazyReports = React.lazy(() => import('./components/Reports'));
const LazyFinance = React.lazy(() => import('./components/Finance'));
const LazyCustomers = React.lazy(() => import('./components/Customers'));
const LazySettings = React.lazy(() => import('./components/Settings'));
const LazyLoginPage = React.lazy(() => import('./components/LoginPage'));
const LazyForgotPasswordPage = React.lazy(() => import('./components/ForgotPasswordPage'));
const LazyResetPasswordPage = React.lazy(() => import('./components/ResetPasswordPage'));

const PageFallback = () => (
  <div className="text-[11px] text-slate-500 dark:text-slate-400 animate-fade-in">Đang tải...</div>
);

const LoadingScreen = () => (
  <div className="min-h-screen bg-slate-50/50 dark:bg-slate-950 flex items-center justify-center">
    <div className="text-center animate-fade-in">
      <div className="inline-block w-12 h-12 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4"></div>
      <p className="text-sm text-slate-600 dark:text-slate-400">Đang tải...</p>
    </div>
  </div>
);

const FeaturePending = () => (
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
  </div>
);

function MainLayout() {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isDarkMode, setIsDarkMode] = useState(false);
  const location = useLocation();

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

  return (
    <div className="min-h-screen bg-slate-50/50 dark:bg-slate-950 font-sans transition-colors duration-300">
      <Navbar
        isDarkMode={isDarkMode}
        toggleTheme={toggleTheme}
        onMenuClick={() => setIsSidebarOpen(true)}
      />

      {/* Mobile Bottom Navigation */}
      <MobileNav
        onMenuClick={() => setIsSidebarOpen(true)}
      />

      <Sidebar
        isOpen={isSidebarOpen}
        setIsOpen={setIsSidebarOpen}
      />

      <main className="p-3 sm:p-4 lg:p-6 pb-24 lg:pb-6 animate-in fade-in duration-500 ease-in-out">
        <div className="max-w-[1600px] mx-auto">
          <Suspense fallback={<PageFallback />}>
            <Outlet />
          </Suspense>
        </div>
      </main>
    </div>
  );
}

/**
 * Protected Route Wrapper
 * Redirects to login if user is not authenticated
 */
function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <LoadingScreen />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

function App() {
  const appMode = getAppMode();

  return (
    <Routes>
      {/* Public Routes */}
      <Route
        path="/login"
        element={
          <Suspense fallback={<LoadingScreen />}>
            <LazyLoginPage />
          </Suspense>
        }
      />
      <Route
        path="/forgot-password"
        element={
          <Suspense fallback={<LoadingScreen />}>
            <LazyForgotPasswordPage />
          </Suspense>
        }
      />
      <Route
        path="/reset-password"
        element={
          <Suspense fallback={<LoadingScreen />}>
            <LazyResetPasswordPage />
          </Suspense>
        }
      />

      {/* POS Route - Standalone, protected */}
      <Route
        path="/pos"
        element={
          <ProtectedRoute>
            <DomainGuard allowedMode="pos">
              <Suspense fallback={<LoadingScreen />}>
                <LazyPOS />
              </Suspense>
            </DomainGuard>
          </ProtectedRoute>
        }
      />

      {/* Protected Admin Routes */}
      <Route
        element={
          <ProtectedRoute>
            <DomainGuard allowedMode="main">
              <MainLayout />
            </DomainGuard>
          </ProtectedRoute>
        }
      >
        <Route index element={<Navigate to={appMode === 'pos' ? '/pos' : '/dashboard'} replace />} />
        <Route path="dashboard" element={<LazyDashboard />} />
        <Route path="inventory" element={<LazyInventory />} />
        <Route path="suppliers" element={<LazySuppliers />} />
        <Route path="purchase-orders" element={<LazyPurchaseOrders />} />
        <Route path="goods-receipts" element={<LazyGoodsReceipts />} />
        <Route path="sales-orders" element={<LazySalesOrders />} />
        <Route path="delivery-orders" element={<LazyDeliveryOrders />} />
        <Route path="reports" element={<LazyReports />} />
        <Route path="finance" element={<LazyFinance />} />
        <Route path="customers" element={<LazyCustomers />} />
        <Route path="settings" element={<LazySettings />} />
        <Route path="*" element={<FeaturePending />} />
      </Route>
    </Routes>
  );
}

export default App;
