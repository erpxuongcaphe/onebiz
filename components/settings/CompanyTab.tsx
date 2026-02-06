import React, { useState, useEffect } from 'react';
import { Building2, Save, CheckCircle2 } from 'lucide-react';
import { useTenant } from '../../lib/tenantContext';
import { supabase } from '../../lib/supabaseClient';

export function CompanyTab() {
    const { tenant } = useTenant();
    const [companyName, setCompanyName] = useState('');
    const [taxCode, setTaxCode] = useState('');
    const [address, setAddress] = useState('');
    const [phone, setPhone] = useState('');
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Populate form from tenant context (name + settings JSONB)
    useEffect(() => {
        if (!tenant) return;
        setCompanyName(tenant.name || '');
        setTaxCode(tenant.settings?.tax_code || '');
        setAddress(tenant.settings?.address || '');
        setPhone(tenant.settings?.phone || '');
    }, [tenant]);

    const handleSave = async () => {
        console.log('[CompanyTab] handleSave called', { companyName, taxCode, address, phone });
        if (!supabase) {
            console.error('[CompanyTab] Supabase not initialized');
            setError('Supabase chưa được khởi tạo');
            return;
        }
        setSaving(true);
        setError(null);
        try {
            console.log('[CompanyTab] Calling RPC update_company_settings...');
            const { error: rpcErr } = await supabase.rpc('update_company_settings', {
                p_name: companyName,
                p_tax_code: taxCode,
                p_address: address,
                p_phone: phone,
            });
            console.log('[CompanyTab] RPC response:', { error: rpcErr });
            if (rpcErr) throw rpcErr;
            setSaved(true);
            setTimeout(() => setSaved(false), 2500);
        } catch (e: any) {
            console.error('[CompanyTab] Save error:', e);
            setError(e?.message || 'Không thể lưu cấu hình');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="space-y-4">
            {/* Company Info */}
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-soft border border-slate-200 dark:border-slate-800 p-4">
                <div className="flex items-center gap-2 mb-4">
                    <Building2 className="w-5 h-5 text-indigo-600" />
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">Thông Tin Công Ty</h3>
                </div>

                <div className="space-y-3">
                    <div>
                        <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">
                            Tên Công Ty
                        </label>
                        <input
                            type="text"
                            value={companyName}
                            onChange={(e) => setCompanyName(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm"
                            placeholder="OneBiz Coffee"
                        />
                    </div>

                    <div>
                        <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">
                            Mã Số Thuế
                        </label>
                        <input
                            type="text"
                            value={taxCode}
                            onChange={(e) => setTaxCode(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm font-mono"
                            placeholder="0123456789"
                        />
                    </div>

                    <div>
                        <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">
                            Địa Chỉ
                        </label>
                        <textarea
                            value={address}
                            onChange={(e) => setAddress(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm"
                            rows={2}
                            placeholder="123 Đường ABC, Quận XYZ, TP.HCM"
                        />
                    </div>

                    <div>
                        <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">
                            Số Điện Thoại
                        </label>
                        <input
                            type="tel"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm"
                            placeholder="0901234567"
                        />
                    </div>

                    {error && (
                        <p className="text-xs text-rose-600 dark:text-rose-400">{error}</p>
                    )}

                    <div className="flex items-center gap-3">
                        <button
                            onClick={handleSave}
                            disabled={saving || saved}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold"
                        >
                            {saved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                            {saving ? 'Đang lưu...' : saved ? 'Đã lưu' : 'Lưu Cấu Hình'}
                        </button>
                    </div>
                </div>
            </div>

            {/* Branch Management */}
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-soft border border-slate-200 dark:border-slate-800 p-4">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white mb-3">Chi Nhánh</h3>

                <div className="text-xs text-slate-500 dark:text-slate-400 space-y-2">
                    <p>Quản lý chi nhánh được tích hợp trong module Inventory.</p>
                    <p>Vui lòng vào <strong>Kho Hàng → Dữ Liệu Gốc</strong> để thêm/sửa/xóa chi nhánh.</p>
                </div>
            </div>
        </div>
    );
}
