"use client";

// Lịch sử xuất/nhập kho — xem tất cả stock movements, lọc theo loại, chi nhánh, thời gian

import { useEffect, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable } from "@/components/shared/data-table";
import {
  FilterPanel,
  FilterGroup,
  SelectFilter,
  DatePresetFilter,
  type DatePresetValue,
} from "@/components/shared/filter-sidebar";
import { FilterChips, type ListFilterChip } from "@/components/shared/filter-chips";
import { ListMetric } from "@/components/shared/list-metric";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useBranchFilter, useToast } from "@/lib/contexts";
import { useRevalidateOnFocus } from "@/lib/hooks/use-revalidate-on-focus";
import { formatCurrency, formatDate, formatNumber } from "@/lib/format";
import { exportToExcel, exportToCsv } from "@/lib/utils/export";
import { getAllStockMovements, getBranches } from "@/lib/services";
import type { AllStockMovementRow } from "@/lib/services/supabase";
import type { BranchDetail } from "@/lib/services/supabase";
import { Icon } from "@/components/ui/icon";
import { StockDocumentLink } from "@/components/shared/stock-document-link";
import { getStockMovementCounts } from "@/lib/services/supabase/products";
import { usePermissions } from "@/lib/permissions/use-permission";
import { PERMISSIONS } from "@/lib/permissions/constants";
import {
  getSignedStockQuantity,
  getStockMovementTotalValue,
  getStockMovementUnitValue,
} from "@/lib/stock-movement-values";

// === Movement type badge config ===
const movementTypeBadge: Record<
  string,
  { label: string; className: string }
> = {
  in: {
    label: "Nhập",
    className: "bg-status-success/10 text-status-success border-status-success/25",
  },
  out: {
    label: "Xuất",
    className: "bg-status-error/10 text-status-error border-status-error/25",
  },
  adjust: {
    label: "Kiểm kho",
    className: "bg-primary-fixed text-primary border-primary-fixed",
  },
  transfer: {
    label: "Chuyển kho",
    className: "bg-status-info/10 text-status-info border-status-info/25",
  },
};

// Map FE type back to DB type for filtering
const feTypeToDbType: Record<string, string> = {
  import: "in",
  export: "out",
  adjustment: "adjust",
  transfer: "transfer",
};

// === Movement type filter options ===
const movementTypeOptions = [
  { label: "Nhập kho", value: "in" },
  { label: "Xuất kho", value: "out" },
  { label: "Kiểm kho", value: "inventory_check" },
  { label: "Chuyển kho", value: "stock_transfer" },
];

// === Date presets ===
// CEO 06/06/2026 Phase 3: dùng STANDARD_LIST_PRESETS_WITH_ALL từ utility chung
// thay vì define local (11 option chuẩn KiotViet).
import {
  computeListPresetRange,
  STANDARD_LIST_PRESETS_WITH_ALL as datePresets,
} from "@/lib/utils/list-date-preset-range";

// === Reference type display ===
// Đợt 2 (CEO 17/07): nhãn chuyển về NGUỒN SỰ THẬT chung — không khai lại ở đây.
import { REFERENCE_TYPE_LABELS as referenceTypeLabels } from "@/lib/constants/stock-movement-refs";

