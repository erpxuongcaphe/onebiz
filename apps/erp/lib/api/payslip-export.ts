// Payslip Export API
// Functions for exporting payslips in PDF (HTML-based) and Excel formats

import { supabase } from '../supabase';
import { MonthlySalary, MonthlySalaryWithEmployee } from './monthly-salaries';
import * as XLSX from 'xlsx';

interface PayslipData {
    employee: {
        id: string;
        name: string;
        department: string | null;
        position: string | null;
        tax_code: string | null;
        insurance_number: string | null;
    };
    payslip: {
        payslipNumber: string;
        month: string;
        baseSalary: number;
        workDays: number;
        otHours: number;
        lunchAllowance: number;
        transportAllowance: number;
        phoneAllowance: number;
        otherAllowance: number;
        kpiBonus: number;
        bonus: number;
        penalty: number;
        grossSalary: number;
        insuranceDeduction: number;
        pitDeduction: number;
        netSalary: number;
        finalizedAt: string | null;
        finalizedByName: string | null;
        standardWorkDays: number;
        actualWorkDays: number;
        paidLeaveDays: number;
        salaryBasedOnWorkDays: number;
    };
    template: {
        companyName: string;
        companyAddress: string | null;
        companyPhone: string | null;
        companyEmail: string | null;
        companyTaxCode: string | null;
        headerText: string | null;
        footerText: string | null;
    };
}

/**
 * Get payslip data for export
 */
async function getPayslipData(employeeId: string, month: string): Promise<PayslipData> {
    const { data: salary, error: salaryError } = await supabase
        .from('monthly_salaries')
        .select(`
            *,
            employee:employees(id, name, department, position, tax_code, insurance_number)
        `)
        .eq('employee_id', employeeId)
        .eq('month', month)
        .single();

    if (salaryError || !salary) {
        throw new Error(`Payslip not found for employee ${employeeId} in ${month}`);
    }



    // Get template
    let template;
    if (salary.branch_id) {
        const { data: branchTemplate } = await supabase
            .from('payslip_templates')
            .select('*')
            .eq('branch_id', salary.branch_id)
            .single();
        template = branchTemplate;
    }

    if (!template) {
        const { data: defaultTemplate } = await supabase
            .from('payslip_templates')
            .select('*')
            .eq('is_default', true)
            .single();
        template = defaultTemplate;
    }

    if (!template) {
        template = {
            company_name: 'Công ty TNHH HRM',
            company_address: null,
            company_phone: null,
            company_email: null,
            company_tax_code: null,
            header_text: null,
            footer_text: null
        };
    }

    // Use kpi_bonus (new column) if available, otherwise fallback to legacy calculation
    const kpiBonus = salary.kpi_bonus ?? ((salary.kpi_target || 0) * ((salary.kpi_percent || 100) / 100));

    const empData = (salary as unknown as MonthlySalaryWithEmployee).employee;

    return {
        employee: {
            id: empData?.id || '',
            name: empData?.name || 'N/A',
            department: empData?.department || null,
            position: empData?.position || null,
            tax_code: empData?.tax_code ?? null,
            insurance_number: empData?.insurance_number ?? null
        },
        payslip: {
            payslipNumber: (salary as unknown as MonthlySalary).payslip_number || 'N/A',
            month: salary.month,
            baseSalary: salary.base_salary || 0,
            workDays: salary.work_days || 0,
            otHours: salary.ot_hours || 0,
            lunchAllowance: salary.lunch_allowance || 0, // Now stored as TOTAL
            transportAllowance: salary.transport_allowance || 0,
            phoneAllowance: salary.phone_allowance || 0,
            otherAllowance: salary.other_allowance || 0,
            kpiBonus,
            bonus: salary.bonus || 0,
            penalty: salary.penalty || 0,
            grossSalary: salary.gross_salary || 0,
            insuranceDeduction: salary.insurance_deduction || 0,
            pitDeduction: salary.pit_deduction || 0,
            netSalary: salary.net_salary || 0,
            finalizedAt: salary.finalized_at,
            finalizedByName: (salary as unknown as MonthlySalary).finalized_by_name || null,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            standardWorkDays: (salary as any).standard_work_days || 26,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            actualWorkDays: (salary as any).actual_work_days || (salary.work_days || 0),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            paidLeaveDays: (salary as any).paid_leave_days || 0,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            salaryBasedOnWorkDays: (salary.base_salary || 0) / ((salary as any).standard_work_days || 26) * (salary.work_days || 0)
        },
        template: {
            companyName: template.company_name,
            companyAddress: template.company_address,
            companyPhone: template.company_phone,
            companyEmail: template.company_email,
            companyTaxCode: template.company_tax_code,
            headerText: template.header_text,
            footerText: template.footer_text
        }
    };
}

