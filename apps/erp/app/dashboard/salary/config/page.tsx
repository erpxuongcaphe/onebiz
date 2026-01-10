"use client";

import { useState, useEffect } from "react";
import { DollarSign, Save, Clock, Calendar, Loader2, Check, Users as UsersIcon, Percent, FileText, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import {
    getSalaryConfigs,
    updateSalaryConfigs,
    SalaryConfig,
    PayType
} from "@/lib/api/salary-config";
import { logActivity } from "@/lib/api/activity-logs";

export default function SalaryConfigPage() {
    const { user, isLoading: authLoading } = useAuth();
    const [payType, setPayType] = useState<PayType>('monthly');
    const [configs, setConfigs] = useState<SalaryConfig[]>([]);
    const [editedValues, setEditedValues] = useState<Record<string, string>>({});
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [saved, setSaved] = useState(false);

    const canEdit = user?.role === 'admin' || user?.role === 'accountant';

    useEffect(() => {
        loadConfigs();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [payType]);

    const loadConfigs = async () => {
        setIsLoading(true);
        try {
            const data = await getSalaryConfigs(payType);
            setConfigs(data);
            const values: Record<string, string> = {};
            data.forEach(c => { values[c.id] = c.config_value; });
            setEditedValues(values);
        } catch (err) {
            console.error('Failed to load configs:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const updates = Object.entries(editedValues).map(([id, value]) => ({
                id,
                config_value: value
            }));
            await updateSalaryConfigs(updates);

            if (user) {
                logActivity({
                    userId: user.employeeId || user.id,
                    userName: user.fullName,
                    userRole: user.role,
                    action: 'update',
                    entityType: 'salary_config',
                    entityId: payType,
                    entityName: payType === 'monthly' ? 'Cấu hình lương tháng' : 'Cấu hình lương giờ',
                    details: { updated_keys: Object.keys(editedValues).length }
                });
            }
            await loadConfigs();
            setSaved(true);
            setTimeout(() => setSaved(false), 2000);
        } catch (err) {
            console.error('Failed to save:', err);
            alert('Lỗi khi lưu cấu hình');
        } finally {
            setIsSaving(false);
        }
    };

    const getValue = (key: string) => {
        const config = configs.find(c => c.config_key === key);
        return config ? editedValues[config.id] || '' : '';
    };

    const setValue = (key: string, value: string) => {
        const config = configs.find(c => c.config_key === key);
        if (config) {
            setEditedValues(prev => ({ ...prev, [config.id]: value }));
        }
    };

    if (authLoading || !user) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            </div>
        );
    }

    if (!canEdit) {
        return (
            <div className="flex flex-col items-center justify-center h-[60vh] text-center">
                <div className="w-24 h-24 bg-red-100 rounded-full flex items-center justify-center mb-6">
                    <DollarSign className="w-12 h-12 text-red-500" />
                </div>
                <h1 className="text-2xl font-bold text-slate-900 mb-2">Không có quyền truy cập</h1>
                <p className="text-slate-500 max-w-md">
                    Trang cấu hình lương chỉ dành cho Quản trị viên và Kế toán.
                </p>
            </div>
        );
    }

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-64">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="animate-fade-in">
                <Link
                    href="/dashboard/salary"
                    className="inline-flex items-center gap-2 text-sm text-slate-600 hover:text-slate-900 mb-4"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Quay lại Trang lương
                </Link>
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">Cấu hình lương</h1>
                <p className="text-slate-500 mt-1">Thiết lập mức lương, phụ cấp và các thông số tính lương</p>
            </div>

            {/* Header với Pay Type */}
            <div className="flex items-center justify-between">
                <div className="flex p-1 bg-slate-100 rounded-lg">
                    <button
                        onClick={() => setPayType('monthly')}
                        className={cn(
                            "flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all",
                            payType === 'monthly' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500"
                        )}
                    >
                        <Calendar className="w-4 h-4" />
                        Lương tháng
                    </button>
                    <button
                        onClick={() => setPayType('hourly')}
                        className={cn(
                            "flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-all",
                            payType === 'hourly' ? "bg-white text-emerald-600 shadow-sm" : "text-slate-500"
                        )}
                    >
                        <Clock className="w-4 h-4" />
                        Lương giờ
                    </button>
                </div>

                {canEdit && (
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className={cn(
                            "inline-flex items-center gap-2 px-5 py-2.5 text-white text-sm font-medium rounded-xl shadow-lg transition-all",
                            saved ? "bg-green-500" : "gradient-primary hover:shadow-xl",
                            isSaving && "opacity-80"
                        )}
                    >
                        {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                        {isSaving ? "Đang lưu..." : saved ? "Đã lưu!" : "Lưu"}
                    </button>
                )}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* LƯƠNG CƠ BẢN */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="p-2 bg-blue-100 rounded-lg">
                            <DollarSign className="w-5 h-5 text-blue-600" />
                        </div>
                        <h3 className="font-semibold text-slate-900">Lương cơ bản</h3>
                    </div>

                    {payType === 'monthly' ? (
                        <div className="space-y-4">
                            <div>
                                <label className="text-sm text-slate-600 mb-1 block">Lương cơ bản (VND/tháng)</label>
                                <input
                                    type="number"
                                    value={getValue('base_salary')}
                                    onChange={e => setValue('base_salary', e.target.value)}
                                    disabled={!canEdit}
                                    className="w-full px-4 py-3 text-lg font-semibold border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                    placeholder="0"
                                />
                            </div>
                        </div>
                    ) : (
                        <div className="space-y-4">
                            <div>
                                <label className="text-sm text-slate-600 mb-1 block">Lương giờ (VND/giờ)</label>
                                <input
                                    type="number"
                                    value={getValue('hourly_rate')}
                                    onChange={e => setValue('hourly_rate', e.target.value)}
                                    disabled={!canEdit}
                                    className="w-full px-4 py-3 text-lg font-semibold border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                    placeholder="0"
                                />
                            </div>
                            <div className="grid grid-cols-3 gap-3">
                                <div>
                                    <label className="text-xs text-slate-500 mb-1 block">OT ngày thường</label>
                                    <div className="flex items-center gap-1">
                                        <span className="text-slate-400">×</span>
                                        <input
                                            type="number"
                                            step="0.1"
                                            value={getValue('ot_rate_weekday')}
                                            onChange={e => setValue('ot_rate_weekday', e.target.value)}
                                            disabled={!canEdit}
                                            className="w-full px-2 py-2 text-center border border-slate-200 rounded-lg"
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="text-xs text-slate-500 mb-1 block">OT cuối tuần</label>
                                    <div className="flex items-center gap-1">
                                        <span className="text-slate-400">×</span>
                                        <input
                                            type="number"
                                            step="0.1"
                                            value={getValue('ot_rate_weekend')}
                                            onChange={e => setValue('ot_rate_weekend', e.target.value)}
                                            disabled={!canEdit}
                                            className="w-full px-2 py-2 text-center border border-slate-200 rounded-lg"
                                        />
                                    </div>
                                </div>
                                <div>
                                    <label className="text-xs text-slate-500 mb-1 block">OT ngày lễ</label>
                                    <div className="flex items-center gap-1">
                                        <span className="text-slate-400">×</span>
                                        <input
                                            type="number"
                                            step="0.1"
                                            value={getValue('ot_rate_holiday')}
                                            onChange={e => setValue('ot_rate_holiday', e.target.value)}
                                            disabled={!canEdit}
                                            className="w-full px-2 py-2 text-center border border-slate-200 rounded-lg"
                                        />
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>

                {/* HỖ TRỢ */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="p-2 bg-green-100 rounded-lg">
                            <FileText className="w-5 h-5 text-green-600" />
                        </div>
                        <h3 className="font-semibold text-slate-900">Hỗ trợ</h3>
                    </div>

                    <div className="space-y-4">
                        {payType === 'monthly' && (
                            <>
                                <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                                    <div>
                                        <p className="font-medium text-slate-900">Hỗ trợ cơm trưa</p>
                                        <p className="text-xs text-slate-500">VND/ngày đủ công</p>
                                    </div>
                                    <input
                                        type="number"
                                        value={getValue('lunch_allowance')}
                                        onChange={e => setValue('lunch_allowance', e.target.value)}
                                        disabled={!canEdit}
                                        className="w-32 px-3 py-2 text-right font-medium border border-slate-200 rounded-lg"
                                    />
                                </div>
                                <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                                    <div>
                                        <p className="font-medium text-slate-900">Hỗ trợ xăng xe</p>
                                        <p className="text-xs text-slate-500">VND/tháng</p>
                                    </div>
                                    <input
                                        type="number"
                                        value={getValue('transport_allowance')}
                                        onChange={e => setValue('transport_allowance', e.target.value)}
                                        disabled={!canEdit}
                                        className="w-32 px-3 py-2 text-right font-medium border border-slate-200 rounded-lg"
                                    />
                                </div>
                                <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                                    <div>
                                        <p className="font-medium text-slate-900">Hỗ trợ điện thoại</p>
                                        <p className="text-xs text-slate-500">VND/tháng</p>
                                    </div>
                                    <input
                                        type="number"
                                        value={getValue('phone_allowance')}
                                        onChange={e => setValue('phone_allowance', e.target.value)}
                                        disabled={!canEdit}
                                        className="w-32 px-3 py-2 text-right font-medium border border-slate-200 rounded-lg"
                                    />
                                </div>
                            </>
                        )}
                        {payType === 'hourly' && (
                            <>
                                <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                                    <div>
                                        <p className="font-medium text-slate-900">Hỗ trợ ca đêm</p>
                                        <p className="text-xs text-slate-500">VND/ca</p>
                                    </div>
                                    <input
                                        type="number"
                                        value={getValue('night_shift_allowance')}
                                        onChange={e => setValue('night_shift_allowance', e.target.value)}
                                        disabled={!canEdit}
                                        className="w-32 px-3 py-2 text-right font-medium border border-slate-200 rounded-lg"
                                    />
                                </div>
                                <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                                    <div>
                                        <p className="font-medium text-slate-900">Thưởng chuyên cần</p>
                                        <p className="text-xs text-slate-500">VND/tháng</p>
                                    </div>
                                    <input
                                        type="number"
                                        value={getValue('attendance_bonus')}
                                        onChange={e => setValue('attendance_bonus', e.target.value)}
                                        disabled={!canEdit}
                                        className="w-32 px-3 py-2 text-right font-medium border border-slate-200 rounded-lg"
                                    />
                                </div>
                            </>
                        )}
                    </div>
                </div>

                {/* BẢO HIỂM */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                    <div className="flex items-center gap-3 mb-6">
                        <div className="p-2 bg-red-100 rounded-lg">
                            <UsersIcon className="w-5 h-5 text-red-600" />
                        </div>
                        <h3 className="font-semibold text-slate-900">Bảo hiểm</h3>
                    </div>

                    <div className="space-y-4">
                        <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                            <p className="font-medium text-slate-900">Có đóng BHXH?</p>
                            <select
                                value={getValue('has_insurance')}
                                onChange={e => setValue('has_insurance', e.target.value)}
                                disabled={!canEdit}
                                className="px-4 py-2 border border-slate-200 rounded-lg font-medium"
                            >
                                <option value="1">Có</option>
                                <option value="0">Không</option>
                            </select>
                        </div>

                        {getValue('has_insurance') === '1' && (
                            <>
                                <div className="flex items-center justify-between p-3 bg-red-50 rounded-xl">
                                    <p className="text-sm text-slate-700">BHXH</p>
                                    <div className="flex items-center gap-1">
                                        <input
                                            type="number"
                                            step="0.5"
                                            value={getValue('bhxh_percent')}
                                            onChange={e => setValue('bhxh_percent', e.target.value)}
                                            disabled={!canEdit}
                                            className="w-16 px-2 py-1 text-center border border-slate-200 rounded-lg"
                                        />
                                        <span className="text-slate-500">%</span>
                                    </div>
                                </div>
                                <div className="flex items-center justify-between p-3 bg-red-50 rounded-xl">
                                    <p className="text-sm text-slate-700">BHYT</p>
                                    <div className="flex items-center gap-1">
                                        <input
                                            type="number"
                                            step="0.5"
                                            value={getValue('bhyt_percent')}
                                            onChange={e => setValue('bhyt_percent', e.target.value)}
                                            disabled={!canEdit}
                                            className="w-16 px-2 py-1 text-center border border-slate-200 rounded-lg"
                                        />
                                        <span className="text-slate-500">%</span>
                                    </div>
                                </div>
                                <div className="flex items-center justify-between p-3 bg-red-50 rounded-xl">
                                    <p className="text-sm text-slate-700">BHTN</p>
                                    <div className="flex items-center gap-1">
                                        <input
                                            type="number"
                                            step="0.5"
                                            value={getValue('bhtn_percent')}
                                            onChange={e => setValue('bhtn_percent', e.target.value)}
                                            disabled={!canEdit}
                                            className="w-16 px-2 py-1 text-center border border-slate-200 rounded-lg"
                                        />
                                        <span className="text-slate-500">%</span>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                </div>

                {/* THUẾ TNCN */}
                {payType === 'monthly' && (
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="p-2 bg-amber-100 rounded-lg">
                                <Percent className="w-5 h-5 text-amber-600" />
                            </div>
                            <h3 className="font-semibold text-slate-900">Thuế TNCN</h3>
                        </div>

                        <div className="space-y-4">
                            <div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
                                <div>
                                    <p className="font-medium text-slate-900">Số người phụ thuộc</p>
                                    <p className="text-xs text-slate-500">Giảm trừ 4.4 triệu/người</p>
                                </div>
                                <input
                                    type="number"
                                    min="0"
                                    value={getValue('dependents_count')}
                                    onChange={e => setValue('dependents_count', e.target.value)}
                                    disabled={!canEdit}
                                    className="w-20 px-3 py-2 text-center font-medium border border-slate-200 rounded-lg"
                                />
                            </div>
                            <div className="p-3 bg-amber-50 rounded-xl text-sm text-amber-800">
                                <p className="font-medium mb-1">Thuế TNCN theo 7 bậc:</p>
                                <p className="text-xs">5% (≤5tr) → 10% → 15% → 20% → 25% → 30% → 35% (&gt;80tr)</p>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
