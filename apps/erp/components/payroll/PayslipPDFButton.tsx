"use client";

import { useState } from "react";
import { Download, FileText, Loader2 } from "lucide-react";
import { exportPayslipPDF, openPayslipForPrint } from "@/lib/api/payslip-export";

interface PayslipPDFButtonProps {
    employeeId: string;
    month: string;
    variant?: "default" | "icon";
}

export default function PayslipPDFButton({ employeeId, month, variant = "default" }: PayslipPDFButtonProps) {
    const [isExporting, setIsExporting] = useState(false);

    const handleExport = async () => {
        setIsExporting(true);
        try {
            const html = await exportPayslipPDF(employeeId, month);
            openPayslipForPrint(html);
        } catch (err) {
            console.error('Failed to export payslip:', err);
            const errorMessage = (err as Error).message;
            if (errorMessage.includes('Payslip not found')) {
                alert('Phiếu lương chưa được lưu. Vui lòng nhấn nút "Lưu" để lưu dữ liệu bảng lương trước khi xuất PDF.');
            } else {
                alert('Lỗi khi xuất phiếu lương: ' + errorMessage);
            }
        } finally {
            setIsExporting(false);
        }
    };

    if (variant === "icon") {
        return (
            <button
                onClick={handleExport}
                disabled={isExporting}
                className="p-1.5 hover:bg-blue-100 rounded-lg text-blue-600 transition-colors disabled:opacity-50"
                title="Xuất PDF"
            >
                {isExporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
            </button>
        );
    }

    return (
        <button
            onClick={handleExport}
            disabled={isExporting}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
            {isExporting ? (
                <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Đang xuất...
                </>
            ) : (
                <>
                    <Download className="w-4 h-4" />
                    Xuất phiếu lương PDF
                </>
            )}
        </button>
    );
}
