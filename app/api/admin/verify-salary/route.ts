
import { NextResponse } from 'next/server';
import { calculateEmployeePayroll } from '@/lib/api/payroll-calculation';
import { supabase } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

export async function GET() {
    try {
        const targetName = 'Nguyễn Thị Huyền Trang';
        const month = '2026-01'; // Target month from screenshot

        // Find employee
        const { data: employees } = await supabase
            .from('employees')
            .select('*')
            .ilike('name', `%${targetName}%`);

        if (!employees || employees.length === 0) {
            return NextResponse.json({ message: 'Employee not found' });
        }

        const employee = employees[0];
        console.log(`Analyzing for ${employee.name} (${employee.id})`);

        // Get raw attendance for debugging
        const startDate = `${month}-01`;
        const endDate = `${month}-31`;

        const { data: attendance } = await supabase
            .from('attendance_records')
            .select('*')
            .eq('employee_id', employee.id)
            .gte('date', startDate)
            .lte('date', endDate);

        // Get raw leaves
        const { data: leaves } = await supabase
            .from('leave_requests')
            .select('*, leave_types(*)')
            .eq('employee_id', employee.id)
            .eq('status', 'approved')
            .gte('start_date', startDate)
            .lte('end_date', endDate);

        // Run calculation
        const result = await calculateEmployeePayroll(employee.id, month);

        return NextResponse.json({
            employee: employee.name,
            rawAttendanceCount: attendance?.length,
            rawAttendance: attendance,
            rawLeaveCount: leaves?.length,
            rawLeaves: leaves,
            calcResult: {
                standardWorkDays: result.standardWorkDays,
                actualWorkDays: result.actualWorkDays,
                paidLeaveDays: result.paidLeaveDays,
                totalWorkDays: result.totalWorkDays
            }
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
        return NextResponse.json({ success: false, error: error.message, stack: error.stack }, { status: 500 });
    }
}