export default function LichSuKhoPage() {
  const { toast } = useToast();
  const { activeBranchId } = useBranchFilter();
  const { hasPermission } = usePermissions();
  const canViewCost = hasPermission(PERMISSIONS.PRODUCTS_VIEW_COST);
  const [data, setData] = useState<AllStockMovementRow[]>([]);
  const [total, setTotal] = useState(0);
  const [movementCounts, setMovementCounts] = useState({
    total: 0,
    inbound: 0,
    outbound: 0,
  });
  const [branches, setBranches] = useState<BranchDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);

  // Filters
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [branchFilter, setBranchFilter] = useState<string>(activeBranchId ?? "all");
  const [datePreset, setDatePreset] = useState<DatePresetValue>("this_month");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);

  // Load branches once
  useEffect(() => {
    getBranches()
      .then(setBranches)
      .catch((err: unknown) => {
        console.error("[lich-su-kho] load branches failed:", err);
        setBranches([]);
      });
  }, []);

  useEffect(() => {
    setBranchFilter(activeBranchId ?? "all");
  }, [activeBranchId]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // P1-3C-K2 12/06/2026: truyền dateFrom/dateTo (trước đây state có nhưng
      // không tới service → filter là UI giả).
      const presetRange = computeListPresetRange(datePreset);
      const effectiveDateFrom =
        datePreset === "custom" ? dateFrom : presetRange.from;
      const effectiveDateTo =
        datePreset === "custom" ? dateTo : presetRange.to;

      const filters = {
        search: search || undefined,
        movementType: typeFilter !== "all" ? typeFilter : undefined,
        branchId: branchFilter !== "all" ? branchFilter : undefined,
        dateFrom: effectiveDateFrom || undefined,
        dateTo: effectiveDateTo || undefined,
      };
      const [result, counts] = await Promise.all([
        getAllStockMovements({ page, pageSize, ...filters }),
        getStockMovementCounts(filters),
      ]);
      setData(result.data);
      setTotal(result.total);
      setMovementCounts(counts);
    } catch (err) {
      toast({
        title: "Lỗi tải lịch sử kho",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, typeFilter, branchFilter, datePreset, dateFrom, dateTo, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useRevalidateOnFocus(fetchData);

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [search, typeFilter, branchFilter, datePreset, dateFrom, dateTo]);


  // === Export ===
  // CEO 17/07 (Thẻ kho Đợt 1): xuất TOÀN BỘ dữ liệu theo bộ lọc hiện tại.
  // Trước đây xuất state `data` — vốn chỉ là 1 TRANG (mặc định 20 dòng) do
  // getAllStockMovements phân trang server-side → file mở được, có số, nhưng
  // THIẾU dữ liệu âm thầm. Nay fetch lại đủ (chunk 1000/trang) rồi mới ghi file.
  const handleExport = async (type: "excel" | "csv") => {
    const exportColumns = [
      { header: "Mã phiếu", key: "code", width: 15 },
      { header: "Loại chứng từ", key: "referenceTypeName", width: 24 },
      { header: "Hướng", key: "typeName", width: 12 },
      { header: "Chi nhánh", key: "branchName", width: 24 },
      { header: "Mã hàng", key: "productCode", width: 15 },
      { header: "Tên hàng", key: "productName", width: 25 },
      { header: "ĐVT", key: "productUnit", width: 10 },
      { header: "Số lượng biến động", key: "signedQuantity", width: 18 },
      ...(canViewCost
        ? [
            { header: "Đơn giá", key: "unitValue", width: 16 },
            { header: "Giá trị", key: "movementValue", width: 18 },
          ]
        : []),
      { header: "Đối tác/Bộ phận", key: "partner", width: 25 },
      { header: "Người tạo", key: "createdByName", width: 20 },
      { header: "Ghi chú", key: "note", width: 25 },
      {
        header: "Ngày tạo",
        key: "date",
        width: 18,
        format: (v: string) => formatDate(v),
      },
    ];
    if (exporting) return;
    setExporting(true);
    try {
      const presetRange = computeListPresetRange(datePreset);
      const filters = {
        search: search || undefined,
        movementType: typeFilter !== "all" ? typeFilter : undefined,
        branchId: branchFilter !== "all" ? branchFilter : undefined,
        dateFrom: (datePreset === "custom" ? dateFrom : presetRange.from) || undefined,
        dateTo: (datePreset === "custom" ? dateTo : presetRange.to) || undefined,
      };
      const CHUNK = 1000; // PostgREST cắt trần ~1000 dòng/response
      const all: AllStockMovementRow[] = [];
      for (let p = 0; ; p++) {
        const r = await getAllStockMovements({ page: p, pageSize: CHUNK, ...filters });
        all.push(...r.data);
        if (all.length >= r.total || r.data.length < CHUNK) break;
      }
      const exportRows = all.map((row) => ({
        ...row,
        referenceTypeName:
          referenceTypeLabels[row.referenceType ?? ""] ?? row.referenceType ?? "",
        signedQuantity: getSignedStockQuantity(row),
        unitValue: getStockMovementUnitValue(row),
        movementValue: getStockMovementTotalValue(row),
      }));
      const selectedBranch = branches.find((branch) => branch.id === branchFilter)?.name;
      const scopeName = branchFilter === "all" ? "toan-chuoi" : selectedBranch ?? "chi-nhanh";
      const safeScope = scopeName
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .toLowerCase();
      const today = new Date().toISOString().slice(0, 10);
      const fileName = `lich-su-kho_${safeScope}_${today}`;
      if (type === "excel") await exportToExcel(exportRows, exportColumns, fileName);
      else await exportToCsv(exportRows, exportColumns, fileName);
      toast({
        title: "Đã xuất file",
        description: `${all.length} dòng (đầy đủ theo bộ lọc hiện tại)`,
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "Xuất file thất bại",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setExporting(false);
    }
  };

  // Giá kho chỉ hiện khi tài khoản có quyền xem giá vốn.
  const costColumns: ColumnDef<AllStockMovementRow, unknown>[] = canViewCost
    ? [
        {
          id: "unitValue",
          header: "Đơn giá",
          size: 130,
          cell: ({ row }) => {
            const value = getStockMovementUnitValue(row.original);
            return (
              <span className="block text-right tabular-nums">
                {value != null ? formatCurrency(value) : "—"}
              </span>
            );
          },
        },
        {
          id: "movementValue",
          header: "Giá trị",
          size: 140,
          cell: ({ row }) => {
            const value = getStockMovementTotalValue(row.original);
            return (
              <span className="block text-right font-medium tabular-nums">
                {value != null ? formatCurrency(value) : "—"}
              </span>
            );
          },
        },
      ]
    : [];

  // === Columns ===
  const filterChips: ListFilterChip[] = [];
  if (typeFilter !== "all") {
    filterChips.push({
      key: "type",
      label: "Loại phiếu",
      value: movementTypeOptions.find((option) => option.value === typeFilter)?.label ?? typeFilter,
      onClear: () => setTypeFilter("all"),
    });
  }
  if (branchFilter !== "all") {
    filterChips.push({
      key: "branch",
      label: "Chi nhánh",
      value: branches.find((branch) => branch.id === branchFilter)?.name ?? "Đang chọn",
      onClear: () => setBranchFilter("all"),
    });
  }
  if (datePreset !== "all") {
    const dateLabel = datePreset === "custom"
      ? `${dateFrom || "..."} - ${dateTo || "..."}`
      : datePresets.find((preset) => preset.value === datePreset)?.label ?? datePreset;
    filterChips.push({
      key: "date",
      label: "Thời gian",
      value: dateLabel,
      onClear: () => {
        setDatePreset("all");
        setDateFrom("");
        setDateTo("");
      },
    });
  }

  const columns: ColumnDef<AllStockMovementRow, unknown>[] = [
    {
      accessorKey: "code",
      header: "Mã phiếu",
      size: 130,
      cell: ({ row }) => (
        <StockDocumentLink
          referenceType={row.original.referenceType}
          referenceId={row.original.referenceId}
          code={row.original.code}
          className="font-medium"
        />
      ),
    },
    {
      accessorKey: "typeName",
      header: "Loại",
      size: 110,
      cell: ({ row }) => {
        const dbType = feTypeToDbType[row.original.type] ?? row.original.type;
        const badge = movementTypeBadge[dbType];
        if (!badge) {
          return <span className="text-muted-foreground">{row.original.typeName}</span>;
        }
        return (
          <Badge variant="outline" className={badge.className}>
            {badge.label}
          </Badge>
        );
      },
    },
    {
      accessorKey: "branchName",
      header: "Chi nhánh",
      size: 180,
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{row.original.branchName ?? "—"}</div>
          {row.original.branchCode && (
            <div className="text-xs text-muted-foreground">{row.original.branchCode}</div>
          )}
        </div>
      ),
    },
    {
      accessorKey: "productName",
      header: "Sản phẩm",
      size: 250,
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.productName}</div>
          <div className="text-xs text-muted-foreground">
            {row.original.productCode}
          </div>
        </div>
      ),
    },
    {
      accessorKey: "quantity",
      header: "Số lượng",
      size: 100,
      cell: ({ row }) => {
        const dbType = feTypeToDbType[row.original.type] ?? row.original.type;
        const isIn = dbType === "in";
        const isOut = dbType === "out";
        const qty = row.original.quantity;
        const prefix = isIn ? "+" : isOut ? "-" : "";
        const color = isIn
          ? "text-status-success"
          : isOut
          ? "text-status-error"
          : "text-primary";
        return (
          <span className={`font-semibold ${color}`}>
            {prefix}
            {formatNumber(Math.abs(qty))}
          </span>
        );
      },
    },
    ...costColumns,
    {
      accessorKey: "partner",
      header: "Đối tác",
      size: 220,
      // CEO 10/06/2026 — đổi từ "Tham chiếu" (chỉ hiện type rỗng) sang
      // "Đối tác" (KH/NCC/Chi nhánh thật, kèm mã phiếu).
      cell: ({ row }) => {
        const p = row.original.partner;
        const t = row.original.partnerType;
        if (!p) return <span className="text-muted-foreground">--</span>;
        const colorMap = {
          customer: "text-blue-600",
          supplier: "text-emerald-600",
          branch: "text-purple-600",
          system: "text-muted-foreground italic",
        } as const;
        const color = t ? colorMap[t] : "text-foreground";
        return (
          <div className="min-w-0">
            <span className={`text-sm font-medium truncate ${color}`} title={p}>
              {p}
            </span>
          </div>
        );
      },
    },
    {
      accessorKey: "note",
      header: "Ghi chú",
      size: 200,
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground truncate block max-w-[200px]">
          {row.original.note || "--"}
        </span>
      ),
    },
    {
      accessorKey: "date",
      header: "Ngày tạo",
      size: 150,
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {formatDate(row.original.date)}
        </span>
      ),
    },
  ];

  return (
    <ListPageLayout sidebar={null}>
      <PageHeader
        title="Lịch sử kho"
        searchPlaceholder="Theo tên hàng, mã hàng, ghi chú..."
        searchValue={search}
        onSearchChange={setSearch}
        density="compact"
      />

      <DataTable
        columns={columns}
        data={data}
        loading={loading}
        density="compact"
        columnToggle
        toolbarMetrics={
          <>
            <ListMetric label="Dòng biến động" value={formatNumber(movementCounts.total)} tone="primary" />
            <ListMetric label="Dòng nhập" value={formatNumber(movementCounts.inbound)} />
            <ListMetric label="Dòng xuất" value={formatNumber(movementCounts.outbound)} />
          </>
        }
        toolbarActions={
          <>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="relative h-8 gap-1.5 px-2 text-xs pointer-coarse:min-h-11"
              onClick={() => setFilterOpen(true)}
            >
              <Icon name="filter_alt" size={15} />
              <span className="hidden sm:inline">Bộ lọc</span>
              {filterChips.length > 0 && (
                <span className="min-w-4 rounded-full bg-primary px-1 text-xs font-bold text-primary-foreground">
                  {filterChips.length}
                </span>
              )}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleExport("csv")}
              disabled={exporting}
              className="h-8 gap-1.5 px-2 text-xs pointer-coarse:min-h-11"
            >
              <Icon name="description" size={15} />
              <span className="hidden sm:inline">CSV</span>
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={() => void handleExport("excel")}
              disabled={exporting}
              className="h-8 gap-1.5 px-2 text-xs pointer-coarse:min-h-11"
            >
              <Icon
                name={exporting ? "progress_activity" : "table_view"}
                size={15}
                className={exporting ? "animate-spin" : undefined}
              />
              {exporting ? "Đang xuất..." : "Xuất Excel lịch sử kho"}
            </Button>
          </>
        }
        toolbarFooter={
          filterChips.length > 0 ? (
            <FilterChips
              filters={filterChips}
              onClearAll={() => {
                setTypeFilter("all");
                setBranchFilter("all");
                setDatePreset("all");
                setDateFrom("");
                setDateTo("");
              }}
            />
          ) : null
        }
        total={total}
        pageIndex={page}
        pageSize={pageSize}
        pageCount={Math.ceil(total / pageSize)}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(0);
        }}
        getRowId={(r) => r.id}
      />

      <FilterPanel
        open={filterOpen}
        onOpenChange={setFilterOpen}
        activeCount={filterChips.length}
        onClearAll={() => {
          setTypeFilter("all");
          setBranchFilter("all");
          setDatePreset("all");
          setDateFrom("");
          setDateTo("");
        }}
        title="Bộ lọc lịch sử kho"
      >
        <FilterGroup label="Loại phiếu">
          <SelectFilter
            options={movementTypeOptions}
            value={typeFilter}
            onChange={setTypeFilter}
            placeholder="Tất cả"
          />
        </FilterGroup>
        <FilterGroup label="Chi nhánh">
          <SelectFilter
            options={branches.map((branch) => ({ label: branch.name, value: branch.id }))}
            value={branchFilter}
            onChange={setBranchFilter}
            placeholder="Tất cả chi nhánh"
          />
        </FilterGroup>
        <FilterGroup label="Thời gian">
          <DatePresetFilter
            value={datePreset}
            onChange={setDatePreset}
            from={dateFrom}
            to={dateTo}
            onFromChange={setDateFrom}
            onToChange={setDateTo}
            presets={datePresets}
          />
        </FilterGroup>
      </FilterPanel>
    </ListPageLayout>
  );
}
