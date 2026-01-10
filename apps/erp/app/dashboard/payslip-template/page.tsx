"use client";

import { useState, useEffect } from "react";
import {
    FileText, Save, Building2, Loader2, Check
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { getBranches, Branch } from "@/lib/api/timekeeping";
import {
    getPayslipTemplates,
    savePayslipTemplate,
    PayslipTemplate
} from "@/lib/api/payslips";

export default function PayslipTemplatePage() {
    const { user, isLoading: authLoading } = useAuth();
    const [branches, setBranches] = useState<Branch[]>([]);
    const [templates, setTemplates] = useState<PayslipTemplate[]>([]);
    const [selectedBranchId, setSelectedBranchId] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    // Form state
    const [formData, setFormData] = useState({
        company_name: '',
        company_address: '',
        company_phone: '',
        company_email: '',
        company_tax_code: '',
        logo_url: '',
        header_text: '',
        footer_text: ''
    });

    // Check permissions
    const hasPermission = user?.role === 'admin' || user?.role === 'accountant';

    useEffect(() => {
        loadData();
    }, []);

    useEffect(() => {
        // Load template for selected branch
        const template = templates.find(t =>
            selectedBranchId ? t.branch_id === selectedBranchId : t.is_default
        );
        if (template) {
            setFormData({
                company_name: template.company_name || '',
                company_address: template.company_address || '',
                company_phone: template.company_phone || '',
                company_email: template.company_email || '',
                company_tax_code: template.company_tax_code || '',
                logo_url: template.logo_url || '',
                header_text: template.header_text || '',
                footer_text: template.footer_text || ''
            });
        } else {
            // Reset to default values
            setFormData({
                company_name: '',
                company_address: '',
                company_phone: '',
                company_email: '',
                company_tax_code: '',
                logo_url: '',
                header_text: '',
                footer_text: ''
            });
        }
    }, [selectedBranchId, templates]);

    const loadData = async () => {
        setIsLoading(true);
        try {
            const [branchData, templateData] = await Promise.all([
                getBranches(),
                getPayslipTemplates()
            ]);
            setBranches(branchData);
            setTemplates(templateData);
        } catch (err) {
            console.error('Failed to load data:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            await savePayslipTemplate({
                branch_id: selectedBranchId,
                company_name: formData.company_name,
                company_address: formData.company_address || null,
                company_phone: formData.company_phone || null,
                company_email: formData.company_email || null,
                company_tax_code: formData.company_tax_code || null,
                logo_url: formData.logo_url || null,
                header_text: formData.header_text || null,
                footer_text: formData.footer_text || null,
                is_default: !selectedBranchId
            });
            await loadData();
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch (err) {
            console.error('Failed to save:', err);
            alert('Lỗi khi lưu mẫu phiếu lương');
        } finally {
            setIsSaving(false);
        }
    };

    if (authLoading || isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            </div>
        );
    }

    if (!hasPermission) {
        return (
            <div className="flex flex-col items-center justify-center h-[60vh] text-center">
                <div className="w-24 h-24 bg-red-100 rounded-full flex items-center justify-center mb-6">
                    <FileText className="w-12 h-12 text-red-500" />
                </div>
                <h1 className="text-2xl font-bold text-slate-900 mb-2">Không có quyền truy cập</h1>
                <p className="text-slate-500">Chỉ Admin và Kế toán mới có thể cấu hình mẫu phiếu lương.</p>
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="animate-fade-in">
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">Mẫu Phiếu Lương</h1>
                <p className="text-slate-500 mt-1">Cấu hình thông tin công ty cho phiếu lương</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Branch Selector + Form */}
                <div className="lg:col-span-2 space-y-6">
                    {/* Branch Selector */}
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                        <h3 className="font-semibold text-slate-900 mb-4 flex items-center gap-2">
                            <Building2 className="w-5 h-5 text-blue-500" />
                            Chọn chi nhánh
                        </h3>
                        <div className="flex flex-wrap gap-2">
                            <button
                                onClick={() => setSelectedBranchId(null)}
                                className={cn(
                                    "px-4 py-2 rounded-xl text-sm font-medium transition-all",
                                    !selectedBranchId
                                        ? "bg-blue-600 text-white shadow-lg"
                                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                                )}
                            >
                                Mặc định (Tất cả)
                            </button>
                            {branches.map(branch => (
                                <button
                                    key={branch.id}
                                    onClick={() => setSelectedBranchId(branch.id)}
                                    className={cn(
                                        "px-4 py-2 rounded-xl text-sm font-medium transition-all",
                                        selectedBranchId === branch.id
                                            ? "bg-blue-600 text-white shadow-lg"
                                            : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                                    )}
                                >
                                    {branch.name}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Company Info Form */}
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                        <h3 className="font-semibold text-slate-900 mb-6">Thông tin công ty</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="md:col-span-2">
                                <label className="text-sm text-slate-600 mb-1 block">Tên công ty *</label>
                                <input
                                    type="text"
                                    value={formData.company_name}
                                    onChange={e => setFormData({ ...formData, company_name: e.target.value })}
                                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                    placeholder="Công ty TNHH ABC"
                                />
                            </div>
                            <div className="md:col-span-2">
                                <label className="text-sm text-slate-600 mb-1 block">Địa chỉ</label>
                                <input
                                    type="text"
                                    value={formData.company_address}
                                    onChange={e => setFormData({ ...formData, company_address: e.target.value })}
                                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                    placeholder="123 Đường ABC, Quận XYZ, TP.HCM"
                                />
                            </div>
                            <div>
                                <label className="text-sm text-slate-600 mb-1 block">Số điện thoại</label>
                                <input
                                    type="text"
                                    value={formData.company_phone}
                                    onChange={e => setFormData({ ...formData, company_phone: e.target.value })}
                                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                    placeholder="028 1234 5678"
                                />
                            </div>
                            <div>
                                <label className="text-sm text-slate-600 mb-1 block">Email</label>
                                <input
                                    type="email"
                                    value={formData.company_email}
                                    onChange={e => setFormData({ ...formData, company_email: e.target.value })}
                                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                    placeholder="info@company.com"
                                />
                            </div>
                            <div>
                                <label className="text-sm text-slate-600 mb-1 block">Mã số thuế</label>
                                <input
                                    type="text"
                                    value={formData.company_tax_code}
                                    onChange={e => setFormData({ ...formData, company_tax_code: e.target.value })}
                                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                    placeholder="0123456789"
                                />
                            </div>
                            <div>
                                <label className="text-sm text-slate-600 mb-1 block">URL Logo</label>
                                <input
                                    type="text"
                                    value={formData.logo_url}
                                    onChange={e => setFormData({ ...formData, logo_url: e.target.value })}
                                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                    placeholder="https://..."
                                />
                            </div>
                            <div className="md:col-span-2">
                                <label className="text-sm text-slate-600 mb-1 block">Ghi chú đầu phiếu</label>
                                <textarea
                                    value={formData.header_text}
                                    onChange={e => setFormData({ ...formData, header_text: e.target.value })}
                                    rows={2}
                                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none"
                                    placeholder="Văn bản hiển thị ở đầu phiếu lương..."
                                />
                            </div>
                            <div className="md:col-span-2">
                                <label className="text-sm text-slate-600 mb-1 block">Ghi chú cuối phiếu</label>
                                <textarea
                                    value={formData.footer_text}
                                    onChange={e => setFormData({ ...formData, footer_text: e.target.value })}
                                    rows={2}
                                    className="w-full px-4 py-3 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none"
                                    placeholder="Văn bản hiển thị ở cuối phiếu lương..."
                                />
                            </div>
                        </div>

                        <div className="mt-6 flex justify-end">
                            <button
                                onClick={handleSave}
                                disabled={isSaving || !formData.company_name}
                                className={cn(
                                    "inline-flex items-center gap-2 px-6 py-3 text-white text-sm font-medium rounded-xl shadow-lg transition-all",
                                    saved ? "bg-green-500" : "gradient-primary hover:shadow-xl",
                                    (isSaving || !formData.company_name) && "opacity-60 cursor-not-allowed"
                                )}
                            >
                                {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                                {isSaving ? "Đang lưu..." : saved ? "Đã lưu!" : "Lưu mẫu"}
                            </button>
                        </div>
                    </div>
                </div>

                {/* Preview */}
                <div className="lg:col-span-1">
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sticky top-6">
                        <h3 className="font-semibold text-slate-900 mb-4">Xem trước</h3>
                        <div className="border border-slate-200 rounded-xl p-4 space-y-3 text-sm">
                            {formData.logo_url && (
                                <div className="flex justify-center">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                        src={formData.logo_url}
                                        alt="Logo"
                                        className="h-12 object-contain"
                                        onError={(e) => (e.currentTarget.style.display = 'none')}
                                    />
                                </div>
                            )}
                            <div className="text-center">
                                <p className="font-bold text-slate-900">{formData.company_name || 'Tên công ty'}</p>
                                {formData.company_address && (
                                    <p className="text-xs text-slate-500">{formData.company_address}</p>
                                )}
                                <div className="flex justify-center gap-4 text-xs text-slate-400 mt-1">
                                    {formData.company_phone && <span>📞 {formData.company_phone}</span>}
                                    {formData.company_email && <span>✉️ {formData.company_email}</span>}
                                </div>
                                {formData.company_tax_code && (
                                    <p className="text-xs text-slate-400">MST: {formData.company_tax_code}</p>
                                )}
                            </div>
                            {formData.header_text && (
                                <p className="text-xs text-slate-500 text-center italic">{formData.header_text}</p>
                            )}
                            <hr className="border-slate-200" />
                            <div className="text-center font-semibold text-blue-600">PHIẾU LƯƠNG</div>
                            <div className="h-24 flex items-center justify-center text-slate-300 text-xs">
                                [Nội dung phiếu lương]
                            </div>
                            <hr className="border-slate-200" />
                            {formData.footer_text && (
                                <p className="text-xs text-slate-500 text-center italic">{formData.footer_text}</p>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
