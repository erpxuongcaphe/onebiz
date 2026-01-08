"use client";

import { useState, useRef } from "react";
import { Upload, FileDown, Loader2, AlertTriangle, X, Check } from "lucide-react";
import * as XLSX from 'xlsx';
import { toast } from 'sonner';
import { EmployeeInsert } from "@/lib/database.types";
import { checkDuplicateEmployees, DuplicateEmployee } from "@/lib/api/employees";

interface ImportDropdownProps {
    onImport: (employees: EmployeeInsert[]) => Promise<void>;
    isImporting: boolean;
}

const templateHeaders = [
    'Mã NV', 'Họ tên', 'Email', 'SĐT', 'Ngày sinh (dd/mm/yyyy)', 'CCCD', 'Giới tính (male/female/other)',
    'Mã số thuế cá nhân', 'Mã số BHXH',
    'Địa chỉ', 'Đường', 'Phường/Xã', 'Quận/Huyện', 'Tỉnh/Thành phố',
    'Phòng ban', 'Chức vụ', 'Lương cơ bản', 'Hình thức (full_time_monthly/full_time_hourly/part_time/probation/intern)',
    'Trạng thái (active/probation/inactive)', 'Ngày vào (dd/mm/yyyy)',
    'Chi phí đồng phục', 'Ngày cấp ĐP', 'Hết hạn ĐP',
    'Người liên hệ khẩn cấp', 'SĐT khẩn cấp', 'Ghi chú'
];

const sampleData = [
    ['NV001', 'Nguyễn Văn A', 'nguyenvana@company.vn', '0901234567', '15/03/1990', '012345678901', 'male',
        '8012345678', '1234567890',
        '123 Nguyễn Huệ, Q1, TP.HCM', '123 Nguyễn Huệ', 'Phường Bến Nghé', 'Quận 1', 'TP.HCM',
        'Kỹ thuật', 'Senior Developer', '25000000', 'full_time_monthly', 'active', '01/01/2022',
        '500000', '01/01/2022', '01/01/2024', 'Nguyễn Văn B', '0909876543', 'Nhân viên xuất sắc'],
    ['NV002', 'Trần Thị B', 'tranthib@company.vn', '0912345678', '20/05/1995', '098765432101', 'female',
        '8098765432', '0987654321',
        '456 Lê Lợi, Q3, TP.HCM', '456 Lê Lợi', 'Phường 1', 'Quận 3', 'TP.HCM',
        'Nhân sự', 'HR Manager', '20000000', 'full_time_monthly', 'active', '15/06/2021',
        '500000', '15/06/2021', '15/06/2023', 'Trần Văn C', '0918765432', '']
];

type DuplicateInfo = {
    duplicates: DuplicateEmployee[];
    toImport: EmployeeInsert[];
    newEmployees: EmployeeInsert[];
};

