"use client";

import { useCallback, useEffect, useState } from "react";
import { ReportPageHeader } from "@/components/shared/report";
import { SummaryCard } from "@/components/shared/summary-card";
import { Icon } from "@/components/ui/icon";
import { useBranchFilter, useToast } from "@/lib/contexts";
import { formatCurrency, formatNumber } from "@/lib/format";
import { useReportState } from "@/lib/hooks/use-report-state";
import {
  getNvlConsumptionByBranch,
  type NvlConsumptionRow,
} from "@/lib/services";
import {
  buildReportTitleRows,
  exportReportToExcel,
  type ExcelSheet,
} from "@/lib/utils/excel-export";

export default function TieuHaoNvlPage() {
  const { toast } = useToast();
  const { activeBranchId, branchLabel, isReady } = useBranchFilter();
  const { preset, range, setPreset, setCustomRange } = useReportState({
    defaultPreset: "thisMonth",
    defaultViewMode: "table",
    forceTable: true,
  });
  const [rows, setRows] = useState<NvlConsumptionRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!isReady) return;
    setLoading(true);
    try {
      const data = await getNvlConsumptionByBranch({
        fromDate: range.from,
        toDate: range.to,
        branchId: activeBranchId,
      });
      setRows(data);
    } catch (err) {
      setRows([]);
      toast({
        variant: "error",
        title: "Không tải được báo cáo",
        description: err instanceof Error ? err.message : "Lỗi không xác định",
      });
    } finally {
      setLoading(false);
    }
  }, [activeBranchId, isReady, range.from, range.to, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const totalCost = rows.reduce((sum, row) => sum + row.totalCost, 0);
  const movementCount = rows.reduce((sum, row) => sum + row.movementCount, 0);
  const uniqueBranches = new Set(rows.map((row) => row.branchId)).size;
  const uniqueMaterials = new Set(rows.map((row) => row.materialId)).size;

  const detailSheet = useCallback((): ExcelSheet => ({
    name: "Chi tiết tiêu hao",
    titleRows: buildReportTitleRows({
      title: "BÁO CÁO TIÊU HAO NGUYÊN VẬT LIỆU",
      range,
      branchName: branchLabel,
    }),
    columns: [
      { label: "Chi nhánh", key: "branchName", width: 24 },
      { label: "Mã NVL", key: "materialCode", width: 14 },
      { label: "Tên NVL", key: "materialName", width: 30 },
      { label: "Số lượng", key: "totalQty", width: 14, format: "number" },
      { label: "ĐVT", key: "unit", width: 10 },
      { label: "Số lượt", key: "movementCount", width: 12, format: "number" },
      { label: "Thành tiền", key: "totalCost", width: 18, format: "currency" },
    ],
    rows: rows.map((row) => ({
      branchName: row.branchName,
      materialCode: row.materialCode,
      materialName: row.materialName,
      totalQty: row.totalQty,
      unit: row.unit,
      movementCount: row.movementCount,
      totalCost: row.totalCost,
    })),
    footer: {
      branchName: "TỔNG",
      materialCode: "",
      materialName: `${uniqueMaterials} nguyên vật liệu`,
      totalQty: "",
      unit: "",
      movementCount,
      totalCost,
    },
  }), [branchLabel, movementCount, range, rows, totalCost, uniqueMaterials]);

  const handleExport = useCallback(async (mode: "view" | "full") => {
    try {
      const sheets: ExcelSheet[] = [];
      if (mode === "full") {
        sheets.push({
          name: "Tổng hợp",
          titleRows: buildReportTitleRows({
            title: "TỔNG HỢP TIÊU HAO NGUYÊN VẬT LIỆU",
            range,
            branchName: branchLabel,
          }),
          columns: [
            { label: "Chỉ tiêu", key: "metric", width: 30 },
            { label: "Giá trị", key: "value", width: 22, format: "number" },
          ],
          rows: [
            { metric: "Số lượt tiêu hao", value: movementCount },
            { metric: "Số loại nguyên vật liệu", value: uniqueMaterials },
            { metric: "Số chi nhánh có phát sinh", value: uniqueBranches },
            { metric: "Tổng giá trị tiêu hao", value: totalCost },
          ],
        });
      }
      sheets.push(detailSheet());
      await exportReportToExcel({
        kind: "tieu-hao-nvl",
        mode,
        range,
        branchName: branchLabel,
        reportTitle: "Báo cáo tiêu hao nguyên vật liệu",
        description: "Tổng hợp các phát sinh xuất kho loại bom_consume theo chi nhánh và nguyên vật liệu.",
        sheets,
      });
      toast({ title: "Đã xuất báo cáo tiêu hao NVL", variant: "success" });
    } catch (err) {
      toast({
        title: "Lỗi xuất Excel",
        description: err instanceof Error ? err.message : "Không thể tạo file",
        variant: "error",
      });
    }
  }, [branchLabel, detailSheet, movementCount, range, toast, totalCost, uniqueBranches, uniqueMaterials]);

  return (
    <div className="flex min-h-full flex-col">
      <ReportPageHeader
        title="Tiêu hao NVL theo chi nhánh"
        subtitle="Nguyên vật liệu được ghi nhận tự động khi bán SKU có công thức BOM"
        preset={preset}
        range={range}
        onPresetChange={setPreset}
        onCustomRangeChange={setCustomRange}
        onExportView={() => handleExport("view")}
        onExportFull={() => handleExport("full")}
        exportDisabled={loading || rows.length === 0}
      />

      <div className="space-y-4 p-4 pb-8 lg:p-6">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <SummaryCard icon={<Icon name="receipt_long" size={16} />} label="Số lượt tiêu hao" value={loading ? "—" : formatNumber(movementCount)} />
          <SummaryCard icon={<Icon name="science" size={16} />} label="Loại NVL" value={loading ? "—" : formatNumber(uniqueMaterials)} />
          <SummaryCard icon={<Icon name="storefront" size={16} />} label="Chi nhánh" value={loading ? "—" : formatNumber(uniqueBranches)} />
          <SummaryCard icon={<Icon name="payments" size={16} />} label="Tổng giá trị NVL tiêu hao" value={loading ? "—" : formatCurrency(totalCost)} highlight />
        </div>

        <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-surface-container-low text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Chi nhánh</th>
                <th className="px-4 py-3 text-left font-semibold">Mã NVL</th>
                <th className="px-4 py-3 text-left font-semibold">Tên NVL</th>
                <th className="px-4 py-3 text-right font-semibold">Số lượng</th>
                <th className="px-4 py-3 text-left font-semibold">ĐVT</th>
                <th className="px-4 py-3 text-right font-semibold">Số lượt</th>
                <th className="px-4 py-3 text-right font-semibold">Thành tiền</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="py-8 text-center text-muted-foreground">Đang tải...</td></tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-muted-foreground">
                    <Icon name="info" size={32} className="mx-auto mb-2 opacity-40" />
                    <p className="text-sm">Chưa có dữ liệu tiêu hao NVL trong kỳ và phạm vi đã chọn.</p>
                    <p className="mt-1 text-xs">Dữ liệu được lấy từ các phát sinh kho loại bom_consume.</p>
                  </td>
                </tr>
              ) : rows.map((row) => (
                <tr key={`${row.branchId}-${row.materialId}`} className="border-t border-border hover:bg-surface-container-low/50">
                  <td className="px-4 py-2">{row.branchName}</td>
                  <td className="px-4 py-2 font-medium text-primary">{row.materialCode}</td>
                  <td className="px-4 py-2">{row.materialName}</td>
                  <td className="px-4 py-2 text-right font-medium">{formatNumber(row.totalQty)}</td>
                  <td className="px-4 py-2 text-muted-foreground">{row.unit}</td>
                  <td className="px-4 py-2 text-right text-muted-foreground">{row.movementCount}</td>
                  <td className="px-4 py-2 text-right font-medium">{formatCurrency(row.totalCost)}</td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="border-t-2 border-border bg-surface-container-low/30">
                <tr>
                  <td colSpan={6} className="px-4 py-3 text-right font-semibold">Tổng cộng:</td>
                  <td className="px-4 py-3 text-right font-semibold text-primary">{formatCurrency(totalCost)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
