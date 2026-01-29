import React, { useState } from 'react';
import { Building2, Save } from 'lucide-react';

type CompanyTabProps = {
    // Will expand later with actual company data
};

export function CompanyTab({ }: CompanyTabProps) {
    const [companyName, setCompanyName] = useState('OneBiz ERP');
    const [taxCode, setTaxCode] = useState('');
    const [address, setAddress] = useState('');
    const [phone, setPhone] = useState('');
    const [saving, setSaving] = useState(false);

    const handleSave = async () => {
        setSaving(true);
        // TODO: Implement save company settings API
        await new Promise((resolve) => setTimeout(resolve, 1000));
        setSaving(false);
        alert('Lưu thành công! (Tính năng đang phát triển)');
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

                    <button
                        onClick={handleSave}
                        disabled={saving}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold"
                    >
                        <Save className="w-4 h-4" />
                        {saving ? 'Đang lưu...' : 'Lưu Cấu Hình'}
                    </button>
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
