"use client";

import { useState, useEffect } from "react";
import { Search, Plus, Edit, Trash2, Eye, Filter, Download, X, Mail, Phone, Briefcase, ChevronLeft, ChevronRight, UserCircle, FileSpreadsheet, FileText, Settings2, Check, Loader2, DollarSign } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { getEmployees, createEmployee, updateEmployee, deleteEmployee } from "@/lib/api/employees";
import { Employee, EmployeeInsert } from "@/lib/database.types";
import { EmployeeForm } from "@/components/employees/EmployeeForm";
import { ImportDropdown } from "@/components/employees/ImportDropdown";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useAuth } from "@/contexts/AuthContext";
import { useRouter } from "next/navigation";
import { logActivity } from "@/lib/api/activity-logs";
import { FilterBar } from "@/components/ui/FilterBar";

const statusLabels: Record<string, { label: string; class: string; dot: string }> = {
    active: { label: "Đang làm việc", class: "bg-green-50 text-green-700 ring-green-600/20", dot: "bg-green-500" },
    probation: { label: "Thử việc", class: "bg-yellow-50 text-yellow-700 ring-yellow-600/20", dot: "bg-yellow-500" },
    inactive: { label: "Nghỉ việc", class: "bg-red-50 text-red-700 ring-red-600/20", dot: "bg-red-500" },
};

const departments = ["Kỹ thuật", "Nhân sự", "Kinh doanh", "Kế toán", "Marketing", "Ban giám đốc", "Hành chính"];

// Format date to dd/mm/yyyy
function formatDate(dateStr: string | undefined | null): string {
    if (!dateStr) return '---';
    const date = new Date(dateStr);
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
}

// Format currency
function formatCurrency(amount: number | undefined | null): string {
    if (!amount) return '---';
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(amount);
}

// Helper for employee type labels
function getEmployeeTypeLabel(type: string | undefined): string {
    switch (type) {
        case 'full_time_monthly': return 'Fulltime (lương tháng)';
        case 'full_time_hourly': return 'Fulltime (lương giờ)';
        case 'part_time': return 'Parttime';
        case 'probation': return 'Nhân viên thử việc';
        case 'intern': return 'Thực tập sinh';
        default: return 'Chưa cập nhật';
    }
}

