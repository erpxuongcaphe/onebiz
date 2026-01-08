/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Settings, Clock, Calendar, Save, Loader2, RotateCcw, CalendarClock, CalendarX, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { getHolidays, createHoliday, deleteHoliday, Holiday } from "@/lib/api/payslips";

type OfficeSetting = {
    id: string;
    key: string;
    value: string;
    description: string;
    updated_at: string;
};

type RegistrationSetting = {
    id: string;
    registration_start_day: number;
    registration_start_hour: number;
    registration_end_day: number;
    registration_end_hour: number;
    weeks_ahead: number;
};

const workDayLabels: { [key: string]: string } = {
    '0': 'Chủ nhật',
    '1': 'Thứ 2',
    '2': 'Thứ 3',
    '3': 'Thứ 4',
    '4': 'Thứ 5',
    '5': 'Thứ 6',
    '6': 'Thứ 7'
};

const dayOptions = [
    { value: 0, label: 'Chủ nhật' },
    { value: 1, label: 'Thứ 2' },
    { value: 2, label: 'Thứ 3' },
    { value: 3, label: 'Thứ 4' },
    { value: 4, label: 'Thứ 5' },
    { value: 5, label: 'Thứ 6' },
    { value: 6, label: 'Thứ 7' },
];

const hourOptions = Array.from({ length: 24 }, (_, i) => ({
    value: i,
    label: `${i.toString().padStart(2, '0')}:00`
}));

