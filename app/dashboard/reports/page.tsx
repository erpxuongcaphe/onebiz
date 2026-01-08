/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useState, useEffect, useRef } from "react";
import {
    TrendingUp,
    TrendingDown,
    Users,
    Clock,
    Calendar,
    Wallet,
    Download,
    FileSpreadsheet,
    Loader2,
    Printer,
    ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    LineChart,
    Line,
    PieChart,
    Pie,
    Cell,
} from "recharts";
import { getEmployees, Employee } from "@/lib/api/employees";
import { getAttendanceRecords, AttendanceRecord } from "@/lib/api/timekeeping";
import { getLeaveRequests, LeaveRequest } from "@/lib/api/leave-management";
import {
    exportPayrollExcel,
    exportAttendanceExcel,
    exportDepartmentSummaryExcel,
    downloadBlob
} from "@/lib/api/payslip-export";
import { toast } from "sonner";

// Color palette for pie chart
const COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#EF4444", "#8B5CF6", "#6B7280", "#EC4899", "#14B8A6"];

export default function ReportsPage() {
    const [loading, setLoading] = useState(true);
    const [selectedPeriod, setSelectedPeriod] = useState("6months");
    const [exportDropdownOpen, setExportDropdownOpen] = useState(false);
    const reportRef = useRef<HTMLDivElement>(null);

    // Real data states
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
    const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);

    // Computed chart data
    const [departmentData, setDepartmentData] = useState<{ name: string; value: number; color: string }[]>([]);
    const [attendanceChartData, setAttendanceChartData] = useState<{ month: string; onTime: number; late: number; absent: number }[]>([]);

    // Get current month for exports
    const currentMonth = new Date().toISOString().slice(0, 7);

    useEffect(() => {
        loadData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedPeriod]);

    async function loadData() {
        setLoading(true);
        try {
            // Calculate date range based on period
            const endDate = new Date();
            const startDate = new Date();
            const monthsBack = selectedPeriod === "1month" ? 1 : selectedPeriod === "3months" ? 3 : selectedPeriod === "6months" ? 6 : 12;
            startDate.setMonth(startDate.getMonth() - monthsBack);

            const [empData, attData, leaveData] = await Promise.all([
                getEmployees(),
                getAttendanceRecords({
                    startDate: startDate.toISOString().split('T')[0],
                    endDate: endDate.toISOString().split('T')[0]
                }),
                getLeaveRequests({
                    startDate: startDate.toISOString().split('T')[0],
                    endDate: endDate.toISOString().split('T')[0]
                })
            ]);

            setEmployees(empData);
            setAttendance(attData);
            setLeaveRequests(leaveData);

            // Process department data
            const deptCounts: Record<string, number> = {};
            empData.filter(e => e.status === 'active').forEach(emp => {
                const dept = emp.department || 'Khác';
                deptCounts[dept] = (deptCounts[dept] || 0) + 1;
            });
            const deptData = Object.entries(deptCounts)
                .map(([name, value], i) => ({ name, value, color: COLORS[i % COLORS.length] }))
                .sort((a, b) => b.value - a.value);
            setDepartmentData(deptData);

            // Process attendance by month
            const monthlyAtt: Record<string, { onTime: number; late: number; total: number }> = {};
            attData.forEach(a => {
                const month = a.date.substring(0, 7); // YYYY-MM
                if (!monthlyAtt[month]) monthlyAtt[month] = { onTime: 0, late: 0, total: 0 };
                monthlyAtt[month].total++;
                if (a.status === 'ontime' || a.status === 'approved') monthlyAtt[month].onTime++;
                if (a.status === 'late') monthlyAtt[month].late++;
            });
            const attChart = Object.entries(monthlyAtt)
                .sort(([a], [b]) => a.localeCompare(b))
                .slice(-6)
                .map(([month, data]) => ({
                    month: `T${parseInt(month.split('-')[1])}`,
                    onTime: data.total > 0 ? Math.round((data.onTime / data.total) * 100) : 0,
                    late: data.total > 0 ? Math.round((data.late / data.total) * 100) : 0,
                    absent: data.total > 0 ? Math.round(((data.total - data.onTime - data.late) / data.total) * 100) : 0,
                }));
            setAttendanceChartData(attChart);

        } catch (error) {
            console.error("Failed to load report data:", error);
        } finally {
            setLoading(false);
        }
    }

    // Calculate summary stats from real data
    const activeEmployees = employees.filter(e => e.status === 'active');
    const totalEmployees = activeEmployees.length;

    const totalAttendanceRecords = attendance.length;
    const onTimeRecords = attendance.filter(a => a.status === 'ontime' || a.status === 'approved').length;
    const attendanceRate = totalAttendanceRecords > 0 ? Math.round((onTimeRecords / totalAttendanceRecords) * 100) : 0;

    const approvedLeaves = leaveRequests.filter(l => l.status === 'approved');
    const avgLeaveDays = approvedLeaves.length > 0
        ? (approvedLeaves.reduce((sum, l) => sum + (l.total_days || 0), 0) / new Set(approvedLeaves.map(l => l.employee_id)).size).toFixed(1)
        : "0";

    // Estimate total salary (based on employee count * average salary)
    const estimatedTotalSalary = activeEmployees.reduce((sum, e) => sum + (e.salary || 0), 0);
    const formatSalary = (value: number) => {
        if (value >= 1000000000) return `${(value / 1000000000).toFixed(1)} Tỷ`;
        if (value >= 1000000) return `${(value / 1000000).toFixed(0)} Tr`;
        return `${value.toLocaleString()}`;
    };

    const summaryStats = [
        {
            title: "Tổng nhân viên",
            value: totalEmployees.toString(),
            change: "",
            changeType: "positive" as const,
            icon: Users,
            color: "from-blue-500 to-cyan-500",
        },
        {
            title: "Tỷ lệ đúng giờ",
            value: `${attendanceRate}%`,
            change: "",
            changeType: "positive" as const,
            icon: Clock,
            color: "from-green-500 to-emerald-500",
        },
        {
            title: "Nghỉ phép TB",
            value: `${avgLeaveDays} ngày`,
            change: "",
            changeType: "positive" as const,
            icon: Calendar,
            color: "from-amber-500 to-orange-500",
        },
        {
            title: "Tổng lương",
            value: formatSalary(estimatedTotalSalary),
            change: "",
            changeType: "positive" as const,
            icon: Wallet,
            color: "from-purple-500 to-pink-500",
        },
    ];

    // Export handlers
    const handleExportAttendance = async () => {
        try {
            setExportDropdownOpen(false);
            toast.info('Đang tạo báo cáo chấm công...');
            // Calculate start and end of month
            const [year, month] = currentMonth.split('-').map(Number);
            const startDate = `${currentMonth}-01`;
            const lastDay = new Date(year, month, 0).getDate();
            const endDate = `${currentMonth}-${lastDay.toString().padStart(2, '0')}`;

            const blob = await exportAttendanceExcel(startDate, endDate);
            downloadBlob(blob, `bao-cao-cham-cong-${currentMonth}.xlsx`);
            toast.success('Đã tải báo cáo chấm công');
        } catch (err) {
            console.error('Export failed:', err);
            toast.error('Lỗi khi xuất báo cáo');
        }
    };

    const handleExportPayroll = async () => {
        try {
            setExportDropdownOpen(false);
            toast.info('Đang tạo báo cáo lương...');
            const blob = await exportPayrollExcel(currentMonth);
            downloadBlob(blob, `bao-cao-luong-${currentMonth}.xlsx`);
            toast.success('Đã tải báo cáo lương');
        } catch (err) {
            console.error('Export failed:', err);
            toast.error('Lỗi khi xuất báo cáo');
        }
    };

    const handleExportDepartment = async () => {
        try {
            setExportDropdownOpen(false);
            toast.info('Đang tạo báo cáo phòng ban...');
            const blob = await exportDepartmentSummaryExcel(currentMonth);
            downloadBlob(blob, `tong-hop-phong-ban-${currentMonth}.xlsx`);
            toast.success('Đã tải báo cáo tổng hợp phòng ban');
        } catch (err) {
            console.error('Export failed:', err);
            toast.error('Lỗi khi xuất báo cáo');
        }
    };

    // Export to Excel (CSV format) - legacy
    const handleExportExcel = () => {
        const headers = ['Nhân viên', 'Mã NV', 'Phòng ban', 'Chức vụ', 'Trạng thái', 'Lương cơ bản'];
        const rows = activeEmployees.map(emp => [
            emp.name || '',
            (emp as any).employee_id || '',
            emp.department || '',
            emp.position || '',
            emp.status || '',
            emp.salary?.toString() || '0'
        ]);

        const csvContent = [headers, ...rows]
            .map(row => row.map(cell => `"${cell}"`).join(','))
            .join('\n');

        const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `bao-cao-nhan-su-${new Date().toISOString().split('T')[0]}.csv`;
        link.click();
        URL.revokeObjectURL(url);
    };

    // Export to PDF (using print)
    const handleExportPDF = () => {
        window.print();
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-[60vh]">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
            </div>
        );
    }

    return (
        <div className="space-y-4 md:space-y-6 print:space-y-2" ref={reportRef}>
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 print:hidden">
                <div>
                    <h1 className="text-xl sm:text-2xl font-bold text-slate-900">
                        Báo cáo & Thống kê
                    </h1>
                    <p className="text-sm text-slate-500 mt-1">
                        Tổng hợp dữ liệu nhân sự, chấm công và lương
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <select
                        value={selectedPeriod}
                        onChange={(e) => setSelectedPeriod(e.target.value)}
                        className="px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white"
                    >
                        <option value="1month">1 tháng</option>
                        <option value="3months">3 tháng</option>
                        <option value="6months">6 tháng</option>
                        <option value="1year">1 năm</option>
                    </select>

                    {/* Export Dropdown */}
                    <div className="relative">
                        <button
                            onClick={() => setExportDropdownOpen(!exportDropdownOpen)}
                            className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                        >
                            <FileSpreadsheet className="w-4 h-4" />
                            <span className="hidden sm:inline">Xuất Excel</span>
                            <ChevronDown className="w-3 h-3" />
                        </button>
                        {exportDropdownOpen && (
                            <>
                                <div className="fixed inset-0 z-40" onClick={() => setExportDropdownOpen(false)} />
                                <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-lg border border-slate-200 z-50 py-2 animate-scale-in">
                                    <button
                                        onClick={handleExportAttendance}
                                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                                    >
                                        <Clock className="w-4 h-4 text-blue-600" />
                                        Chấm công tháng này
                                    </button>
                                    <button
                                        onClick={handleExportPayroll}
                                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                                    >
                                        <Wallet className="w-4 h-4 text-green-600" />
                                        Lương tháng này
                                    </button>
                                    <button
                                        onClick={handleExportDepartment}
                                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                                    >
                                        <Users className="w-4 h-4 text-purple-600" />
                                        Tổng hợp phòng ban
                                    </button>
                                    <hr className="my-2 border-slate-100" />
                                    <button
                                        onClick={handleExportExcel}
                                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                                    >
                                        <FileSpreadsheet className="w-4 h-4 text-slate-500" />
                                        Danh sách NV (CSV)
                                    </button>
                                </div>
                            </>
                        )}
                    </div>

                    <button
                        onClick={handleExportPDF}
                        className="inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                    >
                        <Printer className="w-4 h-4" />
                        <span className="hidden sm:inline">PDF</span>
                    </button>
                </div>
            </div>

            {/* Print Header */}
            <div className="hidden print:block text-center mb-4">
                <h1 className="text-2xl font-bold">BÁO CÁO NHÂN SỰ</h1>
                <p className="text-sm text-gray-500">Ngày xuất: {new Date().toLocaleDateString('vi-VN')}</p>
            </div>

            {/* Summary Stats */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
                {summaryStats.map((stat) => {
                    const Icon = stat.icon;
                    return (
                        <div
                            key={stat.title}
                            className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm print:border print:shadow-none"
                        >
                            <div className="flex items-center justify-between mb-3">
                                <div
                                    className={cn(
                                        "w-10 h-10 rounded-xl flex items-center justify-center text-white bg-gradient-to-br print:bg-blue-500",
                                        stat.color
                                    )}
                                >
                                    <Icon className="w-5 h-5" />
                                </div>
                                {stat.change && (
                                    <span
                                        className={cn(
                                            "inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full",
                                            stat.changeType === "positive"
                                                ? "bg-green-100 text-green-700"
                                                : "bg-red-100 text-red-700"
                                        )}
                                    >
                                        {stat.changeType === "positive" ? (
                                            <TrendingUp className="w-3 h-3" />
                                        ) : (
                                            <TrendingDown className="w-3 h-3" />
                                        )}
                                        {stat.change}
                                    </span>
                                )}
                            </div>
                            <p className="text-xs text-slate-500">{stat.title}</p>
                            <p className="text-xl font-bold text-slate-900 mt-0.5">
                                {stat.value}
                            </p>
                        </div>
                    );
                })}
            </div>

            {/* Charts Row 1 */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 print:grid-cols-2">
                {/* Department Pie Chart */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 md:p-6 print:break-inside-avoid">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h3 className="font-semibold text-slate-900">
                                Phân bố phòng ban
                            </h3>
                            <p className="text-xs text-slate-500 mt-0.5">
                                Số lượng nhân viên theo phòng ban
                            </p>
                        </div>
                        <Users className="w-5 h-5 text-slate-400" />
                    </div>
                    {departmentData.length > 0 ? (
                        <>
                            <div className="h-56">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={departmentData}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={40}
                                            outerRadius={80}
                                            paddingAngle={2}
                                            dataKey="value"
                                        >
                                            {departmentData.map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={entry.color} />
                                            ))}
                                        </Pie>
                                        <Tooltip
                                            contentStyle={{
                                                backgroundColor: "#fff",
                                                border: "1px solid #E2E8F0",
                                                borderRadius: "8px",
                                                fontSize: "12px",
                                            }}
                                            formatter={(value: number | string | undefined) => [`${value} người`, ""]}
                                        />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                            <div className="grid grid-cols-2 gap-2 mt-2">
                                {departmentData.slice(0, 6).map((dept) => (
                                    <div key={dept.name} className="flex items-center gap-2 text-xs">
                                        <span
                                            className="w-2.5 h-2.5 rounded-full shrink-0"
                                            style={{ backgroundColor: dept.color }}
                                        />
                                        <span className="text-slate-600 truncate">{dept.name}</span>
                                        <span className="text-slate-900 font-medium ml-auto">
                                            {dept.value}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </>
                    ) : (
                        <div className="h-56 flex items-center justify-center text-slate-400">
                            Chưa có dữ liệu phòng ban
                        </div>
                    )}
                </div>

                {/* Attendance Chart */}
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 md:p-6 print:break-inside-avoid">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h3 className="font-semibold text-slate-900">
                                Thống kê chấm công
                            </h3>
                            <p className="text-xs text-slate-500 mt-0.5">
                                Tỷ lệ đúng giờ, đi trễ theo tháng (%)
                            </p>
                        </div>
                        <Clock className="w-5 h-5 text-slate-400" />
                    </div>
                    {attendanceChartData.length > 0 ? (
                        <>
                            <div className="h-56">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={attendanceChartData}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                                        <XAxis
                                            dataKey="month"
                                            tick={{ fontSize: 12, fill: "#64748B" }}
                                            axisLine={{ stroke: "#E2E8F0" }}
                                        />
                                        <YAxis
                                            tick={{ fontSize: 12, fill: "#64748B" }}
                                            axisLine={{ stroke: "#E2E8F0" }}
                                            domain={[0, 100]}
                                            tickFormatter={(value) => `${value}%`}
                                        />
                                        <Tooltip
                                            contentStyle={{
                                                backgroundColor: "#fff",
                                                border: "1px solid #E2E8F0",
                                                borderRadius: "8px",
                                                fontSize: "12px",
                                            }}
                                            formatter={(value: number | string | undefined) => [`${value}%`, ""]}
                                        />
                                        <Line
                                            type="monotone"
                                            dataKey="onTime"
                                            name="Đúng giờ"
                                            stroke="#10B981"
                                            strokeWidth={2}
                                            dot={{ fill: "#10B981", strokeWidth: 2 }}
                                        />
                                        <Line
                                            type="monotone"
                                            dataKey="late"
                                            name="Đi trễ"
                                            stroke="#F59E0B"
                                            strokeWidth={2}
                                            dot={{ fill: "#F59E0B", strokeWidth: 2 }}
                                        />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                            <div className="flex items-center justify-center gap-4 mt-3 text-xs flex-wrap">
                                <span className="flex items-center gap-1.5">
                                    <span className="w-3 h-3 rounded bg-green-500" />
                                    Đúng giờ
                                </span>
                                <span className="flex items-center gap-1.5">
                                    <span className="w-3 h-3 rounded bg-amber-500" />
                                    Đi trễ
                                </span>
                            </div>
                        </>
                    ) : (
                        <div className="h-56 flex items-center justify-center text-slate-400">
                            Chưa có dữ liệu chấm công
                        </div>
                    )}
                </div>
            </div>

            {/* Employee Table for Print */}
            <div className="hidden print:block bg-white rounded-xl border p-4 break-inside-avoid">
                <h3 className="font-semibold mb-2">Danh sách nhân viên</h3>
                <table className="w-full text-sm">
                    <thead>
                        <tr className="border-b">
                            <th className="text-left py-2">Họ tên</th>
                            <th className="text-left py-2">Mã NV</th>
                            <th className="text-left py-2">Phòng ban</th>
                            <th className="text-left py-2">Chức vụ</th>
                        </tr>
                    </thead>
                    <tbody>
                        {activeEmployees.slice(0, 20).map((emp) => (
                            <tr key={emp.id} className="border-b">
                                <td className="py-1">{emp.name}</td>
                                <td className="py-1">{(emp as any).employee_id}</td>
                                <td className="py-1">{emp.department}</td>
                                <td className="py-1">{emp.position}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {activeEmployees.length > 20 && (
                    <p className="text-xs text-gray-400 mt-2">... và {activeEmployees.length - 20} nhân viên khác</p>
                )}
            </div>

            {/* Quick Actions */}
            <div className="bg-gradient-to-r from-blue-600 to-cyan-500 rounded-xl p-4 md:p-6 text-white print:hidden">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                    <div>
                        <h3 className="font-semibold text-lg">
                            Cần báo cáo chi tiết hơn?
                        </h3>
                        <p className="text-blue-100 text-sm mt-1">
                            Xuất báo cáo PDF hoặc Excel để phân tích sâu hơn
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={handleExportPDF}
                            className="inline-flex items-center gap-2 px-4 py-2.5 bg-white/20 hover:bg-white/30 backdrop-blur-sm rounded-xl font-medium text-sm transition-colors"
                        >
                            <Download className="w-4 h-4" />
                            Xuất PDF
                        </button>
                        <button
                            onClick={handleExportExcel}
                            className="inline-flex items-center gap-2 px-4 py-2.5 bg-white text-blue-600 hover:bg-blue-50 rounded-xl font-medium text-sm transition-colors"
                        >
                            <FileSpreadsheet className="w-4 h-4" />
                            Xuất Excel
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
