"use client";

// Lịch sử xuất/nhập kho — xem tất cả stock movements, lọc theo loại, chi nhánh, thời gian

import { useEffect, useState, useCallback, useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable } from "@/components/shared/data-table";
import {
  FilterSidebar,
  FilterGroup,
  SelectFilter,
  DatePresetFilter,
  type DatePresetValue,
} from "@/components/shared/filter-sidebar";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/lib/contexts";
import { formatDate, formatNumber } from "@/lib/format";
import { exportToExcel, exportToCsv } from "@/lib/utils/export";
import { getAllStockMovements, getBranches } from "@/lib/services";
import type { AllStockMovementRow } from "@/lib/services/supabase";
import type { BranchDetail } from "@/lib/services/supabase";
import { Icon } from "@/components/ui/icon";

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
  { label: "Kiểm kho", value: "adjust" },
  { label: "Chuyển kho", value: "transfer" },
];

// === Date presets ===
// CEO 06/06/2026 Phase 3: dùng STANDARD_LIST_PRESETS_WITH_ALL từ utility chung
// thay vì define local (11 option chuẩn KiotViet).
import {
  computeListPresetRange,
  STANDARD_LIST_PRESETS_WITH_ALL as datePresets,
} from "@/lib/utils/list-date-preset-range";

// === Reference type display ===
const referenceTypeLabels: Record<string, string> = {
  invoice: "Hóa đơn",
  purchase_order: "Đơn nhập hàng",
  production_order: "Lệnh sản xuất",
  inventory_check: "Phiếu kiểm kho",
  disposal: "Phiếu xuất hủy",
  internal_export: "Xuất nội bộ",
  transfer: "Chuyển kho",
  return: "Trả hàng",
  pos: "POS Retail",
  // E (07/07): bổ sung nhãn còn thiếu — trước hiện mã thô (vd "bom_consume").
  bom_consume: "Tiêu hao công thức",
  modifier_topping: "Topping (tùy chọn)",
  invoice_void: "Hủy HĐ (hoàn kho)",
  sales_return: "Trả hàng bán",
  supplier_return: "Trả hàng nhập (NCC)",
  purchase_return: "Trả hàng nhập (NCC)",
  internal_sale: "Bán nội bộ",
  input_invoice: "Hóa đơn đầu vào",
  initial_stock_import: "Nhập tồn đầu kỳ",
  production_reconcile: "Đối soát sản xuất",
  production_complete: "Nhập kho sản xuất",
  production_consume: "Tiêu hao sản xuất",
  return_bom_restore: "Hồi NVL trả hàng",
  stock_adjustment: "Điều chỉnh tồn",
  purchase_entry: "Phiếu nhập hàng",
  goods_receipt: "Nhập hàng",
};