export function ImportDropdown({ onImport, isImporting }: ImportDropdownProps) {
    const [isOpen, setIsOpen] = useState(false);
    const [isChecking, setIsChecking] = useState(false);
    const [duplicateInfo, setDuplicateInfo] = useState<DuplicateInfo | null>(null);
    const [showDuplicateModal, setShowDuplicateModal] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const downloadTemplate = () => {
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([templateHeaders, ...sampleData]), 'Nhân viên');
        XLSX.writeFile(wb, 'mau-nhap-nhan-vien.xlsx');
        setIsOpen(false);
    };

    const parseDate = (dateStr: string | undefined): string | undefined => {
        if (!dateStr) return undefined;
        const parts = dateStr.toString().split('/');
        if (parts.length === 3) {
            const [day, month, year] = parts;
            return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
        }
        if (dateStr.includes('-')) return dateStr;
        return undefined;
    };

    const parseEmployeesFromFile = async (file: File): Promise<EmployeeInsert[]> => {
        const data = await file.arrayBuffer();
        const workbook = XLSX.read(data);
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as (string | number | undefined)[][];

        const employeeRows = rows.slice(1);
        const employees: EmployeeInsert[] = [];

        for (const row of employeeRows) {
            if (!row[0] || !row[1]) continue;

            const employee: EmployeeInsert = {
                id: row[0]?.toString() || '',
                name: row[1]?.toString() || '',
                email: row[2]?.toString() || '',
                phone: row[3]?.toString() || '',
                date_of_birth: parseDate(row[4]?.toString()),
                identity_card: row[5]?.toString(),
                gender: (row[6]?.toString() as 'male' | 'female' | 'other') || 'male',
                tax_id: row[7]?.toString(),
                social_insurance_id: row[8]?.toString(),
                address: row[9]?.toString() || '',
                address_street: row[10]?.toString(),
                address_ward: row[11]?.toString(),
                address_district: row[12]?.toString(),
                address_city: row[13]?.toString(),
                department: row[14]?.toString() || 'Chưa phân bổ',
                position: row[15]?.toString() || 'Nhân viên',
                salary: parseFloat(row[16]?.toString() || '0') || undefined,
                employee_type: (row[17]?.toString() as 'full_time_monthly' | 'full_time_hourly' | 'part_time' | 'probation' | 'intern') || 'full_time_monthly',
                status: (row[18]?.toString() as 'active' | 'probation' | 'inactive') || 'active',
                join_date: parseDate(row[19]?.toString()) || new Date().toISOString().split('T')[0],
                uniform_cost: parseFloat(row[20]?.toString() || '0') || undefined,
                uniform_issue_date: parseDate(row[21]?.toString()),
                uniform_expiry_date: parseDate(row[22]?.toString()),
                emergency_contact_name: row[23]?.toString(),
                emergency_contact_phone: row[24]?.toString(),
                notes: row[25]?.toString(),
                avatar: row[1]?.toString().charAt(0).toUpperCase() || 'N',
            };
            employees.push(employee);
        }

        return employees;
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            setIsChecking(true);
            setIsOpen(false);

            // Parse employees from file
            const employees = await parseEmployeesFromFile(file);

            if (employees.length === 0) {
                toast.error('Không tìm thấy dữ liệu hợp lệ trong file.');
                return;
            }

            // Check for duplicate employees (by ID or CCCD)
            const employeesToCheck = employees.map(emp => ({
                id: emp.id,
                name: emp.name,
                identity_card: emp.identity_card ?? undefined
            }));
            const duplicates = await checkDuplicateEmployees(employeesToCheck);

            if (duplicates.length > 0) {
                // Has duplicates - show confirmation modal
                const duplicateIds = new Set(duplicates.map(d => d.id));
                const newEmployees = employees.filter(emp => !duplicateIds.has(emp.id));

                setDuplicateInfo({
                    duplicates: duplicates,
                    toImport: employees,
                    newEmployees: newEmployees
                });
                setShowDuplicateModal(true);
            } else {
                // No duplicates - import directly
                await onImport(employees);
                toast.success(`Đã nhập thành công ${employees.length} nhân viên!`);
            }
        } catch (err) {
            console.error('Import error:', err);
            toast.error('Lỗi khi đọc file', {
                description: 'Vui lòng kiểm tra định dạng file hoặc tải file mẫu.'
            });
        } finally {
            setIsChecking(false);
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    const handleImportNewOnly = async () => {
        if (!duplicateInfo) return;

        try {
            if (duplicateInfo.newEmployees.length > 0) {
                await onImport(duplicateInfo.newEmployees);
                toast.success(`Đã nhập ${duplicateInfo.newEmployees.length} nhân viên mới!`, {
                    description: `${duplicateInfo.duplicates.length} nhân viên trùng đã được bỏ qua.`
                });
            } else {
                toast.warning('Không có nhân viên mới nào để nhập', {
                    description: 'Tất cả đều đã tồn tại trong hệ thống.'
                });
            }
        } catch (err: unknown) {
            console.error('Import error:', err);
            const errorMsg = err instanceof Error ? err.message : 'Lỗi không xác định';
            toast.error('Lỗi khi nhập dữ liệu', {
                description: errorMsg
            });
        } finally {
            setShowDuplicateModal(false);
            setDuplicateInfo(null);
        }
    };

    const handleCancelImport = () => {
        setShowDuplicateModal(false);
        setDuplicateInfo(null);
    };

    return (
        <>
            <div className="relative">
                <input
                    type="file"
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                />
                <button
                    onClick={() => setIsOpen(!isOpen)}
                    disabled={isImporting || isChecking}
                    className="inline-flex items-center gap-2 px-4 py-3 text-sm text-slate-600 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 hover:border-slate-300 transition-all disabled:opacity-50"
                >
                    {(isImporting || isChecking) ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                    {isChecking ? 'Đang kiểm tra...' : 'Nhập dữ liệu'}
                </button>
                {isOpen && (
                    <>
                        <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />
                        <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-lg border border-slate-200 z-20 py-2 animate-scale-in">
                            <button
                                onClick={downloadTemplate}
                                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                            >
                                <FileDown className="w-4 h-4 text-blue-600" />
                                Tải mẫu Excel
                            </button>
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
                            >
                                <Upload className="w-4 h-4 text-green-600" />
                                Nhập từ Excel
                            </button>
                        </div>
                    </>
                )}
            </div>

            {/* Duplicate Warning Modal */}
            {showDuplicateModal && duplicateInfo && (
                <>
                    <div
                        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50"
                        onClick={handleCancelImport}
                    />
                    <div className="fixed inset-x-4 top-1/2 -translate-y-1/2 md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:w-full md:max-w-lg bg-white rounded-2xl shadow-2xl z-50 overflow-hidden">
                        {/* Header */}
                        <div className="flex items-center gap-3 p-4 border-b border-slate-100 bg-amber-50">
                            <div className="p-2 bg-amber-100 rounded-lg">
                                <AlertTriangle className="w-5 h-5 text-amber-600" />
                            </div>
                            <div className="flex-1">
                                <h3 className="font-semibold text-slate-900">Phát hiện nhân viên trùng</h3>
                                <p className="text-sm text-slate-500">
                                    {duplicateInfo.duplicates.length} nhân viên đã tồn tại trong hệ thống
                                </p>
                            </div>
                            <button
                                onClick={handleCancelImport}
                                className="p-2 hover:bg-amber-100 rounded-lg transition-colors"
                            >
                                <X className="w-5 h-5 text-slate-500" />
                            </button>
                        </div>

                        {/* Content */}
                        <div className="p-4 max-h-64 overflow-y-auto">
                            <p className="text-sm text-slate-600 mb-3">
                                Các nhân viên sau ĐÃ TỒN TẠI và sẽ <strong>không được nhập</strong> để tránh ghi đè dữ liệu:
                            </p>
                            <div className="space-y-2">
                                {duplicateInfo.duplicates.map((dup) => (
                                    <div key={dup.id} className="flex items-center gap-3 p-2 bg-red-50 rounded-lg border border-red-100">
                                        <div className="w-8 h-8 bg-red-200 rounded-full flex items-center justify-center text-red-700 font-semibold text-sm">
                                            {dup.name.charAt(0)}
                                        </div>
                                        <div className="flex-1">
                                            <p className="text-sm font-medium text-slate-900">
                                                {dup.id} - {dup.name}
                                            </p>
                                            <p className="text-xs text-slate-500">
                                                Trùng: {dup.reason === 'id' ? 'Mã NV' : 'CCCD'}
                                                {dup.existingId && ` (đã có: ${dup.existingId} - ${dup.existingName})`}
                                            </p>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            {duplicateInfo.newEmployees.length > 0 && (
                                <div className="mt-4 p-3 bg-green-50 rounded-lg border border-green-100">
                                    <p className="text-sm text-green-700">
                                        <Check className="w-4 h-4 inline mr-1" />
                                        <strong>{duplicateInfo.newEmployees.length}</strong> nhân viên mới sẽ được nhập
                                    </p>
                                </div>
                            )}
                        </div>

                        {/* Footer */}
                        <div className="flex gap-3 p-4 border-t border-slate-100 bg-slate-50">
                            <button
                                onClick={handleCancelImport}
                                className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                            >
                                Hủy bỏ
                            </button>
                            <button
                                onClick={handleImportNewOnly}
                                disabled={isImporting || duplicateInfo.newEmployees.length === 0}
                                className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isImporting ? (
                                    <Loader2 className="w-4 h-4 animate-spin mx-auto" />
                                ) : duplicateInfo.newEmployees.length > 0 ? (
                                    `Nhập ${duplicateInfo.newEmployees.length} NV mới`
                                ) : (
                                    'Không có NV mới'
                                )}
                            </button>
                        </div>
                    </div>
                </>
            )}
        </>
    );
}
