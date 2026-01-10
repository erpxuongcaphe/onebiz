"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
    Calendar, Loader2, Clock, CheckCircle, Send, Building2, AlertCircle, AlertTriangle
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { getBranches, Branch } from "@/lib/api/timekeeping";
import {
    getRegistrationSettings,
    isRegistrationOpen,
    getTargetWeekStart,
    getAvailableShiftsForRegistration,
    getMyRegistrations,
    registerForShifts,
    ShiftRegistration
} from "@/lib/api/shift-registrations";
import { cn } from "@/lib/utils";
import { doShiftsOverlap, formatOverlapError, getOverlapRange } from "@/lib/utils/shift-overlap";

type ShiftOption = {
    id: string;
    name: string;
    start_time: string;
    end_time: string;
};

type DayShifts = {
    date: string;
    shifts: ShiftOption[];
};

export default function ShiftRegistrationPage() {
    const router = useRouter();
    const { user, isLoading: authLoading } = useAuth();

    const [branches, setBranches] = useState<Branch[]>([]);
    const [selectedBranchId, setSelectedBranchId] = useState<string>('');
    // Settings loaded but only used for initialization
    const [isWindowOpen, setIsWindowOpen] = useState(false);
    const [weekStart, setWeekStart] = useState<Date | null>(null);

    const [availableShifts, setAvailableShifts] = useState<DayShifts[]>([]);
    const [myRegistrations, setMyRegistrations] = useState<ShiftRegistration[]>([]);
    const [selectedShifts, setSelectedShifts] = useState<Set<string>>(new Set());

    const [isLoading, setIsLoading] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

    useEffect(() => {
        if (!authLoading && !user) {
            router.push('/login');
            return;
        }
        if (user) {
            loadInitialData();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, authLoading]);

    useEffect(() => {
        if (selectedBranchId && weekStart) {
            loadShifts();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedBranchId, weekStart]);

    const loadInitialData = async () => {
        setIsLoading(true);
        try {
            // Load branches
            const branchData = await getBranches();
            setBranches(branchData);
            if (branchData.length > 0) {
                setSelectedBranchId(branchData[0].id);
            }

            // Load settings
            const settingsData = await getRegistrationSettings();

            if (settingsData) {
                setIsWindowOpen(isRegistrationOpen(settingsData));
                setWeekStart(getTargetWeekStart(settingsData));
            }
        } catch (err) {
            console.error('Failed to load data:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const loadShifts = async () => {
        if (!user || !weekStart) return;

        try {
            const weekStartStr = weekStart.toISOString().split('T')[0];

            // Load available shifts
            const shifts = await getAvailableShiftsForRegistration(selectedBranchId, weekStart);
            setAvailableShifts(shifts);

            // Load my existing registrations
            const regs = await getMyRegistrations(user.id, weekStartStr);
            setMyRegistrations(regs);

            // Pre-select already registered shifts
            const selected = new Set<string>();
            regs.forEach(r => {
                selected.add(`${r.shift_date}_${r.shift_id}`);
            });
            setSelectedShifts(selected);
        } catch (err) {
            console.error('Failed to load shifts:', err);
        }
    };

    // Get shift details by ID from available shifts
    const getShiftById = (date: string, shiftId: string) => {
        const day = availableShifts.find(d => d.date === date);
        return day?.shifts.find(s => s.id === shiftId);
    };

    // Check if a shift would overlap with already selected shifts on the same day
    const checkOverlapWithSelected = (date: string, shiftId: string): { hasOverlap: boolean; conflictShift?: ShiftOption } => {
        const targetShift = getShiftById(date, shiftId);
        if (!targetShift) return { hasOverlap: false };

        // Get other selected shifts on the same date
        const selectedOnSameDay = Array.from(selectedShifts)
            .filter(key => key.startsWith(`${date}_`) && key !== `${date}_${shiftId}`)
            .map(key => {
                const [, sId] = key.split('_');
                return getShiftById(date, sId);
            })
            .filter(Boolean) as ShiftOption[];

        for (const otherShift of selectedOnSameDay) {
            if (doShiftsOverlap(targetShift, otherShift)) {
                return { hasOverlap: true, conflictShift: otherShift };
            }
        }
        return { hasOverlap: false };
    };

    // Get list of shift IDs that would overlap with selected shifts (for visual indication)
    const getBlockedShiftIds = useMemo(() => {
        const blocked: Record<string, string> = {}; // key: date_shiftId, value: conflicting shift name

        for (const day of availableShifts) {
            const selectedOnThisDay = Array.from(selectedShifts)
                .filter(key => key.startsWith(`${day.date}_`))
                .map(key => {
                    const [, sId] = key.split('_');
                    return day.shifts.find(s => s.id === sId);
                })
                .filter(Boolean) as ShiftOption[];

            for (const shift of day.shifts) {
                const key = `${day.date}_${shift.id}`;
                if (selectedShifts.has(key)) continue; // Skip already selected

                for (const selectedShift of selectedOnThisDay) {
                    if (doShiftsOverlap(shift, selectedShift)) {
                        blocked[key] = selectedShift.name;
                        break;
                    }
                }
            }
        }
        return blocked;
    }, [availableShifts, selectedShifts]);

    const toggleShift = (date: string, shiftId: string) => {
        const key = `${date}_${shiftId}`;
        const newSelected = new Set(selectedShifts);

        if (newSelected.has(key)) {
            // Deselecting - always allowed
            newSelected.delete(key);
        } else {
            // Selecting - check for overlap
            const { hasOverlap, conflictShift } = checkOverlapWithSelected(date, shiftId);
            if (hasOverlap && conflictShift) {
                const targetShift = getShiftById(date, shiftId);
                const overlapRange = targetShift ? getOverlapRange(targetShift, conflictShift) : null;
                toast.warning(
                    formatOverlapError(
                        targetShift?.name || 'Ca này',
                        conflictShift.name,
                        overlapRange || undefined
                    ),
                    { duration: 4000 }
                );
                return; // Don't add to selection
            }
            newSelected.add(key);
        }
        setSelectedShifts(newSelected);
    };

    const handleSubmit = async () => {
        if (!user || !weekStart || selectedShifts.size === 0) return;

        setIsSubmitting(true);
        setMessage(null);

        try {
            const registrations = Array.from(selectedShifts).map(key => {
                const [date, shiftId] = key.split('_');
                return { branchId: selectedBranchId, shiftDate: date, shiftId };
            });

            await registerForShifts(user.id, registrations, weekStart.toISOString().split('T')[0]);

            setMessage({ type: 'success', text: 'Đã gửi đăng ký thành công!' });
            await loadShifts(); // Reload
        } catch (err) {
            console.error('Failed to submit:', err);
            setMessage({ type: 'error', text: 'Lỗi khi gửi đăng ký' });
        } finally {
            setIsSubmitting(false);
        }
    };

    const formatDate = (dateStr: string) => {
        const date = new Date(dateStr);
        return date.toLocaleDateString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit' });
    };

    const formatTime = (time: string) => {
        return time.slice(0, 5); // HH:MM
    };

    const getDayName = (dateStr: string) => {
        const date = new Date(dateStr);
        const days = ['Chủ nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
        return days[date.getDay()];
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
            <div>
                <h1 className="text-xl md:text-2xl font-bold tracking-tight text-slate-900">Đăng ký ca làm việc</h1>
                <p className="text-slate-500 text-sm mt-0.5">Chọn các ca bạn có thể đi làm trong tuần tới</p>
            </div>

            {/* Status Banner */}
            <div className={cn(
                "rounded-2xl p-4 flex items-center gap-3",
                isWindowOpen ? "bg-green-50 border border-green-200" : "bg-amber-50 border border-amber-200"
            )}>
                {isWindowOpen ? (
                    <CheckCircle className="w-5 h-5 text-green-600" />
                ) : (
                    <AlertCircle className="w-5 h-5 text-amber-600" />
                )}
                <div>
                    <p className={cn("font-medium", isWindowOpen ? "text-green-800" : "text-amber-800")}>
                        {isWindowOpen ? "Đang mở đăng ký" : "Chưa đến thời gian đăng ký"}
                    </p>
                    <p className="text-sm text-slate-600">
                        Thời gian: 21h Thứ 5 → 21h Thứ 6 hàng tuần
                    </p>
                </div>
            </div>

            {/* Branch Selector */}
            <div className="bg-white rounded-2xl border border-slate-200 p-4">
                <label className="block text-sm font-medium text-slate-700 mb-2">
                    <Building2 className="w-4 h-4 inline mr-1" />
                    Chi nhánh
                </label>
                <select
                    value={selectedBranchId}
                    onChange={e => setSelectedBranchId(e.target.value)}
                    className="w-full md:w-64 px-4 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                >
                    {branches.map(b => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                </select>
            </div>

            {/* Week Info */}
            {weekStart && (
                <div className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <Calendar className="w-5 h-5 text-blue-500" />
                        <div>
                            <p className="text-sm text-slate-500">Đăng ký cho tuần</p>
                            <p className="font-semibold text-slate-900">
                                {weekStart.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })} - {
                                    new Date(weekStart.getTime() + 6 * 24 * 60 * 60 * 1000).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
                                }
                            </p>
                        </div>
                    </div>
                    <span className="text-sm text-slate-500">
                        Đã chọn: <span className="font-semibold text-blue-600">{selectedShifts.size}</span> ca
                    </span>
                </div>
            )}

            {/* Message */}
            {message && (
                <div className={cn(
                    "rounded-xl p-4",
                    message.type === 'success' ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"
                )}>
                    {message.text}
                </div>
            )}

            {/* Shift Grid */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100">
                    <h3 className="font-semibold text-slate-900">Chọn ca làm việc</h3>
                </div>

                {availableShifts.length === 0 ? (
                    <div className="p-8 text-center text-slate-500">
                        <Clock className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                        Chưa có ca làm việc
                    </div>
                ) : (
                    <div className="divide-y divide-slate-100">
                        {availableShifts.map(day => (
                            <div key={day.date} className="p-4">
                                <div className="flex items-center gap-2 mb-3">
                                    <span className="text-sm font-semibold text-slate-900">{getDayName(day.date)}</span>
                                    <span className="text-sm text-slate-500">{formatDate(day.date)}</span>
                                </div>
                                <div className="flex flex-wrap gap-2">
                                    {day.shifts.map(shift => {
                                        const key = `${day.date}_${shift.id}`;
                                        const isSelected = selectedShifts.has(key);
                                        const existingReg = myRegistrations.find(
                                            r => r.shift_date === day.date && r.shift_id === shift.id
                                        );
                                        const isApproved = existingReg?.status === 'approved';
                                        const isRejected = existingReg?.status === 'rejected';
                                        const blockedByShift = getBlockedShiftIds[key];
                                        const isBlocked = !!blockedByShift;

                                        return (
                                            <button
                                                key={shift.id}
                                                onClick={() => !isApproved && !isBlocked && toggleShift(day.date, shift.id)}
                                                disabled={isApproved || isBlocked}
                                                title={isBlocked ? `Trùng giờ với ${blockedByShift}` : undefined}
                                                className={cn(
                                                    "px-4 py-2 rounded-xl text-sm font-medium transition-all relative",
                                                    isApproved && "bg-green-100 text-green-700 cursor-not-allowed",
                                                    isRejected && "bg-red-100 text-red-700",
                                                    isBlocked && !isApproved && "bg-orange-50 text-orange-400 cursor-not-allowed border border-orange-200",
                                                    isSelected && !isApproved && "bg-blue-100 text-blue-700 ring-2 ring-blue-500",
                                                    !isSelected && !isApproved && !isRejected && !isBlocked && "bg-slate-100 text-slate-700 hover:bg-slate-200"
                                                )}
                                            >
                                                {isBlocked && <AlertTriangle className="w-3 h-3 inline mr-1" />}
                                                {shift.name}
                                                <span className="text-xs ml-1 opacity-75">
                                                    ({formatTime(shift.start_time)}-{formatTime(shift.end_time)})
                                                </span>
                                                {isApproved && <CheckCircle className="w-4 h-4 inline ml-1" />}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Submit Button */}
            <div className="flex justify-end">
                <button
                    onClick={handleSubmit}
                    disabled={isSubmitting || selectedShifts.size === 0}
                    className={cn(
                        "inline-flex items-center gap-2 px-6 py-3 rounded-xl font-medium transition-all",
                        selectedShifts.size > 0
                            ? "bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-500/20"
                            : "bg-slate-100 text-slate-400 cursor-not-allowed"
                    )}
                >
                    {isSubmitting ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                        <Send className="w-5 h-5" />
                    )}
                    Gửi đăng ký ({selectedShifts.size} ca)
                </button>
            </div>
        </div>
    );
}
