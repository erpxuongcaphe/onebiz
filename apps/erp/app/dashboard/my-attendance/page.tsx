"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Clock, Calendar, CheckCircle, Loader2, ChevronLeft, ChevronRight } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { getAttendanceRecords, AttendanceRecord } from "@/lib/api/timekeeping";
import { cn } from "@/lib/utils";

export default function MyAttendancePage() {
    const router = useRouter();
    const { user, isLoading: authLoading } = useAuth();
    const [records, setRecords] = useState<AttendanceRecord[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedMonth, setSelectedMonth] = useState(new Date());

    useEffect(() => {
        if (!authLoading && !user) {
            router.push('/login');
            return;
        }

        if (user) {
            fetchRecords();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, authLoading, selectedMonth]);

    const fetchRecords = async () => {
        if (!user) return;
        setIsLoading(true);
        try {
            const allRecords = await getAttendanceRecords({ employeeId: user.id });
            // Filter by selected month
            const filtered = allRecords.filter(record => {
                const recordDate = new Date(record.date);
                return recordDate.getMonth() === selectedMonth.getMonth() &&
                    recordDate.getFullYear() === selectedMonth.getFullYear();
            });
            setRecords(filtered);
        } catch (err) {
            console.error('Failed to fetch records:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const changeMonth = (delta: number) => {
        const newDate = new Date(selectedMonth);
        newDate.setMonth(newDate.getMonth() + delta);
        setSelectedMonth(newDate);
    };

    const formatTime = (dateString?: string) => {
        if (!dateString) return '--:--';
        return new Date(dateString).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('vi-VN', {
            weekday: 'short',
            day: '2-digit',
            month: '2-digit'
        });
    };

    // Calculate summary
    const totalDays = records.length;
    const totalHours = records.reduce((sum, r) => sum + (r.hours_worked || 0), 0);
    const completedDays = records.filter(r => r.check_out).length;

    if (authLoading) {
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
                <h1 className="text-2xl font-bold tracking-tight text-slate-900">Chấm công của tôi</h1>
                <p className="text-slate-500 mt-1">Lịch sử check-in/check-out của bạn</p>
            </div>

            {/* Month Selector & Summary */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                {/* Month Selector */}
                <div className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center justify-between">
                    <button
                        onClick={() => changeMonth(-1)}
                        className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                        <ChevronLeft className="w-5 h-5" />
                    </button>
                    <div className="text-center">
                        <p className="text-sm text-slate-500">Tháng</p>
                        <p className="font-semibold text-slate-900">
                            {selectedMonth.toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' })}
                        </p>
                    </div>
                    <button
                        onClick={() => changeMonth(1)}
                        className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                        <ChevronRight className="w-5 h-5" />
                    </button>
                </div>

                {/* Summary Cards */}
                <SummaryCard
                    icon={<Calendar className="w-5 h-5 text-blue-500" />}
                    label="Ngày làm việc"
                    value={totalDays}
                    bgColor="bg-blue-50"
                />
                <SummaryCard
                    icon={<Clock className="w-5 h-5 text-green-500" />}
                    label="Tổng giờ làm"
                    value={`${totalHours.toFixed(1)}h`}
                    bgColor="bg-green-50"
                />
                <SummaryCard
                    icon={<CheckCircle className="w-5 h-5 text-purple-500" />}
                    label="Đã hoàn thành"
                    value={completedDays}
                    bgColor="bg-purple-50"
                />
            </div>

            {/* Records List */}
            <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-100">
                    <h3 className="font-semibold text-slate-900">Chi tiết chấm công</h3>
                </div>

                {isLoading ? (
                    <div className="flex items-center justify-center py-12">
                        <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />
                    </div>
                ) : records.length === 0 ? (
                    <div className="text-center py-12">
                        <Clock className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                        <p className="text-slate-500">Không có dữ liệu chấm công trong tháng này</p>
                    </div>
                ) : (
                    <div className="divide-y divide-slate-100">
                        {records.map((record) => (
                            <div key={record.id} className="px-6 py-4 flex items-center justify-between hover:bg-slate-50">
                                <div className="flex items-center gap-4">
                                    <div className={cn(
                                        "w-10 h-10 rounded-xl flex items-center justify-center",
                                        record.check_out ? "bg-green-50" : "bg-amber-50"
                                    )}>
                                        {record.check_out ? (
                                            <CheckCircle className="w-5 h-5 text-green-500" />
                                        ) : (
                                            <Clock className="w-5 h-5 text-amber-500" />
                                        )}
                                    </div>
                                    <div>
                                        <p className="font-medium text-slate-900">{formatDate(record.date)}</p>
                                        <p className="text-sm text-slate-500">
                                            {formatTime(record.check_in)} → {formatTime(record.check_out)}
                                        </p>
                                    </div>
                                </div>
                                <div className="text-right">
                                    <p className="font-medium text-slate-900">
                                        {record.hours_worked ? `${record.hours_worked.toFixed(2)} giờ` : '--'}
                                    </p>
                                    <p className={cn(
                                        "text-xs font-medium",
                                        record.status === 'ontime' ? "text-green-600" :
                                            record.status === 'late' ? "text-red-600" :
                                                record.status === 'pending' ? "text-amber-600" : "text-slate-500"
                                    )}>
                                        {record.status === 'ontime' ? 'Đúng giờ' :
                                            record.status === 'late' ? 'Đi trễ' :
                                                record.status === 'pending' ? 'Đang làm' :
                                                    record.status === 'early_leave' ? 'Về sớm' : record.status}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

function SummaryCard({
    icon,
    label,
    value,
    bgColor
}: {
    icon: React.ReactNode;
    label: string;
    value: React.ReactNode;
    bgColor: string;
}) {
    return (
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
            <div className="flex items-center gap-3">
                <div className={cn("p-2 rounded-xl", bgColor)}>
                    {icon}
                </div>
                <div>
                    <p className="text-xs text-slate-500">{label}</p>
                    <p className="text-xl font-bold text-slate-900">{value}</p>
                </div>
            </div>
        </div>
    );
}