export default function LichSuKhoPage() {
  const { toast } = useToast();
  const [data, setData] = useState<AllStockMovementRow[]>([]);
  const [total, setTotal] = useState(0);
  const [branches, setBranches] = useState<BranchDetail[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);

  // Filters
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [branchFilter, setBranchFilter] = useState<string>("all");
  const [datePreset, setDatePreset] = useState<DatePresetValue>("this_month");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  // Load branches once
  useEffect(() => {
    getBranches()
      .then(setBranches)
      .catch((err: unknown) => {
        console.error("[lich-su-kho] load branches failed:", err);
        setBranches([]);
      });
  }, []);

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

      const result = await getAllStockMovements({
        page,
        pageSize,
        search: search || undefined,
        movementType: typeFilter !== "all" ? typeFilter : undefined,
        branchId: branchFilter !== "all" ? branchFilter : undefined,
        dateFrom: effectiveDateFrom || undefined,
        dateTo: effectiveDateTo || undefined,
      });
      setData(result.data);
      setTotal(result.total);
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

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [search, typeFilter, branchFilter, datePreset, dateFrom, dateTo]);

  // === Summary stats ===
  const totalIn = useMemo(
    () =>
      data
        .filter((r) => r.type === "import")
        .reduce((sum, r) => sum + Math.abs(r.quantity), 0),
    [data]
  );
  const totalOut = useMemo(
    () =>
      data
        .filter((r) => r.type === "export")
        .reduce((sum, r) => sum + Math.abs(r.quantity), 0),
    [data]
  );

  // === Export ===
  // CEO 17/07 (Thẻ kho Đợt 1): xuất TOÀN BỘ dữ liệu theo bộ lọc hiện tại.
  // Trước đây xuất state `data` — vốn chỉ là 1 TRANG (mặc định 20 dòng) do
  // getAllStockMovements phân trang server-side → file mở được, có số, nhưng
  // THIẾU dữ liệu âm thầm. Nay fetch lại đủ (chunk 1000/trang) rồi mới ghi file.
  const handleExport = async (type: "excel" | "csv") => {
    const exportColumns = [
      { header: "Mã phiếu", key: "code", width: 15 },
      { header: "Loại", key: "typeName", width: 12 },
      { header: "Mã hàng", key: "productCode", width: 15 },
      { header: "Tên hàng", key: "productName", width: 25 },
      { header: "Số lượng", key: "quantity", width: 12 },
      {
        header: "Tham chiếu",
        key: "referenceType",
        width: 20,
        format: (v: string) => referenceTypeLabels[v] ?? v ?? "",
      },
      { header: "Ghi chú", key: "note", width: 25 },
      {
        header: "Ngày tạo",
        key: "date",
        width: 18,
        format: (v: string) => formatDate(v),
      },
    ];
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
      if (type === "excel") await exportToExcel(all, exportColumns, "lich-su-kho");
      else await exportToCsv(all, exportColumns, "lich-su-kho");
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
    }
  };

  // === Columns ===
  const columns: ColumnDef<AllStockMovementRow, unknown>[] = [
    {
      accessorKey: "code",
      header: "Mã phiếu",
      size: 130,
      cell: ({ row }) => (
        <span className="font-medium text-primary">{row.original.code}</span>
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
    {
      accessorKey: "partner",
      header: "Đối tác",
      size: 220,
      // CEO 10/06/2026 — đổi từ "Tham chiếu" (chỉ hiện type rỗng) sang
      // "Đối tác" (KH/NCC/Chi nhánh thật, kèm mã phiếu).
      cell: ({ row }) => {
        const p = row.original.partner;
        const t = row.original.partnerType;
        const code = row.original.referenceCode;
        if (!p) return <span className="text-muted-foreground">--</span>;
        const colorMap = {
          customer: "text-blue-600",
          supplier: "text-emerald-600",
          branch: "text-purple-600",
          system: "text-muted-foreground italic",
        } as const;
        const color = t ? colorMap[t] : "text-foreground";
        return (
          <div className="flex flex-col gap-0.5">
            <span className={`text-sm font-medium truncate ${color}`} title={p}>
              {p}
            </span>
            {code && (
              <span className="text-[10px] font-mono text-muted-foreground">
                {code}
              </span>
            )}
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
    <ListPageLayout
      sidebar={
        <FilterSidebar>
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
              options={branches.map((b) => ({
                label: b.name,
                value: b.id,
              }))}
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
        </FilterSidebar>
      }
    >
      <PageHeader
        title="Lịch sử kho"
        searchPlaceholder="Theo tên hàng, mã hàng, ghi chú..."
        searchValue={search}
        onSearchChange={setSearch}
        onExport={{
          excel: () => handleExport("excel"),
          csv: () => handleExport("csv"),
        }}
      />

      {/* Summary cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 px-4 pt-4">
        <SummaryCard
          icon={<Icon name="history" size={16} />}
          label="Tổng phiếu"
          value={total.toString()}
        />
        <SummaryCard
          icon={<Icon name="arrow_circle_down" size={16} className="text-status-success" />}
          label="Tổng nhập"
          value={`+${formatNumber(totalIn)}`}
          highlight
        />
        <SummaryCard
          icon={<Icon name="arrow_circle_up" size={16} className="text-status-error" />}
          label="Tổng xuất"
          value={`-${formatNumber(totalOut)}`}
          danger={totalOut > 0}
        />
      </div>

      <DataTable
        columns={columns}
        data={data}
        loading={loading}
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
    </ListPageLayout>
  );
}

function SummaryCard({
  icon,
  label,
  value,
  highlight,
  danger,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  highlight?: boolean;
  danger?: boolean;
}) {
  return (
    <div
      className={`border rounded-lg p-3 bg-background ${
        highlight ? "border-primary/30 bg-primary/5" : ""
      } ${danger ? "border-destructive/30 bg-destructive/5" : ""}`}
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        {icon}
        <span>{label}</span>
      </div>
      <div
        className={`text-lg font-semibold ${
          highlight ? "text-primary" : danger ? "text-destructive" : ""
        }`}
      >
        {value}
      </div>
    </div>
  );
}
