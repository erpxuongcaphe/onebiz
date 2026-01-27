import React from 'react';
import { CloudOff, ShieldCheck, Loader2 } from 'lucide-react';
import { useAuth } from '../lib/auth';

const AuthStatus: React.FC = () => {
  const { user, loading, isConfigured } = useAuth();

  if (loading) {
    return (
      <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] font-semibold">
        <Loader2 className="w-3 h-3 animate-spin" />
        Đang kết nối
      </div>
    );
  }

  if (!isConfigured) {
    return (
      <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-full bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 text-[10px] font-bold">
        <CloudOff className="w-3 h-3" />
        Chưa cấu hình DB
      </div>
    );
  }

  if (!user) {
    return (
      <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-[10px] font-semibold">
        <CloudOff className="w-3 h-3" />
        Chưa đăng nhập
      </div>
    );
  }

  return (
    <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold">
      <ShieldCheck className="w-3 h-3" />
      {user.email}
    </div>
  );
};

export default AuthStatus;
