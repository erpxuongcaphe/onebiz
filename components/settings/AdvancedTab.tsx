import React, { useState } from 'react';
import { Database, Eye, EyeOff, Terminal } from 'lucide-react';
import { getCachedTenantId } from '../../lib/tenantContext';

type AdvancedTabProps = {
    tenantId?: string | null;
    branchId?: string | null;
    permissionPatterns: string[];
    onBootstrapSuperAdmin?: () => Promise<void>;
};

export function AdvancedTab({ tenantId, branchId, permissionPatterns, onBootstrapSuperAdmin }: AdvancedTabProps) {
    const [showPerms, setShowPerms] = useState(false);
    const [bootstrapping, setBootstrapping] = useState(false);

    const handleBootstrap = async () => {
        if (!onBootstrapSuperAdmin) return;
        setBootstrapping(true);
        try {
            await onBootstrapSuperAdmin();
        } finally {
            setBootstrapping(false);
        }
    };

    return (
        <div className="space-y-4">
            {/* Technical Info */}
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-soft border border-slate-200 dark:border-slate-800 p-4">
                <div className="flex items-center gap-2 mb-4">
                    <Database className="w-5 h-5 text-slate-600 dark:text-slate-400" />
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">Thông Tin Kỹ Thuật</h3>
                </div>

                <div className="space-y-3 text-xs">
                    <div>
                        <div className="font-semibold text-slate-500 dark:text-slate-400 mb-1">Tenant ID</div>
                        <div className="font-mono text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-2 py-1.5 break-all">
                            {tenantId ?? getCachedTenantId() ?? '-'}
                        </div>
                    </div>

                    <div>
                        <div className="font-semibold text-slate-500 dark:text-slate-400 mb-1">Branch ID</div>
                        <div className="font-mono text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-2 py-1.5 break-all">
                            {branchId ?? '-'}
                        </div>
                    </div>

                    <div>
                        <div className="flex items-center justify-between mb-1">
                            <div className="font-semibold text-slate-500 dark:text-slate-400">
                                Permissions ({permissionPatterns.length})
                            </div>
                            <button
                                onClick={() => setShowPerms((v) => !v)}
                                className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-slate-200 dark:border-slate-700 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800"
                            >
                                {showPerms ? (
                                    <>
                                        <EyeOff className="w-3.5 h-3.5" />
                                        Ẩn
                                    </>
                                ) : (
                                    <>
                                        <Eye className="w-3.5 h-3.5" />
                                        Xem
                                    </>
                                )}
                            </button>
                        </div>
                        {showPerms && (
                            <div className="font-mono text-slate-900 dark:text-white bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded px-2 py-1.5 break-words max-h-40 overflow-y-auto">
                                {permissionPatterns.length ? permissionPatterns.join(', ') : '-'}
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Bootstrap Super Admin */}
            {onBootstrapSuperAdmin && (
                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40 rounded-xl p-4">
                    <div className="flex items-start gap-3">
                        <Terminal className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                        <div className="flex-1 space-y-2">
                            <div className="text-sm font-bold text-amber-900 dark:text-amber-200">
                                Bootstrap Super Admin
                            </div>
                            <div className="text-xs text-amber-800 dark:text-amber-300">
                                Nếu tenant chưa có role nào, nhấn nút dưới để tự động tạo các role mặc định và cấp Super Admin cho user hiện tại.
                            </div>
                            <button
                                onClick={handleBootstrap}
                                disabled={bootstrapping}
                                className="px-3 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 disabled:opacity-50 text-white text-xs font-semibold"
                            >
                                {bootstrapping ? 'Đang xử lý...' : 'Cấp Super Admin Cho Tôi'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Debug Note */}
            <div className="bg-slate-50 dark:bg-slate-900/50 border border-slate-200 dark:border-slate-800 rounded-xl p-4">
                <div className="text-xs text-slate-600 dark:text-slate-400 space-y-1">
                    <div className="font-semibold">📝 Lưu ý cho Developer:</div>
                    <ul className="list-disc list-inside space-y-0.5 ml-2">
                        <li>Tab này chỉ dành cho Super Admin</li>
                        <li>Thông tin kỹ thuật để debug, không hiển thị cho user thường</li>
                        <li>Bootstrap chỉ chạy 1 lần đầu tiên khi tenant chưa có role</li>
                    </ul>
                </div>
            </div>
        </div>
    );
}