/**
 * Format currency for display
 */
function formatCurrency(value: number): string {
    return new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND' }).format(value);
}

/**
 * Format month display
 */
function formatMonth(month: string): string {
    const [year, monthNum] = month.split('-');
    return `Tháng ${monthNum}/${year}`;
}

/**
 * Generate HTML payslip with full Vietnamese support
 * Returns HTML string that can be printed or converted to PDF
 */
export async function generatePayslipHTML(employeeId: string, month: string): Promise<string> {
    const data = await getPayslipData(employeeId, month);

    // Calculate OT pay properly: hourly rate * 1.5 * OT hours
    // Hourly rate = Base salary / standard days / 8 hours
    const hourlyRate = data.payslip.baseSalary / data.payslip.standardWorkDays / 8;
    const otPay = data.payslip.otHours * hourlyRate * 1.5;


    return `<!DOCTYPE html>
<html lang="vi">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Phiếu lương - ${data.employee.name} - ${formatMonth(data.payslip.month)}</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap');
        
        @media print {
            body { margin: 0; }
            @page { margin: 1cm; }
        }
        
        * { margin: 0; padding: 0; box-sizing: border-box; }
        
        body {
            font-family: 'Roboto', Arial, sans-serif;
            padding: 40px;
            color: #1e293b;
            line-height: 1.6;
            max-width: 210mm;
            margin: 0 auto;
        }
        
        .header {
            text-align: center;
            margin-bottom: 30px;
            border-bottom: 3px solid #3b82f6;
            padding-bottom: 20px;
        }
        
        .company-name {
            font-size: 20px;
            font-weight: 700;
            color: #1e40af;
            margin-bottom: 5px;
        }
        
        .company-info {
            font-size: 11px;
            color: #64748b;
            margin-bottom: 3px;
        }
        
        .title {
            font-size: 24px;
            font-weight: 700;
            color: #0f172a;
            margin: 15px 0 5px 0;
        }
        
        .month {
            font-size: 16px;
            color: #475569;
            font-weight: 500;
        }
        
        .employee-info {
            background: #f8fafc;
            padding: 15px;
            border-radius: 8px;
            margin-bottom: 25px;
            border-left: 4px solid #3b82f6;
        }
        
        .info-row {
            display: flex;
            margin-bottom: 8px;
            font-size: 13px;
        }
        
        .info-label {
            font-weight: 600;
            min-width: 180px;
            color: #475569;
        }
        
        .info-value {
            color: #0f172a;
        }
        
        .section-title {
            font-size: 16px;
            font-weight: 700;
            color: #1e40af;
            margin: 20px 0 15px 0;
            padding-bottom: 8px;
            border-bottom: 2px solid #e2e8f0;
        }
        
        .salary-table {
            width: 100%;
            margin-bottom: 20px;
        }
        
        .salary-row {
            display: flex;
            justify-content: space-between;
            padding: 10px 0;
            border-bottom: 1px solid #f1f5f9;
            font-size: 13px;
        }
        
        .salary-row.indent {
            padding-left: 20px;
        }
        
        .salary-row.total {
            background: #eff6ff;
            padding: 12px 10px;
            font-weight: 700;
            font-size: 14px;
            border: none;
            margin-top: 5px;
        }
        
        .salary-row.grand-total {
            background: #dbeafe;
            padding: 15px 10px;
            font-weight: 700;
            font-size: 16px;
            color: #1e40af;
            border: 2px solid #3b82f6;
            margin-top: 10px;
        }
        
        .amount {
            font-weight: 600;
            font-family: 'Courier New', monospace;
        }
        
        .amount.positive { color: #059669; }
        .amount.negative { color: #dc2626; }
        
        .footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #e2e8f0;
        }
        
        .signatures {
            display: flex;
            justify-content: space-around;
            margin-top: 30px;
        }
        
        .signature {
            text-align: center;
            flex: 1;
        }
        
        .signature-label {
            font-weight: 600;
            font-size: 13px;
            margin-bottom: 50px;
        }
        
        .signature-name {
            font-weight: 500;
            font-size: 12px;
            margin-top: 10px;
        }
        
        .note {
            font-size: 11px;
            color: #64748b;
            font-style: italic;
            text-align: center;
            margin-top: 20px;
        }
        
        .no-print {
            margin: 20px 0;
            text-align: center;
        }
        
        .no-print button {
            background: #3b82f6;
            color: white;
            border: none;
            padding: 12px 24px;
            border-radius: 8px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
            margin: 0 8px;
        }
        
        .no-print button:hover {
            background: #2563eb;
        }
        
        @media print {
            .no-print { display: none; }
        }
    </style>
</head>
<body>
    <div class="no-print">
        <button onclick="window.print()">🖨️ In phiếu lương</button>
        <button onclick="window.close()">❌ Đóng</button>
    </div>

    <div class="header">
        <div class="company-name">${data.template.companyName}</div>
        ${data.template.companyAddress ? `<div class="company-info">${data.template.companyAddress}</div>` : ''}
        ${data.template.companyPhone ? `<div class="company-info">ĐT: ${data.template.companyPhone}</div>` : ''}
        ${data.template.companyTaxCode ? `<div class="company-info">MST: ${data.template.companyTaxCode}</div>` : ''}
        <div class="title">PHIẾU LƯƠNG</div>
        <div class="month">${formatMonth(data.payslip.month)}</div>
    </div>
    
    <div class="employee-info">
        <div class="info-row">
            <span class="info-label">Mã phiếu lương:</span>
            <span class="info-value">${data.payslip.payslipNumber}</span>
        </div>
        <div class="info-row">
            <span class="info-label">Họ và tên:</span>
            <span class="info-value">${data.employee.name}</span>
        </div>
        <div class="info-row">
            <span class="info-label">Phòng ban:</span>
            <span class="info-value">${data.employee.department || 'N/A'}</span>
        </div>
        <div class="info-row">
            <span class="info-label">Chức vụ:</span>
            <span class="info-value">${data.employee.position || 'N/A'}</span>
        </div>
        <div class="info-row">
            <span class="info-label">Mã số thuế:</span>
            <span class="info-value">${data.employee.tax_code || 'N/A'}</span>
        </div>
        <div class="info-row">
            <span class="info-label">Mã BHXH:</span>
            <span class="info-value">${data.employee.insurance_number || 'N/A'}</span>
        </div>
    </div>
    
    <div class="section-title">THÔNG TIN LƯƠNG</div>
    
    <div class="salary-table">
        <div class="salary-row">
            <span><strong>THU NHẬP</strong></span>
            <span></span>
        </div>
        <div class="salary-row indent">
            <span>Lương cơ bản (đủ tháng)</span>
            <span class="amount">${formatCurrency(data.payslip.baseSalary)}</span>
        </div>
        <div class="salary-row indent">
            <span>Ngày làm việc thực tế</span>
            <span>${data.payslip.actualWorkDays} ngày + ${data.payslip.paidLeaveDays} phép</span>
        </div>
        <div class="salary-row indent">
            <span>Lương thực nhận (đã tính nghỉ không lương)</span>
            <span class="amount">${formatCurrency(data.payslip.salaryBasedOnWorkDays)}</span>
        </div>
        <div class="salary-row indent">
            <span>Hỗ trợ cơm trưa (${data.payslip.actualWorkDays} ngày)</span>
            <span class="amount">${formatCurrency(data.payslip.lunchAllowance)}</span>
        </div>
        <div class="salary-row indent">
            <span>Hỗ trợ xăng xe</span>
            <span class="amount">${formatCurrency(data.payslip.transportAllowance)}</span>
        </div>
        <div class="salary-row indent">
            <span>Hỗ trợ điện thoại</span>
            <span class="amount">${formatCurrency(data.payslip.phoneAllowance)}</span>
        </div>
        <div class="salary-row indent">
            <span>Hỗ trợ khác</span>
            <span class="amount">${formatCurrency(data.payslip.otherAllowance)}</span>
        </div>
        <div class="salary-row indent">
            <span>Thưởng KPI</span>
            <span class="amount">${formatCurrency(data.payslip.kpiBonus)}</span>
        </div>
        <div class="salary-row indent">
            <span>Làm thêm giờ (${data.payslip.otHours.toFixed(1)} giờ)</span>
            <span class="amount">${formatCurrency(otPay)}</span>
        </div>
        <div class="salary-row indent">
            <span>Thưởng khác</span>
            <span class="amount positive">${formatCurrency(data.payslip.bonus)}</span>
        </div>
        ${data.payslip.penalty > 0 ? `
        <div class="salary-row indent">
            <span>Phạt</span>
            <span class="amount negative">-${formatCurrency(data.payslip.penalty)}</span>
        </div>
        ` : ''}
        
        <div class="salary-row total">
            <span>TỔNG THU NHẬP (Gross):</span>
            <span class="amount">${formatCurrency(data.payslip.grossSalary)}</span>
        </div>
    </div>
    
    <div class="salary-table">
        <div class="salary-row">
            <span><strong>CÁC KHOẢN TRỪ</strong></span>
            <span></span>
        </div>
        <div class="salary-row indent">
            <span>Bảo hiểm xã hội</span>
            <span class="amount negative">-${formatCurrency(data.payslip.insuranceDeduction)}</span>
        </div>
        <div class="salary-row indent">
            <span>Thuế thu nhập cá nhân</span>
            <span class="amount negative">-${formatCurrency(data.payslip.pitDeduction)}</span>
        </div>
        
        <div class="salary-row grand-total">
            <span>LƯƠNG THỰC NHẬN (Net):</span>
            <span class="amount">${formatCurrency(data.payslip.netSalary)}</span>
        </div>
    </div>
    
    <div class="footer">
        ${data.template.footerText ? `<div class="note">${data.template.footerText}</div>` : ''}
        
        <div class="signatures">
            <div class="signature">
                <div class="signature-label">Người lập phiếu</div>
                ${data.payslip.finalizedByName ? `<div class="signature-name">${data.payslip.finalizedByName}</div>` : ''}
            </div>
            <div class="signature">
                <div class="signature-label">Nhân viên</div>
            </div>
            <div class="signature">
                <div class="signature-label">Kế toán trưởng</div>
            </div>
        </div>
    </div>
</body>
</html>`;
}

