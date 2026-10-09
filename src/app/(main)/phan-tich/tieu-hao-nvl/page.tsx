"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ReportPageHeader, ReportDataTable, type DataTableColumn } from "@/components/shared/report";
import { SummaryCard } from "@/components/shared/summary-card";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBranchFilter, useToast } from "@/lib/contexts";
import { formatCurrency, formatStockQuantity } from "@/lib/format";
import { useReportState } from "@/lib/hooks/use-report-state";
import { getNvlConsumptionByBranch, type NvlConsumptionRow } from "@/lib/services";
import { materialConsumptionView, materialConsumptionTotals, type MaterialConsumptionViewRow } from "@/lib/reports/material-consumption-view";
import { buildReportTitleRows, exportReportToExcel } from "@/lib/utils/excel-export";

const TABLE_KEY = "report.material-consumption.rows";
const money = (value: number | null) => value === null ? "Chưa đủ giá vốn" : formatCurrency(value);

export default function TieuHaoNvlPage() {
  const { toast } = useToast();
  const { activeBranchId, branchLabel, isReady } = useBranchFilter();
  const { preset, range, setPreset, setCustomRange } = useReportState({ defaultPreset: "thisMonth", defaultViewMode: "table", forceTable: true });
  const [rows, setRows] = useState<NvlConsumptionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [search, setSearch] = useState("");
  const [unit, setUnit] = useState("");
  const [sort, setSort] = useState<{ id: string; direction: "asc" | "desc" }>({ id: "materialCode", direction: "asc" });
  const requestIdRef = useRef(0);
  useEffect(() => {
    const requestId = ++requestIdRef.current;
    let cancelled = false;
    if (!isReady) return;
    setLoading(true);
    getNvlConsumptionByBranch({ fromDate: range.from, toDate: range.to, branchId: activeBranchId })
      .then(data => { if (cancelled || requestId !== requestIdRef.current) return; setRows(data); })
      .catch(error => { if (cancelled || requestId !== requestIdRef.current) return; setRows([]); toast({ variant: "error", title: "Không tải được báo cáo", description: error instanceof Error ? error.message : "Vui lòng thử lại" }); })
      .finally(() => { if (cancelled || requestId !== requestIdRef.current) return; setLoading(false); });
    return () => { cancelled = true; };
  }, [isReady, range.from, range.to, activeBranchId, toast]);
  const visible = useMemo(() => materialConsumptionView(rows, search, unit, sort), [rows, search, unit, sort]);
  const totals = useMemo(() => materialConsumptionTotals(visible), [visible]);
  const units = useMemo(() => [...new Set(rows.map(row => row.unit))].filter(Boolean).sort((a, b) => a.localeCompare(b, "vi")), [rows]);
  const columns: DataTableColumn<MaterialConsumptionViewRow>[] = [
    { key: "materialCode", label: "Mã NVL", sticky: true, hideable: false, width: "150px" },
    { key: "materialName", label: "Nguyên vật liệu", width: "260px" },
    { key: "branchName", label: "Chi nhánh", width: "240px" },
    { key: "unit", label: "ĐVT", width: "90px" },
    { key: "totalQty", label: "Số lượng tiêu hao", align: "right", width: "160px", cell: row => formatStockQuantity(row.totalQty), subtotalCell: totals.quantity === null ? "Nhiều ĐVT" : formatStockQuantity(totals.quantity) },
    { key: "averageUnitCost", label: "Đơn giá bình quân", align: "right", width: "180px", cell: row => row.averageUnitCost === null ? "—" : formatStockQuantity(row.averageUnitCost) },
    { key: "totalCost", label: "Thành tiền", align: "right", width: "180px", cell: row => money(row.totalCost), subtotalCell: money(totals.totalCost) },
    { key: "movementCount", label: "Số phát sinh", align: "right", width: "130px", subtotalCell: totals.movements },
  ];
  async function exportRows(mode: "view" | "full") {
    if (exporting || loading) return;
    setExporting(true);
    try {
      const titleRows = buildReportTitleRows({ title: "BÁO CÁO TIÊU HAO NGUYÊN VẬT LIỆU", range, branchName: branchLabel });
      titleRows.push(`Tìm kiếm: ${search || "Tất cả"}; ĐVT: ${unit || "Tất cả"}; Sắp xếp: ${sort.id} ${sort.direction}`);
      titleRows.push("Giá vốn chốt tại phát sinh kho; ô trống là thiếu giá lịch sử. Đơn giá bình quân = thành tiền / số lượng.");
      await exportReportToExcel({ kind: "tieu-hao-nvl", mode, range, branchName: branchLabel, sheets: [{
        name: "Tiêu hao NVL", titleRows, autoFilter: true,
        tablePreferenceKey: mode === "view" ? TABLE_KEY : undefined,
        columns: columns.map(column => ({ key: String(column.key), label: column.label, width: column.key === "materialName" ? 32 : 22,
          hideable: column.hideable, decimalPlaces: 4,
          format: ["totalQty", "averageUnitCost", "totalCost", "movementCount"].includes(String(column.key)) ? "number" as const : undefined })),
        rows: visible.map(row => ({ ...row })),
        footer: { materialCode: "TỔNG", totalQty: totals.quantity ?? "Nhiều ĐVT", totalCost: totals.totalCost, movementCount: totals.movements },
      }] });
      toast({ title: "Đã xuất báo cáo", variant: "success" });
    } catch (error) { toast({ title: "Không xuất được Excel", description: error instanceof Error ? error.message : "Vui lòng thử lại", variant: "error" }); }
    finally { setExporting(false); }
  }
  return <div className="flex min-h-full flex-col">
    <ReportPageHeader title="Tiêu hao nguyên vật liệu" preset={preset} range={range} onPresetChange={setPreset} onCustomRangeChange={setCustomRange}
      onExportView={() => exportRows("view")} onExportFull={() => exportRows("full")} exportDisabled={loading || exporting || !visible.length} />
    <div className="space-y-4 p-4 lg:p-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard label="Nguyên vật liệu" value={loading ? "—" : String(totals.materials)} />
        <SummaryCard label="Phát sinh" value={loading ? "—" : String(totals.movements)} />
        <SummaryCard label="Giá trị đủ giá vốn" value={loading ? "—" : formatCurrency(totals.knownCost)} />
        <SummaryCard label="Tổng tiêu hao" value={loading ? "—" : money(totals.totalCost)} highlight />
      </div>
      {totals.missing > 0 && <p role="status" className="border-l-4 border-amber-500 bg-amber-50 p-3 text-sm text-amber-900">{totals.missing} dòng chưa đủ giá vốn lịch sử. Tổng đủ giá vốn được hiển thị riêng, không tính giá thiếu thành 0.</p>}
      <div className="flex flex-wrap gap-3">
        <div className="relative min-w-60 flex-1"><Icon name="search" size={18} className="absolute left-3 top-3 text-muted-foreground" /><Input aria-label="Tìm nguyên vật liệu" placeholder="Mã, tên NVL hoặc chi nhánh" value={search} onChange={event => setSearch(event.target.value)} className="pl-9" /></div>
        <Select value={unit || "all"} onValueChange={value => setUnit(value === "all" ? "" : value ?? "")}><SelectTrigger className="w-44" aria-label="Đơn vị tính"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Tất cả ĐVT</SelectItem>{units.map(value => <SelectItem key={value} value={value}>{value}</SelectItem>)}</SelectContent></Select>
      </div>
      <ReportDataTable columns={columns} rows={loading ? [] : visible} getRowKey={row => `${row.branchId}:${row.materialId}`} tablePreferenceKey={TABLE_KEY}
        sortState={sort} onSortChange={setSort} subtotalLabel={`${visible.length} dòng`} emptyState={loading ? "Đang tải..." : "Không có phát sinh phù hợp."} />
    </div>
  </div>;
}
