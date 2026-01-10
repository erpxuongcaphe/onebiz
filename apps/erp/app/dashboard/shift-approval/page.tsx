"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
    Calendar, Loader2, Clock, Save, Building2,
    Users, AlertCircle, Check, Lock, Unlock, AlertTriangle
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { getBranches, Branch } from "@/lib/api/timekeeping";
import {
    getRegistrationSettings,
    getTargetWeekStart,
    getRegistrationsForApproval,
    updateRegistrationStatus,
    createSchedulesFromApproved,
    closeRegistration,
    reopenRegistration,
    isRegistrationOpen,
    ShiftRegistration,
    RegistrationSettings
} from "@/lib/api/shift-registrations";
import { cn } from "@/lib/utils";
import { doShiftsOverlap } from "@/lib/utils/shift-overlap";

export default function ShiftApprovalPage() {
    const router = useRouter();
    const { user, isLoading: authLoading, hasPermission } = useAuth();

    const [branches, setBranches] = useState<Branch[]>([]);
    const [selectedBranchId, setSelectedBranchId] = useState<string>('');
    const [weekStart, setWeekStart] = useState<Date | null>(null);

    const [registrations, setRegistrations] = useState<ShiftRegistration[]>([]);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [settings, setSettings] = useState<RegistrationSettings | null>(null);

    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isClosing, setIsClosing] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    const isManager = hasPermission(['admin', 'branch_manager']);

    useEffect(() => {
        if (!authLoading && !user) {
            router.push('/login');
            return;
        }
        if (user && isManager) {
            loadInitialData();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, authLoading]);

    useEffect(() => {
        if (selectedBranchId && weekStart) {
            loadRegistrations();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedBranchId, weekStart]);

    const loadInitialData = async () => {
        setIsLoading(true);
        try {
            const branchData = await getBranches();
            setBranches(branchData);
            if (branchData.length > 0) {
                setSelectedBranchId(branchData[0].id);
            }

            const settingsData = await getRegistrationSettings();
            setSettings(settingsData);
            if (settingsData) {
                setWeekStart(getTargetWeekStart(settingsData));
            }
        } catch (err) {
            console.error('Failed to load data:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const loadRegistrations = async () => {
        if (!weekStart) return;

        try {
            const weekStartStr = weekStart.toISOString().split('T')[0];
            const regs = await getRegistrationsForApproval(selectedBranchId, weekStartStr);
            setRegistrations(regs);

            // Pre-select already approved
            const approved = new Set<string>();
            regs.filter(r => r.status === 'approved').forEach(r => approved.add(r.id));
            setSelectedIds(approved);
        } catch (err) {
            console.error('Failed to load registrations:', err);
        }
    };

    // Check if selecting a registration would cause overlap for the same employee
    const checkEmployeeOverlap = (regId: string): { hasOverlap: boolean; conflictShiftName?: string } => {
        const reg = registrations.find(r => r.id === regId);
        if (!reg || !reg.shift_start || !reg.shift_end) return { hasOverlap: false };

        // Find other selected registrations for the same employee on the same date
        const otherSelectedRegs = registrations.filter(r =>
            r.id !== regId &&
            r.employee_id === reg.employee_id &&
            r.shift_date === reg.shift_date &&
            selectedIds.has(r.id) &&
            r.shift_start && r.shift_end
        );

        for (const otherReg of otherSelectedRegs) {
            const targetShift = { start_time: reg.shift_start!, end_time: reg.shift_end! };
            const otherShift = { start_time: otherReg.shift_start!, end_time: otherReg.shift_end! };

            if (doShiftsOverlap(targetShift, otherShift)) {
                return { hasOverlap: true, conflictShiftName: otherReg.shift_name || 'Ca khác' };
            }
        }
        return { hasOverlap: false };
    };

    // Get map of registrations that would cause overlap if selected
    const conflictingRegsMap = useMemo(() => {
        const conflicts: Record<string, { employeeName: string; conflictShift: string }> = {};

        for (const reg of registrations) {
            if (selectedIds.has(reg.id)) continue; // Skip already selected
            if (!reg.shift_start || !reg.shift_end) continue;

            // Check against other selected regs for same employee on same date
            const selectedSameEmployeeSameDate = registrations.filter(r =>
                r.employee_id === reg.employee_id &&
                r.shift_date === reg.shift_date &&
                selectedIds.has(r.id) &&
                r.shift_start && r.shift_end
            );

            for (const otherReg of selectedSameEmployeeSameDate) {
                const targetShift = { start_time: reg.shift_start!, end_time: reg.shift_end! };
                const otherShift = { start_time: otherReg.shift_start!, end_time: otherReg.shift_end! };

                if (doShiftsOverlap(targetShift, otherShift)) {
                    conflicts[reg.id] = {
                        employeeName: reg.employee_name || reg.employee_id,
                        conflictShift: otherReg.shift_name || 'Ca khác'
                    };
                    break;
                }
            }
        }
        return conflicts;
    }, [registrations, selectedIds]);

    const toggleSelect = (id: string) => {
        const newSelected = new Set(selectedIds);
        if (newSelected.has(id)) {
            // Deselecting - always allowed
            newSelected.delete(id);
        } else {
            // Selecting - check for employee overlap
            const { hasOverlap, conflictShiftName } = checkEmployeeOverlap(id);
            if (hasOverlap) {
                const reg = registrations.find(r => r.id === id);
                toast.warning(
                    `${reg?.employee_name || 'Nhân viên'} đã được chọn cho ${conflictShiftName} (trùng giờ)`,
                    { duration: 4000 }
                );
                return; // Don't add to selection
            }
            newSelected.add(id);
        }
        setSelectedIds(newSelected);
    };

    const selectAllForShift = (shiftDate: string, shiftId: string | null, select: boolean) => {
        const newSelected = new Set(selectedIds);
        const matching = registrations.filter(r => r.shift_date === shiftDate && r.shift_id === shiftId);

        if (select) {
            // When selecting all, check for conflicts
            const employeesWithConflict: string[] = [];

            for (const reg of matching) {
                // Temporarily add to check
                newSelected.add(reg.id);

                // Check if this employee already has a selected shift on this date
                const otherSelected = registrations.filter(r =>
                    r.id !== reg.id &&
                    r.employee_id === reg.employee_id &&
                    r.shift_date === reg.shift_date &&
                    newSelected.has(r.id) &&
                    r.shift_start && r.shift_end
                );

                const hasConflict = otherSelected.some(other => {
                    if (!reg.shift_start || !reg.shift_end) return false;
                    return doShiftsOverlap(
                        { start_time: reg.shift_start, end_time: reg.shift_end },
                        { start_time: other.shift_start!, end_time: other.shift_end! }
                    );
                });

                if (hasConflict) {
                    newSelected.delete(reg.id);
                    employeesWithConflict.push(reg.employee_name || reg.employee_id);
                }
            }

            if (employeesWithConflict.length > 0) {
                toast.warning(
                    `Bỏ qua ${employeesWithConflict.length} NV do trùng giờ: ${employeesWithConflict.slice(0, 3).join(', ')}${employeesWithConflict.length > 3 ? '...' : ''}`,
                    { duration: 5000 }
                );
            }
        } else {
            // Deselecting - always allowed
            matching.forEach(r => newSelected.delete(r.id));
        }

        setSelectedIds(newSelected);
    };

    const handleSave = async () => {
        if (!user || !weekStart) return;

        setIsSaving(true);
        setMessage(null);

        try {
            const toApprove = Array.from(selectedIds);
            const toReject = registrations
                .filter(r => r.status === 'pending' && !selectedIds.has(r.id))
                .map(r => r.id);

            if (toApprove.length > 0) {
                await updateRegistrationStatus(toApprove, 'approved', user.id);
            }
            if (toReject.length > 0) {
                await updateRegistrationStatus(toReject, 'rejected', user.id);
            }

            // Create schedules from approved
            const weekStartStr = weekStart.toISOString().split('T')[0];
            const count = await createSchedulesFromApproved(selectedBranchId, weekStartStr);

            setMessage({
                type: 'success',
                text: `Đã lưu và tạo ${count} lịch làm việc!`
            });
            await loadRegistrations();
        } catch (err) {
            console.error('Failed to save:', err);
            setMessage({ type: 'error', text: 'Lỗi khi lưu' });
        } finally {
            setIsSaving(false);
        }
    };

    const handleToggleClose = async () => {
        if (!user || !settings) return;

        setIsClosing(true);
        try {
            if (settings.is_closed) {
                await reopenRegistration(settings.id);
                setMessage({ type: 'success', text: 'Đã mở lại đăng ký!' });
            } else {
                await closeRegistration(settings.id, user.id);
                setMessage({ type: 'success', text: 'Đã đóng đăng ký!' });
            }
            // Reload settings
            const newSettings = await getRegistrationSettings();
            setSettings(newSettings);
        } catch (err) {
            console.error('Failed to toggle close:', err);
            setMessage({ type: 'error', text: 'Lỗi' });
        } finally {
            setIsClosing(false);
        }
    };

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' });
    };

    const formatTime = (time?: string) => {
        if (!time) return '';
        return time.slice(0, 5);
    };

    const formatRegistrationTime = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleString('vi-VN', {
            day: '2-digit', month: '2-digit',
            hour: '2-digit', minute: '2-digit'
        });
    };

    // Group registrations by date and shift
    const groupedRegistrations = registrations.reduce((acc, reg) => {
        const key = `${reg.shift_date}_${reg.shift_id}`;
        if (!acc[key]) {
            acc[key] = {
                date: reg.shift_date,
                shiftId: reg.shift_id,
                shiftName: reg.shift_name || 'Ca làm việc',
                shiftTime: reg.shift_start && reg.shift_end
                    ? `${formatTime(reg.shift_start)} - ${formatTime(reg.shift_end)}`
                    : '',
                registrations: []
            };
        }
        acc[key].registrations.push(reg);
        return acc;
    }, {} as Record<string, { date: string; shiftId: string | null; shiftName: string; shiftTime: string; registrations: ShiftRegistration[] }>);

    if (!isManager) {
        return (
            <div className="flex flex-col items-center justify-center h-96 text-center">
                <AlertCircle className="w-16 h-16 text-red-400 mb-4" />
                <h2 className="text-xl font-bold text-slate-900 mb-2">Truy cập bị từ chối</h2>
                <p className="text-slate-500">Chỉ Quản lý mới có quyền duyệt đăng ký ca.</p>
            </div>
        );
    }

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
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h1 className="text-xl md:text-2xl font-bold tracking-tight text-slate-900">Duyệt đăng ký ca</h1>
                    <p className="text-slate-500 text-sm mt-0.5">Chọn nhân viên cho từng ca làm việc</p>
                </div>
                <div className="flex items-center gap-2">
                    {/* Close/Reopen Button */}
                    <button
                        onClick={handleToggleClose}
                        disabled={isClosing}
                        className={cn(
                            "inline-flex items-center gap-2 px-4 py-3 rounded-xl font-medium transition-all",
                            settings?.is_closed
                                ? "bg-green-100 text-green-700 hover:bg-green-200"
                                : "bg-amber-100 text-amber-700 hover:bg-amber-200"
                        )}
                    >
                        {isClosing ? (
                            <Loader2 className="w-5 h-5 animate-spin" />
                        ) : settings?.is_closed ? (
                            <Unlock className="w-5 h-5" />
                        ) : (
                            <Lock className="w-5 h-5" />
                        )}
                        {settings?.is_closed ? "Mở lại đăng ký" : "Đóng đăng ký"}
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 shadow-lg shadow-blue-500/20 transition-all disabled:opacity-50"
                    >
                        {isSaving ? <Loader2 className="w-5 h-5 animate-spin" /> : <Save className="w-5 h-5" />}
                        Lưu & Tạo lịch
                    </button>
                </div>
            </div>

            {/* Registration Status Banner */}
            {settings && (
                <div className={cn(
                    "rounded-2xl p-4 flex items-center justify-between",
                    settings.is_closed
                        ? "bg-red-50 border border-red-200"
                        : isRegistrationOpen(settings)
                            ? "bg-green-50 border border-green-200"
                            : "bg-amber-50 border border-amber-200"
                )}>
                    <div className="flex items-center gap-3">
                        {settings.is_closed ? (
                            <Lock className="w-5 h-5 text-red-600" />
                        ) : (
                            <Unlock className="w-5 h-5 text-green-600" />
                        )}
                        <div>
                            <p className={cn(
                                "font-medium",
                                settings.is_closed ? "text-red-800" : "text-green-800"
                            )}>
                                {settings.is_closed
                                    ? "Đăng ký đã bị đóng thủ công"
                                    : isRegistrationOpen(settings)
                                        ? "Đang mở đăng ký - Nhân viên có thể sửa đăng ký"
                                        : "Chưa đến thời gian đăng ký"}
                            </p>
                            {settings.is_closed && settings.closed_at && (
                                <p className="text-sm text-red-600">
                                    Đóng lúc: {new Date(settings.closed_at).toLocaleString('vi-VN')}
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Filters */}
            <div className="flex flex-wrap gap-4">
                <div className="bg-white rounded-xl border border-slate-200 px-4 py-2 flex items-center gap-2">
                    <Building2 className="w-4 h-4 text-slate-400" />
                    <select
                        value={selectedBranchId}
                        onChange={e => setSelectedBranchId(e.target.value)}
                        className="border-0 focus:ring-0 text-sm font-medium text-slate-700 bg-transparent"
                    >
                        {branches.map(b => (
                            <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                    </select>
                </div>

                {weekStart && (
                    <div className="bg-white rounded-xl border border-slate-200 px-4 py-2 flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-slate-400" />
                        <span className="text-sm font-medium text-slate-700">
                            Tuần: {weekStart.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}
                        </span>
                    </div>
                )}
            </div>

            {/* Message */}
            {message && (
                <div className={cn(
                    "rounded-xl p-4",
                    message.type === 'success' ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"
                )}>
                    {message.text}
                </div>
            )}

            {/* Registrations by Shift */}
            {Object.keys(groupedRegistrations).length === 0 ? (
                <div className="bg-white rounded-2xl border border-slate-200 p-12 text-center">
                    <Users className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                    <p className="text-slate-500">Chưa có đăng ký nào</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {Object.values(groupedRegistrations)
                        .sort((a, b) => a.date.localeCompare(b.date))
                        .map(group => (
                            <div key={`${group.date}_${group.shiftId}`} className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                                {/* Shift Header */}
                                <div className="px-6 py-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                                    <div className="flex items-center gap-3">
                                        <div className="w-10 h-10 rounded-xl bg-blue-100 flex items-center justify-center">
                                            <Clock className="w-5 h-5 text-blue-600" />
                                        </div>
                                        <div>
                                            <p className="font-semibold text-slate-900">{formatDate(group.date)}</p>
                                            <p className="text-sm text-slate-500">{group.shiftName} {group.shiftTime}</p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm text-slate-500">{group.registrations.length} đăng ký</span>
                                        <button
                                            onClick={() => selectAllForShift(group.date, group.shiftId, true)}
                                            className="text-xs text-blue-600 hover:underline"
                                        >
                                            Chọn tất cả
                                        </button>
                                    </div>
                                </div>

                                {/* Registration List */}
                                <div className="divide-y divide-slate-100">
                                    {group.registrations.map((reg, idx) => {
                                        const conflictInfo = conflictingRegsMap[reg.id];
                                        const hasConflict = !!conflictInfo;

                                        return (
                                            <div
                                                key={reg.id}
                                                className={cn(
                                                    "px-6 py-3 flex items-center justify-between cursor-pointer transition-colors",
                                                    selectedIds.has(reg.id) && "bg-green-50 hover:bg-green-100",
                                                    hasConflict && !selectedIds.has(reg.id) && "bg-orange-50 hover:bg-orange-100",
                                                    !selectedIds.has(reg.id) && !hasConflict && "hover:bg-slate-50"
                                                )}
                                                onClick={() => toggleSelect(reg.id)}
                                            >
                                                <div className="flex items-center gap-3">
                                                    <span className={cn(
                                                        "w-6 h-6 rounded-full text-xs flex items-center justify-center font-medium",
                                                        hasConflict ? "bg-orange-200 text-orange-700" : "bg-slate-200 text-slate-600"
                                                    )}>
                                                        {hasConflict ? <AlertTriangle className="w-3 h-3" /> : idx + 1}
                                                    </span>
                                                    <div>
                                                        <p className="font-medium text-slate-900">{reg.employee_name || reg.employee_id}</p>
                                                        <p className="text-xs text-slate-500">
                                                            Đăng ký: {formatRegistrationTime(reg.registered_at)}
                                                            {hasConflict && (
                                                                <span className="ml-2 text-orange-600">
                                                                    ⚠ Trùng giờ với {conflictInfo.conflictShift}
                                                                </span>
                                                            )}
                                                        </p>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    {reg.status === 'approved' && (
                                                        <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">Đã duyệt</span>
                                                    )}
                                                    {reg.status === 'rejected' && (
                                                        <span className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full">Từ chối</span>
                                                    )}
                                                    <div className={cn(
                                                        "w-6 h-6 rounded-lg border-2 flex items-center justify-center transition-all",
                                                        selectedIds.has(reg.id)
                                                            ? "bg-green-500 border-green-500"
                                                            : hasConflict
                                                                ? "border-orange-300"
                                                                : "border-slate-300"
                                                    )}>
                                                        {selectedIds.has(reg.id) && <Check className="w-4 h-4 text-white" />}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                </div>
            )}
        </div>
    );
}
