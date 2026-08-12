"use client";

import { useCallback, useEffect, useState } from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable } from "@/components/shared/data-table";
import { ListMetric } from "@/components/shared/list-metric";
import { FilterChips, type ListFilterChip } from "@/components/shared/filter-chips";
import { FilterPanel, FilterGroup, SelectFilter } from "@/components/shared/filter-sidebar";
import { AllBranchesBanner } from "@/components/shared/all-branches-banner";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { useToast, useBranchFilter } from "@/lib/contexts";
import { usePermissions } from "@/lib/permissions";
import { useDebounce } from "@/lib/utils/use-debounce";
import { getProductLotListWorkspace, getProductLotsForExport } from "@/lib/services";
import { exportToExcel } from "@/lib/utils/export";
import { formatDate, formatNumber } from "@/lib/format";
import type { ProductLot } from "@/lib/types";

type LotRow = ProductLot & { productName: string; productCode: string; daysUntilExpiry?: number };

const searchFields = [
  { value: "all", label: "Tất cả" },
  { value: "lot_number", label: "Số lô" },
  { value: "product_code", label: "Mã hàng" },
  { value: "product_name", label: "Tên hàng" },
];
const expiryOptions = [
  { value: "attention", label: "Đã hết và sắp hết hạn" },
  { value: "expired", label: "Đã hết hạn" },
  { value: "upcoming", label: "Sắp hết hạn" },
];

