"use client";

/**
 * Báo cáo VAT đầu vào / đầu ra (Phase C.2 — CEO 16/05/2026).
 *
 * CFO dùng để khai thuế GTGT hàng tháng:
 *   - VAT output = đầu ra (invoices.tax_amount)
 *   - VAT input = đầu vào (purchase_orders.tax_amount)
 *   - Phải nộp = output − input (nếu dương → nộp; âm → khấu trừ kỳ sau)
 */

import { useEffect, useState, useCallback } from "react";
import { useBranchFilter, useToast } from "@/lib/contexts";
import { Icon } from "@/components/ui/icon";
import { formatNumber, formatCurrency, formatDate } from "@/lib/format";
import {
  ReportPageHeader,
  ReportDataTable,
  type DataTableColumn,
} from "@/components/shared/report";
import { useReportState } from "@/lib/hooks/use-report-state";
import {
  exportReportToExcel,
  buildInfoSheet,
  type ExcelSheet,
} from "@/lib/utils/excel-export";
import {
  getVatReport,
  type VatInvoiceDetail,
  type VatPoDetail,
  type VatReport,
} from "@/lib/services";
import { KpiCard } from "../_components/kpi-card";

export default function VatReportPage() {
  const { toast } = useToast();
  const { activeBranchId, isReady } = useBranchFilter();
  const { preset, range, setPreset, setCustomRange } = useReportState({
    forceTable: true,
  });

  const [report, setReport] = useState<VatReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"output" | "input">("output");

  useEffect(() => {
    if (!isReady) return;
    setLoading(true);
    getVatReport({
      dateFrom: range.from,
      dateTo: range.to,
      branchId: activeBranchId ?? null,
    })
      .then(setReport)
      .catch((err) => {
        toast({
          title: "Không tải được báo cáo VAT",
          description: err instanceof Error ? err.message : "Lỗi không xác định",
          variant: "error",
        });
        setReport(null);
      })
      .finally(() => setLoading(false));
  }, [isReady, range.from, range.to, activeBranchId, toast]);

  const outputDetail = report?.outputDetail ?? [];
  const inputDetail = report?.inputDetail ?? [];
  const taxPayable =
    (report?.output.totalTax ?? 0) - (report?.input.totalTax ?? 0);

  const outputColumns: DataTableColumn<VatInvoiceDetail>[] = [
    {
      label: "Ngày",
      key: "createdAt",
      width: "110px",
      cell: (r) => formatDate(r.createdAt),
    },
    { label: "Mã HĐ", key: "code", width: "130px" },
    { label: "Khách hàng", key: "customerName", width: "200px" },
    {
      label: "Doanh thu chưa VAT",
      key: "subtotal",
      align: "right",
      cell: (r) => formatCurrency(r.subtotal),
    },
    {
      label: "VAT đầu ra",
      key: "taxAmount",
      align: "right",
      cell: (r) => (
        <span className="font-semibold text-primary tabular-nums">
          {formatCurrency(r.taxAmount)}
        </span>
      ),
    },
    {
      label: "Tổng HĐ",
      key: "total",
      align: "right",
      cell: (r) => formatCurrency(r.total),
    },
  ];

  const inputColumns: DataTableColumn<VatPoDetail>[] = [
    {
      label: "Ngày",
      key: "createdAt",
      width: "110px",
      cell: (r) => formatDate(r.createdAt),
    },
    { label: "Mã PO", key: "code", width: "130px" },
    { label: "Nhà cung cấp", key: "supplierName", width: "200px" },
    {
      label: "VAT đầu vào",
      key: "taxAmount",
      align: "right",
      cell: (r) => (
        <span className="font-semibold text-status-success tabular-nums">
          {formatCurrency(r.taxAmount)}
        </span>
      ),
    },
    {
      label: "Tổng PO",
      key: "total",
      align: "right",
      cell: (r) => formatCurrency(r.total),
    },
  ];

  const handleExport = useCallback(() => {
    if (!report) return;
    try {
      const infoSheet = buildInfoSheet({
        title: "BÁO CÁO VAT ĐẦU VÀO / ĐẦU RA",
        description: "Tổng hợp VAT input + output theo kỳ — phục vụ khai thuế GTGT",
        range,
        tenantName: "OneBiz",
        generatedAt: new Date(),
        disclaimer:
          "VAT output = invoices.tax_amount (status=completed). VAT input = purchase_orders.tax_amount (status=completed). Phải nộp = output − input.",
      });

      const summarySheet: ExcelSheet = {
        name: "Tổng quan",
        titleRows: ["TỔNG QUAN VAT KỲ NÀY"],
        columns: [
          { label: "Chỉ tiêu", key: "label", width: 32 },
          { label: "Giá trị", key: "value", width: 22 },
        ],
        rows: [
          {
            label: `VAT đầu ra (${report.output.invoiceCount} HĐ)`,
            value: formatCurrency(report.output.totalTax) + " đ",
          },
          {
            label: "Doanh thu chưa VAT",
            value: formatCurrency(report.output.totalTaxable) + " đ",
          },
          {
            label: `VAT đầu vào (${report.input.poCount} PO)`,
            value: formatCurrency(report.input.totalTax) + " đ",
          },
          {
            label: "Mua chưa VAT",
            value: formatCurrency(report.input.totalTaxable) + " đ",
          },
          {
            label: taxPayable >= 0 ? "VAT PHẢI NỘP" : "VAT KHẤU TRỪ KỲ SAU",
            value: formatCurrency(Math.abs(taxPayable)) + " đ",
          },
        ],
      };

      const outputSheet: ExcelSheet = {
        name: "VAT đầu ra",
        titleRows: ["CHI TIẾT VAT ĐẦU RA (HÓA ĐƠN BÁN)"],
        columns: [
          { label: "Ngày", key: "date", width: 12, format: "text" },
          { label: "Mã HĐ", key: "code", width: 14 },
          { label: "Khách hàng", key: "customer", width: 28 },
          { label: "DT chưa VAT", key: "subtotal", width: 16, format: "currency" },
          { label: "VAT", key: "tax", width: 14, format: "currency" },
          { label: "Tổng HĐ", key: "total", width: 16, format: "currency" },
        ],
        rows: outputDetail.map((d) => ({
          date: formatDate(d.createdAt),
          code: d.code,
          customer: d.customerName,
          subtotal: d.subtotal,
          tax: d.taxAmount,
          total: d.total,
        })),
        footer: {
          date: "",
          code: "",
          customer: `${outputDetail.length} HĐ`,
          subtotal: report.output.totalTaxable,
          tax: report.output.totalTax,
          total: outputDetail.reduce((s, d) => s + d.total, 0),
        },
      };

      const inputSheet: ExcelSheet = {
        name: "VAT đầu vào",
        titleRows: ["CHI TIẾT VAT ĐẦU VÀO (ĐƠN NHẬP)"],
        columns: [
          { label: "Ngày", key: "date", width: 12, format: "text" },
          { label: "Mã PO", key: "code", width: 14 },
          { label: "Nhà cung cấp", key: "supplier", width: 28 },
          { label: "VAT", key: "tax", width: 14, format: "currency" },
          { label: "Tổng PO", key: "total", width: 16, format: "currency" },
        ],
        rows: inputDetail.map((d) => ({
          date: formatDate(d.createdAt),
          code: d.code,
          supplier: d.supplierName,
          tax: d.taxAmount,
          total: d.total,
        })),
        footer: {
          date: "",
          code: "",
          supplier: `${inputDetail.length} PO`,
          tax: report.input.totalTax,
          total: inputDetail.reduce((s, d) => s + d.total, 0),
        },
        withSignature: true,
      };

      exportReportToExcel({
        kind: "tai-chinh",
        mode: "full",
        range,
        tenantName: "OneBiz",
        sheets: [infoSheet, summarySheet, outputSheet, inputSheet],
      });

      toast({
        title: "Đã xuất báo cáo VAT",
        description: `4 sheet: Info + Tổng quan + Đầu ra (${outputDetail.length}) + Đầu vào (${inputDetail.length})`,
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "Lỗi xuất Excel",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    }
  }, [report, outputDetail, inputDetail, taxPayable, range, toast]);

  return (
    <div className="p-3 md:p-5 space-y-4">
      <ReportPageHeader
        title="VAT đầu vào / đầu ra"
        subtitle="Báo cáo thuế GTGT — CFO khai thuế hàng tháng"
        preset={preset}
        range={range}
        onPresetChange={setPreset}
        onCustomRangeChange={setCustomRange}
        onExportFull={handleExport}
        exportDisabled={loading || !report}
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="VAT đầu ra"
          value={formatCurrency(report?.output.totalTax ?? 0) + " đ"}
          change={`${report?.output.invoiceCount ?? 0} HĐ`}
          positive
          icon="trending_up"
          bg="bg-primary-fixed"
          iconColor="text-primary"
          valueColor="text-primary"
        />
        <KpiCard
          label="VAT đầu vào"
          value={formatCurrency(report?.input.totalTax ?? 0) + " đ"}
          change={`${report?.input.poCount ?? 0} PO`}
          positive
          icon="trending_down"
          bg="bg-status-success/10"
          iconColor="text-status-success"
          valueColor="text-status-success"
        />
        <KpiCard
          label={taxPayable >= 0 ? "VAT phải nộp" : "VAT khấu trừ kỳ sau"}
          value={formatCurrency(Math.abs(taxPayable)) + " đ"}
          icon={taxPayable >= 0 ? "payments" : "savings"}
          bg={taxPayable >= 0 ? "bg-status-warning/10" : "bg-status-info/10"}
          iconColor={taxPayable >= 0 ? "text-status-warning" : "text-status-info"}
          valueColor={taxPayable >= 0 ? "text-status-warning" : "text-status-info"}
        />
        <KpiCard
          label="DT chưa VAT"
          value={formatCurrency(report?.output.totalTaxable ?? 0) + " đ"}
          icon="receipt_long"
          bg="bg-status-info/10"
          iconColor="text-status-info"
          valueColor="text-foreground"
        />
      </div>

      {/* VAT breakdown theo thuế suất — CFO khai tờ 01/GTGT */}
      {(report?.outputByRate.length || report?.inputByRate.length) ? (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="rounded-xl border border-border bg-surface-container-lowest p-4">
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <Icon name="trending_up" size={16} className="text-primary" />
              VAT đầu ra theo thuế suất
            </h3>
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="text-left py-2">Thuế suất</th>
                  <th className="text-right">Số HĐ</th>
                  <th className="text-right">DT chưa VAT</th>
                  <th className="text-right">VAT</th>
                </tr>
              </thead>
              <tbody>
                {(report?.outputByRate ?? []).map((r) => (
                  <tr key={`out-${r.taxRate}`} className="border-b last:border-0">
                    <td className="py-2 font-semibold">{r.taxRate}%</td>
                    <td className="text-right tabular-nums">
                      {formatNumber(r.invoiceCount ?? 0)}
                    </td>
                    <td className="text-right tabular-nums">
                      {formatCurrency(r.taxableAmount)}
                    </td>
                    <td className="text-right font-semibold tabular-nums text-primary">
                      {formatCurrency(r.taxAmount)}
                    </td>
                  </tr>
                ))}
                {(report?.outputByRate ?? []).length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-muted-foreground">
                      Không có dữ liệu
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="rounded-xl border border-border bg-surface-container-lowest p-4">
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <Icon name="trending_down" size={16} className="text-status-success" />
              VAT đầu vào theo thuế suất
            </h3>
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="text-left py-2">Thuế suất</th>
                  <th className="text-right">Số PO</th>
                  <th className="text-right">Mua chưa VAT</th>
                  <th className="text-right">VAT</th>
                </tr>
              </thead>
              <tbody>
                {(report?.inputByRate ?? []).map((r) => (
                  <tr key={`in-${r.taxRate}`} className="border-b last:border-0">
                    <td className="py-2 font-semibold">{r.taxRate}%</td>
                    <td className="text-right tabular-nums">
                      {formatNumber(r.poCount ?? 0)}
                    </td>
                    <td className="text-right tabular-nums">
                      {formatCurrency(r.taxableAmount)}
                    </td>
                    <td className="text-right font-semibold tabular-nums text-status-success">
                      {formatCurrency(r.taxAmount)}
                    </td>
                  </tr>
                ))}
                {(report?.inputByRate ?? []).length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-4 text-center text-muted-foreground">
                      Không có dữ liệu
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="flex gap-2 border-b">
        <button
          type="button"
          onClick={() => setTab("output")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "output"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          VAT đầu ra ({outputDetail.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("input")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            tab === "input"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          VAT đầu vào ({inputDetail.length})
        </button>
      </div>

      {tab === "output" ? (
        <ReportDataTable
          columns={outputColumns}
          rows={outputDetail}
          getRowKey={(r) => r.id}
          subtotalLabel={
            loading
              ? "Đang tải..."
              : outputDetail.length === 0
                ? "Không có HĐ có VAT trong kỳ"
                : `${outputDetail.length} HĐ — Tổng VAT đầu ra: ${formatCurrency(report?.output.totalTax ?? 0)}đ`
          }
          emptyState={
            <div className="text-center py-12 text-muted-foreground">
              <Icon name="receipt_long" size={40} className="opacity-50 mb-2" />
              <p>Không có HĐ có VAT trong kỳ</p>
            </div>
          }
        />
      ) : (
        <ReportDataTable
          columns={inputColumns}
          rows={inputDetail}
          getRowKey={(r) => r.id}
          subtotalLabel={
            loading
              ? "Đang tải..."
              : inputDetail.length === 0
                ? "Không có PO có VAT trong kỳ"
                : `${inputDetail.length} PO — Tổng VAT đầu vào: ${formatCurrency(report?.input.totalTax ?? 0)}đ`
          }
          emptyState={
            <div className="text-center py-12 text-muted-foreground">
              <Icon name="add_box" size={40} className="opacity-50 mb-2" />
              <p>Không có PO có VAT trong kỳ</p>
            </div>
          }
        />
      )}
    </div>
  );
}
