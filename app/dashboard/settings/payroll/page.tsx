'use client';

import { useState, useEffect } from 'react';
import { getSystemConfigs, updateSystemConfig, SystemConfig } from '@/lib/api/system-configs';
import { toast } from 'sonner';
import { ArrowLeft, DollarSign, Percent, Shield, Calculator } from 'lucide-react';
import Link from 'next/link';

export default function PayrollSettingsPage() {
    const [configs, setConfigs] = useState<SystemConfig[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState<string | null>(null);

    useEffect(() => {
        loadConfigs();
    }, []);

    const loadConfigs = async () => {
        try {
            const data = await getSystemConfigs('payroll');
            // Sort by key for consistent order
            setConfigs(data.sort((a, b) => a.key.localeCompare(b.key)));
        } catch (error) {
            console.error(error);
            toast.error('Không thể tải cấu hình hệ thống');
        } finally {
            setLoading(false);
        }
    };

    const handleUpdate = async (key: string, newValue: string) => {
        setSaving(key);
        try {
            // Determine type based on key or current value, but for payroll mostly numbers (float or int)
            // simple check: if input has decimal, parse float, else int. 
            // Or just store as number.
            const numValue = parseFloat(newValue);
            if (isNaN(numValue)) {
                toast.error('Vui lòng nhập số hợp lệ');
                return;
            }

            await updateSystemConfig(key, numValue);

            // Update local state
            setConfigs(prev => prev.map(c =>
                c.key === key ? { ...c, value: numValue } : c
            ));

            toast.success('Đã cập nhật cấu hình');
        } catch (error) {
            console.error(error);
            toast.error('Cập nhật thất bại');
        } finally {
            setSaving(null);
        }
    };

    const formatLabel = (key: string) => {
        const parts = key.split('.');
        return parts[parts.length - 1].replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    };

    const getIcon = (key: string) => {
        if (key.includes('tax')) return <DollarSign className="w-5 h-5 text-green-600" />;
        if (key.includes('insurance')) return <Shield className="w-5 h-5 text-blue-600" />;
        if (key.includes('ot')) return <Percent className="w-5 h-5 text-orange-600" />;
        return <Calculator className="w-5 h-5 text-slate-600" />;
    };

    return (
        <div className="p-6 max-w-5xl mx-auto">
            <div className="flex items-center gap-4 mb-8">
                <Link href="/dashboard/settings" className="p-2 hover:bg-slate-100 rounded-full transition-colors">
                    <ArrowLeft className="w-6 h-6 text-slate-600" />
                </Link>
                <div>
                    <h1 className="text-2xl font-bold text-slate-900">Cấu hình Lương & Thuế</h1>
                    <p className="text-slate-500">Quản lý các tham số tính toán lương, thuế và bảo hiểm</p>
                </div>
            </div>

            {loading ? (
                <div className="flex justify-center py-12">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                </div>
            ) : (
                <div className="grid gap-6">
                    {configs.map((config) => (
                        <div key={config.key} className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex items-start gap-4 hover:shadow-md transition-shadow">
                            <div className="p-3 bg-slate-50 rounded-lg">
                                {getIcon(config.key)}
                            </div>
                            <div className="flex-1">
                                <label className="block text-sm font-medium text-slate-900 mb-1">
                                    {config.description || formatLabel(config.key)}
                                </label>
                                <p className="text-xs text-slate-500 mb-3 font-mono">{config.key}</p>

                                <div className="flex items-center gap-3">
                                    <input
                                        type="number"
                                        defaultValue={config.value}
                                        onBlur={(e) => {
                                            if (e.target.value !== config.value.toString()) {
                                                handleUpdate(config.key, e.target.value);
                                            }
                                        }}
                                        step={config.key.includes('rate') ? "0.001" : "1000"}
                                        className="block w-full max-w-xs rounded-md border-slate-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm px-4 py-2 border"
                                    />
                                    {saving === config.key && (
                                        <span className="text-xs text-blue-600 animate-pulse">Đang lưu...</span>
                                    )}
                                </div>
                                <p className="text-xs text-slate-400 mt-2">
                                    {config.key.includes('rate')
                                        ? `Giá trị ${config.value * 100}%`
                                        : `Giá trị hiện tại: ${new Intl.NumberFormat('vi-VN').format(config.value)}`}
                                </p>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