export default function HSDPage() {
  const { toast } = useToast();
  const { activeBranchId, currentBranch, isReady } = useBranchFilter();
  const { hasAny, isLoading: permissionsLoading } = usePermissions();
  const duocXemToanChuoi = hasAny(["reports.view_all_branches", "system.manage_branches"]);
  const [viewAllBranches, setViewAllBranches] = useState(false);
  const [otherBranchCount, setOtherBranchCount] = useState(0);
  const [data, setData] = useState<LotRow[]>([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState({ activeCount: 0, currentQty: 0, expiredCount: 0, nearExpiryCount: 0 });
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [searchField, setSearchField] = useState("all");
  const [thresholdDays, setThresholdDays] = useState(30);
  const [expiryState, setExpiryState] = useState<"attention" | "expired" | "upcoming">("attention");
  const [filterOpen, setFilterOpen] = useState(false);

  useEffect(() => setViewAllBranches(false), [activeBranchId]);
  useEffect(() => { if (!duocXemToanChuoi) setViewAllBranches(false); }, [duocXemToanChuoi]);
  useEffect(() => setPage(0), [debouncedSearch, searchField, thresholdDays, expiryState, activeBranchId, viewAllBranches]);

  const buildQuery = useCallback(() => ({
    search: debouncedSearch || undefined,
    searchField: searchField as "all" | "lot_number" | "product_code" | "product_name",
    expiryState,
    thresholdDays,
    branchId: duocXemToanChuoi && viewAllBranches ? undefined : activeBranchId,
  }), [activeBranchId, debouncedSearch, duocXemToanChuoi, expiryState, searchField, thresholdDays, viewAllBranches]);

  const fetchData = useCallback(async () => {
    if (!isReady || permissionsLoading) return;
    setLoading(true);
    try {
      const query = buildQuery();
      const result = await getProductLotListWorkspace({ ...query, page, pageSize });
      setData(result.data); setTotal(result.total); setSummary(result.summary);
      if (duocXemToanChuoi && !viewAllBranches && activeBranchId && result.total === 0) {
        const all = await getProductLotListWorkspace({ ...query, branchId: undefined, page: 0, pageSize: 1 });
        setOtherBranchCount(all.total);
      } else setOtherBranchCount(0);
    } catch (error) {
      toast({ title: "Lỗi tải hạn sử dụng", description: error instanceof Error ? error.message : "Vui lòng thử lại", variant: "error" });
    } finally { setLoading(false); }
  }, [activeBranchId, buildQuery, duocXemToanChuoi, isReady, page, pageSize, permissionsLoading, toast, viewAllBranches]);
  useEffect(() => { void fetchData(); }, [fetchData]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const rows = await getProductLotsForExport(buildQuery());
      await exportToExcel(rows, [
        { header: "Số lô", key: "lotNumber", width: 20 }, { header: "Mã hàng", key: "productCode", width: 18 },
        { header: "Tên hàng", key: "productName", width: 32 }, { header: "Chi nhánh", key: "branchName", width: 24 },
        { header: "Tồn lô", key: "currentQty", width: 14 },
        { header: "Hạn sử dụng", key: "expiryDate", width: 16, format: (v: string) => formatDate(v) },
        { header: "Số ngày còn lại", key: "daysUntilExpiry", width: 18 },
      ], "han-su-dung");
    } catch (error) {
      toast({ title: "Xuất file thất bại", description: error instanceof Error ? error.message : "Vui lòng thử lại", variant: "error" });
    } finally { setExporting(false); }
  };

  const filterChips: ListFilterChip[] = [
    ...(expiryState !== "attention" ? [{ key: "expiry", label: "Tình trạng", value: expiryOptions.find((x) => x.value === expiryState)?.label ?? expiryState, onClear: () => setExpiryState("attention") }] : []),
    ...(thresholdDays !== 30 ? [{ key: "threshold", label: "Ngưỡng cảnh báo", value: `${thresholdDays} ngày`, onClear: () => setThresholdDays(30) }] : []),
  ];
  const columns: ColumnDef<LotRow, unknown>[] = [
    { accessorKey: "lotNumber", header: "Số lô", size: 170, cell: ({ row }) => <span className="font-medium text-primary">{row.original.lotNumber}</span> },
    { id: "product", header: "Sản phẩm", size: 280, cell: ({ row }) => <div><div className="font-medium">{row.original.productName}</div><div className="text-xs text-muted-foreground">{row.original.productCode}</div></div> },
    { accessorKey: "branchName", header: "Chi nhánh", size: 170 },
    { accessorKey: "currentQty", header: "Tồn lô", size: 110, cell: ({ row }) => <span className="font-medium tabular-nums">{formatNumber(row.original.currentQty)}</span> },
    { accessorKey: "expiryDate", header: "Hạn sử dụng", size: 135, cell: ({ row }) => row.original.expiryDate ? formatDate(row.original.expiryDate) : "—" },
    { accessorKey: "daysUntilExpiry", header: "Còn lại", size: 150, cell: ({ row }) => { const days=row.original.daysUntilExpiry ?? 0; return days<0 ? <span className="font-medium text-destructive"><Icon name="warning" size={14} className="mr-1 inline"/>Hết hạn {Math.abs(days)} ngày</span> : <span className={days<=7?"font-medium text-destructive":"text-status-warning"}>{days} ngày</span>; } },
  ];

  return <ListPageLayout sidebar={null}>
    <PageHeader title="Hạn sử dụng (HSD)" density="compact" searchPlaceholder="Nhập nội dung cần tìm..." searchValue={search} onSearchChange={setSearch} searchFields={searchFields} searchField={searchField} onSearchFieldChange={setSearchField} onExport={{ items: [{ label: exporting ? "Đang xuất..." : "Xuất Excel hạn sử dụng", icon: "table_view", onClick: () => { if (!exporting) void handleExport(); } }] }} />
    <DataTable columns={columns} data={data} loading={loading} total={total} density="compact" columnToggle pageIndex={page} pageSize={pageSize} pageCount={Math.max(1,Math.ceil(total/pageSize))} onPageChange={setPage} onPageSizeChange={(size)=>{setPageSize(size);setPage(0);}} getRowId={(row)=>row.id}
      toolbarMetrics={<><ListMetric icon={<Icon name="event" size={15}/>} label="Lô cần chú ý" value={formatNumber(total)} hint={`Theo ngưỡng ${thresholdDays} ngày`} tone="primary"/><ListMetric icon={<Icon name="warning" size={15}/>} label="Đã hết hạn" value={formatNumber(summary.expiredCount)} tone={summary.expiredCount>0?"danger":"default"}/><ListMetric icon={<Icon name="schedule" size={15}/>} label={`Sắp hết (${thresholdDays} ngày)`} value={formatNumber(summary.nearExpiryCount)}/></>}
      toolbarActions={<Button type="button" variant="outline" size="sm" className="relative h-8 gap-1.5 px-2 text-xs pointer-coarse:min-h-11" onClick={()=>setFilterOpen(true)}><Icon name="filter_alt" size={15}/><span className="hidden sm:inline">Bộ lọc</span>{filterChips.length>0&&<span className="min-w-4 rounded-full bg-primary px-1 text-xs font-bold text-primary-foreground">{filterChips.length}</span>}</Button>}
      toolbarFooter={<>{filterChips.length>0&&<FilterChips filters={filterChips} onClearAll={()=>{setExpiryState("attention");setThresholdDays(30);}}/>}{viewAllBranches&&<AllBranchesBanner entityLabel="lô" branchName={currentBranch?.name} onBackToBranch={()=>setViewAllBranches(false)}/>}</>}
      emptyTitle="Không có lô cần chú ý" emptyDescription="Thử thay đổi nội dung tìm kiếm hoặc ngưỡng cảnh báo." emptyIcon="event" emptyBranchHint={duocXemToanChuoi?{otherBranchCount,onViewAllBranches:()=>setViewAllBranches(true),entityLabel:"lô"}:undefined}/>
    <FilterPanel open={filterOpen} onOpenChange={setFilterOpen} activeCount={filterChips.length} onClearAll={()=>{setExpiryState("attention");setThresholdDays(30);}} title="Bộ lọc hạn sử dụng">
      <FilterGroup label="Tình trạng"><SelectFilter options={expiryOptions} value={expiryState} onChange={(v)=>setExpiryState(v as typeof expiryState)}/></FilterGroup>
      <FilterGroup label="Ngưỡng cảnh báo (ngày)" activeHint={`${thresholdDays} ngày`}><Input type="number" value={thresholdDays} onChange={(e)=>setThresholdDays(Math.min(365,Math.max(1,Number(e.target.value)||30)))} min={1} max={365}/><p className="mt-2 text-xs text-muted-foreground">Hiển thị lô sắp hết hạn trong số ngày đã chọn.</p></FilterGroup>
    </FilterPanel>
  </ListPageLayout>;
}
