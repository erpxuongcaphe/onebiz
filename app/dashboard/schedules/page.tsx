"use client";

import { useState, useEffect } from "react";
import {
    Calendar as CalendarIcon, Plus, ChevronLeft, ChevronRight, Loader2,
    X, Filter, Clock, Download
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useAuth } from "@/contexts/AuthContext";
import { getEmployees } from "@/lib/api/employees";
import { getBranches, getShifts, Branch, Shift, autoGenerateSchedules } from "@/lib/api/timekeeping";
import {
    getSchedules, createBulkSchedules, deleteSchedule, WorkSchedule
} from "@/lib/api/schedules";
import { Employee } from "@/lib/database.types";

const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

// Vietnamese public holidays
const VIETNAMESE_HOLIDAYS: Record<number, { month: number; day: number; name: string }[]> = {
    2024: [
        { month: 1, day: 1, name: 'Tết Dương lịch' },
        { month: 2, day: 8, name: 'Tết Nguyên đán' },
        { month: 2, day: 9, name: 'Tết Nguyên đán' },
        { month: 2, day: 10, name: 'Tết Nguyên đán' },
        { month: 2, day: 11, name: 'Tết Nguyên đán' },
        { month: 2, day: 12, name: 'Tết Nguyên đán' },
        { month: 4, day: 18, name: 'Giỗ Tổ Hùng Vương' },
        { month: 4, day: 30, name: 'Giải phóng miền Nam' },
        { month: 5, day: 1, name: 'Quốc tế Lao động' },
        { month: 9, day: 2, name: 'Quốc khánh' },
    ],
    2025: [
        { month: 1, day: 1, name: 'Tết Dương lịch' },
        { month: 1, day: 28, name: 'Tết Nguyên đán' },
        { month: 1, day: 29, name: 'Tết Nguyên đán' },
        { month: 1, day: 30, name: 'Tết Nguyên đán' },
        { month: 1, day: 31, name: 'Tết Nguyên đán' },
        { month: 2, day: 1, name: 'Tết Nguyên đán' },
        { month: 4, day: 7, name: 'Giỗ Tổ Hùng Vương' },
        { month: 4, day: 30, name: 'Giải phóng miền Nam' },
        { month: 5, day: 1, name: 'Quốc tế Lao động' },
        { month: 9, day: 2, name: 'Quốc khánh' },
    ],
};

const getHolidayName = (date: Date): string | null => {
    const year = date.getFullYear();
    const month = date.getMonth() + 1;
    const day = date.getDate();
    const holidays = VIETNAMESE_HOLIDAYS[year] || [];
    const holiday = holidays.find(h => h.month === month && h.day === day);
    return holiday ? holiday.name : null;
};

const isSunday = (date: Date): boolean => date.getDay() === 0;