/**
 * Export payslip as PDF (opens in new window for printing)
 * This provides perfect Vietnamese support using browser's native PDF generation
 */
export async function exportPayslipPDF(employeeId: string, month: string): Promise<string> {
    const html = await generatePayslipHTML(employeeId, month);

    // Track export
    await trackPayslipExport(employeeId, month);

    return html;
}

/**
 * Export payroll to Excel
 */
export async function exportPayrollExcel(month: string, branchId?: string): Promise<Blob> {
    let query = supabase
        .from('monthly_salaries')
        .select(`
            *,
            employee:employees(id, name, department, position, tax_code, insurance_number)
        `)
        .eq('month', month);

    if (branchId) {
        query = query.eq('branch_id', branchId);
    }

    const { data: salaries, error } = await query;
    if (error) throw error;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const excelData = (salaries || []).map((s: any) => {
        const kpiBonus = (s.kpi_target || 0) * ((s.kpi_percent || 100) / 100);
        return {
            'Mã NV': s.employee.id,
            'Họ tên': s.employee.name,
            'Phòng ban': s.employee.department || '',
            'Chức vụ': s.employee.position || '',
            'Lương CB': s.base_salary || 0,
            'Ngày công': s.work_days || 0,
            'Giờ OT': s.ot_hours || 0,
            'Hỗ trợ cơm': s.lunch_allowance || 0,
            'Hỗ trợ xăng': s.transport_allowance || 0,
            'Hỗ trợ ĐT': s.phone_allowance || 0,
            'Hỗ trợ khác': s.other_allowance || 0,
            'Thưởng KPI': kpiBonus,
            'Thưởng': s.bonus || 0,
            'Phạt': s.penalty || 0,
            'Tổng thu nhập': s.gross_salary || 0,
            'BHXH': s.insurance_deduction || 0,
            'Thuế TNCN': s.pit_deduction || 0,
            'Thực nhận': s.net_salary || 0,
            'Mã phiếu lương': s.payslip_number || '',
            'Trạng thái': s.is_finalized ? 'Đã chốt' : 'Nháp'
        };
    });

    const ws = XLSX.utils.json_to_sheet(excelData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `Luong_${month}`);

    const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/**
 * Export attendance to Excel for a given date range
 * @param startDate - Start date (YYYY-MM-DD)
 * @param endDate - End date (YYYY-MM-DD)
 * @param branchId - Optional branch filter
 */
export async function exportAttendanceExcel(startDate: string, endDate: string, branchId?: string): Promise<Blob> {
    // Get attendance records
    let query = supabase
        .from('attendance')
        .select(`
            *,
            employee:employees(id, name, department, position)
        `)
        .gte('check_in', startDate)
        .lte('check_in', `${endDate}T23:59:59`);

    if (branchId) {
        query = query.eq('branch_id', branchId);
    }

    const { data: records, error } = await query.order('check_in', { ascending: true });
    if (error) throw error;

    // Group by employee and calculate summary
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const employeeMap = new Map<string, any>();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (records || []).forEach((r: any) => {
        const empId = r.employee?.id || r.employee_id;
        if (!employeeMap.has(empId)) {
            employeeMap.set(empId, {
                employee: r.employee,
                records: [],
                totalHours: 0,
                otHours: 0,
                workDays: new Set<string>(),
                lateDays: 0,
                onTimeDays: 0
            });
        }
        const emp = employeeMap.get(empId);
        emp.records.push(r);
        emp.totalHours += r.hours_worked || 0;
        emp.otHours += r.overtime_hours || 0;
        if (r.check_in) {
            emp.workDays.add(r.check_in.split('T')[0]);
        }
        if (r.status === 'late') emp.lateDays++;
        if (r.status === 'ontime') emp.onTimeDays++;
    });

    // Create summary sheet
    const summaryData = Array.from(employeeMap.values()).map(emp => ({
        'Mã NV': emp.employee?.id || 'N/A',
        'Họ tên': emp.employee?.name || 'N/A',
        'Phòng ban': emp.employee?.department || '',
        'Chức vụ': emp.employee?.position || '',
        'Số ngày công': emp.workDays.size,
        'Tổng giờ làm': Math.round(emp.totalHours * 10) / 10,
        'Giờ OT': Math.round(emp.otHours * 10) / 10,
        'Ngày đúng giờ': emp.onTimeDays,
        'Ngày đi muộn': emp.lateDays
    }));

    // Create detail sheet
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const detailData = (records || []).map((r: any) => ({
        'Ngày': r.check_in ? new Date(r.check_in).toLocaleDateString('vi-VN') : '',
        'Mã NV': r.employee?.id || r.employee_id,
        'Họ tên': r.employee?.name || 'N/A',
        'Check-in': r.check_in ? new Date(r.check_in).toLocaleTimeString('vi-VN') : '',
        'Check-out': r.check_out ? new Date(r.check_out).toLocaleTimeString('vi-VN') : '',
        'Số giờ': r.hours_worked || 0,
        'Giờ OT': r.overtime_hours || 0,
        'Trạng thái': r.status === 'ontime' ? 'Đúng giờ' : r.status === 'late' ? 'Đi muộn' : r.status
    }));

    const wb = XLSX.utils.book_new();

    // Summary sheet
    const wsSummary = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, wsSummary, 'Tổng hợp');

    // Detail sheet
    const wsDetail = XLSX.utils.json_to_sheet(detailData);
    XLSX.utils.book_append_sheet(wb, wsDetail, 'Chi tiết');

    const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/**
 * Export department summary to Excel for a given date range
 * @param startDate - Start date (YYYY-MM-DD) - uses month of this date
 * @param endDate - End date (YYYY-MM-DD) - uses month of this date  
 */
export async function exportDepartmentSummaryExcel(startMonth: string, endMonth?: string): Promise<Blob> {
    // Build query for date range
    let query = supabase
        .from('monthly_salaries')
        .select(`
            *,
            employee:employees(id, name, department, position)
        `)
        .gte('month', startMonth);

    if (endMonth) {
        query = query.lte('month', endMonth);
    } else {
        query = query.eq('month', startMonth);
    }

    const { data: salaries, error } = await query;
    if (error) throw error;

    // Group by department
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const deptMap = new Map<string, any>();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (salaries || []).forEach((s: any) => {
        const dept = s.employee?.department || 'Không xác định';
        if (!deptMap.has(dept)) {
            deptMap.set(dept, {
                department: dept,
                employeeCount: 0,
                employeeIds: new Set<string>(),
                totalBaseSalary: 0,
                totalGrossSalary: 0,
                totalNetSalary: 0,
                totalWorkDays: 0,
                totalOTHours: 0,
                totalBonus: 0,
                totalPenalty: 0,
                totalInsurance: 0,
                totalTax: 0
            });
        }
        const d = deptMap.get(dept);
        d.employeeIds.add(s.employee_id);
        d.totalBaseSalary += s.base_salary || 0;
        d.totalGrossSalary += s.gross_salary || 0;
        d.totalNetSalary += s.net_salary || 0;
        d.totalWorkDays += s.work_days || 0;
        d.totalOTHours += s.ot_hours || 0;
        d.totalBonus += s.bonus || 0;
        d.totalPenalty += s.penalty || 0;
        d.totalInsurance += s.insurance_deduction || 0;
        d.totalTax += s.pit_deduction || 0;
    });

    // Create summary data
    const summaryData = Array.from(deptMap.values()).map(d => ({
        'Phòng ban': d.department,
        'Số nhân viên': d.employeeIds.size,
        'Tổng lương CB': d.totalBaseSalary,
        'Tổng lương Gross': d.totalGrossSalary,
        'Tổng lương Net': d.totalNetSalary,
        'Tổng ngày công': d.totalWorkDays,
        'Tổng giờ OT': Math.round(d.totalOTHours * 10) / 10,
        'Tổng thưởng': d.totalBonus,
        'Tổng phạt': d.totalPenalty,
        'Tổng BHXH': d.totalInsurance,
        'Tổng thuế': d.totalTax
    }));

    // Add total row
    const totals = {
        'Phòng ban': 'TỔNG CỘNG',
        'Số nhân viên': summaryData.reduce((sum, d) => sum + d['Số nhân viên'], 0),
        'Tổng lương CB': summaryData.reduce((sum, d) => sum + d['Tổng lương CB'], 0),
        'Tổng lương Gross': summaryData.reduce((sum, d) => sum + d['Tổng lương Gross'], 0),
        'Tổng lương Net': summaryData.reduce((sum, d) => sum + d['Tổng lương Net'], 0),
        'Tổng ngày công': summaryData.reduce((sum, d) => sum + d['Tổng ngày công'], 0),
        'Tổng giờ OT': summaryData.reduce((sum, d) => sum + d['Tổng giờ OT'], 0),
        'Tổng thưởng': summaryData.reduce((sum, d) => sum + d['Tổng thưởng'], 0),
        'Tổng phạt': summaryData.reduce((sum, d) => sum + d['Tổng phạt'], 0),
        'Tổng BHXH': summaryData.reduce((sum, d) => sum + d['Tổng BHXH'], 0),
        'Tổng thuế': summaryData.reduce((sum, d) => sum + d['Tổng thuế'], 0)
    };
    summaryData.push(totals);

    const periodLabel = endMonth ? `${startMonth}_to_${endMonth}` : startMonth;
    const ws = XLSX.utils.json_to_sheet(summaryData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, `PB_${periodLabel.replace(/-/g, '')}`);

    const excelBuffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    return new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

/**
 * Track payslip export (increment counter)
 * Note: This requires the migration to add exported_count and last_exported_at fields
 */
async function trackPayslipExport(employeeId: string, month: string): Promise<void> {
    try {
        const { data: current } = await supabase
            .from('monthly_salaries')
            .select('id')
            .eq('employee_id', employeeId)
            .eq('month', month)
            .single();

        if (current) {
            // Note: exported_count field will be available after running the migration
            // For now, this is a placeholder
            console.log(`Tracked export for employee ${employeeId}, month ${month}`);
        }
    } catch (err) {
        console.error('Failed to track export:', err);
    }
}

/**
 * Download file helper
 */
export function downloadBlob(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
}

/**
 * Open payslip in new window for printing/saving as PDF
 */
export function openPayslipForPrint(html: string): void {
    const printWindow = window.open('', '_blank');
    if (printWindow) {
        printWindow.document.write(html);
        printWindow.document.close();
    }
}