// Employee Detail Slide-over
function EmployeeDetail({ employee, onClose, onEdit }: { employee: Employee | null; onClose: () => void; onEdit: () => void }) {
    if (!employee) return null;

    return (
        <>
            <div
                className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40 animate-fade-in"
                onClick={onClose}
            />
            <div className="fixed inset-y-0 right-0 w-full max-w-xl bg-slate-50 shadow-2xl z-50 animate-slide-in overflow-y-auto">
                <div className="sticky top-0 bg-white border-b border-slate-100 px-6 py-4 flex items-center justify-between z-10 shadow-sm">
                    <h2 className="text-lg font-semibold text-slate-900">Thông tin chi tiết</h2>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={onEdit}
                            className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Chỉnh sửa"
                        >
                            <Edit className="w-5 h-5" />
                        </button>
                        <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors">
                            <X className="w-5 h-5" />
                        </button>
                    </div>
                </div>

                <div className="p-6 space-y-6">
                    {/* Header Card */}
                    <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
                        <div className="flex items-start gap-4">
                            <div className="w-20 h-20 rounded-2xl gradient-primary flex items-center justify-center text-2xl font-bold text-white shadow-lg shrink-0">
                                {employee.avatar}
                            </div>
                            <div className="flex-1 min-w-0">
                                <h3 className="text-xl font-bold text-slate-900 truncate">{employee.name}</h3>
                                <p className="text-slate-500">{employee.position}</p>
                                <div className="flex flex-wrap items-center gap-2 mt-2">
                                    <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full ring-1 ring-inset", statusLabels[employee.status].class)}>
                                        <span className={cn("w-1.5 h-1.5 rounded-full", statusLabels[employee.status].dot)} />
                                        {statusLabels[employee.status].label}
                                    </span>
                                    <span className="inline-flex items-center px-2.5 py-1 text-xs font-medium rounded-full bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-200">
                                        {employee.id}
                                    </span>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Personal Info */}
                    <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
                        <h4 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
                            <UserCircle className="w-4 h-4 text-blue-500" />
                            Thông tin cá nhân
                        </h4>
                        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
                            <div>
                                <dt className="text-xs font-medium text-slate-500">Ngày sinh</dt>
                                <dd className="text-sm text-slate-900 mt-1">{formatDate(employee.date_of_birth)}</dd>
                            </div>
                            <div>
                                <dt className="text-xs font-medium text-slate-500">CCCD/CMND</dt>
                                <dd className="text-sm text-slate-900 mt-1 font-mono">{employee.identity_card || '---'}</dd>
                            </div>
                            <div className="sm:col-span-2">
                                <dt className="text-xs font-medium text-slate-500">Địa chỉ</dt>
                                <dd className="text-sm text-slate-900 mt-1">{employee.address || '---'}</dd>
                            </div>
                            <div className="sm:col-span-2 pt-2 border-t border-slate-50 mt-2">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                        <dt className="text-xs font-medium text-slate-500">Email</dt>
                                        <dd className="text-sm text-slate-900 mt-1 flex items-center gap-1.5">
                                            <Mail className="w-3.5 h-3.5 text-slate-400" />
                                            {employee.email}
                                        </dd>
                                    </div>
                                    <div>
                                        <dt className="text-xs font-medium text-slate-500">Số điện thoại</dt>
                                        <dd className="text-sm text-slate-900 mt-1 flex items-center gap-1.5">
                                            <Phone className="w-3.5 h-3.5 text-slate-400" />
                                            {employee.phone}
                                        </dd>
                                    </div>
                                </div>
                            </div>
                            <div className="sm:col-span-2 pt-2 border-t border-slate-50 mt-2">
                                <dt className="text-xs font-medium text-slate-500">Liên hệ khẩn cấp</dt>
                                <dd className="text-sm text-slate-900 mt-1">
                                    {employee.emergency_contact_name ? (
                                        <span>{employee.emergency_contact_name} - {employee.emergency_contact_phone}</span>
                                    ) : '---'}
                                </dd>
                            </div>
                        </dl>
                    </div>

                    {/* Work Info */}
                    <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
                        <h4 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
                            <Briefcase className="w-4 h-4 text-orange-500" />
                            Thông tin công việc
                        </h4>
                        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
                            <div>
                                <dt className="text-xs font-medium text-slate-500">Phòng ban</dt>
                                <dd className="text-sm text-slate-900 mt-1">{employee.department}</dd>
                            </div>
                            <div>
                                <dt className="text-xs font-medium text-slate-500">Chức vụ</dt>
                                <dd className="text-sm text-slate-900 mt-1">{employee.position}</dd>
                            </div>
                            <div>
                                <dt className="text-xs font-medium text-slate-500">Hình thức</dt>
                                <dd className="text-sm text-slate-900 mt-1">
                                    {getEmployeeTypeLabel(employee.employee_type || undefined)}
                                </dd>
                            </div>
                            <div>
                                <dt className="text-xs font-medium text-slate-500">Ngày vào làm</dt>
                                <dd className="text-sm text-slate-900 mt-1">{formatDate(employee.join_date)}</dd>
                            </div>
                            {employee.termination_date && (
                                <div className="sm:col-span-2">
                                    <dt className="text-xs font-medium text-red-500">Ngày nghỉ việc</dt>
                                    <dd className="text-sm text-red-700 mt-1">{formatDate(employee.termination_date)}</dd>
                                </div>
                            )}
                        </dl>
                    </div>

                    {/* Salary & Benefits */}
                    <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
                        <h4 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
                            <DollarSign className="w-4 h-4 text-green-500" />
                            Lương & Phúc lợi
                        </h4>
                        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
                            <div className="sm:col-span-2">
                                <dt className="text-xs font-medium text-slate-500">Mức lương cơ bản</dt>
                                <dd className="text-lg font-semibold text-green-600 mt-1">{formatCurrency(employee.salary)}</dd>
                            </div>
                            <div className="sm:col-span-2 pt-2 border-t border-slate-50 mt-2">
                                <dt className="text-xs font-medium text-slate-500 mb-2">Đồng phục</dt>
                                <div className="bg-slate-50 rounded-lg p-3 grid grid-cols-2 gap-4">
                                    <div>
                                        <span className="block text-xs text-slate-400">Chi phí</span>
                                        <span className="text-sm font-medium text-slate-900">{formatCurrency(employee.uniform_cost)}</span>
                                    </div>
                                    <div>
                                        <span className="block text-xs text-slate-400">Ngày cấp</span>
                                        <span className="text-sm font-medium text-slate-900">{formatDate(employee.uniform_issue_date)}</span>
                                    </div>
                                    <div className="col-span-2">
                                        <span className="block text-xs text-slate-400">Hết hạn khấu hao</span>
                                        <span className="text-sm font-medium text-slate-900">{formatDate(employee.uniform_expiry_date)}</span>
                                    </div>
                                </div>
                            </div>
                        </dl>
                    </div>

                    {/* Notes */}
                    {employee.notes && (
                        <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100">
                            <h4 className="text-sm font-semibold text-slate-900 mb-2 flex items-center gap-2">
                                <FileText className="w-4 h-4 text-slate-400" />
                                Ghi chú
                            </h4>
                            <p className="text-sm text-slate-600 whitespace-pre-wrap">{employee.notes}</p>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}

// Column Visibility Dropdown
function ColumnVisibilityDropdown({
    columns,
    visibleColumns,
    onToggle
}: {
    columns: { key: string; label: string }[];
    visibleColumns: string[];
    onToggle: (key: string) => void;
}) {
    const [isOpen, setIsOpen] = useState(false);

    return (
        <div className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="inline-flex items-center gap-2 px-4 py-3 text-sm font-medium text-slate-600 bg-slate-50 rounded-xl hover:bg-slate-100 transition-colors"
            >
                <Settings2 className="w-4 h-4" />
                Cột hiển thị
            </button>
            {isOpen && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
                    <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-lg border border-slate-200 z-50 py-2 animate-scale-in overflow-y-auto max-h-80">
                        <button
                            onClick={() => {
                                if (visibleColumns.length === columns.length) {
                                    onToggle('none'); // Custom signal to deselect all
                                } else {
                                    onToggle('all'); // Custom signal to select all
                                }
                            }}
                            className="w-full flex items-center gap-3 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors border-b border-slate-100 mb-1"
                        >
                            <div className={cn(
                                "w-4 h-4 rounded border flex items-center justify-center transition-colors flex-shrink-0",
                                visibleColumns.length === columns.length
                                    ? "bg-blue-600 border-blue-600"
                                    : "border-slate-300"
                            )}>
                                {visibleColumns.length === columns.length && <Check className="w-3 h-3 text-white" />}
                            </div>
                            <span className="font-semibold">Tất cả thông tin</span>
                        </button>
                        {columns.map((col) => (
                            <button
                                key={col.key}
                                onClick={() => onToggle(col.key)}
                                className="w-full flex items-center gap-3 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                            >
                                <div className={cn(
                                    "w-4 h-4 rounded border flex items-center justify-center transition-colors flex-shrink-0",
                                    visibleColumns.includes(col.key)
                                        ? "bg-blue-600 border-blue-600"
                                        : "border-slate-300"
                                )}>
                                    {visibleColumns.includes(col.key) && <Check className="w-3 h-3 text-white" />}
                                </div>
                                {col.label}
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
}

// Export Dropdown
function ExportDropdown({ employees }: { employees: Employee[] }) {
    const [isOpen, setIsOpen] = useState(false);

    const formatNumber = (num: number | undefined | null) => {
        if (!num) return '0';
        return new Intl.NumberFormat('vi-VN').format(num);
    };

    const exportToCSV = () => {
        const headers = [
            'Mã NV', 'Họ tên', 'Email', 'SĐT', 'Ngày sinh', 'CCCD', 'Giới tính',
            'Mã số thuế', 'Mã số BHXH',
            'Địa chỉ', 'Đường', 'Phường/Xã', 'Quận/Huyện', 'Tỉnh/Thành phố',
            'Phòng ban', 'Chức vụ', 'Lương cơ bản', 'Hình thức', 'Trạng thái',
            'Ngày vào', 'Ngày nghỉ việc',
            'Chi phí đồng phục', 'Ngày cấp ĐP', 'Hết hạn ĐP',
            'Liên hệ khẩn cấp', 'SĐT khẩn cấp', 'Ghi chú'
        ];
        const getGenderLabel = (gender: string | null | undefined) => {
            switch (gender) {
                case 'male': return 'Nam';
                case 'female': return 'Nữ';
                case 'other': return 'Khác';
                default: return '';
            }
        };
        const rows = employees.map(e => [
            e.id,
            e.name,
            e.email,
            e.phone,
            formatDate(e.date_of_birth),
            `'${e.identity_card || ''}`, // Force text format for ID card
            getGenderLabel(e.gender),
            e.tax_id || '',
            e.social_insurance_id || '',
            `"${e.address || ''}"`,
            `"${e.address_street || ''}"`,
            `"${e.address_ward || ''}"`,
            `"${e.address_district || ''}"`,
            `"${e.address_city || ''}"`,
            e.department,
            e.position,
            formatNumber(e.salary),
            getEmployeeTypeLabel(e.employee_type || undefined),
            statusLabels[e.status]?.label || e.status,
            formatDate(e.join_date),
            formatDate(e.termination_date),
            formatNumber(e.uniform_cost),
            formatDate(e.uniform_issue_date),
            formatDate(e.uniform_expiry_date),
            e.emergency_contact_name || '',
            e.emergency_contact_phone || '',
            `"${e.notes || ''}"`
        ]);

        const csvContent = [headers, ...rows].map(row => row.join(',')).join('\n');
        const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `danh-sach-nhan-vien-${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        setIsOpen(false);
    };

    const exportToPDF = () => {
        const printWindow = window.open('', '_blank');
        if (printWindow) {
            const html = `
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Danh sách nhân viên</title>
                    <style>
                        @page { size: A4 landscape; margin: 5mm; }
                        body { font-family: 'Segoe UI', Arial, sans-serif; padding: 10px; color: #1e293b; font-size: 10px; }
                        .header { text-align: center; margin-bottom: 20px; border-bottom: 2px solid #e2e8f0; padding-bottom: 10px; }
                        h1 { color: #0f172a; margin: 0 0 5px 0; font-size: 20px; text-transform: uppercase; }
                        .meta { color: #64748b; font-size: 11px; }
                        table { width: 100%; border-collapse: collapse; margin-top: 10px; background: white; }
                        th, td { border: 1px solid #e2e8f0; padding: 6px; text-align: left; vertical-align: top; }
                        th { background-color: #f1f5f9; color: #475569; font-weight: 700; text-transform: uppercase; font-size: 9px; white-space: nowrap; }
                        tr:nth-child(even) { background-color: #f8fafc; }
                        .text-right { text-align: right; }
                        .font-bold { font-weight: 700; }
                        .text-blue { color: #2563eb; }
                        .text-xs { font-size: 9px; color: #64748b; }
                        .label { color: #94a3b8; font-size: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
                        .badge { display: inline-block; padding: 2px 4px; border-radius: 3px; font-size: 8px; font-weight: 600; text-transform: uppercase; }
                        .section-gap { margin-top: 4px; }
                    </style>
                </head>
                <body>
                    <div class="header">
                        <h1>Danh sách nhân viên</h1>
                        <div class="meta">Ngày xuất: ${formatDate(new Date().toISOString())} • SL: ${employees.length}</div>
                    </div>
                    <table>
                        <thead>
                            <tr>
                                <th style="width: 50px">Mã</th>
                                <th style="width: 20%">Thông tin cá nhân</th>
                                <th style="width: 25%">Liên hệ & Địa chỉ</th>
                                <th style="width: 20%">Công việc</th>
                                <th style="width: 20%">Lương & Phúc lợi</th>
                                <th>Trạng thái</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${employees.map(e => `
                                <tr>
                                    <td><span class="font-bold text-blue">${e.id}</span></td>
                                    <td>
                                        <div class="font-bold" style="font-size: 11px">${e.name}</div>
                                        <div class="section-gap">
                                            <span class="label">Ngày sinh:</span> ${formatDate(e.date_of_birth)}<br/>
                                            <span class="label">CCCD:</span> ${e.identity_card || '---'}
                                        </div>
                                        ${e.notes ? `<div class="section-gap" style="font-style: italic; color: #64748b; border-top: 1px dashed #e2e8f0; padding-top: 2px; margin-top: 4px;">Note: ${e.notes}</div>` : ''}
                                    </td>
                                    <td>
                                        <div><span class="label">Email:</span> ${e.email}</div>
                                        <div><span class="label">SĐT:</span> ${e.phone}</div>
                                        <div class="section-gap"><span class="label">Đ/C:</span> ${e.address || '---'}</div>
                                        ${e.emergency_contact_name ? `
                                            <div class="section-gap" style="border-top: 1px dashed #e2e8f0; padding-top: 2px; margin-top: 4px;">
                                                <span class="label">Khẩn cấp:</span> ${e.emergency_contact_name} - ${e.emergency_contact_phone || ''}
                                            </div>
                                        ` : ''}
                                    </td>
                                    <td>
                                        <div class="font-bold">${e.position}</div>
                                        <div>${e.department}</div>
                                        <div class="text-xs">${getEmployeeTypeLabel(e.employee_type || undefined)}</div>
                                        <div class="section-gap">
                                            <span class="label">Vào làm:</span> ${formatDate(e.join_date)}
                                            ${e.termination_date ? `<br/><span class="label" style="color: #ef4444">Nghỉ việc:</span> <span style="color: #ef4444">${formatDate(e.termination_date)}</span>` : ''}
                                        </div>
                                    </td>
                                    <td>
                                        <div><span class="label">Lương:</span> <span class="font-bold">${formatNumber(e.salary)}</span></div>
                                        <div class="section-gap">
                                            <span class="label">Đồng phục:</span> ${formatNumber(e.uniform_cost)}
                                            ${e.uniform_issue_date ? `<div class="text-xs">Cấp: ${formatDate(e.uniform_issue_date)} - Hết: ${formatDate(e.uniform_expiry_date)}</div>` : ''}
                                        </div>
                                    </td>
                                    <td>
                                        <span class="badge" style="background: ${e.status === 'active' ? '#dcfce7; color: #166534' : e.status === 'probation' ? '#fef9c3; color: #854d0e' : '#fee2e2; color: #991b1b'}">
                                            ${statusLabels[e.status]?.label || e.status}
                                        </span>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </body>
                </html>
            `;
            printWindow.document.write(html);
            printWindow.document.close();
            printWindow.print();
        }
        setIsOpen(false);
    };

    return (
        <div className="relative">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="inline-flex items-center gap-2 px-4 py-3 text-sm font-medium text-slate-600 bg-slate-50 rounded-xl hover:bg-slate-100 transition-colors"
            >
                <Download className="w-4 h-4" />
                Xuất dữ liệu
            </button>
            {isOpen && (
                <>
                    <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
                    <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-lg border border-slate-200 z-50 py-2 animate-scale-in">
                        <button
                            onClick={exportToCSV}
                            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                        >
                            <FileSpreadsheet className="w-4 h-4 text-green-600" />
                            Xuất Excel (CSV)
                        </button>
                        <button
                            onClick={exportToPDF}
                            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                        >
                            <FileText className="w-4 h-4 text-red-600" />
                            Xuất PDF
                        </button>
                    </div>
                </>
            )}
        </div>
    );
}

// Column definitions
const allColumns = [
    { key: 'id', label: 'Mã NV' },
    { key: 'name', label: 'Họ và tên' },
    { key: 'phone', label: 'Số điện thoại' },
    { key: 'department', label: 'Phòng ban' },
    { key: 'position', label: 'Chức vụ' },
    { key: 'salary', label: 'Lương cơ bản' },
    { key: 'status', label: 'Trạng thái' },
    { key: 'join_date', label: 'Ngày vào' },
    { key: 'date_of_birth', label: 'Ngày sinh' },
    { key: 'identity_card', label: 'CCCD/CMND' },
    { key: 'gender', label: 'Giới tính' },
    { key: 'employee_type', label: 'Loại hình NV' },
    { key: 'address', label: 'Địa chỉ' },
    { key: 'tax_id', label: 'Mã số thuế' },
    { key: 'social_insurance_id', label: 'Mã số BHXH' },
    { key: 'email', label: 'Email' },
    { key: 'termination_date', label: 'Ngày nghỉ việc' },
];

export default function PersonnelPage() {
    const { user, isLoading: authLoading } = useAuth();
    const router = useRouter();
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedDepartment, setSelectedDepartment] = useState("all");
    const [selectedEmployee, setSelectedEmployee] = useState<Employee | null>(null);
    const [isFormOpen, setIsFormOpen] = useState(false);
    const [editingEmployee, setEditingEmployee] = useState<Employee | null>(null);
    const [visibleColumns, setVisibleColumns] = useState(['id', 'name', 'department', 'position', 'status', 'join_date']);
    const [isSaving, setIsSaving] = useState(false);
    const [selectedStatus, setSelectedStatus] = useState('');
    const [selectedType, setSelectedType] = useState('');
    const [confirmDelete, setConfirmDelete] = useState<{ open: boolean; employeeId: string | null; employeeName: string }>({
        open: false,
        employeeId: null,
        employeeName: ''
    });

    // Permission checks
    const isMember = user?.role === 'member';
    const canEdit = user?.role === 'admin' || user?.role === 'accountant' || user?.role === 'branch_manager';
    const canExport = user?.role === 'admin' || user?.role === 'accountant';

    // Redirect members to their profile page
    useEffect(() => {
        if (!authLoading && isMember) {
            router.replace('/dashboard/my-profile');
        }
    }, [authLoading, isMember, router]);

    // Fetch employees on mount
    useEffect(() => {
        if (!isMember) {
            fetchEmployees();
        }
    }, [isMember]);

    const fetchEmployees = async () => {
        try {
            setIsLoading(true);
            setError(null);
            const data = await getEmployees();
            setEmployees(data);
        } catch (err) {
            console.error('Failed to fetch employees:', err);
            const errorMessage = err instanceof Error ? err.message : 'Lỗi không xác định';
            setError(`Không thể tải dữ liệu nhân viên: ${errorMessage}`);
        } finally {
            setIsLoading(false);
        }
    };

    const filteredEmployees = employees.filter((employee) => {
        const matchesSearch =
            employee.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
            employee.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
            employee.email.toLowerCase().includes(searchTerm.toLowerCase());
        const matchesDepartment =
            selectedDepartment === "all" || employee.department === selectedDepartment;
        const matchesStatus =
            !selectedStatus || employee.status === selectedStatus;
        const matchesType =
            !selectedType || employee.employee_type === selectedType;
        return matchesSearch && matchesDepartment && matchesStatus && matchesType;
    });

    const handleSaveEmployee = async (employeeData: EmployeeInsert) => {
        try {
            setIsSaving(true);
            if (editingEmployee) {
                // Convert null values to undefined for compatibility
                const updateData = {
                    ...employeeData,
                    email: employeeData.email ?? undefined
                };
                await updateEmployee(editingEmployee.id, updateData);
                // Log activity
                if (user) {
                    logActivity({
                        userId: user.employeeId || user.id,
                        userName: user.fullName,
                        userRole: user.role,
                        action: 'update',
                        entityType: 'employee',
                        entityId: editingEmployee.id,
                        entityName: employeeData.name,
                        details: { updated_fields: Object.keys(employeeData) }
                    });
                }
                toast.success('Đã cập nhật nhân viên thành công');
            } else {
                const newEmp = await createEmployee(employeeData);
                // Log activity
                if (user) {
                    logActivity({
                        userId: user.employeeId || user.id,
                        userName: user.fullName,
                        userRole: user.role,
                        action: 'create',
                        entityType: 'employee',
                        entityId: newEmp.id,
                        entityName: newEmp.name
                    });
                }
                toast.success('Đã thêm nhân viên mới thành công');
            }
            await fetchEmployees();
            setEditingEmployee(null);
            setIsFormOpen(false);
        } catch (err: unknown) {
            console.error('Failed to save employee:', err);
            const errorMessage = err instanceof Error ? err.message : 'Lỗi không xác định';
            toast.error('Lỗi khi lưu dữ liệu', {
                description: errorMessage,
                duration: 10000 // Show for 10 seconds so user can read
            });
        } finally {
            setIsSaving(false);
        }
    };

    const handleDeleteEmployee = (id: string) => {
        const empToDelete = employees.find(e => e.id === id);
        setConfirmDelete({
            open: true,
            employeeId: id,
            employeeName: empToDelete?.name || 'nhân viên này'
        });
    };

    const confirmDeleteEmployee = async () => {
        if (!confirmDelete.employeeId) return;

        try {
            await deleteEmployee(confirmDelete.employeeId);
            // Log activity
            if (user) {
                logActivity({
                    userId: user.employeeId || user.id,
                    userName: user.fullName,
                    userRole: user.role,
                    action: 'delete',
                    entityType: 'employee',
                    entityId: confirmDelete.employeeId,
                    entityName: confirmDelete.employeeName
                });
            }
            toast.success('Đã xóa nhân viên');
            await fetchEmployees();
            setConfirmDelete({ open: false, employeeId: null, employeeName: '' });
        } catch (err: unknown) {
            console.error('Failed to delete employee:', err);
            const errorMsg = err instanceof Error ? err.message : 'Lỗi không xác định';
            toast.error('Lỗi khi xóa nhân viên', {
                description: errorMsg
            });
        }
    };

    const handleEditFromDetail = () => {
        setEditingEmployee(selectedEmployee);
        setSelectedEmployee(null);
        setIsFormOpen(true);
    };

    const handleToggleColumn = (key: string) => {
        if (key === 'all') {
            setVisibleColumns(allColumns.map(c => c.key));
            return;
        }
        if (key === 'none') {
            setVisibleColumns(['id', 'name']); // Always keep ID and Name
            return;
        }

        if (visibleColumns.includes(key)) {
            if (visibleColumns.length > 1) {
                setVisibleColumns(visibleColumns.filter(c => c !== key));
            }
        } else {
            setVisibleColumns([...visibleColumns, key]);
        }
    };

    const [isImporting, setIsImporting] = useState(false);
    const handleImportEmployees = async (importedEmployees: EmployeeInsert[]) => {
        try {
            setIsImporting(true);
            for (const emp of importedEmployees) {
                await createEmployee(emp);
            }
            await fetchEmployees();
        } catch (err) {
            console.error('Failed to import employees:', err);
            throw err;
        } finally {
            setIsImporting(false);
        }
    };

    const openAddForm = () => {
        setEditingEmployee(null);
        setIsFormOpen(true);
    };

    if (isLoading) {
        return (
            <div className="flex items-center justify-center h-96">
                <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
                <span className="ml-2 text-slate-600">Đang tải dữ liệu...</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="flex flex-col items-center justify-center h-96">
                <p className="text-red-500 mb-4">{error}</p>
                <button
                    onClick={fetchEmployees}
                    className="px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700"
                >
                    Thử lại
                </button>
            </div>
        );
    }

    return (
        <>
            <div className="space-y-4 md:space-y-6">
                {/* Header - Compact on mobile */}
                <div className="flex items-center justify-between gap-2 animate-fade-in">
                    <div>
                        <h1 className="text-xl md:text-2xl font-bold tracking-tight text-slate-900">Quản lý Nhân sự</h1>
                        <p className="text-slate-500 text-sm mt-0.5 hidden sm:block">Danh sách và quản lý thông tin nhân viên</p>
                    </div>
                    {canEdit && (
                        <button
                            onClick={openAddForm}
                            className="inline-flex items-center gap-1.5 px-3 md:px-5 py-2 md:py-2.5 gradient-primary text-white text-sm font-medium rounded-xl shadow-lg shadow-blue-500/20 hover:shadow-xl transition-all duration-200"
                        >
                            <Plus className="w-4 h-4" />
                            <span className="hidden sm:inline">Thêm nhân viên</span>
                        </button>
                    )}
                </div>

                {/* Filters & Search - Compact on mobile */}
                <div className="relative z-10 bg-white rounded-xl md:rounded-2xl border border-slate-200 shadow-sm p-3 md:p-5 animate-slide-up stagger-1" style={{ animationFillMode: "forwards" }}>
                    <div className="flex flex-col gap-3">
                        {/* Search */}
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                            <input
                                type="text"
                                placeholder="Tìm kiếm..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                className="w-full pl-10 pr-4 py-2.5 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                            />
                        </div>
                        {/* Filters & Actions - Wrap on mobile instead of scroll */}
                        <div className="flex flex-wrap items-center gap-2">
                            <div className="flex items-center gap-1.5 bg-slate-50 px-3 py-2 rounded-xl shrink-0">
                                <Filter className="w-3.5 h-3.5 text-slate-400" />
                                <select
                                    value={selectedDepartment}
                                    onChange={(e) => setSelectedDepartment(e.target.value)}
                                    className="text-sm border-none focus:outline-none bg-transparent cursor-pointer"
                                >
                                    <option value="all">Tất cả PB</option>
                                    {departments.map((dept) => (
                                        <option key={dept} value={dept}>{dept}</option>
                                    ))}
                                </select>
                            </div>
                            <FilterBar
                                filters={[
                                    {
                                        key: 'status',
                                        label: 'Trạng thái',
                                        placeholder: 'Tất cả TT',
                                        options: [
                                            { value: 'active', label: 'Đang làm việc' },
                                            { value: 'probation', label: 'Thử việc' },
                                            { value: 'inactive', label: 'Nghỉ việc' }
                                        ]
                                    },
                                    {
                                        key: 'type',
                                        label: 'Loại hình',
                                        placeholder: 'Tất cả',
                                        options: [
                                            { value: 'full_time_monthly', label: 'Fulltime (lương tháng)' },
                                            { value: 'full_time_hourly', label: 'Fulltime (lương giờ)' },
                                            { value: 'part_time', label: 'Parttime' },
                                            { value: 'probation', label: 'Nhân viên thử việc' },
                                            { value: 'intern', label: 'Thực tập sinh' }
                                        ]
                                    }
                                ]}
                                values={{ status: selectedStatus, type: selectedType }}
                                onChange={(key, val) => {
                                    if (key === 'status') setSelectedStatus(val);
                                    if (key === 'type') setSelectedType(val);
                                }}
                                onReset={() => { setSelectedStatus(''); setSelectedType(''); }}
                            />
                            <ColumnVisibilityDropdown
                                columns={allColumns}
                                visibleColumns={visibleColumns}
                                onToggle={handleToggleColumn}
                            />
                            {canExport && <ExportDropdown employees={filteredEmployees} />}
                            {canEdit && <ImportDropdown onImport={handleImportEmployees} isImporting={isImporting} />}
                        </div>
                    </div>
                </div>

                {/* Table */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden opacity-0 animate-slide-up stagger-2" style={{ animationFillMode: "forwards" }}>
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="bg-slate-50/80 border-b border-slate-100">
                                    {visibleColumns.includes('id') && (
                                        <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-6 py-4">Mã NV</th>
                                    )}
                                    {visibleColumns.includes('name') && (
                                        <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-6 py-4">Họ và tên</th>
                                    )}
                                    {visibleColumns.includes('phone') && (
                                        <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-6 py-4">Số điện thoại</th>
                                    )}
                                    {visibleColumns.includes('department') && (
                                        <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-6 py-4">Phòng ban</th>
                                    )}
                                    {visibleColumns.includes('position') && (
                                        <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-6 py-4">Chức vụ</th>
                                    )}
                                    {visibleColumns.includes('salary') && (
                                        <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-6 py-4">Lương</th>
                                    )}
                                    {visibleColumns.includes('status') && (
                                        <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-6 py-4">Trạng thái</th>
                                    )}
                                    {visibleColumns.includes('join_date') && (
                                        <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-6 py-4">Ngày vào</th>
                                    )}
                                    {visibleColumns.includes('date_of_birth') && (
                                        <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-6 py-4">Ngày sinh</th>
                                    )}
                                    {visibleColumns.includes('identity_card') && (
                                        <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-6 py-4">CCCD</th>
                                    )}
                                    {visibleColumns.includes('gender') && (
                                        <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-6 py-4">Giới tính</th>
                                    )}
                                    {visibleColumns.includes('employee_type') && (
                                        <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-6 py-4">Loại hình</th>
                                    )}
                                    {visibleColumns.includes('address') && (
                                        <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-6 py-4">Địa chỉ</th>
                                    )}
                                    {visibleColumns.includes('tax_id') && (
                                        <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-6 py-4">MST</th>
                                    )}
                                    {visibleColumns.includes('social_insurance_id') && (
                                        <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-6 py-4">BHXH</th>
                                    )}
                                    {visibleColumns.includes('email') && (
                                        <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-6 py-4">Email</th>
                                    )}
                                    {visibleColumns.includes('termination_date') && (
                                        <th className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-6 py-4">Ngày nghỉ</th>
                                    )}

                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-50">
                                {filteredEmployees.map((employee, index) => (
                                    <tr
                                        key={employee.id}
                                        className="hover:bg-blue-50/50 transition-all duration-200 cursor-pointer group opacity-0 animate-fade-in"
                                        style={{ animationDelay: `${300 + index * 50}ms`, animationFillMode: "forwards" }}
                                        onClick={() => setSelectedEmployee(employee)}
                                    >
                                        {visibleColumns.includes('id') && (
                                            <td className="px-6 py-4">
                                                <span className="text-sm font-medium text-blue-600 bg-blue-50 px-2.5 py-1 rounded-lg">{employee.id}</span>
                                            </td>
                                        )}
                                        {visibleColumns.includes('name') && (
                                            <td className="px-6 py-4">
                                                <div className="flex items-center gap-3 group/name relative">
                                                    <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center text-white text-sm font-semibold shadow-md group-hover:scale-110 transition-transform duration-200 flex-shrink-0">
                                                        {employee.avatar}
                                                    </div>
                                                    <div className="flex flex-col">
                                                        <div className="text-sm font-medium text-slate-900">{employee.name}</div>
                                                        {/* Hover Actions */}
                                                        <div className="absolute left-full ml-4 top-1/2 -translate-y-1/2 flex items-center gap-1 opacity-0 group-hover/name:opacity-100 transition-all duration-200 bg-white/90 backdrop-blur-sm shadow-sm rounded-lg border border-slate-100 p-1 z-10">
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); setSelectedEmployee(employee); }}
                                                                className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-colors"
                                                                title="Xem chi tiết"
                                                            >
                                                                <Eye className="w-3.5 h-3.5" />
                                                            </button>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); setEditingEmployee(employee); setIsFormOpen(true); }}
                                                                className="p-1.5 text-slate-400 hover:text-amber-600 hover:bg-amber-50 rounded-md transition-colors"
                                                                title="Chỉnh sửa"
                                                            >
                                                                <Edit className="w-3.5 h-3.5" />
                                                            </button>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); handleDeleteEmployee(employee.id); }}
                                                                className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-colors"
                                                                title="Xóa"
                                                            >
                                                                <Trash2 className="w-3.5 h-3.5" />
                                                            </button>
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
                                        )}
                                        {visibleColumns.includes('phone') && (
                                            <td className="px-6 py-4"><span className="text-sm text-slate-600">{employee.phone}</span></td>
                                        )}
                                        {visibleColumns.includes('department') && (
                                            <td className="px-6 py-4">
                                                <span className="text-sm text-slate-600 bg-slate-100 px-2.5 py-1 rounded-lg">{employee.department}</span>
                                            </td>
                                        )}
                                        {visibleColumns.includes('position') && (
                                            <td className="px-6 py-4"><span className="text-sm text-slate-600">{employee.position}</span></td>
                                        )}
                                        {visibleColumns.includes('salary') && (
                                            <td className="px-6 py-4"><span className="text-sm font-medium text-green-600">{formatCurrency(employee.salary)}</span></td>
                                        )}
                                        {visibleColumns.includes('status') && (
                                            <td className="px-6 py-4">
                                                <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full ring-1 ring-inset", statusLabels[employee.status].class)}>
                                                    <span className={cn("w-1.5 h-1.5 rounded-full", statusLabels[employee.status].dot)} />
                                                    {statusLabels[employee.status].label}
                                                </span>
                                            </td>
                                        )}
                                        {visibleColumns.includes('join_date') && (
                                            <td className="px-6 py-4"><span className="text-sm text-slate-600">{formatDate(employee.join_date)}</span></td>
                                        )}
                                        {visibleColumns.includes('date_of_birth') && (
                                            <td className="px-6 py-4"><span className="text-sm text-slate-600">{formatDate(employee.date_of_birth)}</span></td>
                                        )}
                                        {visibleColumns.includes('identity_card') && (
                                            <td className="px-6 py-4"><span className="text-sm text-slate-600 font-mono">{employee.identity_card}</span></td>
                                        )}
                                        {visibleColumns.includes('gender') && (
                                            <td className="px-6 py-4"><span className="text-sm text-slate-600">{employee.gender === 'male' ? 'Nam' : employee.gender === 'female' ? 'Nữ' : 'Khác'}</span></td>
                                        )}
                                        {visibleColumns.includes('employee_type') && (
                                            <td className="px-6 py-4"><span className="text-sm text-slate-600">{getEmployeeTypeLabel(employee.employee_type || undefined)}</span></td>
                                        )}
                                        {visibleColumns.includes('address') && (
                                            <td className="px-6 py-4"><span className="text-sm text-slate-600 max-w-xs truncate block">{employee.address || '---'}</span></td>
                                        )}
                                        {visibleColumns.includes('tax_id') && (
                                            <td className="px-6 py-4"><span className="text-sm text-slate-600 font-mono">{employee.tax_id || '---'}</span></td>
                                        )}
                                        {visibleColumns.includes('social_insurance_id') && (
                                            <td className="px-6 py-4"><span className="text-sm text-slate-600 font-mono">{employee.social_insurance_id || '---'}</span></td>
                                        )}
                                        {visibleColumns.includes('email') && (
                                            <td className="px-6 py-4"><span className="text-sm text-slate-600">{employee.email}</span></td>
                                        )}
                                        {visibleColumns.includes('termination_date') && (
                                            <td className="px-6 py-4"><span className="text-sm text-slate-600">{formatDate(employee.termination_date)}</span></td>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
                    <div className="flex items-center justify-between px-6 py-4 border-t border-slate-100 bg-slate-50/50">
                        <p className="text-sm text-slate-500">
                            Hiển thị <span className="font-semibold text-slate-700">{filteredEmployees.length}</span> / {employees.length} nhân viên
                        </p>
                        <div className="flex items-center gap-2">
                            <button className="p-2 text-slate-400 hover:text-slate-600 hover:bg-white rounded-lg transition-colors border border-slate-200 disabled:opacity-50" disabled>
                                <ChevronLeft className="w-4 h-4" />
                            </button>
                            <button className="px-3.5 py-1.5 text-sm font-medium gradient-primary text-white rounded-lg shadow-sm">1</button>
                            <button className="p-2 text-slate-400 hover:text-slate-600 hover:bg-white rounded-lg transition-colors border border-slate-200">
                                <ChevronRight className="w-4 h-4" />
                            </button>
                        </div>
                    </div>
                </div>
            </div >

            {/* Employee Detail Slide-over */}
            {
                selectedEmployee && (
                    <EmployeeDetail
                        employee={selectedEmployee}
                        onClose={() => setSelectedEmployee(null)}
                        onEdit={handleEditFromDetail}
                    />
                )
            }

            {/* Add/Edit Employee Form */}
            <EmployeeForm
                isOpen={isFormOpen}
                onClose={() => { setIsFormOpen(false); setEditingEmployee(null); }}
                onSave={handleSaveEmployee}
                employee={editingEmployee}
                isSaving={isSaving}
            />

            {/* Delete Confirmation Dialog */}
            <ConfirmDialog
                open={confirmDelete.open}
                onOpenChange={(open) => setConfirmDelete({ ...confirmDelete, open })}
                title="Xóa nhân viên?"
                description={`Bạn sẽ xóa nhân viên "${confirmDelete.employeeName}". Hành động này không thể hoàn tác và sẽ xóa toàn bộ dữ liệu liên quan.`}
                confirmText="Xóa"
                cancelText="Hủy"
                variant="destructive"
                onConfirm={confirmDeleteEmployee}
            />
        </>
    );
}
