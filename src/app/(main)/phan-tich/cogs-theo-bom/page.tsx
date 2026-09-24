"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ReportPageHeader, ReportTableFrame } from "@/components/shared/report";
import { SummaryCard } from "@/components/shared/summary-card";
import { Icon } from "@/components/ui/icon";
import { useBranchFilter, useToast } from "@/lib/contexts";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { useReportState } from "@/lib/hooks/use-report-state";
import { getCogsByBom, type CogsByBomRow } from "@/lib/services";
import { buildInvoiceListDeepLink } from "@/lib/utils/invoice-list-deep-link";
import {
  buildReportTitleRows,
  exportReportToExcel,
  type ExcelSheet,
} from "@/lib/utils/excel-export";

function formatDateTime(iso: string): string {
  return formatDate(iso);
}

export default function CogsTheoBomPage() {
  const { toast } = useToast();
  const { activeBranchId, branchLabel, isReady } = useBranchFilter();
  const { preset, range, setPreset, setCustomRange } = useReportState({
    defaultPreset: "thisMonth",
    defaultViewMode: "table",
    forceTable: true,
  });
  const [rows, setRows] = useState<CogsByBomRow[]>([]);
  const [loading, setLoading] = useState(true);
  const requestIdRef = useRef(0);

  const fetchData = useCallback(async () => {
    if (!isReady) return;
    const requestId = ++requestIdRef.current;
    setLoading(true);
    try {
      const data = await getCogsByBom({
        fromDate: range.from,
        toDate: range.to,
        branchId: activeBranchId,
      });
      if (requestId !== requestIdRef.current) return;
      setRows(data);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setRows([]);
      toast({
        variant: "error",
        title: "Không tải được báo cáo",
        description: err instanceof Error ? err.message : "Lỗi không xác định",
      });
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [activeBranchId, isReady, range.from, range.to, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const totalRevenue = rows.reduce((sum, row) => sum + row.revenue, 0);
  const knownRows = rows.filter((row) => row.cogsReal != null);
  const missingCostCount = rows.length - knownRows.length;
  const knownRevenue = knownRows.reduce((sum, row) => sum + row.revenue, 0);
  const totalCogs = knownRows.reduce((sum, row) => sum + (row.cogsReal ?? 0), 0);
  const totalMargin = knownRevenue - totalCogs;
  const marginPercent = knownRevenue > 0 ? (totalMargin / knownRevenue) * 100 : 0;
  const negativeMargin = knownRows.filter((row) => (row.margin ?? 0) < 0);

  const detailSheet = useCallback((): ExcelSheet => ({
    name: "Chi tiết giá vốn",
    titleRows: buildReportTitleRows({
      title: "BÁO CÁO GIÁ VỐN THEO CÔNG THỨC",
      range,
      branchName: branchLabel,
    }),
    columns: [
      { label: "Hóa đơn", key: "invoiceCode", width: 16 },
      { label: "Thời gian", key: "invoiceDate", width: 18 },
      { label: "Chi nhánh", key: "branchName", width: 24 },
      { label: "Mã hàng", key: "productCode", width: 14 },
      { label: "Tên sản phẩm", key: "productName", width: 32 },
      { label: "Số lượng", key: "qtySold", width: 12, format: "number" },
      { label: "Doanh thu", key: "revenue", width: 18, format: "currency" },
      { label: "Giá vốn", key: "cogsReal", width: 18, format: "currency" },
      { label: "Lợi nhuận gộp", key: "margin", width: 18, format: "currency" },
      { label: "Tình trạng giá vốn", key: "costStatus", width: 20 },
    ],
    rows: rows.map((row) => ({
      invoiceCode: row.invoiceCode,
      invoiceDate: formatDateTime(row.invoiceDate),
      branchName: row.branchName,
      productCode: row.productCode,
      productName: row.productName,
      qtySold: row.qtySold,
      revenue: row.revenue,
      cogsReal: row.cogsReal,
      margin: row.margin,
      costStatus: row.cogsReal == null ? "Chưa xác định" : "Đã ghi nhận",
    })),
    footer: {
      invoiceCode: "TỔNG",
      invoiceDate: "",
      branchName: "",
      productCode: "",
      productName: "",
      qtySold: rows.reduce((sum, row) => sum + row.qtySold, 0),
      revenue: totalRevenue,
      cogsReal: totalCogs,
      margin: missingCostCount ? null : totalMargin,
    },
  }), [branchLabel, missingCostCount, range, rows, totalCogs, totalMargin, totalRevenue]);

  const handleExport = useCallback(async (mode: "view" | "full") => {
    try {
      const sheets: ExcelSheet[] = [];
      if (mode === "full") {
        sheets.push({
          name: "Tổng hợp",
          titleRows: buildReportTitleRows({
            title: "TỔNG HỢP GIÁ VỐN THEO CÔNG THỨC",
            range,
            branchName: branchLabel,
          }),
          columns: [
            { label: "Chỉ tiêu", key: "metric", width: 30 },
            { label: "Giá trị", key: "value", width: 22, format: "currency" },
          ],
          rows: [
            { metric: "Doanh thu sản phẩm có công thức", value: totalRevenue },
            { metric: "Giá vốn đã ghi nhận", value: totalCogs },
            { metric: "Lợi nhuận gộp (dòng đủ giá)", value: totalMargin },
            { metric: "Số dòng có lợi nhuận âm", value: negativeMargin.length },
            { metric: "Số dòng chưa có giá vốn", value: missingCostCount },
          ],
        });
      }
      sheets.push(detailSheet());
      await exportReportToExcel({
        kind: "cogs-theo-bom",
        mode,
        range,
        branchName: branchLabel,
        reportTitle: "Báo cáo giá vốn theo công thức",
        description: "Giá vốn tại thời điểm bán, chưa trừ hàng trả; dòng chưa có giá không được tính thành 0.",
        sheets,
      });
      toast({ title: "Đã xuất báo cáo giá vốn theo công thức", variant: "success" });
    } catch (err) {
      toast({
        title: "Lỗi xuất Excel",
        description: err instanceof Error ? err.message : "Không thể tạo file",
        variant: "error",
      });
    }
  }, [branchLabel, detailSheet, missingCostCount, negativeMargin.length, range, toast, totalCogs, totalMargin, totalRevenue]);

  return (
    <div className="flex min-h-full flex-col">
      <ReportPageHeader
        title="Giá vốn theo công thức"
        subtitle="Giá vốn đã chốt trên hóa đơn có BOM; doanh thu trước hàng trả"
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
          <SummaryCard
            icon={<Icon name="trending_up" size={16} />}
            label="Doanh thu gộp của dòng có BOM"
            value={loading ? "—" : formatCurrency(totalRevenue)}
            highlight
          />
          <SummaryCard
            icon={<Icon name="payments" size={16} />}
            label="Giá vốn đã ghi nhận"
            value={loading ? "—" : formatCurrency(totalCogs)}
          />
          <SummaryCard
            icon={<Icon name="account_balance" size={16} />}
            label={`Lãi gộp dòng đủ giá (${marginPercent.toFixed(1)}%)`}
            value={loading ? "—" : formatCurrency(totalMargin)}
            danger={totalMargin < 0}
          />
          <SummaryCard
            icon={<Icon name="warning" size={16} />}
            label="Dòng chưa có giá vốn"
            value={loading ? "—" : formatNumber(missingCostCount)}
            danger={missingCostCount > 0}
          />
        </div>

        <p className="text-sm text-muted-foreground">
          Giá vốn lấy từ dòng hóa đơn lúc bán, không tính lại theo giá nguyên liệu hôm nay.
          Hàng trả xem riêng ở báo cáo Trả hàng; dòng thiếu giá không được cộng vào lãi gộp.
        </p>

        <ReportTableFrame tablePreferenceKey="report.bom-cogs.rows">
          <div className="overflow-x-auto rounded-lg border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-surface-container-low text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Hóa đơn</th>
                <th className="px-4 py-3 text-left font-semibold">Thời gian</th>
                <th className="px-4 py-3 text-left font-semibold">Chi nhánh</th>
                <th className="px-4 py-3 text-left font-semibold">Mã hàng</th>
                <th className="px-4 py-3 text-right font-semibold">SL</th>
                <th className="px-4 py-3 text-right font-semibold">Doanh thu</th>
                <th className="px-4 py-3 text-right font-semibold">Giá vốn</th>
                <th className="px-4 py-3 text-right font-semibold">Lợi nhuận gộp</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="py-8 text-center text-muted-foreground">Đang tải...</td></tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-muted-foreground">
                    <Icon name="info" size={32} className="mx-auto mb-2 opacity-40" />
                    <p className="text-sm">Chưa có dữ liệu giá vốn theo công thức trong kỳ và phạm vi đã chọn.</p>
                    <p className="mt-1 text-xs">Báo cáo chỉ tính dòng hóa đơn của sản phẩm có BOM.</p>
                  </td>
                </tr>
              ) : rows.map((row) => (
                <tr key={`${row.invoiceId}-${row.productId}`} className={`border-t border-border hover:bg-surface-container-low/50 ${(row.margin ?? 0) < 0 ? "bg-status-danger/5" : ""}`}>
                  <td className="px-4 py-2 font-medium text-primary"><a href={buildInvoiceListDeepLink(row.invoiceCode)} className="underline-offset-2 hover:underline">{row.invoiceCode}</a></td>
                  <td className="px-4 py-2 text-xs text-muted-foreground">{formatDateTime(row.invoiceDate)}</td>
                  <td className="px-4 py-2">{row.branchName}</td>
                  <td className="px-4 py-2"><div>{row.productName}</div><div className="text-xs text-muted-foreground">{row.productCode}</div></td>
                  <td className="px-4 py-2 text-right">{formatNumber(row.qtySold)}</td>
                  <td className="px-4 py-2 text-right font-medium">{formatCurrency(row.revenue)}</td>
                  <td className="px-4 py-2 text-right">{row.cogsReal == null ? "Chưa xác định" : formatCurrency(row.cogsReal)}</td>
                  <td className={`px-4 py-2 text-right font-semibold ${(row.margin ?? 0) < 0 ? "text-status-danger" : "text-status-success"}`}>{row.margin == null ? "—" : formatCurrency(row.margin)}</td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="border-t-2 border-border bg-surface-container-low/30">
                <tr>
                  <td colSpan={5} className="px-4 py-3 text-right font-semibold">Tổng cộng:</td>
                  <td className="px-4 py-3 text-right font-semibold text-primary">{formatCurrency(totalRevenue)}</td>
                  <td className="px-4 py-3 text-right font-semibold">{formatCurrency(totalCogs)}</td>
                  <td className={`px-4 py-3 text-right font-semibold ${totalMargin < 0 ? "text-status-danger" : "text-status-success"}`}>{missingCostCount ? "Chưa đủ giá" : formatCurrency(totalMargin)}</td>
                </tr>
              </tfoot>
            )}
          </table>
          </div>
        </ReportTableFrame>
      </div>
    </div>
  );
}