// Branch color palette for visual distinction
const BRANCH_COLORS = [
    { bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200' },
    { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
    { bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
    { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200' },
    { bg: 'bg-pink-50', text: 'text-pink-700', border: 'border-pink-200' },
    { bg: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200' },
    { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200' },
    { bg: 'bg-indigo-50', text: 'text-indigo-700', border: 'border-indigo-200' },
];

type ViewMode = 'month' | 'week' | 'day' | 'range';

export default function SchedulesPage() {
    const { user } = useAuth();
    const [currentDate, setCurrentDate] = useState(new Date());
    const [viewMode, setViewMode] = useState<ViewMode>('month');
    const [selectedBranch, setSelectedBranch] = useState<string>('');

    // Date range state
    const [dateRangeStart, setDateRangeStart] = useState<string>('');
    const [dateRangeEnd, setDateRangeEnd] = useState<string>('');

    const [employees, setEmployees] = useState<Employee[]>([]);
    const [branches, setBranches] = useState<Branch[]>([]);
    const [shifts, setShifts] = useState<Shift[]>([]);
    const [schedules, setSchedules] = useState<WorkSchedule[]>([]);

    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);

    // Modal state
    const [showAddModal, setShowAddModal] = useState(false);
    const [showDetailModal, setShowDetailModal] = useState(false);
    const [showDatePicker, setShowDatePicker] = useState(false);
    const [showAutoGenModal, setShowAutoGenModal] = useState(false);
    const [selectedDate, setSelectedDate] = useState<string | null>(null);
    const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);
    const [selectedShift, setSelectedShift] = useState<string>('');

    // Auto generate state
    const [autoGenStart, setAutoGenStart] = useState<string>('');
    const [autoGenEnd, setAutoGenEnd] = useState<string>('');
    const [autoGenSelectAll, setAutoGenSelectAll] = useState<boolean>(true);
    const [autoGenSelectedEmployees, setAutoGenSelectedEmployees] = useState<string[]>([]);

    // Date picker modal state
    const [pickerMode, setPickerMode] = useState<'single' | 'range'>('single');
    const [tempDate, setTempDate] = useState<string>('');
    const [tempStartDate, setTempStartDate] = useState<string>('');
    const [tempEndDate, setTempEndDate] = useState<string>('');

    const [confirmDeleteSchedule, setConfirmDeleteSchedule] = useState<{ open: boolean; scheduleId: string; employeeName: string }>({ open: false, scheduleId: '', employeeName: '' });

    const canEdit = user?.role === 'admin' || user?.role === 'branch_manager';

    useEffect(() => {
        fetchBaseData();
    }, []);

    useEffect(() => {
        fetchSchedules();
        fetchShifts();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentDate, selectedBranch, viewMode, dateRangeStart, dateRangeEnd]);

    const fetchBaseData = async () => {
        setIsLoading(true);
        try {
            const [empData, branchData] = await Promise.all([
                getEmployees(),
                getBranches()
            ]);
            setEmployees(empData);
            setBranches(branchData);
            if (branchData.length > 0) {
                setSelectedBranch(branchData[0].id);
            }
        } catch (err) {
            console.error('Failed to fetch data:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const fetchSchedules = async () => {
        try {
            let startDate, endDate;
            const year = currentDate.getFullYear();
            const month = currentDate.getMonth();

            if (viewMode === 'range' && dateRangeStart && dateRangeEnd) {
                startDate = dateRangeStart;
                endDate = dateRangeEnd;
            } else if (viewMode === 'day') {
                startDate = currentDate.toISOString().split('T')[0];
                endDate = startDate;
            } else if (viewMode === 'week') {
                const day = currentDate.getDay();
                const diff = currentDate.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
                const firstDay = new Date(currentDate.setDate(diff));
                const lastDay = new Date(firstDay);
                lastDay.setDate(lastDay.getDate() + 6);

                startDate = firstDay.toISOString().split('T')[0];
                endDate = lastDay.toISOString().split('T')[0];
                // Reset current date to avoid mutation causing loops? No, safe here.
            } else {
                startDate = new Date(year, month, 1).toISOString().split('T')[0];
                endDate = new Date(year, month + 1, 0).toISOString().split('T')[0];
            }

            const data = await getSchedules({
                startDate,
                endDate,
                branchId: selectedBranch
            });
            setSchedules(data);
        } catch (err) {
            console.error('Failed to fetch schedules:', err);
        }
    };

    const fetchShifts = async () => {
        try {
            // Pass undefined to get all shifts when no specific branch selected
            const data = await getShifts(selectedBranch || undefined);
            setShifts(data);
        } catch (err) {
            console.error('Failed to fetch shifts:', err);
        }
    };

    const navigate = (delta: number) => {
        const newDate = new Date(currentDate);
        if (viewMode === 'month') {
            newDate.setMonth(newDate.getMonth() + delta);
        } else if (viewMode === 'week') {
            newDate.setDate(newDate.getDate() + (delta * 7));
        } else {
            newDate.setDate(newDate.getDate() + delta);
        }
        setCurrentDate(newDate);
    };

    const getBranchColor = (branchId?: string) => {
        if (!branchId) return BRANCH_COLORS[0];
        const idx = branches.findIndex(b => b.id === branchId);
        return BRANCH_COLORS[idx >= 0 ? idx % BRANCH_COLORS.length : 0];
    };

    const getBranchName = (branchId?: string) => {
        if (!branchId) return '';
        const branch = branches.find(b => b.id === branchId);
        return branch?.name || '';
    };

    const getDaysToRender = () => {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const days: Date[] = [];

        if (viewMode === 'month') {
            const firstDay = new Date(year, month, 1);
            const lastDay = new Date(year, month + 1, 0);

            // Calculate start padding (Monday start)
            // getDay(): 0=Sun, 1=Mon, ..., 6=Sat
            // We want Mon=0, ..., Sun=6
            // Formula: (day + 6) % 7
            const startPadding = (firstDay.getDay() + 6) % 7;

            for (let i = startPadding; i > 0; i--) {
                days.push(new Date(year, month, 1 - i));
            }
            for (let i = 1; i <= lastDay.getDate(); i++) {
                days.push(new Date(year, month, i));
            }

            // Calculate end padding
            // We want last cell to be Sunday (index 6)
            // (lastDay's converted index)
            const lastDayIndex = (lastDay.getDay() + 6) % 7;
            const endPadding = 6 - lastDayIndex;

            for (let i = 1; i <= endPadding; i++) {
                days.push(new Date(year, month + 1, i));
            }
        } else if (viewMode === 'week') {
            const current = new Date(currentDate);
            const day = current.getDay(); // 0 is Sunday
            // Adjust to Monday start logic
            // If Sun(0), diff = 0 - 6 = -6 (Mon is 6 days ago)
            // If Mon(1), diff = 1 - 1 = 0
            const diff = current.getDate() - day + (day === 0 ? -6 : 1);

            const monday = new Date(current.setDate(diff));
            for (let i = 0; i < 7; i++) {
                const d = new Date(monday);
                d.setDate(monday.getDate() + i);
                days.push(d);
            }
        } else if (viewMode === 'range' && dateRangeStart && dateRangeEnd) {
            // Generate all days in the range
            const start = new Date(dateRangeStart);
            const end = new Date(dateRangeEnd);
            const current = new Date(start);
            while (current <= end) {
                days.push(new Date(current));
                current.setDate(current.getDate() + 1);
            }
        } else {
            days.push(new Date(currentDate));
        }
        return days;
    };

    const getSchedulesForDate = (date: Date) => {
        const dateStr = date.toISOString().split('T')[0];
        return schedules.filter(s => s.date === dateStr);
    };

    const handleAddSchedule = async () => {
        if (!selectedDate || selectedEmployees.length === 0) return;
        setIsSaving(true);
        try {
            const newSchedules = selectedEmployees.map(empId => ({
                employee_id: empId,
                branch_id: selectedBranch,
                shift_id: selectedShift || undefined,
                date: selectedDate,
                created_by: user?.id
            }));
            await createBulkSchedules(newSchedules);
            await fetchSchedules();
            setShowAddModal(false);
            setSelectedEmployees([]);
            setSelectedShift('');
        } catch (err) {
            console.error('Failed to create schedules:', err);
            alert('Lỗi khi tạo lịch làm việc');
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteSchedule = (scheduleId: string, employeeId: string) => {
        const empName = getEmployeeName(employeeId);
        setConfirmDeleteSchedule({ open: true, scheduleId, employeeName: empName });
    };

    const confirmDeleteScheduleAction = async () => {
        if (!confirmDeleteSchedule.scheduleId) return;
        try {
            await deleteSchedule(confirmDeleteSchedule.scheduleId);
            toast.success('Đã xóa khỏi lịch');
            await fetchSchedules();
            setConfirmDeleteSchedule({ open: false, scheduleId: '', employeeName: '' });
        } catch (err) {
            console.error('Failed to delete schedule:', err);
            toast.error('Lỗi khi xóa lịch');
        }
    };

    const openAddModal = (date: Date) => {
        if (!canEdit) return;
        setSelectedDate(date.toISOString().split('T')[0]);
        setSelectedEmployees([]);
        setSelectedShift('');
        setShowAddModal(true);
    };

    const openAutoGenModal = () => {
        // Default to current month
        const now = new Date();
        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
        const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        setAutoGenStart(firstDay.toISOString().split('T')[0]);
        setAutoGenEnd(lastDay.toISOString().split('T')[0]);
        setAutoGenSelectAll(true);
        setAutoGenSelectedEmployees([]);
        setShowAutoGenModal(true);
    };

    const handleAutoGenerate = async () => {
        if (!user || !autoGenStart || !autoGenEnd) return;

        // If selecting specific employees but none selected, show error
        if (!autoGenSelectAll && autoGenSelectedEmployees.length === 0) {
            alert('Vui lòng chọn ít nhất một nhân viên.');
            return;
        }

        setIsGenerating(true);
        try {
            // Pass undefined for all employees, or specific IDs
            const employeeIds = autoGenSelectAll ? undefined : autoGenSelectedEmployees;
            const result = await autoGenerateSchedules(autoGenStart, autoGenEnd, user.id, employeeIds);
            await fetchSchedules();
            setShowAutoGenModal(false);

            if (result.created === 0 && result.skipped === 0) {
                alert('Không tìm thấy nhân viên lương tháng nào ở chi nhánh văn phòng.\n\nKiểm tra:\n1. Nhân viên có employee_type = "full_time_monthly" (hoặc probation/intern)\n2. Nhân viên thuộc chi nhánh văn phòng (is_office = true)\n3. Nhân viên có status = "active"');
            } else {
                const empCount = autoGenSelectAll ? 'tất cả nhân viên' : `${autoGenSelectedEmployees.length} nhân viên`;
                alert(`✅ Đã tạo ${result.created} lịch làm việc cho ${empCount}.\n⏭️ Bỏ qua ${result.skipped} (đã có sẵn).`);
            }
        } catch (err) {
            console.error('Failed to auto generate:', err);
            alert('Lỗi khi tạo lịch tự động:\n' + (err instanceof Error ? err.message : 'Vui lòng thử lại.'));
        } finally {
            setIsGenerating(false);
        }
    };

    const handleCellClick = (date: Date, hasSchedules: boolean) => {
        if (viewMode !== 'month') return;

        const dateStr = date.toISOString().split('T')[0];
        setSelectedDate(dateStr);

        if (hasSchedules) {
            // If there are schedules, open detail modal
            setShowDetailModal(true);
        } else if (canEdit) {
            // If no schedules and can edit, open add modal
            setSelectedEmployees([]);
            setSelectedShift('');
            setShowAddModal(true);
        }
    };

    const getEmployeeName = (empId: string) => employees.find(e => e.id === empId)?.name || empId;

    // Export schedules to Excel/CSV
    const handleExportExcel = () => {
        const headers = ['Ngày', 'Thứ', 'Nhân viên', 'Chi nhánh', 'Ca làm', 'Giờ bắt đầu', 'Giờ kết thúc'];
        const rows = schedules.map(schedule => {
            const emp = employees.find(e => e.id === schedule.employee_id);
            const shift = shifts.find(s => s.id === schedule.shift_id);
            const branch = branches.find(b => b.id === schedule.branch_id);
            const dateObj = new Date(schedule.date);
            const dayOfWeek = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][dateObj.getDay()];
            return [
                schedule.date,
                dayOfWeek,
                emp?.name || schedule.employee_id,
                branch?.name || '',
                shift?.name || 'Chưa xếp ca',
                shift?.start_time?.slice(0, 5) || '',
                shift?.end_time?.slice(0, 5) || ''
            ];
        });

        const csvContent = [headers, ...rows]
            .map(row => row.map(cell => `"${cell}"`).join(','))
            .join('\n');

        const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;

        // Generate filename based on view mode
        let dateRange = '';
        if (viewMode === 'month') {
            dateRange = currentDate.toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' });
        } else if (viewMode === 'range' && dateRangeStart && dateRangeEnd) {
            dateRange = `${dateRangeStart}-${dateRangeEnd}`;
        } else {
            dateRange = currentDate.toISOString().split('T')[0];
        }

        const branchName = selectedBranch ? branches.find(b => b.id === selectedBranch)?.name : 'tat-ca';
        link.download = `lich-lam-viec-${branchName}-${dateRange}.csv`.replace(/\s+/g, '-');
        link.click();
        URL.revokeObjectURL(url);
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-96">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                <span className="ml-2 text-slate-600">Đang tải dữ liệu...</span>
            </div>
        );
    }

    const days = getDaysToRender();

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4 animate-fade-in">
                <div className="flex items-center gap-4">
                    <div>
                        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Lịch làm việc</h1>
                        <p className="text-slate-500 mt-1">Xếp lịch ca làm việc cho nhân viên</p>
                    </div>
                    {canEdit && (
                        <button
                            onClick={openAutoGenModal}
                            className="inline-flex items-center gap-2 px-4 py-2 bg-green-500 text-white text-sm font-medium rounded-xl hover:bg-green-600 shadow-sm transition-all"
                        >
                            <CalendarIcon className="w-4 h-4" />
                            Tạo lịch tự động
                        </button>
                    )}
                </div>

                <div className="flex flex-wrap items-center gap-3">
                    {/* View Mode Switcher */}
                    <div className="flex p-1 bg-slate-100 rounded-lg">
                        <button
                            onClick={() => setViewMode('month')}
                            className={cn(
                                "px-3 py-1.5 text-sm font-medium rounded-md transition-all",
                                viewMode === 'month' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                            )}
                        >
                            Tháng
                        </button>
                        <button
                            onClick={() => setViewMode('week')}
                            className={cn(
                                "px-3 py-1.5 text-sm font-medium rounded-md transition-all",
                                viewMode === 'week' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                            )}
                        >
                            Tuần
                        </button>
                        <button
                            onClick={() => setViewMode('day')}
                            className={cn(
                                "px-3 py-1.5 text-sm font-medium rounded-md transition-all",
                                viewMode === 'day' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                            )}
                        >
                            Ngày
                        </button>
                        <button
                            onClick={() => {
                                if (viewMode !== 'range') {
                                    // Initialize with current month range
                                    const now = new Date();
                                    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
                                    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                                    setTempStartDate(firstDay.toISOString().split('T')[0]);
                                    setTempEndDate(lastDay.toISOString().split('T')[0]);
                                    setPickerMode('range');
                                    setShowDatePicker(true);
                                }
                            }}
                            className={cn(
                                "px-3 py-1.5 text-sm font-medium rounded-md transition-all",
                                viewMode === 'range' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                            )}
                        >
                            Tùy chọn
                        </button>
                    </div>

                    <div className="h-6 w-px bg-slate-200" />

                    {/* Branch Filter */}
                    <div className="flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 rounded-xl max-w-[200px]">
                        <Filter className="w-4 h-4 text-slate-400 shrink-0" />
                        <select
                            value={selectedBranch}
                            onChange={e => setSelectedBranch(e.target.value)}
                            className="text-sm border-none focus:outline-none bg-transparent w-full truncate"
                        >
                            <option value="">Tất cả chi nhánh</option>
                            {branches.map(b => (
                                <option key={b.id} value={b.id}>{b.name}</option>
                            ))}
                        </select>
                    </div>

                    {/* Date Navigation / Display */}
                    {viewMode !== 'range' ? (
                        <div className="relative">
                            <div className="flex items-center gap-2 bg-white px-2 py-1.5 border border-slate-200 rounded-xl">
                                <button onClick={() => navigate(-1)} className="p-1.5 hover:bg-slate-50 rounded-lg">
                                    <ChevronLeft className="w-5 h-5 text-slate-600" />
                                </button>
                                <button
                                    onClick={() => {
                                        setPickerMode('single');
                                        setTempDate(currentDate.toISOString().split('T')[0]);
                                        setShowDatePicker(true);
                                    }}
                                    className="text-sm font-medium text-slate-900 min-w-[140px] text-center select-none hover:bg-slate-50 rounded-lg py-1"
                                >
                                    {viewMode === 'day'
                                        ? currentDate.toLocaleDateString('vi-VN')
                                        : viewMode === 'week'
                                            ? `Tuần ${Math.ceil((currentDate.getDate() + new Date(currentDate.getFullYear(), currentDate.getMonth(), 1).getDay()) / 7)}, ${currentDate.toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' })}`
                                            : `Tháng ${currentDate.getMonth() + 1}, ${currentDate.getFullYear()}`
                                    }
                                </button>
                                <button onClick={() => navigate(1)} className="p-1.5 hover:bg-slate-50 rounded-lg">
                                    <ChevronRight className="w-5 h-5 text-slate-600" />
                                </button>
                            </div>
                        </div>
                    ) : (
                        <div className="flex items-center gap-2 bg-blue-50 px-3 py-2 border border-blue-200 rounded-xl">
                            <CalendarIcon className="w-4 h-4 text-blue-600" />
                            <span className="text-sm font-medium text-blue-800">
                                {dateRangeStart && dateRangeEnd
                                    ? `${new Date(dateRangeStart).toLocaleDateString('vi-VN')} - ${new Date(dateRangeEnd).toLocaleDateString('vi-VN')}`
                                    : 'Chọn khoảng thời gian'
                                }
                            </span>
                            <button
                                onClick={() => {
                                    setPickerMode('range');
                                    setTempStartDate(dateRangeStart);
                                    setTempEndDate(dateRangeEnd);
                                    setShowDatePicker(true);
                                }}
                                className="text-xs text-blue-600 hover:underline ml-1"
                            >
                                Đổi
                            </button>
                        </div>
                    )}

                    {/* Export Button */}
                    <button
                        onClick={handleExportExcel}
                        disabled={schedules.length === 0}
                        className="flex items-center gap-2 px-4 py-2.5 bg-green-600 text-white rounded-xl shadow-sm hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                        <Download className="w-4 h-4" />
                        <span className="text-sm font-medium hidden lg:inline">Xuất Excel</span>
                    </button>
                </div>
            </div>

            {/* Calendar Grid */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-slide-up">
                {/* Weekday Headers - Hide in Day/Range View */}
                {(viewMode === 'month' || viewMode === 'week') && (
                    <div className="grid grid-cols-7 border-b border-slate-100">
                        {WEEKDAYS.map(day => (
                            <div key={day} className="py-2.5 text-center text-xs font-semibold text-slate-500 uppercase">
                                {day}
                            </div>
                        ))}
                    </div>
                )}

                <div className={cn(
                    "grid",
                    viewMode === 'day' ? "grid-cols-1"
                        : viewMode === 'range' ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
                            : "grid-cols-7"
                )}>
                    {days.map((day, idx) => {
                        const isCurrentMonth = viewMode === 'range' ? true : day.getMonth() === currentDate.getMonth();
                        const isToday = day.toDateString() === new Date().toDateString();
                        const daySchedules = getSchedulesForDate(day);
                        const holidayName = getHolidayName(day);
                        const isHolidayOrSunday = isSunday(day) || !!holidayName;

                        // Shift grouping with branch color support
                        const shiftGroups = daySchedules.reduce((acc, schedule) => {
                            const shift = shifts.find(s => s.id === schedule.shift_id);
                            // Group by branch_id + shift_id for proper color distinction
                            const key = `${schedule.branch_id || 'unknown'}_${shift?.id || 'unknown'}`;
                            if (!acc[key]) {
                                acc[key] = {
                                    name: shift?.name || 'Chưa xếp ca',
                                    start: shift?.start_time,
                                    end: shift?.end_time,
                                    count: 0,
                                    schedules: [],
                                    branchId: schedule.branch_id,
                                    branchName: getBranchName(schedule.branch_id)
                                };
                            }
                            acc[key].count++;
                            acc[key].schedules.push(schedule);
                            return acc;
                        }, {} as Record<string, { name: string; start?: string; end?: string; count: number; schedules: WorkSchedule[]; branchId?: string; branchName?: string }>);

                        return (
                            <div
                                key={idx}
                                className={cn(
                                    "border-b border-r border-slate-100 transition-colors relative group",
                                    viewMode === 'month' ? "min-h-[100px] p-2" : "min-h-[200px] p-3",
                                    viewMode === 'range' && "min-h-[180px]",
                                    !isCurrentMonth && viewMode === 'month' && "bg-slate-50/50",
                                    isHolidayOrSunday && "bg-red-50/30",
                                    (viewMode === 'month' && isCurrentMonth) && "hover:bg-blue-50/30 cursor-pointer",
                                    viewMode === 'range' && "hover:bg-blue-50/30 cursor-pointer"
                                )}
                                onClick={() => (viewMode === 'month' || viewMode === 'range') && isCurrentMonth && handleCellClick(day, daySchedules.length > 0)}
                            >
                                {/* Date Header */}
                                <div className={cn(
                                    "flex items-center justify-between mb-2",
                                    viewMode !== 'month' && "border-b border-slate-100 pb-2"
                                )}>
                                    <div className="flex flex-col">
                                        {viewMode !== 'month' && (
                                            <span className="text-xs font-medium text-slate-500 uppercase mb-0.5">
                                                {viewMode === 'range'
                                                    ? WEEKDAYS[(day.getDay() + 6) % 7]
                                                    : WEEKDAYS[day.getDay()]
                                                }
                                            </span>
                                        )}
                                        <div className="flex items-center gap-2">
                                            <span className={cn(
                                                "text-sm font-medium",
                                                !isCurrentMonth && viewMode === 'month' && "text-slate-300",
                                                isCurrentMonth && !isHolidayOrSunday && "text-slate-700",
                                                isCurrentMonth && isHolidayOrSunday && "text-red-500",
                                                isToday && !isHolidayOrSunday && "text-blue-600"
                                            )}>
                                                <span className={cn(
                                                    "inline-flex items-center justify-center rounded-full",
                                                    viewMode === 'range' ? "px-2 py-1" : "w-7 h-7",
                                                    isToday && !isHolidayOrSunday && "bg-blue-600 text-white",
                                                    isToday && isHolidayOrSunday && "bg-red-600 text-white"
                                                )}>
                                                    {viewMode === 'range'
                                                        ? day.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })
                                                        : day.getDate()
                                                    }
                                                </span>
                                            </span>
                                            {holidayName && (
                                                <span className="text-xs text-red-500 font-medium truncate max-w-[100px]" title={holidayName}>
                                                    {holidayName}
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    {/* Quick Add Button (Visible on Hover in Month View) */}
                                    {canEdit && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); openAddModal(day); }}
                                            className={cn(
                                                "p-1 rounded-full hover:bg-blue-100 text-blue-600 transition-opacity",
                                                viewMode === 'month' ? "opacity-0 group-hover:opacity-100" : ""
                                            )}
                                            title="Thêm lịch"
                                        >
                                            <Plus className="w-4 h-4" />
                                        </button>
                                    )}
                                </div>

                                {/* Schedules Content */}
                                <div className="space-y-1.5">
                                    {Object.entries(shiftGroups).map(([key, group]) => {
                                        const branchColor = getBranchColor(group.branchId);
                                        return (
                                            <div key={key} className="text-xs">
                                                {/* Shift Header with Branch Color */}
                                                <div className={cn(
                                                    "flex items-center justify-between px-2 py-1 rounded-md mb-0.5",
                                                    branchColor.bg, branchColor.text
                                                )}>
                                                    <div className="flex items-center gap-1.5 overflow-hidden">
                                                        <Clock className="w-3 h-3 shrink-0 opacity-70" />
                                                        <div className="truncate font-medium">
                                                            {!selectedBranch && group.branchName && (
                                                                <span className="opacity-75 mr-1">[{group.branchName}]</span>
                                                            )}
                                                            {group.name}
                                                            {group.start && <span className="opacity-75 font-normal ml-1">({group.start?.slice(0, 5)}-{group.end?.slice(0, 5)})</span>}
                                                        </div>
                                                    </div>
                                                    <span className="bg-white/80 px-1.5 rounded-full text-[10px] font-bold shadow-sm">
                                                        {group.count}
                                                    </span>
                                                </div>

                                                {/* Detailed List (Only for Week/Day view) */}
                                                {viewMode !== 'month' && (
                                                    <div className={cn("pl-2 space-y-1 mt-1 border-l-2", branchColor.border)}>
                                                        {group.schedules.map(sch => (
                                                            <div key={sch.id} className="flex items-center justify-between group/item px-2 py-1 hover:bg-slate-50 rounded">
                                                                <span className="text-slate-600 truncate">{getEmployeeName(sch.employee_id)}</span>
                                                                {canEdit && (
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); handleDeleteSchedule(sch.id, sch.employee_id); }}
                                                                        className="opacity-0 group-hover/item:opacity-100 text-slate-400 hover:text-red-500"
                                                                    >
                                                                        <X className="w-3 h-3" />
                                                                    </button>
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                    {daySchedules.length === 0 && canEdit && (
                                        <div
                                            className="text-xs text-slate-400 italic text-center py-2 border border-dashed border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50 hover:border-blue-200 hover:text-blue-500 transition-colors"
                                            onClick={(e) => { e.stopPropagation(); openAddModal(day); }}
                                        >
                                            + Tạo lịch
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Add Schedule Modal - Unchanged */}
            {showAddModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowAddModal(false)} />
                    <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 animate-scale-in">
                        <h3 className="text-lg font-bold text-slate-900 mb-4 flex items-center gap-2">
                            <CalendarIcon className="w-5 h-5 text-blue-600" />
                            Thêm lịch làm việc - {selectedDate?.split('-').reverse().join('/')}
                        </h3>

                        <div className="space-y-4">
                            {/* Shift Selection */}
                            {shifts.length > 0 && (
                                <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                                    <label className="block text-sm font-medium text-slate-700 mb-2">Chọn ca làm việc</label>
                                    <div className="space-y-2">
                                        {shifts.map(s => (
                                            <label key={s.id} className="flex items-center gap-3 p-2 bg-white border border-slate-200 rounded-lg cursor-pointer hover:border-blue-500 transition-colors">
                                                <input
                                                    type="radio"
                                                    name="shift"
                                                    value={s.id}
                                                    checked={selectedShift === s.id}
                                                    onChange={e => setSelectedShift(e.target.value)}
                                                    className="w-4 h-4 text-blue-600"
                                                />
                                                <div className="flex-1">
                                                    <div className="font-medium text-sm text-slate-900">{s.name}</div>
                                                    <div className="text-xs text-slate-500 flex items-center gap-1">
                                                        <Clock className="w-3 h-3" />
                                                        {s.start_time.slice(0, 5)} - {s.end_time.slice(0, 5)}
                                                    </div>
                                                </div>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Employee Selection */}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">
                                    Chọn nhân viên ({selectedEmployees.length} đã chọn)
                                </label>
                                <div className="max-h-60 overflow-y-auto border border-slate-200 rounded-xl divide-y divide-slate-100">
                                    {employees.map(emp => {
                                        const isSelected = selectedEmployees.includes(emp.id);
                                        return (
                                            <label
                                                key={emp.id}
                                                className={cn(
                                                    "flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors",
                                                    isSelected && "bg-blue-50"
                                                )}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={isSelected}
                                                    onChange={e => {
                                                        if (e.target.checked) {
                                                            setSelectedEmployees([...selectedEmployees, emp.id]);
                                                        } else {
                                                            setSelectedEmployees(selectedEmployees.filter(id => id !== emp.id));
                                                        }
                                                    }}
                                                    className="w-4 h-4 text-blue-600 rounded"
                                                />
                                                <div className="flex-1">
                                                    <p className="text-sm font-medium text-slate-900">{emp.name}</p>
                                                    <p className="text-xs text-slate-500">{emp.department} - {emp.position}</p>
                                                </div>
                                            </label>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        <div className="flex justify-end gap-3 mt-6">
                            <button
                                onClick={() => setShowAddModal(false)}
                                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
                            >
                                Hủy
                            </button>
                            <button
                                onClick={handleAddSchedule}
                                disabled={isSaving || selectedEmployees.length === 0}
                                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
                            >
                                {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                                <Plus className="w-4 h-4" />
                                Thêm lịch
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Detail Modal - View/Delete Schedules for a Day */}
            {showDetailModal && selectedDate && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowDetailModal(false)} />
                    <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 animate-scale-in max-h-[80vh] overflow-y-auto">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                                <CalendarIcon className="w-5 h-5 text-blue-600" />
                                Lịch ngày {selectedDate?.split('-').reverse().join('/')}
                            </h3>
                            <button
                                onClick={() => setShowDetailModal(false)}
                                className="p-1 hover:bg-slate-100 rounded-lg"
                            >
                                <X className="w-5 h-5 text-slate-500" />
                            </button>
                        </div>

                        {/* Schedules for the selected date */}
                        {(() => {
                            const daySchedules = schedules.filter(s => s.date === selectedDate);

                            if (daySchedules.length === 0) {
                                return (
                                    <div className="py-8 text-center text-slate-500">
                                        <CalendarIcon className="w-12 h-12 mx-auto mb-3 text-slate-300" />
                                        <p>Chưa có lịch làm việc</p>
                                    </div>
                                );
                            }

                            // Group by shift
                            const grouped = daySchedules.reduce((acc, schedule) => {
                                const shift = shifts.find(s => s.id === schedule.shift_id);
                                const key = shift?.id || 'unknown';
                                if (!acc[key]) acc[key] = {
                                    name: shift?.name || 'Chưa xếp ca',
                                    start: shift?.start_time,
                                    end: shift?.end_time,
                                    items: []
                                };
                                acc[key].items.push(schedule);
                                return acc;
                            }, {} as Record<string, { name: string; start?: string; end?: string; items: WorkSchedule[] }>);

                            return (
                                <div className="space-y-4">
                                    {Object.entries(grouped).map(([key, group]) => (
                                        <div key={key} className="border border-slate-200 rounded-xl overflow-hidden">
                                            <div className="flex items-center justify-between bg-blue-50 px-4 py-2 border-b border-slate-200">
                                                <div className="flex items-center gap-2">
                                                    <Clock className="w-4 h-4 text-blue-600" />
                                                    <span className="font-medium text-blue-800">{group.name}</span>
                                                    {group.start && (
                                                        <span className="text-sm text-blue-600">
                                                            ({group.start.slice(0, 5)} - {group.end?.slice(0, 5)})
                                                        </span>
                                                    )}
                                                </div>
                                                <span className="bg-blue-600 text-white text-xs px-2 py-0.5 rounded-full">
                                                    {group.items.length} người
                                                </span>
                                            </div>
                                            <div className="divide-y divide-slate-100">
                                                {group.items.map(sch => (
                                                    <div key={sch.id} className="flex items-center justify-between px-4 py-3 hover:bg-slate-50">
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-600">
                                                                {getEmployeeName(sch.employee_id).slice(0, 2).toUpperCase()}
                                                            </div>
                                                            <span className="text-sm text-slate-700">{getEmployeeName(sch.employee_id)}</span>
                                                        </div>
                                                        {canEdit && (
                                                            <button
                                                                onClick={() => handleDeleteSchedule(sch.id, sch.employee_id)}
                                                                className="text-slate-400 hover:text-red-500 p-1.5 hover:bg-red-50 rounded-lg transition-colors"
                                                                title="Xóa khỏi lịch"
                                                            >
                                                                <X className="w-4 h-4" />
                                                            </button>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            );
                        })()}

                        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-100">
                            <button
                                onClick={() => setShowDetailModal(false)}
                                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
                            >
                                Đóng
                            </button>
                            {canEdit && (
                                <button
                                    onClick={() => { setShowDetailModal(false); setShowAddModal(true); }}
                                    className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
                                >
                                    <Plus className="w-4 h-4" />
                                    Thêm nhân viên
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Date Picker Modal */}
            {showDatePicker && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowDatePicker(false)} />
                    <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 animate-scale-in">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                                <CalendarIcon className="w-5 h-5 text-blue-600" />
                                {pickerMode === 'single' ? 'Chọn ngày' : 'Chọn khoảng thời gian'}
                            </h3>
                            <button
                                onClick={() => setShowDatePicker(false)}
                                className="p-1 hover:bg-slate-100 rounded-lg"
                            >
                                <X className="w-5 h-5 text-slate-500" />
                            </button>
                        </div>

                        {/* Mode Switcher */}
                        <div className="flex p-1 bg-slate-100 rounded-lg mb-4">
                            <button
                                onClick={() => setPickerMode('single')}
                                className={cn(
                                    "flex-1 px-3 py-2 text-sm font-medium rounded-md transition-all",
                                    pickerMode === 'single' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                                )}
                            >
                                Chọn 1 ngày
                            </button>
                            <button
                                onClick={() => setPickerMode('range')}
                                className={cn(
                                    "flex-1 px-3 py-2 text-sm font-medium rounded-md transition-all",
                                    pickerMode === 'range' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500 hover:text-slate-700"
                                )}
                            >
                                Chọn khoảng thời gian
                            </button>
                        </div>

                        {pickerMode === 'single' ? (
                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-2">Chọn ngày</label>
                                    <input
                                        type="date"
                                        value={tempDate}
                                        onChange={e => setTempDate(e.target.value)}
                                        className="w-full px-4 py-3 text-sm border border-slate-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
                                    />
                                </div>

                                {/* Quick Select Buttons */}
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        onClick={() => setTempDate(new Date().toISOString().split('T')[0])}
                                        className="px-3 py-1.5 text-xs font-medium bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-colors"
                                    >
                                        Hôm nay
                                    </button>
                                    <button
                                        onClick={() => {
                                            const tomorrow = new Date();
                                            tomorrow.setDate(tomorrow.getDate() + 1);
                                            setTempDate(tomorrow.toISOString().split('T')[0]);
                                        }}
                                        className="px-3 py-1.5 text-xs font-medium bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-colors"
                                    >
                                        Ngày mai
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-2">Từ ngày</label>
                                        <input
                                            type="date"
                                            value={tempStartDate}
                                            onChange={e => setTempStartDate(e.target.value)}
                                            className="w-full px-4 py-3 text-sm border border-slate-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-2">Đến ngày</label>
                                        <input
                                            type="date"
                                            value={tempEndDate}
                                            onChange={e => setTempEndDate(e.target.value)}
                                            min={tempStartDate}
                                            className="w-full px-4 py-3 text-sm border border-slate-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 outline-none transition-all"
                                        />
                                    </div>
                                </div>

                                {/* Quick Range Buttons */}
                                <div className="flex flex-wrap gap-2">
                                    <button
                                        onClick={() => {
                                            const now = new Date();
                                            const start = new Date(now.getFullYear(), now.getMonth(), 1);
                                            const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
                                            setTempStartDate(start.toISOString().split('T')[0]);
                                            setTempEndDate(end.toISOString().split('T')[0]);
                                        }}
                                        className="px-3 py-1.5 text-xs font-medium bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-colors"
                                    >
                                        Tháng này
                                    </button>
                                    <button
                                        onClick={() => {
                                            const now = new Date();
                                            const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
                                            const end = new Date(now.getFullYear(), now.getMonth(), 0);
                                            setTempStartDate(start.toISOString().split('T')[0]);
                                            setTempEndDate(end.toISOString().split('T')[0]);
                                        }}
                                        className="px-3 py-1.5 text-xs font-medium bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-colors"
                                    >
                                        Tháng trước
                                    </button>
                                    <button
                                        onClick={() => {
                                            const now = new Date();
                                            const dayOfWeek = now.getDay();
                                            const diff = now.getDate() - dayOfWeek + (dayOfWeek === 0 ? -6 : 1);
                                            const monday = new Date(now.setDate(diff));
                                            const sunday = new Date(monday);
                                            sunday.setDate(monday.getDate() + 6);
                                            setTempStartDate(monday.toISOString().split('T')[0]);
                                            setTempEndDate(sunday.toISOString().split('T')[0]);
                                        }}
                                        className="px-3 py-1.5 text-xs font-medium bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-colors"
                                    >
                                        Tuần này
                                    </button>
                                    <button
                                        onClick={() => {
                                            const now = new Date();
                                            const start = new Date(now);
                                            const end = new Date(now);
                                            end.setDate(end.getDate() + 7);
                                            setTempStartDate(start.toISOString().split('T')[0]);
                                            setTempEndDate(end.toISOString().split('T')[0]);
                                        }}
                                        className="px-3 py-1.5 text-xs font-medium bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-colors"
                                    >
                                        7 ngày tới
                                    </button>
                                    <button
                                        onClick={() => {
                                            const now = new Date();
                                            const start = new Date(now);
                                            const end = new Date(now);
                                            end.setDate(end.getDate() + 30);
                                            setTempStartDate(start.toISOString().split('T')[0]);
                                            setTempEndDate(end.toISOString().split('T')[0]);
                                        }}
                                        className="px-3 py-1.5 text-xs font-medium bg-slate-100 text-slate-600 rounded-lg hover:bg-slate-200 transition-colors"
                                    >
                                        30 ngày tới
                                    </button>
                                </div>
                            </div>
                        )}

                        <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-100">
                            <button
                                onClick={() => setShowDatePicker(false)}
                                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
                            >
                                Hủy
                            </button>
                            <button
                                onClick={() => {
                                    if (pickerMode === 'single' && tempDate) {
                                        setCurrentDate(new Date(tempDate));
                                        setViewMode('day');
                                    } else if (pickerMode === 'range' && tempStartDate && tempEndDate) {
                                        setDateRangeStart(tempStartDate);
                                        setDateRangeEnd(tempEndDate);
                                        setViewMode('range');
                                    }
                                    setShowDatePicker(false);
                                }}
                                disabled={(pickerMode === 'single' && !tempDate) || (pickerMode === 'range' && (!tempStartDate || !tempEndDate))}
                                className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
                            >
                                <CalendarIcon className="w-4 h-4" />
                                Áp dụng
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Auto Generate Modal */}
            {showAutoGenModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-slate-900/60 backdrop-blur-sm" onClick={() => setShowAutoGenModal(false)} />
                    <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-lg p-6 animate-scale-in max-h-[90vh] overflow-y-auto">
                        <h3 className="text-lg font-bold text-slate-900 mb-2 flex items-center gap-2">
                            <CalendarIcon className="w-5 h-5 text-green-600" />
                            Tạo lịch tự động
                        </h3>
                        <p className="text-sm text-slate-500 mb-4">
                            Tạo lịch làm việc cho nhân viên <strong>lương tháng</strong> tại các chi nhánh <strong>văn phòng</strong> theo cài đặt giờ hành chính.
                        </p>

                        <div className="space-y-4">
                            {/* Date Range */}
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Từ ngày</label>
                                    <input
                                        type="date"
                                        value={autoGenStart}
                                        onChange={e => setAutoGenStart(e.target.value)}
                                        className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Đến ngày</label>
                                    <input
                                        type="date"
                                        value={autoGenEnd}
                                        onChange={e => setAutoGenEnd(e.target.value)}
                                        className="w-full px-3 py-2 border border-slate-200 rounded-xl focus:border-blue-500 focus:ring-2 focus:ring-blue-100 outline-none"
                                    />
                                </div>
                            </div>

                            {/* Employee Selection */}
                            <div className="border border-slate-200 rounded-xl p-4">
                                <label className="block text-sm font-medium text-slate-700 mb-3">Chọn nhân viên</label>

                                {/* Radio buttons */}
                                <div className="flex gap-4 mb-3">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="employeeSelect"
                                            checked={autoGenSelectAll}
                                            onChange={() => setAutoGenSelectAll(true)}
                                            className="w-4 h-4 text-green-600"
                                        />
                                        <span className="text-sm text-slate-700">Tất cả nhân viên lương tháng</span>
                                    </label>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="radio"
                                            name="employeeSelect"
                                            checked={!autoGenSelectAll}
                                            onChange={() => setAutoGenSelectAll(false)}
                                            className="w-4 h-4 text-green-600"
                                        />
                                        <span className="text-sm text-slate-700">Chọn nhân viên cụ thể</span>
                                    </label>
                                </div>

                                {/* Employee List (only shown when not selecting all) */}
                                {!autoGenSelectAll && (
                                    <div className="max-h-48 overflow-y-auto border border-slate-100 rounded-lg p-2 bg-slate-50">
                                        {employees
                                            .filter(emp =>
                                                emp.status === 'active' &&
                                                ['full_time_monthly', 'probation', 'intern'].includes(emp.employee_type || '')
                                            )
                                            .map(emp => (
                                                <label
                                                    key={emp.id}
                                                    className={cn(
                                                        "flex items-center gap-3 p-2 rounded-lg cursor-pointer transition-colors",
                                                        autoGenSelectedEmployees.includes(emp.id)
                                                            ? "bg-green-50 border border-green-200"
                                                            : "hover:bg-slate-100"
                                                    )}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={autoGenSelectedEmployees.includes(emp.id)}
                                                        onChange={(e) => {
                                                            if (e.target.checked) {
                                                                setAutoGenSelectedEmployees([...autoGenSelectedEmployees, emp.id]);
                                                            } else {
                                                                setAutoGenSelectedEmployees(autoGenSelectedEmployees.filter(id => id !== emp.id));
                                                            }
                                                        }}
                                                        className="w-4 h-4 text-green-600 rounded"
                                                    />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="text-sm font-medium text-slate-900 truncate">{emp.name}</div>
                                                        <div className="text-xs text-slate-500">{emp.position} - {emp.department}</div>
                                                    </div>
                                                </label>
                                            ))}
                                        {employees.filter(emp =>
                                            emp.status === 'active' &&
                                            ['full_time_monthly', 'probation', 'intern'].includes(emp.employee_type || '')
                                        ).length === 0 && (
                                                <p className="text-sm text-slate-400 italic text-center py-4">
                                                    Không có nhân viên lương tháng nào
                                                </p>
                                            )}
                                    </div>
                                )}

                                {!autoGenSelectAll && autoGenSelectedEmployees.length > 0 && (
                                    <div className="mt-2 text-xs text-green-600">
                                        Đã chọn {autoGenSelectedEmployees.length} nhân viên
                                    </div>
                                )}
                            </div>

                            <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-sm text-blue-700">
                                <strong>Lưu ý:</strong> Chỉ tạo cho các ngày theo cài đặt giờ hành chính (mặc định T2-T7). Những ngày đã có lịch sẽ được bỏ qua.
                            </div>
                        </div>

                        <div className="flex justify-end gap-3 mt-6">
                            <button
                                onClick={() => setShowAutoGenModal(false)}
                                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
                            >
                                Hủy
                            </button>
                            <button
                                onClick={handleAutoGenerate}
                                disabled={isGenerating || !autoGenStart || !autoGenEnd || (!autoGenSelectAll && autoGenSelectedEmployees.length === 0)}
                                className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50"
                            >
                                {isGenerating && <Loader2 className="w-4 h-4 animate-spin" />}
                                <Plus className="w-4 h-4" />
                                Tạo lịch
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Schedule Confirmation */}
            <ConfirmDialog
                open={confirmDeleteSchedule.open}
                onOpenChange={(open) => setConfirmDeleteSchedule({ ...confirmDeleteSchedule, open })}
                title="Xóa khỏi lịch làm việc?"
                description={'Bạn sẽ xóa "' + confirmDeleteSchedule.employeeName + '" khỏi lịch làm việc này. Hành động này không thể hoàn tác.'}
                confirmText="Xóa"
                cancelText="Hủy"
                variant="destructive"
                onConfirm={confirmDeleteScheduleAction}
            />
        </div>
    );
}
