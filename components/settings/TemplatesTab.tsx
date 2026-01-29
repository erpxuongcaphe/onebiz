import React, { useEffect, useState } from 'react';
import { FileText, RefreshCw, Save, AlertTriangle } from 'lucide-react';
import {
    ensureDefaultTemplates,
    fetchDocumentTemplates,
    getActiveTemplate,
    upsertTemplate,
    type DocumentTemplate,
    type PaperSize,
    type TemplateSettings,
    type TemplateType,
} from '../../lib/documentTemplates';

type TemplatesTabProps = {
    tenantId: string | null;
    canManageTemplates: boolean;
};

export function TemplatesTab({ tenantId, canManageTemplates }: TemplatesTabProps) {
    const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
    const [templatesLoading, setTemplatesLoading] = useState(false);
    const [templatesError, setTemplatesError] = useState<string | null>(null);
    const [templateType, setTemplateType] = useState<TemplateType>('invoice_sale');
    const [paperSize, setPaperSize] = useState<PaperSize>('A5');
    const [templateName, setTemplateName] = useState('');
    const [templateSettings, setTemplateSettings] = useState<TemplateSettings>({});
    const [templateSaving, setTemplateSaving] = useState(false);

    const loadTemplates = async () => {
        if (!tenantId || !canManageTemplates) return;
        setTemplatesLoading(true);
        setTemplatesError(null);
        try {
            await ensureDefaultTemplates(tenantId);
            setTemplates(await fetchDocumentTemplates(tenantId));
        } catch (e: any) {
            setTemplatesError(e?.message ?? 'Không tải được mẫu chứng từ.');
        } finally {
            setTemplatesLoading(false);
        }
    };

    useEffect(() => {
        loadTemplates();
    }, [tenantId, canManageTemplates]);

    const handleSaveTemplate = async () => {
        if (!tenantId) return;
        setTemplateSaving(true);
        setTemplatesError(null);
        try {
            const active = getActiveTemplate(templates, templateType, paperSize);
            const ok = await upsertTemplate({
                id: active?.id,
                tenant_id: tenantId,
                template_type: templateType,
                paper_size: paperSize,
                name: templateName || active?.name || 'Mẫu chứng từ',
                settings: templateSettings,
                layout: active?.layout ?? { columns: [], show_totals: true },
                version: active?.version ?? 1,
                is_active: true,
            });
            if (!ok) throw new Error('Lưu mẫu thất bại.');
            setTemplates(await fetchDocumentTemplates(tenantId));
        } catch (e: any) {
            setTemplatesError(e?.message ?? 'Lưu mẫu thất bại.');
        } finally {
            setTemplateSaving(false);
        }
    };

    if (!canManageTemplates) {
        return (
            <div className="text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/40 rounded-lg p-4">
                Cần quyền `settings.*` để quản lý mẫu chứng từ.
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <FileText className="w-5 h-5 text-indigo-600" />
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white">Mẫu Chứng Từ</h3>
                </div>
                <button
                    onClick={loadTemplates}
                    disabled={templatesLoading}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 text-xs font-semibold"
                >
                    <RefreshCw className={`w-3.5 h-3.5 ${templatesLoading ? 'animate-spin' : ''}`} />
                    Tải Lại
                </button>
            </div>

            {/* Error */}
            {templatesError && (
                <div className="flex items-start gap-2 text-xs text-rose-700 dark:text-rose-400 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-900/40 rounded-lg p-3">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    {templatesError}
                </div>
            )}

            {/* Template Selection */}
            <div className="bg-white dark:bg-slate-900 rounded-xl shadow-soft border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                        <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">
                            Loại Chứng Từ
                        </label>
                        <select
                            value={templateType}
                            onChange={(e) => setTemplateType(e.target.value as TemplateType)}
                            className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm"
                        >
                            <option value="invoice_sale">Hóa đơn bán hàng</option>
                            <option value="payment_slip">Phiếu thanh toán</option>
                            <option value="payment_receipt">Phiếu thu</option>
                            <option value="payment_voucher">Phiếu chi</option>
                            <option value="delivery_note">Phiếu giao hàng</option>
                            <option value="purchase_order">Phiếu đặt hàng</option>
                            <option value="transfer_note">Phiếu chuyển hàng</option>
                            <option value="void_note">Phiếu hủy hàng</option>
                            <option value="production_order">Phiếu sản xuất</option>
                            <option value="inventory_receipt">Phiếu nhập kho</option>
                            <option value="inventory_issue">Phiếu xuất kho</option>
                            <option value="inventory_transfer">Phiếu chuyển kho</option>
                        </select>
                    </div>

                    <div>
                        <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">
                            Khổ Giấy
                        </label>
                        <select
                            value={paperSize}
                            onChange={(e) => setPaperSize(e.target.value as PaperSize)}
                            className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm"
                        >
                            <option value="A4">A4</option>
                            <option value="A5">A5</option>
                            {templateType === 'payment_slip' && <option value="80mm">80mm</option>}
                        </select>
                    </div>

                    <div>
                        <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">
                            Tên Mẫu
                        </label>
                        <input
                            value={templateName}
                            onChange={(e) => setTemplateName(e.target.value)}
                            className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm"
                            placeholder="Mẫu mặc định"
                        />
                    </div>
                </div>
            </div>

            {/* Template Settings */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Company Info */}
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-soft border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                    <h4 className="text-xs font-bold text-slate-700 dark:text-slate-200">Thông Tin Đơn Vị</h4>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <div className="sm:col-span-2">
                            <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">Tên Đơn Vị</label>
                            <input
                                value={templateSettings.company_name ?? ''}
                                onChange={(e) => setTemplateSettings((prev) => ({ ...prev, company_name: e.target.value }))}
                                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm"
                            />
                        </div>
                        <div>
                            <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">Mã Số Thuế</label>
                            <input
                                value={templateSettings.company_tax_code ?? ''}
                                onChange={(e) => setTemplateSettings((prev) => ({ ...prev, company_tax_code: e.target.value }))}
                                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm"
                            />
                        </div>
                        <div>
                            <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">Hotline</label>
                            <input
                                value={templateSettings.company_phone ?? ''}
                                onChange={(e) => setTemplateSettings((prev) => ({ ...prev, company_phone: e.target.value }))}
                                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm"
                            />
                        </div>
                        <div className="sm:col-span-2">
                            <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">Địa Chỉ</label>
                            <input
                                value={templateSettings.company_address ?? ''}
                                onChange={(e) => setTemplateSettings((prev) => ({ ...prev, company_address: e.target.value }))}
                                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm"
                            />
                        </div>
                        <div className="sm:col-span-2">
                            <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">Logo URL</label>
                            <input
                                value={templateSettings.logo_url ?? ''}
                                onChange={(e) => setTemplateSettings((prev) => ({ ...prev, logo_url: e.target.value }))}
                                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm"
                            />
                        </div>
                    </div>
                </div>

                {/* Display Settings */}
                <div className="bg-white dark:bg-slate-900 rounded-xl shadow-soft border border-slate-200 dark:border-slate-800 p-4 space-y-3">
                    <h4 className="text-xs font-bold text-slate-700 dark:text-slate-200">Hiển Thị & Nội Dung</h4>

                    <div className="space-y-3">
                        <div>
                            <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">Header</label>
                            <input
                                value={templateSettings.header_text ?? ''}
                                onChange={(e) => setTemplateSettings((prev) => ({ ...prev, header_text: e.target.value }))}
                                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm"
                            />
                        </div>
                        <div>
                            <label className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1 block">Footer</label>
                            <input
                                value={templateSettings.footer_text ?? ''}
                                onChange={(e) => setTemplateSettings((prev) => ({ ...prev, footer_text: e.target.value }))}
                                className="w-full px-3 py-2 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm"
                            />
                        </div>
                        <div className="flex items-center gap-4">
                            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">
                                <input
                                    type="checkbox"
                                    checked={Boolean(templateSettings.show_vat)}
                                    onChange={(e) => setTemplateSettings((prev) => ({ ...prev, show_vat: e.target.checked }))}
                                    className="accent-indigo-600"
                                />
                                Hiện VAT
                            </label>
                            <div className="flex items-center gap-2">
                                <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">VAT %</label>
                                <input
                                    type="number"
                                    value={templateSettings.vat_rate ?? 10}
                                    onChange={(e) => setTemplateSettings((prev) => ({ ...prev, vat_rate: Number(e.target.value) }))}
                                    className="w-20 px-2 py-1.5 rounded-lg bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-sm"
                                />
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Save Button */}
            <div className="flex justify-end">
                <button
                    onClick={handleSaveTemplate}
                    disabled={templateSaving}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-semibold"
                >
                    <Save className="w-4 h-4" />
                    {templateSaving ? 'Đang lưu...' : 'Lưu Mẫu'}
                </button>
            </div>
        </div>
    );
}
