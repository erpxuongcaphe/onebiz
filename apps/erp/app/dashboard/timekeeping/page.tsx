"use client";

import { useState, useEffect } from "react";
import {
    Clock, Calendar, CheckCircle, XCircle, AlertCircle, Users,
    LogIn, Filter, Loader2, Download, BarChart3, Pencil, X, Timer
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { getEmployees } from "@/lib/api/employees";
import { getBranches, getAttendanceRecords, updateAttendanceRecord, addManualOT, Branch, AttendanceRecord } from "@/lib/api/timekeeping";
import { getSchedules, WorkSchedule } from "@/lib/api/schedules";
import { getUsers, User } from "@/lib/api/users";
import { Employee } from "@/lib/database.types";

const statusConfig: Record<string, { label: string; icon: typeof CheckCircle; class: string; dotClass: string }> = {
    scheduled: { label: "Chờ chấm công", icon: Clock, class: "text-slate-600 bg-slate-100", dotClass: "bg-slate-400" },
    pending: { label: "Chờ duyệt", icon: Clock, class: "text-yellow-700 bg-yellow-100", dotClass: "bg-yellow-500" },
    approved: { label: "Đã duyệt", icon: CheckCircle, class: "text-green-700 bg-green-100", dotClass: "bg-green-500" },
    ontime: { label: "Đúng giờ", icon: CheckCircle, class: "text-green-600 bg-green-50", dotClass: "bg-green-500" },
    late: { label: "Đi muộn", icon: AlertCircle, class: "text-amber-600 bg-amber-50", dotClass: "bg-amber-500" },
    early_leave: { label: "Về sớm", icon: AlertCircle, class: "text-orange-600 bg-orange-50", dotClass: "bg-orange-500" },
    absent: { label: "Vắng mặt", icon: XCircle, class: "text-red-600 bg-red-50", dotClass: "bg-red-500" },
    rejected: { label: "Từ chối", icon: XCircle, class: "text-red-700 bg-red-100", dotClass: "bg-red-600" },
    completed: { label: "Hoàn thành", icon: CheckCircle, class: "text-blue-600 bg-blue-50", dotClass: "bg-blue-500" },
};

export default function TimekeepingPage() {
    const { user, hasSpecificPermission } = useAuth();
    const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0]);
    const [selectedBranch, setSelectedBranch] = useState<string>('');
    const [currentTime, setCurrentTime] = useState(new Date());

    // Date mode: 'day' (single date), 'range' (from-to), 'month' (whole month), 'summary' (monthly summary by employee)
    type DateMode = 'day' | 'range' | 'month' | 'summary';
    const [dateMode, setDateMode] = useState<DateMode>('day');
    const [dateRangeStart, setDateRangeStart] = useState<string>('');
    const [dateRangeEnd, setDateRangeEnd] = useState<string>('');
    const [selectedMonth, setSelectedMonth] = useState<string>(new Date().toISOString().slice(0, 7)); // YYYY-MM

    const [branches, setBranches] = useState<Branch[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [schedules, setSchedules] = useState<WorkSchedule[]>([]);
    const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);

    const [isLoading, setIsLoading] = useState(true);

    // Edit modal state
    const [editingRecord, setEditingRecord] = useState<AttendanceRecord | null>(null);
    const [editForm, setEditForm] = useState({ checkIn: '', checkOut: '', notes: '' });
    const [isSaving, setIsSaving] = useState(false);

    // OT modal state
    const [otRecord, setOtRecord] = useState<AttendanceRecord | null>(null);
    const [otForm, setOtForm] = useState({ hours: '', reason: '' });
    const [isOTSaving, setIsOTSaving] = useState(false);

    const isAdmin = user?.role === 'admin' || user?.role === 'branch_manager';

    // Handle edit attendance record
    async function handleSaveEdit() {
        if (!editingRecord) return;
        setIsSaving(true);
        try {
            // Create proper datetime with timezone
            const dateStr = editingRecord.date;

            // Parse time and create full datetime with local timezone
            let checkInDateTime: string | undefined;
            let checkOutDateTime: string | undefined;

            if (editForm.checkIn) {
                const [hours, minutes] = editForm.checkIn.split(':').map(Number);
                const checkInDate = new Date(dateStr);
                checkInDate.setHours(hours, minutes, 0, 0);
                checkInDateTime = checkInDate.toISOString();
            }

            if (editForm.checkOut) {
                const [hours, minutes] = editForm.checkOut.split(':').map(Number);
                const checkOutDate = new Date(dateStr);
                checkOutDate.setHours(hours, minutes, 0, 0);
                // Handle overnight shifts: if checkout time is before checkin, add 1 day
                if (editForm.checkIn && editForm.checkOut < editForm.checkIn) {
                    checkOutDate.setDate(checkOutDate.getDate() + 1);
                }
                checkOutDateTime = checkOutDate.toISOString();
            }

            await updateAttendanceRecord(editingRecord.id, {
                check_in: checkInDateTime,
                check_out: checkOutDateTime,
                notes: editForm.notes || undefined,
            });

            setEditingRecord(null);
            // Reload data
            fetchSchedulesAndAttendance();
        } catch (error) {
            console.error('Error updating attendance:', error);
            alert('Có lỗi khi cập nhật bản ghi chấm công');
        } finally {
            setIsSaving(false);
        }
    }

    function openEditModal(record: AttendanceRecord) {
        setEditingRecord(record);
        setEditForm({
            checkIn: record.check_in ? new Date(record.check_in).toTimeString().slice(0, 5) : '',
            checkOut: record.check_out ? new Date(record.check_out).toTimeString().slice(0, 5) : '',
            notes: record.notes || '',
        });
    }

    // OT handlers
    function openOTModal(record: AttendanceRecord) {
        setOtRecord(record);
        setOtForm({ hours: '', reason: '' });
    }

    async function handleSaveOT() {
        if (!otRecord || !user) return;
        const hours = parseFloat(otForm.hours);
        if (isNaN(hours) || hours <= 0) {
            alert('Vui lòng nhập số giờ OT hợp lệ');
            return;
        }
        setIsOTSaving(true);
        try {
            await addManualOT(otRecord.id, hours, user.id, otForm.reason || undefined);
            setOtRecord(null);
            fetchSchedulesAndAttendance();
        } catch (error) {
            console.error('Error adding OT:', error);
            alert('Có lỗi khi thêm OT');
        } finally {
            setIsOTSaving(false);
        }
    }

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    useEffect(() => {
        fetchBaseData();
    }, []);

    useEffect(() => {
        fetchSchedulesAndAttendance();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedDate, selectedBranch, user, dateMode, dateRangeStart, dateRangeEnd, selectedMonth]);

    const fetchBaseData = async () => {
        setIsLoading(true);
        try {
            const [empData, branchData, userData] = await Promise.all([
                getEmployees(),
                getBranches(),
                getUsers()
            ]);
            setEmployees(empData);
            setBranches(branchData);
            setUsers(userData);
        } catch (err) {
            console.error('Failed to fetch data:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const fetchSchedulesAndAttendance = async () => {
        try {
            const filters: { date?: string; startDate?: string; endDate?: string; branchId?: string; employeeId?: string } = {};

            if (selectedBranch) {
                filters.branchId = selectedBranch;
            }

            // Check if user has permission to view all timekeeping records
            // If not, only show their own records
            const canViewAll = hasSpecificPermission('view_all_timekeeping');
            if (!canViewAll && user?.employeeId) {
                filters.employeeId = user.employeeId;
            }

            if (dateMode === 'day') {
                filters.date = selectedDate;
            } else if (dateMode === 'range' && dateRangeStart && dateRangeEnd) {
                filters.startDate = dateRangeStart;
                filters.endDate = dateRangeEnd;
            } else if (dateMode === 'month' && selectedMonth) {
                const [year, month] = selectedMonth.split('-').map(Number);
                const lastDay = new Date(year, month, 0).getDate();
                filters.startDate = `${selectedMonth}-01`;
                filters.endDate = `${selectedMonth}-${lastDay.toString().padStart(2, '0')}`;
            } else if (dateMode === 'summary' && selectedMonth) {
                const [year, month] = selectedMonth.split('-').map(Number);
                const lastDay = new Date(year, month, 0).getDate();
                filters.startDate = `${selectedMonth}-01`;
                filters.endDate = `${selectedMonth}-${lastDay.toString().padStart(2, '0')}`;
            } else {
                // Default to today if no valid filter
                filters.date = selectedDate;
            }

            const [scheduleData, attendanceData] = await Promise.all([
                getSchedules(filters),
                getAttendanceRecords(filters)
            ]);

            setSchedules(scheduleData);
            setAttendanceRecords(attendanceData);
        } catch (err) {
            console.error('Failed to fetch data:', err);
        }
    };


    // Get employee details - handle both direct employee_id and user_id
    const getEmployeeDetails = (idOrUserId: string) => {
        // First try direct employee ID match
        let emp = employees.find(e => e.id === idOrUserId);
        if (emp) return emp;

        // If not found, try to find via user's employeeId
        const linkedUser = users.find(u => u.id === idOrUserId);
        if (linkedUser?.employeeId) {
            emp = employees.find(e => e.id === linkedUser.employeeId);
            if (emp) return emp;
        }

        // Try to find user by full_name match
        const userMatch = users.find(u => u.id === idOrUserId);
        if (userMatch) {
            return { name: userMatch.fullName, department: '' } as Employee;
        }

        return null;
    };

    const getBranchName = (branchId?: string) => {
        if (!branchId) return 'N/A';
        return branches.find(b => b.id === branchId)?.name || 'N/A';
    };

    // Export to Excel
    const handleExportExcel = () => {
        const headers = ['Ngày', 'Nhân viên', 'Chi nhánh', 'Vào ca', 'Ra ca', 'Số giờ', 'Trạng thái'];
        const rows = attendanceRecords.map(record => {
            const emp = getEmployeeDetails(record.employee_id);
            const checkIn = record.check_in ? new Date(record.check_in).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '';
            const checkOut = record.check_out ? new Date(record.check_out).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '';
            const hours = record.hours_worked ? record.hours_worked.toFixed(1) : '';
            const status = statusConfig[record.status]?.label || record.status;
            return [
                record.date,
                emp?.name || record.employee_id,
                getBranchName(record.branch_id),
                checkIn,
                checkOut,
                hours,
                status
            ];
        });

        const csvContent = [headers, ...rows]
            .map(row => row.map(cell => `"${cell}"`).join(','))
            .join('\n');

        const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;

        // Generate filename based on date mode
        let dateInfo = '';
        if (dateMode === 'day') {
            dateInfo = selectedDate;
        } else if (dateMode === 'range') {
            dateInfo = `${dateRangeStart}_${dateRangeEnd}`;
        } else {
            dateInfo = selectedMonth;
        }

        link.download = `cham-cong-${dateInfo}${selectedBranch ? `-${getBranchName(selectedBranch)}` : ''}.csv`.replace(/\s+/g, '-');
        link.click();
        URL.revokeObjectURL(url);
    };

    // Summary stats - now based on attendance records
    const stats = {
        total: attendanceRecords.length,
        checkedIn: attendanceRecords.filter(a => a.check_in && !a.check_out).length,
        completed: attendanceRecords.filter(a => a.check_out).length,
        late: attendanceRecords.filter(a => a.status === 'late').length,
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-96">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                <span className="ml-2 text-slate-600">Đang tải dữ liệu...</span>
            </div>
        );
    }

    return (
        <>
            <div className="space-y-4 md:space-y-6">
                {/* Header - Compact on mobile */}
                <div className="flex flex-col gap-3 animate-fade-in">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-xl md:text-2xl font-bold tracking-tight text-slate-900">Chấm công</h1>
                            <p className="text-slate-500 text-sm mt-0.5 hidden sm:block">Theo dõi và chấm công theo lịch làm việc</p>
                        </div>
                        {/* Export Button - Compact on mobile */}
                        <button
                            onClick={handleExportExcel}
                            disabled={attendanceRecords.length === 0}
                            className="flex items-center gap-1.5 px-3 py-2 bg-green-600 text-white rounded-xl shadow-sm hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                        >
                            <Download className="w-4 h-4" />
                            <span className="text-sm font-medium hidden sm:inline">Xuất Excel</span>
                        </button>
                    </div>

                    {/* Filters - Horizontal scroll on mobile */}
                    <div className="flex items-center gap-2 overflow-x-auto pb-1 -mx-1 px-1">
                        {/* Branch Filter */}
                        <div className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-xl shadow-sm shrink-0">
                            <Filter className="w-3.5 h-3.5 text-slate-400" />
                            <select
                                value={selectedBranch}
                                onChange={e => setSelectedBranch(e.target.value)}
                                className="text-sm border-none focus:outline-none bg-transparent"
                            >
                                <option value="">Tất cả chi nhánh</option>
                                {branches.map(b => (
                                    <option key={b.id} value={b.id}>{b.name}</option>
                                ))}
                            </select>
                        </div>

                        {/* Date Mode Selector */}
                        <div className="flex p-0.5 bg-slate-100 rounded-lg shrink-0">
                            <button
                                onClick={() => setDateMode('day')}
                                className={cn(
                                    "px-2.5 py-1 text-xs font-medium rounded-md transition-all",
                                    dateMode === 'day' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500"
                                )}
                            >
                                Ngày
                            </button>
                            <button
                                onClick={() => setDateMode('range')}
                                className={cn(
                                    "px-2.5 py-1 text-xs font-medium rounded-md transition-all",
                                    dateMode === 'range' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500"
                                )}
                            >
                                Tuỳ chọn
                            </button>
                            <button
                                onClick={() => setDateMode('month')}
                                className={cn(
                                    "px-2.5 py-1 text-xs font-medium rounded-md transition-all",
                                    dateMode === 'month' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500"
                                )}
                            >
                                Tháng
                            </button>
                            <button
                                onClick={() => setDateMode('summary')}
                                className={cn(
                                    "px-2.5 py-1 text-xs font-medium rounded-md transition-all flex items-center gap-1",
                                    dateMode === 'summary' ? "bg-white text-blue-600 shadow-sm" : "text-slate-500"
                                )}
                            >
                                <BarChart3 className="w-3 h-3" />
                                Tổng hợp
                            </button>
                        </div>

                        {/* Date Input based on mode */}
                        {dateMode === 'day' && (
                            <div className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-xl shadow-sm shrink-0">
                                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                                <input
                                    type="date"
                                    value={selectedDate}
                                    onChange={(e) => setSelectedDate(e.target.value)}
                                    className="text-sm border-none focus:outline-none bg-transparent w-[110px]"
                                />
                            </div>
                        )}

                        {dateMode === 'range' && (
                            <div className="flex items-center gap-1.5 px-2 py-1.5 bg-white border border-slate-200 rounded-xl shadow-sm shrink-0">
                                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                                <input
                                    type="date"
                                    value={dateRangeStart}
                                    onChange={(e) => setDateRangeStart(e.target.value)}
                                    className="text-xs border-none focus:outline-none bg-transparent w-[95px]"
                                />
                                <span className="text-slate-400 text-xs">→</span>
                                <input
                                    type="date"
                                    value={dateRangeEnd}
                                    onChange={(e) => setDateRangeEnd(e.target.value)}
                                    className="text-xs border-none focus:outline-none bg-transparent w-[95px]"
                                />
                            </div>
                        )}

                        {dateMode === 'month' && (
                            <div className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-xl shadow-sm shrink-0">
                                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                                <input
                                    type="month"
                                    value={selectedMonth}
                                    onChange={(e) => setSelectedMonth(e.target.value)}
                                    className="text-sm border-none focus:outline-none bg-transparent"
                                />
                            </div>
                        )}

                        {dateMode === 'summary' && (
                            <div className="flex items-center gap-1.5 px-3 py-2 bg-white border border-slate-200 rounded-xl shadow-sm shrink-0">
                                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                                <input
                                    type="month"
                                    value={selectedMonth}
                                    onChange={(e) => setSelectedMonth(e.target.value)}
                                    className="text-sm border-none focus:outline-none bg-transparent"
                                />
                            </div>
                        )}
                    </div>
                </div>

                {/* Summary Stats - Compact 2x2 on mobile */}
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 md:gap-4">
                    <div className="bg-white rounded-xl md:rounded-2xl border border-slate-200 p-3 md:p-5 shadow-sm animate-slide-up">
                        <div className="flex items-center gap-2 md:gap-4">
                            <div className="p-2 md:p-3 rounded-lg md:rounded-xl bg-blue-50">
                                <Users className="w-4 h-4 md:w-6 md:h-6 text-blue-600" />
                            </div>
                            <div>
                                <p className="text-lg md:text-2xl font-bold text-slate-900">{stats.total}</p>
                                <p className="text-xs md:text-sm text-slate-500">Bản ghi</p>
                            </div>
                        </div>
                    </div>
                    <div className="bg-white rounded-xl md:rounded-2xl border border-slate-200 p-3 md:p-5 shadow-sm animate-slide-up stagger-1">
                        <div className="flex items-center gap-2 md:gap-4">
                            <div className="p-2 md:p-3 rounded-lg md:rounded-xl bg-amber-50">
                                <LogIn className="w-4 h-4 md:w-6 md:h-6 text-amber-600" />
                            </div>
                            <div>
                                <p className="text-lg md:text-2xl font-bold text-slate-900">{stats.checkedIn}</p>
                                <p className="text-xs md:text-sm text-slate-500">Check-in</p>
                            </div>
                        </div>
                    </div>
                    <div className="bg-white rounded-xl md:rounded-2xl border border-slate-200 p-3 md:p-5 shadow-sm animate-slide-up stagger-2">
                        <div className="flex items-center gap-2 md:gap-4">
                            <div className="p-2 md:p-3 rounded-lg md:rounded-xl bg-green-50">
                                <CheckCircle className="w-4 h-4 md:w-6 md:h-6 text-green-600" />
                            </div>
                            <div>
                                <p className="text-lg md:text-2xl font-bold text-slate-900">{stats.completed}</p>
                                <p className="text-xs md:text-sm text-slate-500">Hoàn thành</p>
                            </div>
                        </div>
                    </div>
                    <div className="bg-white rounded-xl md:rounded-2xl border border-slate-200 p-3 md:p-5 shadow-sm animate-slide-up stagger-3">
                        <div className="flex items-center gap-2 md:gap-4">
                            <div className="p-2 md:p-3 rounded-lg md:rounded-xl bg-amber-50">
                                <AlertCircle className="w-4 h-4 md:w-6 md:h-6 text-amber-600" />
                            </div>
                            <div>
                                <p className="text-lg md:text-2xl font-bold text-slate-900">{stats.late}</p>
                                <p className="text-xs md:text-sm text-slate-500">Đi trễ</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Current Time - Compact on mobile */}
                <div className="flex items-center justify-center gap-2 md:gap-4 py-3 md:py-4 bg-white rounded-xl md:rounded-2xl border border-slate-200 shadow-sm">
                    <Clock className="w-4 h-4 md:w-6 md:h-6 text-blue-600" />
                    <span className="text-xl md:text-3xl font-bold text-slate-900 tabular-nums">
                        {currentTime.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </span>
                    <span className="text-xs md:text-base text-slate-500 hidden sm:inline">
                        {currentTime.toLocaleDateString("vi-VN", { weekday: "long", day: "numeric", month: "long" })}
                    </span>
                </div>

                {/* Summary View - Statistics per Employee - SHOW FIRST when in summary mode */}
                {dateMode === 'summary' && (
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-fade-in">
                        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                            <div>
                                <h3 className="font-semibold text-slate-900">Tổng hợp chấm công tháng {selectedMonth}</h3>
                                <p className="text-xs text-slate-500 mt-0.5">{attendanceRecords.length} bản ghi • {employees.filter(e => e.status === 'active').length} nhân viên</p>
                            </div>
                        </div>
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead className="bg-slate-50">
                                    <tr>
                                        <th className="text-left text-xs font-semibold text-slate-500 uppercase px-4 py-3">Nhân viên</th>
                                        <th className="text-center text-xs font-semibold text-slate-500 uppercase px-3 py-3">Ngày công</th>
                                        <th className="text-center text-xs font-semibold text-slate-500 uppercase px-3 py-3">Tổng giờ</th>
                                        <th className="text-center text-xs font-semibold text-slate-500 uppercase px-3 py-3">Đúng giờ</th>
                                        <th className="text-center text-xs font-semibold text-slate-500 uppercase px-3 py-3">Đi muộn</th>
                                        <th className="text-center text-xs font-semibold text-slate-500 uppercase px-3 py-3">OT (h)</th>
                                        <th className="text-center text-xs font-semibold text-slate-500 uppercase px-3 py-3">Tỷ lệ</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {(() => {
                                        // Group attendance by employee AND by date first
                                        // Each day = max 1 work day, regardless of how many check-ins
                                        const employeeSummary: Record<string, {
                                            name: string;
                                            department: string;
                                            workDays: number;
                                            totalHours: number;
                                            onTimeCount: number;
                                            lateCount: number;
                                            otHours: number;
                                            dateRecords: Record<string, { hours: number; otHours: number; statuses: string[] }>;
                                        }> = {};

                                        // First pass: group records by employee and date
                                        attendanceRecords.forEach(record => {
                                            const emp = getEmployeeDetails(record.employee_id);
                                            const empKey = emp?.id || record.employee_id;
                                            const dateKey = record.check_in ? record.check_in.split('T')[0] : record.date;

                                            if (!employeeSummary[empKey]) {
                                                employeeSummary[empKey] = {
                                                    name: emp?.name || 'Unknown',
                                                    department: emp?.department || '',
                                                    workDays: 0,
                                                    totalHours: 0,
                                                    onTimeCount: 0,
                                                    lateCount: 0,
                                                    otHours: 0,
                                                    dateRecords: {},
                                                };
                                            }

                                            if (record.check_in && dateKey) {
                                                if (!employeeSummary[empKey].dateRecords[dateKey]) {
                                                    employeeSummary[empKey].dateRecords[dateKey] = { hours: 0, otHours: 0, statuses: [] };
                                                }
                                                employeeSummary[empKey].dateRecords[dateKey].hours += record.hours_worked || 0;
                                                employeeSummary[empKey].dateRecords[dateKey].otHours += record.overtime_hours || 0;
                                                employeeSummary[empKey].dateRecords[dateKey].statuses.push(record.status);
                                            }
                                        });

                                        // Second pass: calculate work days from grouped date records
                                        Object.values(employeeSummary).forEach(summary => {
                                            Object.values(summary.dateRecords).forEach(dayData => {
                                                // Each day = 1 work day if total hours >= 7
                                                if (dayData.hours >= 7) {
                                                    summary.workDays++;
                                                }
                                                // Total hours: max 8h per day for regular work
                                                summary.totalHours += Math.min(dayData.hours, 8);
                                                summary.otHours += dayData.otHours;
                                                // Count on-time/late based on any status in the day
                                                if (dayData.statuses.includes('ontime') || dayData.statuses.includes('approved')) {
                                                    summary.onTimeCount++;
                                                }
                                                if (dayData.statuses.includes('late')) {
                                                    summary.lateCount++;
                                                }
                                            });
                                        });

                                        const summaryList = Object.entries(employeeSummary)
                                            .sort(([, a], [, b]) => b.workDays - a.workDays);

                                        if (summaryList.length === 0) {
                                            return (
                                                <tr>
                                                    <td colSpan={7} className="px-4 py-12 text-center text-slate-400">
                                                        Không có dữ liệu chấm công trong tháng này
                                                    </td>
                                                </tr>
                                            );
                                        }

                                        return summaryList.map(([empId, data]) => {
                                            const attendanceRate = data.workDays > 0
                                                ? Math.round((data.onTimeCount / data.workDays) * 100)
                                                : 0;

                                            return (
                                                <tr key={empId} className="hover:bg-slate-50/50 transition-colors">
                                                    <td className="px-4 py-3">
                                                        <div className="flex items-center gap-3">
                                                            <div className="w-9 h-9 rounded-lg gradient-primary flex items-center justify-center text-white text-xs font-bold">
                                                                {data.name.slice(0, 2).toUpperCase()}
                                                            </div>
                                                            <div>
                                                                <div className="text-sm font-medium text-slate-900">{data.name}</div>
                                                                <div className="text-xs text-slate-500">{data.department}</div>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-3 py-3 text-center">
                                                        <span className="text-sm font-semibold text-slate-900">{data.workDays}</span>
                                                    </td>
                                                    <td className="px-3 py-3 text-center">
                                                        <span className="text-sm text-slate-600">{data.totalHours.toFixed(1)}h</span>
                                                    </td>
                                                    <td className="px-3 py-3 text-center">
                                                        <span className="inline-flex items-center justify-center w-7 h-7 text-xs font-medium rounded-full bg-green-100 text-green-700">
                                                            {data.onTimeCount}
                                                        </span>
                                                    </td>
                                                    <td className="px-3 py-3 text-center">
                                                        <span className={cn(
                                                            "inline-flex items-center justify-center w-7 h-7 text-xs font-medium rounded-full",
                                                            data.lateCount > 0 ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-400"
                                                        )}>
                                                            {data.lateCount}
                                                        </span>
                                                    </td>
                                                    <td className="px-3 py-3 text-center">
                                                        <span className={cn(
                                                            "text-sm",
                                                            data.otHours > 0 ? "text-purple-600 font-medium" : "text-slate-400"
                                                        )}>
                                                            {data.otHours > 0 ? data.otHours.toFixed(1) : '-'}
                                                        </span>
                                                    </td>
                                                    <td className="px-3 py-3 text-center">
                                                        <div className="flex items-center justify-center gap-1.5">
                                                            <div className="w-12 h-1.5 bg-slate-200 rounded-full overflow-hidden">
                                                                <div
                                                                    className={cn(
                                                                        "h-full rounded-full",
                                                                        attendanceRate >= 90 ? "bg-green-500" : attendanceRate >= 70 ? "bg-amber-500" : "bg-red-500"
                                                                    )}
                                                                    style={{ width: `${attendanceRate}%` }}
                                                                />
                                                            </div>
                                                            <span className="text-xs text-slate-500 w-8">{attendanceRate}%</span>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        });
                                    })()}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Attendance List */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden animate-slide-up stagger-4">
                    <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                        <h3 className="font-semibold text-slate-900">Danh sách chấm công</h3>
                        <span className="text-sm text-slate-500">{attendanceRecords.length} bản ghi</span>
                    </div>

                    {attendanceRecords.length === 0 ? (
                        <div className="p-12 text-center">
                            <Calendar className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                            <p className="text-slate-500">Chưa có ai chấm công hôm nay</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full">
                                <thead>
                                    <tr className="bg-slate-50/80">
                                        {dateMode !== 'day' && <th className="text-left text-xs font-semibold text-slate-500 uppercase px-6 py-3">Ngày</th>}
                                        <th className="text-left text-xs font-semibold text-slate-500 uppercase px-6 py-3">Nhân viên</th>
                                        {!selectedBranch && <th className="text-left text-xs font-semibold text-slate-500 uppercase px-6 py-3">Chi nhánh</th>}
                                        <th className="text-left text-xs font-semibold text-slate-500 uppercase px-6 py-3">Vào ca</th>
                                        <th className="text-left text-xs font-semibold text-slate-500 uppercase px-6 py-3">Ra ca</th>
                                        <th className="text-left text-xs font-semibold text-slate-500 uppercase px-6 py-3">Số giờ</th>
                                        <th className="text-left text-xs font-semibold text-slate-500 uppercase px-6 py-3">Trạng thái</th>
                                        {isAdmin && <th className="text-center text-xs font-semibold text-slate-500 uppercase px-4 py-3">Sửa</th>}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-50">
                                    {attendanceRecords.map((record, index) => {
                                        const employee = getEmployeeDetails(record.employee_id);
                                        const status = record.status || 'scheduled';

                                        return (
                                            <tr
                                                key={record.id}
                                                className="hover:bg-slate-50/50 transition-colors animate-fade-in"
                                                style={{ animationDelay: `${index * 50}ms` }}
                                            >
                                                {dateMode !== 'day' && (
                                                    <td className="px-6 py-4">
                                                        <span className="text-sm text-slate-600">{new Date(record.date).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}</span>
                                                    </td>
                                                )}
                                                <td className="px-6 py-4">
                                                    <div className="flex items-center gap-3">
                                                        <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center text-white text-xs font-bold shadow-md">
                                                            {employee?.name?.slice(0, 2).toUpperCase() || 'NV'}
                                                        </div>
                                                        <div>
                                                            <div className="text-sm font-medium text-slate-900">{employee?.name || record.employee_id}</div>
                                                            <div className="text-xs text-slate-500">{employee?.department}</div>
                                                        </div>
                                                    </div>
                                                </td>
                                                {!selectedBranch && (
                                                    <td className="px-6 py-4">
                                                        <span className="text-sm text-slate-600">{getBranchName(record.branch_id)}</span>
                                                    </td>
                                                )}
                                                <td className="px-6 py-4">
                                                    <span className={cn(
                                                        "text-sm font-mono",
                                                        record.check_in ? "text-slate-900" : "text-slate-400"
                                                    )}>
                                                        {record.check_in
                                                            ? new Date(record.check_in).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
                                                            : "--:--"}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <span className={cn(
                                                        "text-sm font-mono",
                                                        record.check_out ? "text-slate-900" : "text-slate-400"
                                                    )}>
                                                        {record.check_out
                                                            ? new Date(record.check_out).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
                                                            : "--:--"}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <span className="text-sm font-medium text-slate-900">
                                                        {record.hours_worked
                                                            ? `${record.hours_worked.toFixed(1)}h`
                                                            : "-"}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <span className={cn(
                                                        "inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full",
                                                        statusConfig[status]?.class || statusConfig.scheduled.class
                                                    )}>
                                                        <span className={cn("w-1.5 h-1.5 rounded-full", statusConfig[status]?.dotClass || statusConfig.scheduled.dotClass)} />
                                                        {statusConfig[status]?.label || status}
                                                    </span>
                                                </td>
                                                {isAdmin && (
                                                    <td className="px-4 py-4">
                                                        <div className="flex items-center gap-1">
                                                            <button
                                                                onClick={() => openEditModal(record)}
                                                                className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                                                                title="Sửa giờ chấm công"
                                                            >
                                                                <Pencil className="w-4 h-4" />
                                                            </button>
                                                            <button
                                                                onClick={() => openOTModal(record)}
                                                                className="p-1.5 text-slate-400 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                                                                title="Thêm OT"
                                                            >
                                                                <Timer className="w-4 h-4" />
                                                            </button>
                                                        </div>
                                                    </td>
                                                )}
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>
            </div>

            {/* Edit Attendance Modal */}
            {
                editingRecord && (
                    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
                        <div className="bg-white rounded-2xl shadow-xl max-w-md w-full animate-fade-in">
                            <div className="p-6 border-b border-slate-200 flex items-center justify-between">
                                <div>
                                    <h2 className="text-lg font-semibold text-slate-900">Sửa giờ chấm công</h2>
                                    <p className="text-sm text-slate-500 mt-0.5">
                                        {new Date(editingRecord.date).toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}
                                    </p>
                                </div>
                                <button
                                    onClick={() => setEditingRecord(null)}
                                    className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>

                            <div className="p-6 space-y-4">
                                {/* Employee Info */}
                                <div className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                                    <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center text-white text-xs font-bold">
                                        {getEmployeeDetails(editingRecord.employee_id)?.name?.slice(0, 2).toUpperCase() || 'NV'}
                                    </div>
                                    <div>
                                        <div className="font-medium text-slate-900">
                                            {getEmployeeDetails(editingRecord.employee_id)?.name || editingRecord.employee_id}
                                        </div>
                                        <div className="text-xs text-slate-500">
                                            {getEmployeeDetails(editingRecord.employee_id)?.department}
                                        </div>
                                    </div>
                                </div>

                                {/* Check-in Time */}
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">
                                        Giờ vào ca
                                    </label>
                                    <input
                                        type="time"
                                        value={editForm.checkIn}
                                        onChange={(e) => setEditForm({ ...editForm, checkIn: e.target.value })}
                                        className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                                    />
                                </div>

                                {/* Check-out Time */}
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">
                                        Giờ ra ca
                                    </label>
                                    <input
                                        type="time"
                                        value={editForm.checkOut}
                                        onChange={(e) => setEditForm({ ...editForm, checkOut: e.target.value })}
                                        className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                                    />
                                </div>

                                {/* Notes */}
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">
                                        Ghi chú (lý do chỉnh sửa)
                                    </label>
                                    <textarea
                                        value={editForm.notes}
                                        onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                                        rows={2}
                                        placeholder="VD: Nhân viên quên chấm công, đã xác nhận có mặt..."
                                        className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all resize-none"
                                    />
                                </div>
                            </div>

                            <div className="p-6 border-t border-slate-200 flex gap-3 justify-end">
                                <button
                                    onClick={() => setEditingRecord(null)}
                                    className="px-4 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                                >
                                    Hủy
                                </button>
                                <button
                                    onClick={handleSaveEdit}
                                    disabled={isSaving}
                                    className="px-4 py-2.5 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                                >
                                    {isSaving ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            Đang lưu...
                                        </>
                                    ) : (
                                        'Lưu thay đổi'
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* OT Modal */}
            {otRecord && (
                <div className="fixed inset-0 z-50 flex items-center justify-center">
                    <div
                        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                        onClick={() => setOtRecord(null)}
                    />
                    <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden animate-scale-in">
                        <div className="p-6 border-b border-slate-200">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-bold text-slate-900 flex items-center gap-2">
                                    <Timer className="w-5 h-5 text-purple-500" />
                                    Thêm OT
                                </h3>
                                <button
                                    onClick={() => setOtRecord(null)}
                                    className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                                >
                                    <X className="w-5 h-5" />
                                </button>
                            </div>
                            <p className="text-sm text-slate-500 mt-2">
                                Nhân viên: <span className="font-medium text-slate-700">
                                    {employees.find(e => e.id === otRecord.employee_id)?.name ||
                                        users.find((u: User) => u.id === otRecord.employee_id)?.fullName ||
                                        otRecord.employee_id}
                                </span>
                            </p>
                            <p className="text-sm text-slate-500">
                                Ngày: <span className="font-medium text-slate-700">
                                    {new Date(otRecord.date).toLocaleDateString('vi-VN')}
                                </span>
                            </p>
                        </div>

                        <div className="p-6 space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                                    Số giờ OT <span className="text-red-500">*</span>
                                </label>
                                <input
                                    type="number"
                                    step="0.5"
                                    min="0.5"
                                    max="12"
                                    value={otForm.hours}
                                    onChange={(e) => setOtForm({ ...otForm, hours: e.target.value })}
                                    placeholder="VD: 2"
                                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                                    Lý do OT
                                </label>
                                <textarea
                                    value={otForm.reason}
                                    onChange={(e) => setOtForm({ ...otForm, reason: e.target.value })}
                                    rows={2}
                                    placeholder="VD: Bàn giao ca, xử lý sự cố..."
                                    className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition-all resize-none"
                                />
                            </div>
                        </div>

                        <div className="p-6 border-t border-slate-200 flex gap-3 justify-end">
                            <button
                                onClick={() => setOtRecord(null)}
                                className="px-4 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl transition-colors"
                            >
                                Hủy
                            </button>
                            <button
                                onClick={handleSaveOT}
                                disabled={isOTSaving || !otForm.hours}
                                className="px-4 py-2.5 bg-purple-600 text-white font-medium rounded-xl hover:bg-purple-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                            >
                                {isOTSaving ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Đang lưu...
                                    </>
                                ) : (
                                    'Thêm OT'
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
