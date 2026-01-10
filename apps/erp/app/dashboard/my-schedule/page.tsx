"use client";

import { useState, useEffect } from "react";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, Loader2, Clock, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { getSchedules, WorkSchedule } from "@/lib/api/schedules";
import { getBranches, getShifts, Branch, Shift } from "@/lib/api/timekeeping";
import { getEmployees } from "@/lib/api/employees";
import { Employee } from "@/lib/database.types";

const WEEKDAYS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

// Vietnamese public holidays
const VIETNAMESE_HOLIDAYS: Record<number, { month: number; day: number; name: string }[]> = {
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
    2026: [
        { month: 1, day: 1, name: 'Tết Dương lịch' },
        { month: 2, day: 17, name: 'Tết Nguyên đán' },
        { month: 2, day: 18, name: 'Tết Nguyên đán' },
        { month: 2, day: 19, name: 'Tết Nguyên đán' },
        { month: 2, day: 20, name: 'Tết Nguyên đán' },
        { month: 2, day: 21, name: 'Tết Nguyên đán' },
        { month: 4, day: 26, name: 'Giỗ Tổ Hùng Vương' },
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

export default function MySchedulePage() {
    const { user } = useAuth();
    const [currentDate, setCurrentDate] = useState(new Date());
    const [schedules, setSchedules] = useState<WorkSchedule[]>([]);
    const [branches, setBranches] = useState<Branch[]>([]);
    const [shifts, setShifts] = useState<Shift[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [employee, setEmployee] = useState<Employee | null>(null);
    const [isLoading, setIsLoading] = useState(true);

    // Detail popup state
    const [selectedDayPopup, setSelectedDayPopup] = useState<{ date: Date; schedules: WorkSchedule[] } | null>(null);

    useEffect(() => {
        fetchBaseData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user]);

    useEffect(() => {
        if (employee) {
            fetchSchedules();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentDate, employee]);

    const fetchBaseData = async () => {
        if (!user?.employeeId) {
            setIsLoading(false);
            return;
        }

        setIsLoading(true);
        try {
            const [branchData, shiftData, employeeData] = await Promise.all([
                getBranches(),
                getShifts(),
                getEmployees()
            ]);
            setBranches(branchData);
            setShifts(shiftData);
            setEmployees(employeeData);

            // Find current user's employee profile
            const emp = employeeData.find(e => e.id === user.employeeId);
            setEmployee(emp || null);
        } catch (err) {
            console.error('Failed to fetch data:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const fetchSchedules = async () => {
        if (!employee) return;

        try {
            const year = currentDate.getFullYear();
            const month = currentDate.getMonth();
            const startDate = new Date(year, month, 1).toISOString().split('T')[0];
            const endDate = new Date(year, month + 1, 0).toISOString().split('T')[0];

            // Fetch schedules for the employee's branch (all employees in branch)
            const data = await getSchedules({
                startDate,
                endDate,
                branchId: employee.branch_id || undefined
            });
            setSchedules(data);
        } catch (err) {
            console.error('Failed to fetch schedules:', err);
        }
    };

    const navigate = (delta: number) => {
        const newDate = new Date(currentDate);
        newDate.setMonth(newDate.getMonth() + delta);
        setCurrentDate(newDate);
    };

    const getBranchName = (branchId?: string) => {
        if (!branchId) return '';
        const branch = branches.find(b => b.id === branchId);
        return branch?.name || '';
    };

    const getShiftDetails = (shiftId?: string) => {
        if (!shiftId) return null;
        return shifts.find(s => s.id === shiftId);
    };

    const getEmployeeName = (empId: string) => {
        const emp = employees.find(e => e.id === empId);
        return emp?.name || 'N/A';
    };

    const getDaysInMonth = () => {
        const year = currentDate.getFullYear();
        const month = currentDate.getMonth();
        const days: Date[] = [];

        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);

        // Start padding (Monday = 0)
        const startPadding = (firstDay.getDay() + 6) % 7;

        for (let i = startPadding; i > 0; i--) {
            days.push(new Date(year, month, 1 - i));
        }
        for (let i = 1; i <= lastDay.getDate(); i++) {
            days.push(new Date(year, month, i));
        }

        // End padding
        const lastDayIndex = (lastDay.getDay() + 6) % 7;
        const endPadding = 6 - lastDayIndex;

        for (let i = 1; i <= endPadding; i++) {
            days.push(new Date(year, month + 1, i));
        }

        return days;
    };

    const getSchedulesForDate = (date: Date) => {
        const dateStr = date.toISOString().split('T')[0];
        return schedules.filter(s => s.date === dateStr);
    };

    // Count my own work days
    const myWorkDays = schedules.filter(s => s.employee_id === employee?.id).length;
    const totalSchedules = schedules.length;

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-96">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                <span className="ml-2 text-slate-600">Đang tải dữ liệu...</span>
            </div>
        );
    }

    if (!user?.employeeId || !employee) {
        return (
            <div className="flex flex-col items-center justify-center h-96 text-center">
                <CalendarIcon className="w-16 h-16 text-slate-300 mb-4" />
                <h2 className="text-xl font-bold text-slate-900 mb-2">Không tìm thấy hồ sơ nhân viên</h2>
                <p className="text-slate-500">Tài khoản của bạn chưa được liên kết với hồ sơ nhân viên.</p>
                <p className="text-slate-400 text-sm mt-2">Vui lòng liên hệ quản trị viên để được hỗ trợ.</p>
            </div>
        );
    }

    const days = getDaysInMonth();
    const branchName = getBranchName(employee.branch_id || undefined);

    return (
        <div className="space-y-4 animate-fade-in">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                    <h1 className="text-xl md:text-2xl font-bold tracking-tight text-slate-900">
                        Lịch làm việc {branchName ? `- ${branchName}` : ''}
                    </h1>
                    <p className="text-slate-500 text-sm mt-0.5">
                        Xem lịch làm việc của chi nhánh •
                        <span className="font-medium text-blue-600"> {myWorkDays} ngày của tôi</span>
                        <span className="text-slate-400"> • {totalSchedules} lịch tổng</span>
                    </p>
                </div>

                {/* Month Navigation */}
                <div className="flex items-center gap-2 bg-white px-3 py-2 border border-slate-200 rounded-xl shadow-sm">
                    <button onClick={() => navigate(-1)} className="p-1.5 hover:bg-slate-50 rounded-lg transition-colors">
                        <ChevronLeft className="w-5 h-5 text-slate-600" />
                    </button>
                    <span className="text-sm font-medium text-slate-900 min-w-[140px] text-center">
                        Tháng {currentDate.getMonth() + 1}, {currentDate.getFullYear()}
                    </span>
                    <button onClick={() => navigate(1)} className="p-1.5 hover:bg-slate-50 rounded-lg transition-colors">
                        <ChevronRight className="w-5 h-5 text-slate-600" />
                    </button>
                </div>
            </div>

            {/* Legend */}
            <div className="flex flex-wrap gap-4 text-sm">
                <span className="flex items-center gap-2">
                    <span className="w-4 h-4 rounded bg-blue-500 border border-blue-600"></span>
                    <span className="text-slate-600">Lịch của tôi</span>
                </span>
                <span className="flex items-center gap-2">
                    <span className="w-4 h-4 rounded bg-slate-200 border border-slate-300"></span>
                    <span className="text-slate-600">Đồng nghiệp</span>
                </span>
                <span className="flex items-center gap-2">
                    <span className="w-4 h-4 rounded bg-green-100 border border-green-300"></span>
                    <span className="text-slate-600">Hôm nay</span>
                </span>
                <span className="flex items-center gap-2">
                    <span className="w-4 h-4 rounded bg-red-50 border border-red-200"></span>
                    <span className="text-slate-600">Nghỉ lễ / Chủ nhật</span>
                </span>
            </div>

            {/* Calendar */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                {/* Weekday Headers */}
                <div className="grid grid-cols-7 border-b border-slate-100">
                    {WEEKDAYS.map(day => (
                        <div key={day} className="py-3 text-center text-xs font-semibold text-slate-500 uppercase">
                            {day}
                        </div>
                    ))}
                </div>

                {/* Days Grid */}
                <div className="grid grid-cols-7">
                    {days.map((day, idx) => {
                        const isCurrentMonth = day.getMonth() === currentDate.getMonth();
                        const isToday = day.toDateString() === new Date().toDateString();
                        const daySchedules = getSchedulesForDate(day);
                        const mySchedules = daySchedules.filter(s => s.employee_id === employee.id);
                        const otherSchedules = daySchedules.filter(s => s.employee_id !== employee.id);
                        const holidayName = getHolidayName(day);
                        const isHolidayOrSunday = isSunday(day) || !!holidayName;
                        const hasMySchedule = mySchedules.length > 0;
                        const hasAnySchedule = daySchedules.length > 0;

                        // Get first 2 other employee names to display
                        const displayOtherNames = otherSchedules.slice(0, 2).map(s => getEmployeeName(s.employee_id));
                        const moreCount = otherSchedules.length - 2;

                        return (
                            <div
                                key={idx}
                                onClick={() => {
                                    if (isCurrentMonth && hasAnySchedule) {
                                        setSelectedDayPopup({ date: day, schedules: daySchedules });
                                    }
                                }}
                                className={cn(
                                    "min-h-[100px] md:min-h-[120px] p-2 border-b border-r border-slate-100 transition-colors",
                                    !isCurrentMonth && "bg-slate-50/50",
                                    isHolidayOrSunday && isCurrentMonth && "bg-red-50/30",
                                    isToday && "ring-2 ring-inset ring-green-400",
                                    hasMySchedule && isCurrentMonth && !isHolidayOrSunday && "bg-blue-50/50",
                                    isCurrentMonth && hasAnySchedule && "cursor-pointer hover:bg-slate-100/50"
                                )}
                            >
                                {/* Date Number */}
                                <div className="flex items-start justify-between mb-1">
                                    <span className={cn(
                                        "inline-flex items-center justify-center w-7 h-7 rounded-full text-sm font-medium",
                                        !isCurrentMonth && "text-slate-300",
                                        isCurrentMonth && !isHolidayOrSunday && !isToday && "text-slate-700",
                                        isCurrentMonth && isHolidayOrSunday && !isToday && "text-red-500",
                                        isToday && "bg-green-500 text-white"
                                    )}>
                                        {day.getDate()}
                                    </span>
                                    {/* Total people count */}
                                    {daySchedules.length > 0 && isCurrentMonth && (
                                        <span className="flex items-center gap-0.5 text-[10px] text-slate-400">
                                            <Users className="w-3 h-3" />
                                            {daySchedules.length}
                                        </span>
                                    )}
                                </div>

                                {/* Holiday Name */}
                                {holidayName && isCurrentMonth && (
                                    <div className="text-[10px] text-red-500 font-medium truncate mb-1" title={holidayName}>
                                        {holidayName}
                                    </div>
                                )}

                                {/* My Schedules */}
                                {mySchedules.length > 0 && isCurrentMonth && (
                                    <div className="space-y-1 mb-1">
                                        {mySchedules.map(schedule => {
                                            const shift = getShiftDetails(schedule.shift_id);
                                            return (
                                                <div key={schedule.id} className="flex items-center gap-1 text-xs bg-blue-500 text-white rounded px-1.5 py-0.5">
                                                    <Clock className="w-3 h-3" />
                                                    <span className="truncate font-medium">
                                                        {shift ? `${shift.start_time?.slice(0, 5)}-${shift.end_time?.slice(0, 5)}` : 'Có lịch'}
                                                    </span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}

                                {/* Other employees' schedules - show names */}
                                {otherSchedules.length > 0 && isCurrentMonth && (
                                    <div className="space-y-0.5">
                                        {displayOtherNames.map((name, i) => (
                                            <div key={i} className="text-[10px] text-slate-600 truncate flex items-center gap-1">
                                                <span className="w-1.5 h-1.5 bg-slate-400 rounded-full flex-shrink-0"></span>
                                                {name}
                                            </div>
                                        ))}
                                        {moreCount > 0 && (
                                            <div className="text-[10px] text-blue-500 font-medium">
                                                +{moreCount} người khác
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Schedule List (for mobile and quick view) */}
            <div className="md:hidden bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-4 py-3 border-b border-slate-100">
                    <h3 className="font-semibold text-slate-900">Lịch làm việc của tôi tháng này</h3>
                </div>

                {myWorkDays === 0 ? (
                    <div className="p-8 text-center">
                        <CalendarIcon className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                        <p className="text-slate-500">Bạn chưa có lịch làm việc trong tháng này</p>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-50">
                        {schedules
                            .filter(s => s.employee_id === employee.id)
                            .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                            .map(schedule => {
                                const shift = getShiftDetails(schedule.shift_id);
                                const scheduleDate = new Date(schedule.date);
                                const dayOfWeek = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][scheduleDate.getDay()];
                                const isPast = scheduleDate < new Date(new Date().setHours(0, 0, 0, 0));
                                // Count coworkers on this day
                                const coworkers = schedules.filter(s => s.date === schedule.date && s.employee_id !== employee.id).length;

                                return (
                                    <div
                                        key={schedule.id}
                                        className={cn(
                                            "flex items-center gap-4 px-4 py-3 hover:bg-slate-50/50 transition-colors",
                                            isPast && "opacity-60"
                                        )}
                                    >
                                        <div className="flex flex-col items-center justify-center w-12 h-12 bg-blue-50 rounded-xl">
                                            <span className="text-xs text-blue-600 font-medium">{dayOfWeek}</span>
                                            <span className="text-lg font-bold text-blue-700">{scheduleDate.getDate()}</span>
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                <Clock className="w-4 h-4 text-slate-400" />
                                                <span className="text-sm font-medium text-slate-900">
                                                    {shift ? `${shift.name} (${shift.start_time?.slice(0, 5)} - ${shift.end_time?.slice(0, 5)})` : 'Lịch làm việc'}
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2 mt-0.5">
                                                {schedule.branch_id && (
                                                    <span className="text-xs text-slate-500">
                                                        📍 {getBranchName(schedule.branch_id)}
                                                    </span>
                                                )}
                                                {coworkers > 0 && (
                                                    <span className="text-xs text-slate-400">
                                                        • {coworkers} đồng nghiệp
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        {isPast && (
                                            <span className="text-xs text-slate-400">Đã qua</span>
                                        )}
                                    </div>
                                );
                            })}
                    </div>
                )}
            </div>

            {/* Full Branch Schedule List - Removed to reduce clutter */}
            {/* The calendar view with popups is sufficient for checking coworker schedules */}

            {/* Day Detail Popup Modal */}
            {selectedDayPopup && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                    <div
                        className="absolute inset-0 bg-black/40"
                        onClick={() => setSelectedDayPopup(null)}
                    />
                    <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] overflow-hidden animate-scale-in">
                        {/* Header */}
                        <div className="px-5 py-4 border-b border-slate-100 bg-gradient-to-r from-blue-50 to-slate-50">
                            <div className="flex items-center justify-between">
                                <div>
                                    <h3 className="text-lg font-bold text-slate-900">
                                        {selectedDayPopup.date.toLocaleDateString('vi-VN', {
                                            weekday: 'long',
                                            day: 'numeric',
                                            month: 'long',
                                            year: 'numeric'
                                        })}
                                    </h3>
                                    <p className="text-sm text-slate-500">
                                        {selectedDayPopup.schedules.length} nhân viên có lịch làm
                                    </p>
                                </div>
                                <button
                                    onClick={() => setSelectedDayPopup(null)}
                                    className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                                >
                                    <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                        </div>

                        {/* Employee List */}
                        <div className="overflow-y-auto max-h-[60vh] p-4 space-y-2">
                            {selectedDayPopup.schedules
                                .sort((a, b) => {
                                    // Sort: my schedule first, then by name
                                    if (a.employee_id === employee?.id) return -1;
                                    if (b.employee_id === employee?.id) return 1;
                                    return getEmployeeName(a.employee_id).localeCompare(getEmployeeName(b.employee_id));
                                })
                                .map(schedule => {
                                    const shift = getShiftDetails(schedule.shift_id);
                                    const isMe = schedule.employee_id === employee?.id;
                                    const emp = employees.find(e => e.id === schedule.employee_id);

                                    return (
                                        <div
                                            key={schedule.id}
                                            className={cn(
                                                "flex items-center gap-3 p-3 rounded-xl border transition-colors",
                                                isMe
                                                    ? "bg-blue-50 border-blue-200"
                                                    : "bg-slate-50 border-slate-100 hover:bg-slate-100"
                                            )}
                                        >
                                            {/* Avatar */}
                                            <div className={cn(
                                                "w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold",
                                                isMe
                                                    ? "bg-blue-500 text-white"
                                                    : "bg-slate-300 text-slate-600"
                                            )}>
                                                {getEmployeeName(schedule.employee_id).charAt(0).toUpperCase()}
                                            </div>

                                            {/* Info */}
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className={cn(
                                                        "font-medium truncate",
                                                        isMe ? "text-blue-700" : "text-slate-900"
                                                    )}>
                                                        {isMe ? '👤 ' : ''}{getEmployeeName(schedule.employee_id)}
                                                    </span>
                                                    {isMe && (
                                                        <span className="text-xs bg-blue-500 text-white px-1.5 py-0.5 rounded flex-shrink-0">
                                                            Tôi
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="text-xs text-slate-500 mt-0.5">
                                                    {emp?.position || 'Nhân viên'}
                                                </div>
                                            </div>

                                            {/* Shift Time */}
                                            <div className="text-right flex-shrink-0">
                                                <div className={cn(
                                                    "text-sm font-medium",
                                                    isMe ? "text-blue-600" : "text-slate-700"
                                                )}>
                                                    {shift
                                                        ? `${shift.start_time?.slice(0, 5)} - ${shift.end_time?.slice(0, 5)}`
                                                        : '—'}
                                                </div>
                                                {shift && (
                                                    <div className="text-xs text-slate-400">
                                                        {shift.name}
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                        </div>

                        {/* Footer */}
                        <div className="px-5 py-3 border-t border-slate-100 bg-slate-50">
                            <button
                                onClick={() => setSelectedDayPopup(null)}
                                className="w-full py-2 bg-slate-900 text-white rounded-lg font-medium hover:bg-slate-800 transition-colors"
                            >
                                Đóng
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