export default function SettingsPage() {
    const router = useRouter();
    const { user, isLoading: authLoading, hasPermission } = useAuth();
    const [settings, setSettings] = useState<OfficeSetting[]>([]);
    const [regSettings, setRegSettings] = useState<RegistrationSetting | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [editedValues, setEditedValues] = useState<{ [key: string]: string }>({});
    const [editedRegSettings, setEditedRegSettings] = useState<Partial<RegistrationSetting>>({});

    // Holidays state
    const [holidays, setHolidays] = useState<Holiday[]>([]);
    const [newHoliday, setNewHoliday] = useState({ date: '', name: '', isRecurring: true });
    const [isAddingHoliday, setIsAddingHoliday] = useState(false);
    const [confirmDeleteHoliday, setConfirmDeleteHoliday] = useState<{ open: boolean; id: string; name: string }>({ open: false, id: '', name: '' });

    useEffect(() => {
        if (!authLoading && !user) {
            router.push('/login');
            return;
        }
        if (!authLoading && user && !hasPermission(['admin'])) {
            router.push('/dashboard');
            return;
        }

        fetchSettings();
        fetchRegSettings();
        fetchHolidaysData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, authLoading]);

    const fetchHolidaysData = async () => {
        try {
            const data = await getHolidays();
            setHolidays(data);
        } catch (err) {
            console.error('Failed to fetch holidays:', err);
        }
    };

    const handleAddHoliday = async () => {
        if (!newHoliday.date || !newHoliday.name) return;
        setIsAddingHoliday(true);
        try {
            await createHoliday(newHoliday.date, newHoliday.name, newHoliday.isRecurring);
            setNewHoliday({ date: '', name: '', isRecurring: true });
            toast.success('Đã thêm ngày lễ');
            await fetchHolidaysData();
        } catch (err) {
            console.error('Failed to add holiday:', err);
            toast.error('Lỗi khi thêm ngày lễ');
        } finally {
            setIsAddingHoliday(false);
        }
    };

    const handleDeleteHoliday = (id: string, name: string) => {
        setConfirmDeleteHoliday({ open: true, id, name });
    };

    const confirmDeleteHolidayAction = async () => {
        if (!confirmDeleteHoliday.id) return;
        try {
            await deleteHoliday(confirmDeleteHoliday.id);
            toast.success('Đã xóa ngày lễ');
            await fetchHolidaysData();
            setConfirmDeleteHoliday({ open: false, id: '', name: '' });
        } catch (err) {
            console.error('Failed to delete holiday:', err);
            toast.error('Lỗi khi xóa ngày lễ');
        }
    };

    const fetchSettings = async () => {
        setIsLoading(true);
        try {
            const { data, error } = await (supabase as any)
                .from('office_settings')
                .select('*')
                .order('key');

            if (error) throw error;
            setSettings(data || []);

            // Initialize edited values
            const values: { [key: string]: string } = {};
            (data || []).forEach((s: OfficeSetting) => {
                values[s.key] = s.value;
            });
            setEditedValues(values);
        } catch (err) {
            console.error('Failed to fetch settings:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const fetchRegSettings = async () => {
        try {
            const { data } = await (supabase as any)
                .from('registration_settings')
                .select('*')
                .is('branch_id', null)
                .single();

            if (data) {
                const regData = data as RegistrationSetting;
                setRegSettings(regData);
                setEditedRegSettings({
                    registration_start_day: regData.registration_start_day,
                    registration_start_hour: regData.registration_start_hour,
                    registration_end_day: regData.registration_end_day,
                    registration_end_hour: regData.registration_end_hour,
                    weeks_ahead: regData.weeks_ahead
                });
            }
        } catch (err) {
            console.error('Failed to fetch registration settings:', err);
        }
    };

    const handleSave = async () => {
        if (!user) return;
        setIsSaving(true);
        try {
            // Save office settings
            for (const [key, value] of Object.entries(editedValues)) {
                await (supabase as any)
                    .from('office_settings')
                    .update({
                        value,
                        updated_at: new Date().toISOString(),
                        updated_by: user.id
                    } as never)
                    .eq('key', key);
            }

            // Save registration settings
            if (regSettings && Object.keys(editedRegSettings).length > 0) {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                await (supabase as any)
                    .from('registration_settings')
                    .update({
                        ...editedRegSettings,
                        updated_at: new Date().toISOString()
                    })
                    .eq('id', regSettings.id);
            }

            await fetchSettings();
            await fetchRegSettings();
            alert('Đã lưu cài đặt thành công!');
        } catch (err) {
            console.error('Failed to save settings:', err);
            alert('Lỗi khi lưu. Vui lòng thử lại.');
        } finally {
            setIsSaving(false);
        }
    };

    const handleReset = () => {
        const values: { [key: string]: string } = {};
        settings.forEach((s) => {
            values[s.key] = s.value;
        });
        setEditedValues(values);

        if (regSettings) {
            setEditedRegSettings({
                registration_start_day: regSettings.registration_start_day,
                registration_start_hour: regSettings.registration_start_hour,
                registration_end_day: regSettings.registration_end_day,
                registration_end_hour: regSettings.registration_end_hour,
                weeks_ahead: regSettings.weeks_ahead
            });
        }
    };

    const getSettingLabel = (key: string) => {
        const labels: { [key: string]: string } = {
            'office_start_time': 'Giờ bắt đầu làm việc',
            'office_end_time': 'Giờ kết thúc làm việc',
            'lunch_start_time': 'Giờ nghỉ trưa bắt đầu',
            'lunch_end_time': 'Giờ nghỉ trưa kết thúc',
            'work_days': 'Các ngày làm việc'
        };
        return labels[key] || key;
    };

    const getSettingIcon = (key: string) => {
        if (key.includes('time')) return <Clock className="w-5 h-5 text-blue-500" />;
        if (key.includes('days')) return <Calendar className="w-5 h-5 text-green-500" />;
        return <Settings className="w-5 h-5 text-slate-500" />;
    };

    const toggleWorkDay = (day: string) => {
        const current = editedValues['work_days']?.split(',') || [];
        if (current.includes(day)) {
            setEditedValues({
                ...editedValues,
                'work_days': current.filter(d => d !== day).join(',')
            });
        } else {
            setEditedValues({
                ...editedValues,
                'work_days': [...current, day].sort().join(',')
            });
        }
    };

    if (authLoading || isLoading) {
        return (
            <div className="flex items-center justify-center h-96">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-slate-900">Cài đặt hệ thống</h1>
                    <p className="text-slate-500 mt-1">Cấu hình giờ làm việc và thời gian đăng ký ca</p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleReset}
                        className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors"
                    >
                        <RotateCcw className="w-4 h-4" />
                        Hoàn tác
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className={cn(
                            "inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-xl transition-all",
                            isSaving
                                ? "bg-slate-400 cursor-not-allowed"
                                : "bg-blue-500 hover:bg-blue-600 shadow-sm hover:shadow"
                        )}
                    >
                        {isSaving ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                            <Save className="w-4 h-4" />
                        )}
                        Lưu thay đổi
                    </button>
                </div>
            </div>

            {/* Time Settings */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {settings.filter(s => s.key.includes('time')).map((setting) => (
                    <div key={setting.id} className="bg-white rounded-2xl border border-slate-200 p-6">
                        <div className="flex items-center gap-3 mb-4">
                            {getSettingIcon(setting.key)}
                            <div>
                                <h3 className="font-medium text-slate-900">{getSettingLabel(setting.key)}</h3>
                                <p className="text-xs text-slate-500">{setting.description}</p>
                            </div>
                        </div>
                        <input
                            type="time"
                            value={editedValues[setting.key] || ''}
                            onChange={(e) => setEditedValues({ ...editedValues, [setting.key]: e.target.value })}
                            className="w-full px-4 py-3 text-lg font-medium border border-slate-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none"
                        />
                    </div>
                ))}
            </div>

            {/* Work Days */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6">
                <div className="flex items-center gap-3 mb-4">
                    <Calendar className="w-5 h-5 text-green-500" />
                    <div>
                        <h3 className="font-medium text-slate-900">Các ngày làm việc trong tuần</h3>
                        <p className="text-xs text-slate-500">Chọn các ngày nhân viên lương tháng đi làm</p>
                    </div>
                </div>
                <div className="flex flex-wrap gap-2">
                    {Object.entries(workDayLabels).map(([day, label]) => {
                        const isSelected = editedValues['work_days']?.split(',').includes(day);
                        return (
                            <button
                                key={day}
                                onClick={() => toggleWorkDay(day)}
                                className={cn(
                                    "px-4 py-2 rounded-xl font-medium transition-all",
                                    isSelected
                                        ? "bg-green-500 text-white shadow-sm"
                                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                                )}
                            >
                                {label}
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Shift Registration Settings */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6">
                <div className="flex items-center gap-3 mb-6">
                    <CalendarClock className="w-5 h-5 text-purple-500" />
                    <div>
                        <h3 className="font-medium text-slate-900">Thời gian đăng ký ca làm việc</h3>
                        <p className="text-xs text-slate-500">Cấu hình thời gian mở đăng ký ca cho nhân viên theo giờ</p>
                    </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Start Time */}
                    <div className="space-y-3">
                        <label className="text-sm font-medium text-slate-700">Bắt đầu mở đăng ký</label>
                        <div className="flex gap-3">
                            <select
                                value={editedRegSettings.registration_start_day ?? 4}
                                onChange={(e) => setEditedRegSettings({
                                    ...editedRegSettings,
                                    registration_start_day: parseInt(e.target.value)
                                })}
                                className="flex-1 px-3 py-2 border border-slate-200 rounded-xl focus:border-purple-500 focus:ring-2 focus:ring-purple-100 outline-none"
                            >
                                {dayOptions.map(d => (
                                    <option key={d.value} value={d.value}>{d.label}</option>
                                ))}
                            </select>
                            <select
                                value={editedRegSettings.registration_start_hour ?? 21}
                                onChange={(e) => setEditedRegSettings({
                                    ...editedRegSettings,
                                    registration_start_hour: parseInt(e.target.value)
                                })}
                                className="w-28 px-3 py-2 border border-slate-200 rounded-xl focus:border-purple-500 focus:ring-2 focus:ring-purple-100 outline-none"
                            >
                                {hourOptions.map(h => (
                                    <option key={h.value} value={h.value}>{h.label}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* End Time */}
                    <div className="space-y-3">
                        <label className="text-sm font-medium text-slate-700">Kết thúc đăng ký</label>
                        <div className="flex gap-3">
                            <select
                                value={editedRegSettings.registration_end_day ?? 5}
                                onChange={(e) => setEditedRegSettings({
                                    ...editedRegSettings,
                                    registration_end_day: parseInt(e.target.value)
                                })}
                                className="flex-1 px-3 py-2 border border-slate-200 rounded-xl focus:border-purple-500 focus:ring-2 focus:ring-purple-100 outline-none"
                            >
                                {dayOptions.map(d => (
                                    <option key={d.value} value={d.value}>{d.label}</option>
                                ))}
                            </select>
                            <select
                                value={editedRegSettings.registration_end_hour ?? 21}
                                onChange={(e) => setEditedRegSettings({
                                    ...editedRegSettings,
                                    registration_end_hour: parseInt(e.target.value)
                                })}
                                className="w-28 px-3 py-2 border border-slate-200 rounded-xl focus:border-purple-500 focus:ring-2 focus:ring-purple-100 outline-none"
                            >
                                {hourOptions.map(h => (
                                    <option key={h.value} value={h.value}>{h.label}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>

                {/* Weeks Ahead */}
                <div className="mt-6 pt-6 border-t border-slate-100">
                    <label className="text-sm font-medium text-slate-700 block mb-3">Đăng ký cho tuần sau bao lâu?</label>
                    <select
                        value={editedRegSettings.weeks_ahead ?? 1}
                        onChange={(e) => setEditedRegSettings({
                            ...editedRegSettings,
                            weeks_ahead: parseInt(e.target.value)
                        })}
                        className="w-full md:w-64 px-3 py-2 border border-slate-200 rounded-xl focus:border-purple-500 focus:ring-2 focus:ring-purple-100 outline-none"
                    >
                        <option value={1}>Tuần tới (1 tuần)</option>
                        <option value={2}>2 tuần tới</option>
                        <option value={3}>3 tuần tới</option>
                    </select>
                </div>

                {/* Preview */}
                <div className="mt-6 p-4 bg-purple-50 rounded-xl">
                    <p className="text-sm text-purple-700">
                        <strong>Thời gian mở:</strong>{' '}
                        {dayOptions.find(d => d.value === (editedRegSettings.registration_start_day ?? 4))?.label}{' '}
                        {(editedRegSettings.registration_start_hour ?? 21).toString().padStart(2, '0')}:00
                        {' → '}
                        {dayOptions.find(d => d.value === (editedRegSettings.registration_end_day ?? 5))?.label}{' '}
                        {(editedRegSettings.registration_end_hour ?? 21).toString().padStart(2, '0')}:00
                    </p>
                </div>
            </div>

            {/* Holidays Management */}
            <div className="bg-white rounded-2xl border border-slate-200 p-6">
                <div className="flex items-center gap-3 mb-6">
                    <CalendarX className="w-5 h-5 text-red-500" />
                    <div>
                        <h3 className="font-medium text-slate-900">Quản lý ngày lễ</h3>
                        <p className="text-xs text-slate-500">Thêm hoặc xóa ngày lễ được trừ khi tính công lương tháng</p>
                    </div>
                </div>

                {/* Add new holiday form */}
                <div className="flex flex-wrap gap-3 mb-4 pb-4 border-b border-slate-100">
                    <input
                        type="date"
                        value={newHoliday.date}
                        onChange={(e) => setNewHoliday({ ...newHoliday, date: e.target.value })}
                        className="px-3 py-2 border border-slate-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none"
                    />
                    <input
                        type="text"
                        placeholder="Tên ngày lễ"
                        value={newHoliday.name}
                        onChange={(e) => setNewHoliday({ ...newHoliday, name: e.target.value })}
                        className="flex-1 min-w-[180px] px-3 py-2 border border-slate-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none"
                    />
                    <label className="flex items-center gap-2 text-sm text-slate-600">
                        <input
                            type="checkbox"
                            checked={newHoliday.isRecurring}
                            onChange={(e) => setNewHoliday({ ...newHoliday, isRecurring: e.target.checked })}
                            className="w-4 h-4 rounded text-blue-500"
                        />
                        Lặp lại hàng năm
                    </label>
                    <button
                        onClick={handleAddHoliday}
                        disabled={isAddingHoliday || !newHoliday.date || !newHoliday.name}
                        className={cn(
                            "inline-flex items-center gap-1.5 px-4 py-2 text-sm font-medium rounded-xl transition-all",
                            isAddingHoliday || !newHoliday.date || !newHoliday.name
                                ? "bg-slate-100 text-slate-400"
                                : "bg-blue-500 text-white hover:bg-blue-600"
                        )}
                    >
                        {isAddingHoliday ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                        Thêm
                    </button>
                </div>

                {/* Holidays list */}
                <div className="space-y-2 max-h-64 overflow-y-auto">
                    {holidays.length === 0 ? (
                        <p className="text-sm text-slate-500 text-center py-4">Chưa có ngày lễ nào</p>
                    ) : (
                        holidays.map((h) => {
                            const dateObj = new Date(h.date);
                            const displayDate = `${dateObj.getDate().toString().padStart(2, '0')}/${(dateObj.getMonth() + 1).toString().padStart(2, '0')}`;
                            return (
                                <div key={h.id} className="flex items-center justify-between px-4 py-3 bg-slate-50 rounded-xl">
                                    <div className="flex items-center gap-3">
                                        <span className="font-mono text-sm font-medium text-slate-700">{displayDate}</span>
                                        <span className="text-sm text-slate-900">{h.name}</span>
                                        {h.is_recurring && (
                                            <span className="px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded-full">Hàng năm</span>
                                        )}
                                    </div>
                                    <button
                                        onClick={() => handleDeleteHoliday(h.id, h.name)}
                                        className="p-1.5 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            {/* Info Box */}
            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-4">
                <p className="text-sm text-blue-700">
                    <strong>Lưu ý:</strong> Thay đổi cài đặt này sẽ áp dụng cho tất cả nhân viên.
                    Để thay đổi giờ làm việc cho từng chi nhánh riêng, vào <strong>Chi nhánh → Sửa ca làm việc</strong>.
                </p>
            </div>

            {/* Delete Holiday Confirmation */}
            <ConfirmDialog
                open={confirmDeleteHoliday.open}
                onOpenChange={(open) => setConfirmDeleteHoliday({ ...confirmDeleteHoliday, open })}
                title="Xóa ngày lễ?"
                description={'Bạn sẽ xóa ngày lễ "' + confirmDeleteHoliday.name + '". Hành động này không thể hoàn tác.'}
                confirmText="Xóa"
                cancelText="Hủy"
                variant="destructive"
                onConfirm={confirmDeleteHolidayAction}
            />
        </div>
    );
}
