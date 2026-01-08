"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
    Clock, CheckCircle, XCircle, Loader2, User as UserIcon, Calendar,
    AlertTriangle, Building2, RotateCcw, Plus, UserPlus, Pencil, X, Timer
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
    getPendingRecords, getRejectedRecords, approveRecord, rejectRecord,
    reApproveRecord, manualCheckIn, updateAttendanceHours, AttendanceRecord, getBranches, Branch,
    getPendingOTRecords, approveOvertime, rejectOvertime
} from "@/lib/api/timekeeping";
import { getEmployees } from "@/lib/api/employees";
import { getUsers, User } from "@/lib/api/users";
import { Database } from "@/lib/database.types";
type Employee = Database['public']['Tables']['employees']['Row'];
import { cn } from "@/lib/utils";
import { logActivity } from "@/lib/api/activity-logs";
import { FilterBar } from "@/components/ui/FilterBar";

type TabType = 'pending' | 'rejected' | 'manual' | 'ot';

export default function ApprovalPage() {
    const router = useRouter();
    const { user, isLoading: authLoading, hasPermission } = useAuth();
    const [activeTab, setActiveTab] = useState<TabType>('pending');
    const [pendingRecords, setPendingRecords] = useState<AttendanceRecord[]>([]);
    const [rejectedRecords, setRejectedRecords] = useState<AttendanceRecord[]>([]);
    const [otRecords, setOtRecords] = useState<AttendanceRecord[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [branches, setBranches] = useState<Branch[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [processingId, setProcessingId] = useState<string | null>(null);

    // Manual check-in form state
    const [manualForm, setManualForm] = useState({
        employeeId: '',
        branchId: '',
        date: new Date().toISOString().split('T')[0],
        checkIn: '08:00',
        checkOut: '17:30',
        notes: ''
    });
    const [isSubmitting, setIsSubmitting] = useState(false);

    // Edit hours modal state
    const [editRecord, setEditRecord] = useState<AttendanceRecord | null>(null);
    const [editForm, setEditForm] = useState({ hoursWorked: '', overtimeHours: '', notes: '' });
    const [isEditSaving, setIsEditSaving] = useState(false);

    // Filter state
    const [filterBranch, setFilterBranch] = useState('');

    useEffect(() => {
        if (!authLoading && !user) {
            router.push('/login');
            return;
        }
        if (!authLoading && user && !hasPermission(['admin', 'branch_manager', 'accountant'])) {
            router.push('/dashboard');
            return;
        }

        fetchData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, authLoading]);

    const fetchData = async () => {
        setIsLoading(true);
        try {
            const [pendingData, rejectedData, otData, employeesData, branchesData, usersData] = await Promise.all([
                getPendingRecords(),
                getRejectedRecords(),
                getPendingOTRecords(),
                getEmployees(),
                getBranches(),
                getUsers()
            ]);
            setPendingRecords(pendingData);
            setRejectedRecords(rejectedData);
            setOtRecords(otData);
            setEmployees(employeesData);
            setBranches(branchesData);
            setUsers(usersData);
        } catch (err) {
            console.error('Failed to fetch data:', err);
        } finally {
            setIsLoading(false);
        }
    };

    const handleApprove = async (recordId: string) => {
        if (!user) return;
        setProcessingId(recordId);
        try {
            const record = pendingRecords.find(r => r.id === recordId);
            await approveRecord(recordId, user.id);
            // Log activity
            logActivity({
                userId: user.employeeId || user.id,
                userName: user.fullName,
                userRole: user.role,
                action: 'update',
                entityType: 'attendance',
                entityId: recordId,
                entityName: record ? getEmployeeName(record.employee_id) : undefined,
                details: { action: 'approve', date: record?.date }
            });
            await fetchData();
        } catch (err) {
            console.error('Approval failed:', err);
            alert('Lỗi khi duyệt. Vui lòng thử lại.');
        } finally {
            setProcessingId(null);
        }
    };

    const handleReject = async (recordId: string) => {
        if (!user) return;
        const reason = prompt('Lý do từ chối (có thể bỏ trống):');
        setProcessingId(recordId);
        try {
            const record = pendingRecords.find(r => r.id === recordId);
            await rejectRecord(recordId, user.id, reason || undefined);
            // Log activity
            logActivity({
                userId: user.employeeId || user.id,
                userName: user.fullName,
                userRole: user.role,
                action: 'update',
                entityType: 'attendance',
                entityId: recordId,
                entityName: record ? getEmployeeName(record.employee_id) : undefined,
                details: { action: 'reject', reason, date: record?.date }
            });
            await fetchData();
        } catch (err) {
            console.error('Rejection failed:', err);
            alert('Lỗi khi từ chối. Vui lòng thử lại.');
        } finally {
            setProcessingId(null);
        }
    };

    const handleReApprove = async (recordId: string) => {
        if (!user) return;
        const reason = prompt('Lý do duyệt lại (có thể bỏ trống):');
        setProcessingId(recordId);
        try {
            const record = rejectedRecords.find(r => r.id === recordId);
            await reApproveRecord(recordId, user.id, reason || undefined);
            // Log activity
            logActivity({
                userId: user.employeeId || user.id,
                userName: user.fullName,
                userRole: user.role,
                action: 'update',
                entityType: 'attendance',
                entityId: recordId,
                entityName: record ? getEmployeeName(record.employee_id) : undefined,
                details: { action: 'reapprove', reason, date: record?.date }
            });
            await fetchData();
            alert('Đã duyệt lại thành công!');
        } catch (err) {
            console.error('Re-approval failed:', err);
            alert('Lỗi khi duyệt lại. Vui lòng thử lại.');
        } finally {
            setProcessingId(null);
        }
    };

    // Handle edit hours
    const handleEditHours = async () => {
        if (!user || !editRecord) return;
        setIsEditSaving(true);
        try {
            const hoursWorked = parseFloat(editForm.hoursWorked) || 0;
            const overtimeHours = parseFloat(editForm.overtimeHours) || 0;
            await updateAttendanceHours(
                editRecord.id,
                hoursWorked,
                overtimeHours,
                user.id,
                editForm.notes || undefined
            );
            logActivity({
                userId: user.employeeId || user.id,
                userName: user.fullName,
                userRole: user.role,
                action: 'update',
                entityType: 'attendance',
                entityId: editRecord.id,
                entityName: getEmployeeName(editRecord.employee_id),
                details: { action: 'edit_hours', hoursWorked, overtimeHours, date: editRecord.date }
            });
            setEditRecord(null);
            await fetchData();
        } catch (err) {
            console.error('Edit hours failed:', err);
            alert('Lỗi khi sửa giờ. Vui lòng thử lại.');
        } finally {
            setIsEditSaving(false);
        }
    };

    const openEditModal = (record: AttendanceRecord) => {
        setEditRecord(record);
        setEditForm({
            hoursWorked: record.hours_worked?.toString() || '0',
            overtimeHours: record.overtime_hours?.toString() || '0',
            notes: ''
        });
    };

    const handleManualCheckIn = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user) return;

        if (!manualForm.employeeId || !manualForm.branchId || !manualForm.notes) {
            alert('Vui lòng điền đầy đủ thông tin: Nhân viên, Chi nhánh, và Lý do.');
            return;
        }

        setIsSubmitting(true);
        try {
            const result = await manualCheckIn({
                employeeId: manualForm.employeeId,
                branchId: manualForm.branchId,
                date: manualForm.date,
                checkIn: manualForm.checkIn,
                checkOut: manualForm.checkOut || undefined,
                notes: manualForm.notes,
                createdBy: user.id
            });
            // Log activity
            const emp = employees.find(e => e.id === manualForm.employeeId);
            logActivity({
                userId: user.employeeId || user.id,
                userName: user.fullName,
                userRole: user.role,
                action: 'create',
                entityType: 'attendance',
                entityId: result.id,
                entityName: emp?.name,
                details: { action: 'manual_checkin', date: manualForm.date, notes: manualForm.notes }
            });
            alert('Chấm công thủ công thành công!');
            setManualForm({
                employeeId: '',
                branchId: '',
                date: new Date().toISOString().split('T')[0],
                checkIn: '08:00',
                checkOut: '17:30',
                notes: ''
            });
            await fetchData();
        } catch (err) {
            console.error('Manual check-in failed:', err);
            alert('Lỗi khi chấm công thủ công. Vui lòng thử lại.');
        } finally {
            setIsSubmitting(false);
        }
    };

    const getEmployeeName = (recordEmployeeId: string) => {
        // First, check if it's a User ID (from QR check-in)
        const user = users.find(u => u.id === recordEmployeeId);
        if (user) {
            // If user is linked to an employee, get the employee name
            if (user.employeeId) {
                const emp = employees.find(e => e.id === user.employeeId);
                if (emp) return emp.name;
            }
            // Otherwise, return user's fullName
            return user.fullName;
        }

        // Check if it's directly an Employee ID
        const emp = employees.find(e => e.id === recordEmployeeId);
        if (emp) return emp.name;

        // Fallback to showing the ID
        return recordEmployeeId;
    };

    const getBranchName = (branchId?: string) => {
        if (!branchId) return 'N/A';
        return branches.find(b => b.id === branchId)?.name || 'N/A';
    };

    const formatTime = (dateString?: string) => {
        if (!dateString) return '--:--';
        return new Date(dateString).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
    };

    const formatDate = (dateString: string) => {
        return new Date(dateString).toLocaleDateString('vi-VN', {
            weekday: 'short',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric'
        });
    };

    if (authLoading || isLoading) {
        return (
            <div className="flex items-center justify-center h-96">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            </div>
        );
    }

    const tabs = [
        { id: 'pending' as TabType, label: 'Chờ duyệt', count: pendingRecords.length, icon: AlertTriangle, color: 'amber' },
        { id: 'rejected' as TabType, label: 'Đã từ chối', count: rejectedRecords.length, icon: XCircle, color: 'red' },
        { id: 'ot' as TabType, label: 'Duyệt OT', count: otRecords.length, icon: Timer, color: 'purple' },
        { id: 'manual' as TabType, label: 'Chấm công thủ công', icon: UserPlus, color: 'blue' },
    ];

    // Filtered records based on branch filter
    const filteredPending = filterBranch
        ? pendingRecords.filter(r => r.branch_id === filterBranch)
        : pendingRecords;

    const filteredRejected = filterBranch
        ? rejectedRecords.filter(r => r.branch_id === filterBranch)
        : rejectedRecords;

    const filteredOT = filterBranch
        ? otRecords.filter(r => r.branch_id === filterBranch)
        : otRecords;

    // OT Approval handlers
    const handleApproveOT = async (recordId: string) => {
        if (!user) return;
        setProcessingId(recordId);
        try {
            const record = otRecords.find(r => r.id === recordId);
            await approveOvertime(recordId, user.id);
            logActivity({
                userId: user.employeeId || user.id,
                userName: user.fullName,
                userRole: user.role,
                action: 'update',
                entityType: 'overtime',
                entityId: recordId,
                entityName: record ? getEmployeeName(record.employee_id) : '',
                details: { ot_hours: record?.ot_requested_hours, date: record?.date }
            });
            await fetchData();
        } catch (err) {
            console.error('OT approval failed:', err);
            alert('Lỗi khi duyệt OT. Vui lòng thử lại.');
        } finally {
            setProcessingId(null);
        }
    };

    const handleRejectOT = async (recordId: string) => {
        if (!user) return;
        const reason = prompt('Lý do từ chối OT (không bắt buộc):');
        setProcessingId(recordId);
        try {
            const record = otRecords.find(r => r.id === recordId);
            await rejectOvertime(recordId, user.id, reason || undefined);
            logActivity({
                userId: user.employeeId || user.id,
                userName: user.fullName,
                userRole: user.role,
                action: 'update',
                entityType: 'overtime',
                entityId: recordId,
                entityName: record ? getEmployeeName(record.employee_id) : '',
                details: { reason, date: record?.date }
            });
            await fetchData();
        } catch (err) {
            console.error('OT rejection failed:', err);
            alert('Lỗi khi từ chối OT. Vui lòng thử lại.');
        } finally {
            setProcessingId(null);
        }
    };

    const RecordItem = ({ record, showReApprove = false }: { record: AttendanceRecord; showReApprove?: boolean }) => (
        <div className="px-4 md:px-6 py-4 hover:bg-slate-50 transition-colors">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                <div className="flex items-center gap-3 md:gap-4">
                    <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
                        <UserIcon className="w-5 h-5 md:w-6 md:h-6 text-amber-600" />
                    </div>
                    <div className="min-w-0">
                        <p className="font-medium text-slate-900 truncate">
                            {getEmployeeName(record.employee_id)}
                        </p>
                        <div className="flex flex-wrap items-center gap-2 md:gap-3 text-xs md:text-sm text-slate-500 mt-1">
                            <span className="flex items-center gap-1">
                                <Calendar className="w-3 h-3 md:w-3.5 md:h-3.5" />
                                {formatDate(record.date)}
                            </span>
                            <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3 md:w-3.5 md:h-3.5" />
                                {formatTime(record.check_in)} → {formatTime(record.check_out)}
                            </span>
                            <span className="flex items-center gap-1">
                                <Building2 className="w-3 h-3 md:w-3.5 md:h-3.5" />
                                {getBranchName(record.branch_id)}
                            </span>
                        </div>
                        {record.notes && (
                            <p className="text-xs text-slate-400 mt-1 italic truncate">{record.notes}</p>
                        )}
                    </div>
                </div>

                <div className="flex items-center gap-2 md:gap-3 ml-13 md:ml-0">
                    {/* Info badges */}
                    <div className="flex flex-col items-end gap-1 text-xs md:text-sm">
                        {record.hours_worked && (
                            <span className="text-slate-600">
                                {record.hours_worked.toFixed(2)}h
                            </span>
                        )}
                        {record.overtime_hours && record.overtime_hours > 0 && (
                            <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs font-medium">
                                🕐 OT {record.overtime_hours.toFixed(2)}h
                            </span>
                        )}
                    </div>

                    {/* Action buttons */}
                    <div className="flex items-center gap-2">
                        {/* Edit button for branch_manager */}
                        {(user?.role === 'branch_manager' || user?.role === 'admin') && (
                            <button
                                onClick={() => openEditModal(record)}
                                className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl bg-blue-100 text-blue-700 hover:bg-blue-200 transition-all"
                            >
                                <Pencil className="w-4 h-4" />
                                <span className="hidden md:inline">Sửa</span>
                            </button>
                        )}
                        {showReApprove ? (
                            <button
                                onClick={() => handleReApprove(record.id)}
                                disabled={processingId === record.id}
                                className={cn(
                                    "inline-flex items-center gap-1.5 px-3 md:px-4 py-2 text-sm font-medium rounded-xl transition-all",
                                    processingId === record.id
                                        ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                                        : "bg-green-500 text-white hover:bg-green-600 shadow-sm hover:shadow"
                                )}
                            >
                                {processingId === record.id ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                    <RotateCcw className="w-4 h-4" />
                                )}
                                <span className="hidden md:inline">Duyệt lại</span>
                            </button>
                        ) : (
                            <>
                                <button
                                    onClick={() => handleApprove(record.id)}
                                    disabled={processingId === record.id}
                                    className={cn(
                                        "inline-flex items-center gap-1.5 px-3 md:px-4 py-2 text-sm font-medium rounded-xl transition-all",
                                        processingId === record.id
                                            ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                                            : "bg-green-500 text-white hover:bg-green-600 shadow-sm hover:shadow"
                                    )}
                                >
                                    {processingId === record.id ? (
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                    ) : (
                                        <CheckCircle className="w-4 h-4" />
                                    )}
                                    <span className="hidden md:inline">Duyệt</span>
                                </button>
                                <button
                                    onClick={() => handleReject(record.id)}
                                    disabled={processingId === record.id}
                                    className={cn(
                                        "inline-flex items-center gap-1.5 px-3 md:px-4 py-2 text-sm font-medium rounded-xl transition-all",
                                        processingId === record.id
                                            ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                                            : "bg-red-500 text-white hover:bg-red-600 shadow-sm hover:shadow"
                                    )}
                                >
                                    <XCircle className="w-4 h-4" />
                                    <span className="hidden md:inline">Từ chối</span>
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );

    return (
        <>
            <div className="space-y-4 md:space-y-6 animate-fade-in">
                {/* Header */}
                <div>
                    <h1 className="text-xl md:text-2xl font-bold tracking-tight text-slate-900">Duyệt chấm công</h1>
                    <p className="text-slate-500 text-sm mt-0.5 hidden sm:block">Duyệt, từ chối và chấm công thủ công cho nhân viên</p>
                </div>

                {/* Tabs */}
                <div className="flex gap-2 overflow-x-auto pb-1">
                    {tabs.map(tab => {
                        const Icon = tab.icon;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={cn(
                                    "flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-sm transition-all shrink-0",
                                    activeTab === tab.id
                                        ? tab.color === 'amber' ? "bg-amber-100 text-amber-700"
                                            : tab.color === 'red' ? "bg-red-100 text-red-700"
                                                : "bg-blue-100 text-blue-700"
                                        : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                                )}
                            >
                                <Icon className="w-4 h-4" />
                                {tab.label}
                                {tab.count !== undefined && (
                                    <span className={cn(
                                        "px-2 py-0.5 rounded-full text-xs font-bold",
                                        activeTab === tab.id
                                            ? "bg-white/50"
                                            : "bg-slate-200"
                                    )}>
                                        {tab.count}
                                    </span>
                                )}
                            </button>
                        );
                    })}
                </div>

                {/* Tab Content */}
                <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
                    {/* Pending Tab */}
                    {activeTab === 'pending' && (
                        <>
                            <div className="px-4 md:px-6 py-4 border-b border-slate-100 flex flex-col md:flex-row md:items-center justify-between gap-3">
                                <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                                    <AlertTriangle className="w-5 h-5 text-amber-500" />
                                    Chờ duyệt ({filteredPending.length})
                                </h3>
                                <FilterBar
                                    filters={[
                                        {
                                            key: 'branch',
                                            label: 'Chi nhánh',
                                            placeholder: 'Tất cả chi nhánh',
                                            options: branches.map(b => ({ value: b.id, label: b.name }))
                                        }
                                    ]}
                                    values={{ branch: filterBranch }}
                                    onChange={(key, val) => setFilterBranch(val)}
                                    onReset={() => setFilterBranch('')}
                                />
                            </div>
                            {filteredPending.length === 0 ? (
                                <div className="text-center py-12">
                                    <CheckCircle className="w-12 h-12 text-green-300 mx-auto mb-4" />
                                    <p className="text-slate-500">Không có bản ghi nào cần duyệt</p>
                                </div>
                            ) : (
                                <div className="divide-y divide-slate-100">
                                    {filteredPending.map((record) => (
                                        <RecordItem key={record.id} record={record} />
                                    ))}
                                </div>
                            )}
                        </>
                    )}

                    {/* Rejected Tab */}
                    {activeTab === 'rejected' && (
                        <>
                            <div className="px-4 md:px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                                <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                                    <XCircle className="w-5 h-5 text-red-500" />
                                    Đã từ chối ({filteredRejected.length})
                                </h3>
                            </div>
                            {filteredRejected.length === 0 ? (
                                <div className="text-center py-12">
                                    <CheckCircle className="w-12 h-12 text-green-300 mx-auto mb-4" />
                                    <p className="text-slate-500">Không có bản ghi nào bị từ chối</p>
                                </div>
                            ) : (
                                <div className="divide-y divide-slate-100">
                                    {filteredRejected.map((record) => (
                                        <RecordItem key={record.id} record={record} showReApprove />
                                    ))}
                                </div>
                            )}
                        </>
                    )}

                    {/* OT Approval Tab */}
                    {activeTab === 'ot' && (
                        <>
                            <div className="px-4 md:px-6 py-4 border-b border-slate-100 flex items-center justify-between">
                                <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                                    <Timer className="w-5 h-5 text-purple-500" />
                                    Duyệt OT ({filteredOT.length})
                                </h3>
                            </div>
                            {filteredOT.length === 0 ? (
                                <div className="text-center py-12">
                                    <CheckCircle className="w-12 h-12 text-green-300 mx-auto mb-4" />
                                    <p className="text-slate-500">Không có yêu cầu OT nào cần duyệt</p>
                                </div>
                            ) : (
                                <div className="divide-y divide-slate-100">
                                    {filteredOT.map((record) => (
                                        <div key={record.id} className="px-4 md:px-6 py-4 hover:bg-slate-50 transition-colors">
                                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
                                                <div className="flex items-center gap-3 md:gap-4">
                                                    <div className="w-10 h-10 md:w-12 md:h-12 rounded-xl bg-purple-50 flex items-center justify-center shrink-0">
                                                        <Timer className="w-5 h-5 md:w-6 md:h-6 text-purple-600" />
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="font-medium text-slate-900 truncate">
                                                            {getEmployeeName(record.employee_id)}
                                                        </p>
                                                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500 mt-0.5">
                                                            <span className="flex items-center gap-1">
                                                                <Calendar className="w-3.5 h-3.5" />
                                                                {formatDate(record.date)}
                                                            </span>
                                                            <span className="flex items-center gap-1">
                                                                <Building2 className="w-3.5 h-3.5" />
                                                                {getBranchName(record.branch_id)}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>

                                                {/* OT Info */}
                                                <div className="flex items-center gap-4">
                                                    <div className="text-right">
                                                        <p className="text-sm text-slate-500">Giờ theo ca</p>
                                                        <p className="font-semibold text-slate-900">
                                                            {record.scheduled_hours?.toFixed(1) || record.hours_worked?.toFixed(1) || '-'}h
                                                        </p>
                                                    </div>
                                                    <div className="text-right">
                                                        <p className="text-sm text-slate-500">OT yêu cầu</p>
                                                        <p className="font-bold text-purple-600 text-lg">
                                                            +{record.ot_requested_hours?.toFixed(1) || '0'}h
                                                        </p>
                                                    </div>
                                                </div>

                                                {/* Actions */}
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <button
                                                        onClick={() => handleApproveOT(record.id)}
                                                        disabled={processingId === record.id}
                                                        className={cn(
                                                            "inline-flex items-center gap-1.5 px-3 md:px-4 py-2 text-sm font-medium rounded-xl transition-all",
                                                            processingId === record.id
                                                                ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                                                                : "bg-green-500 text-white hover:bg-green-600 shadow-sm hover:shadow"
                                                        )}
                                                    >
                                                        {processingId === record.id ? (
                                                            <Loader2 className="w-4 h-4 animate-spin" />
                                                        ) : (
                                                            <CheckCircle className="w-4 h-4" />
                                                        )}
                                                        <span className="hidden md:inline">Duyệt OT</span>
                                                    </button>
                                                    <button
                                                        onClick={() => handleRejectOT(record.id)}
                                                        disabled={processingId === record.id}
                                                        className={cn(
                                                            "inline-flex items-center gap-1.5 px-3 md:px-4 py-2 text-sm font-medium rounded-xl transition-all",
                                                            processingId === record.id
                                                                ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                                                                : "bg-red-500 text-white hover:bg-red-600 shadow-sm hover:shadow"
                                                        )}
                                                    >
                                                        <XCircle className="w-4 h-4" />
                                                        <span className="hidden md:inline">Từ chối</span>
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}

                    {/* Manual Check-in Tab */}
                    {activeTab === 'manual' && (
                        <>
                            <div className="px-4 md:px-6 py-4 border-b border-slate-100">
                                <h3 className="font-semibold text-slate-900 flex items-center gap-2">
                                    <UserPlus className="w-5 h-5 text-blue-500" />
                                    Chấm công thủ công
                                </h3>
                                <p className="text-sm text-slate-500 mt-1">
                                    Dùng khi nhân viên hư điện thoại hoặc không thể tự chấm công
                                </p>
                            </div>
                            <form onSubmit={handleManualCheckIn} className="p-4 md:p-6 space-y-4">
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    {/* Employee */}
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1.5">
                                            Nhân viên <span className="text-red-500">*</span>
                                        </label>
                                        <select
                                            value={manualForm.employeeId}
                                            onChange={e => setManualForm(prev => ({ ...prev, employeeId: e.target.value }))}
                                            className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                            required
                                        >
                                            <option value="">-- Chọn nhân viên --</option>
                                            {employees.map(emp => (
                                                <option key={emp.id} value={emp.id}>{emp.name} ({emp.department})</option>
                                            ))}
                                        </select>
                                    </div>

                                    {/* Branch */}
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1.5">
                                            Chi nhánh <span className="text-red-500">*</span>
                                        </label>
                                        <select
                                            value={manualForm.branchId}
                                            onChange={e => setManualForm(prev => ({ ...prev, branchId: e.target.value }))}
                                            className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                            required
                                        >
                                            <option value="">-- Chọn chi nhánh --</option>
                                            {branches.map(branch => (
                                                <option key={branch.id} value={branch.id}>{branch.name}</option>
                                            ))}
                                        </select>
                                    </div>

                                    {/* Date */}
                                    <div>
                                        <label className="block text-sm font-medium text-slate-700 mb-1.5">
                                            Ngày
                                        </label>
                                        <input
                                            type="date"
                                            value={manualForm.date}
                                            onChange={e => setManualForm(prev => ({ ...prev, date: e.target.value }))}
                                            className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                        />
                                    </div>

                                    {/* Time inputs */}
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1.5">
                                                Giờ vào
                                            </label>
                                            <input
                                                type="time"
                                                value={manualForm.checkIn}
                                                onChange={e => setManualForm(prev => ({ ...prev, checkIn: e.target.value }))}
                                                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-slate-700 mb-1.5">
                                                Giờ ra
                                            </label>
                                            <input
                                                type="time"
                                                value={manualForm.checkOut}
                                                onChange={e => setManualForm(prev => ({ ...prev, checkOut: e.target.value }))}
                                                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Notes */}
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                                        Lý do chấm công thủ công <span className="text-red-500">*</span>
                                    </label>
                                    <textarea
                                        value={manualForm.notes}
                                        onChange={e => setManualForm(prev => ({ ...prev, notes: e.target.value }))}
                                        placeholder="Ví dụ: Nhân viên hư điện thoại, quên quét mã QR..."
                                        rows={3}
                                        className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 resize-none"
                                        required
                                    />
                                </div>

                                {/* Submit */}
                                <button
                                    type="submit"
                                    disabled={isSubmitting}
                                    className={cn(
                                        "w-full md:w-auto inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-medium rounded-xl transition-all",
                                        isSubmitting
                                            ? "bg-slate-100 text-slate-400 cursor-not-allowed"
                                            : "bg-blue-500 text-white hover:bg-blue-600 shadow-lg shadow-blue-500/20 hover:shadow-xl"
                                    )}
                                >
                                    {isSubmitting ? (
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                    ) : (
                                        <Plus className="w-5 h-5" />
                                    )}
                                    Tạo bản ghi chấm công
                                </button>
                            </form>
                        </>
                    )}
                </div>
            </div>

            {/* Edit Hours Modal */}
            {
                editRecord && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
                        <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl">
                            <div className="flex justify-between items-center mb-4">
                                <h3 className="text-lg font-semibold text-slate-900">Sửa giờ làm</h3>
                                <button
                                    onClick={() => setEditRecord(null)}
                                    className="p-1 hover:bg-slate-100 rounded-lg"
                                >
                                    <X className="w-5 h-5 text-slate-500" />
                                </button>
                            </div>

                            <div className="mb-4 p-3 bg-slate-50 rounded-xl text-sm">
                                <p className="font-medium text-slate-900">{getEmployeeName(editRecord.employee_id)}</p>
                                <p className="text-slate-500">{formatDate(editRecord.date)}</p>
                            </div>

                            <div className="space-y-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">
                                        Giờ làm việc
                                    </label>
                                    <input
                                        type="number"
                                        step="0.5"
                                        value={editForm.hoursWorked}
                                        onChange={(e) => setEditForm({ ...editForm, hoursWorked: e.target.value })}
                                        className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">
                                        Giờ tăng ca (OT)
                                    </label>
                                    <input
                                        type="number"
                                        step="0.5"
                                        value={editForm.overtimeHours}
                                        onChange={(e) => setEditForm({ ...editForm, overtimeHours: e.target.value })}
                                        className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">
                                        Ghi chú (lý do sửa)
                                    </label>
                                    <textarea
                                        value={editForm.notes}
                                        onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                                        className="w-full px-4 py-2.5 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                        rows={2}
                                        placeholder="Nhập lý do sửa giờ..."
                                    />
                                </div>
                            </div>

                            <div className="flex gap-3 mt-6">
                                <button
                                    onClick={() => setEditRecord(null)}
                                    className="flex-1 px-4 py-2.5 border border-slate-200 rounded-xl text-slate-700 hover:bg-slate-50 transition-all"
                                >
                                    Hủy
                                </button>
                                <button
                                    onClick={handleEditHours}
                                    disabled={isEditSaving}
                                    className={cn(
                                        "flex-1 px-4 py-2.5 rounded-xl font-medium transition-all",
                                        isEditSaving
                                            ? "bg-slate-100 text-slate-400"
                                            : "bg-blue-500 text-white hover:bg-blue-600"
                                    )}
                                >
                                    {isEditSaving ? <Loader2 className="w-5 h-5 animate-spin mx-auto" /> : 'Lưu thay đổi'}
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }
        </>
    );
}
