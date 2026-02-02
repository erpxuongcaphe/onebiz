import React, { useState } from 'react';
import { Copy, CheckCircle, X, AlertTriangle } from 'lucide-react';

type PasswordResetModalProps = {
  password: string;
  onClose: () => void;
};

export function PasswordResetModal({ password, onClose }: PasswordResetModalProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(password);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-900 rounded-xl shadow-xl border border-slate-200 dark:border-slate-800 p-6 max-w-md w-full mx-4 animate-fade-in">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-bold text-slate-900 dark:text-white">
            Mật Khẩu Tạm Thời
          </h3>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-4">
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Mật khẩu tạm thời đã được tạo. Sao chép và gửi cho người dùng qua kênh liên lạc riêng.
          </p>

          {/* Password Display */}
          <div className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg p-4">
            <div className="flex items-center justify-between gap-3">
              <code className="text-lg font-mono font-bold text-indigo-600 dark:text-indigo-400 break-all">
                {password}
              </code>
              <button
                onClick={handleCopy}
                className="shrink-0 flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-semibold transition-colors"
              >
                {copied ? (
                  <>
                    <CheckCircle className="w-4 h-4" />
                    Đã Sao Chép
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" />
                    Sao Chép
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Warning */}
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40 rounded-lg p-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-800 dark:text-amber-300">
                ⚠️ Người dùng nên đổi mật khẩu này ngay sau khi đăng nhập (Cài Đặt → Hồ Sơ → Đổi Mật Khẩu).
              </p>
            </div>
          </div>

          {/* Instructions */}
          <div className="text-xs text-slate-500 dark:text-slate-400 space-y-1">
            <p className="font-semibold">Hướng dẫn gửi cho người dùng:</p>
            <ol className="list-decimal list-inside space-y-0.5 pl-2">
              <li>Gửi mật khẩu qua kênh bảo mật (chat nội bộ, email riêng)</li>
              <li>Hướng dẫn user đăng nhập với mật khẩu này</li>
              <li>Nhắc user đổi mật khẩu ngay trong mục Cài Đặt</li>
            </ol>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-semibold text-sm transition-colors"
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  );
}
