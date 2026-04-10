"use client";

// Lịch sử xuất/nhập kho — xem tất cả stock movements, lọc theo loại, chi nhánh, thời gian

import { useEffect, useState, useCallback, useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { History, ArrowDownCircle, ArrowUpCircle, PackageCheck } from "lucide-react";
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
import { formatDate } from "@/lib/format";
import { exportToExcel, exportToCsv } from "@/lib/utils/export";
import { getAllStockMovements, getBranches } from "@/lib/services";
import type { AllStockMovementRow } from "@/lib/services/supabase";
import type { BranchDetail } from "@/lib/services/supabase";

// === Movement type badge config ===
const movementTypeBadge: Record<
  string,
  { label: string; className: string }
> = {
  in: {
    label: "Nhập",
    className: "bg-green-50 text-green-700 border-green-200",
  },
  out: {
    label: "Xuất",
    className: "bg-red-50 text-red-700 border-red-200",
  },
  adjust: {
    label: "Kiểm kho",
    className: "bg-blue-50 text-blue-700 border-blue-200",
  },
  transfer: {
    label: "Chuyển kho",
    className: "bg-purple-50 text-purple-700 border-purple-200",
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
const datePresets: { label: string; value: DatePresetValue }[] = [
  { label: "Hôm nay", value: "today" },
  { label: "Hôm qua", value: "yesterday" },
  { label: "Tuần này", value: "this_week" },
  { label: "Tháng này", value: "this_month" },
  { label: "Tháng trước", value: "last_month" },
  { label: "Tất cả", value: "all" },
  { label: "Tùy chỉnh", value: "custom" },
];

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
  pos: "Bán hàng POS",
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
      .catch(() => setBranches([]));
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getAllStockMovements({
        page,
        pageSize,
        search: search || undefined,
        movementType: typeFilter !== "all" ? typeFilter : undefined,
        branchId: branchFilter !== "all" ? branchFilter : undefined,
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
  }, [page, pageSize, search, typeFilter, branchFilter, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Reset page when filters change
  useEffect(() => {
    setPage(0);
  }, [search, typeFilter, branchFilter, datePreset]);

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
  const handleExport = (type: "excel" | "csv") => {
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
    if (type === "excel") exportToExcel(data, exportColumns, "lich-su-kho");
    else exportToCsv(data, exportColumns, "lich-su-kho");
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
          ? "text-green-600"
          : isOut
          ? "text-red-600"
          : "text-blue-600";
        return (
          <span className={`font-semibold ${color}`}>
            {prefix}
            {Math.abs(qty)}
          </span>
        );
      },
    },
    {
      accessorKey: "referenceType",
      header: "Tham chiếu",
      size: 170,
      cell: ({ row }) => {
        const refType = row.original.referenceType;
        if (!refType) return <span className="text-muted-foreground">--</span>;
        return (
          <span className="text-sm">
            {referenceTypeLabels[refType] ?? refType}
          </span>
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
          icon={<History className="h-4 w-4" />}
          label="Tổng phiếu"
          value={total.toString()}
        />
        <SummaryCard
          icon={<ArrowDownCircle className="h-4 w-4 text-green-600" />}
          label="Tổng nhập"
          value={`+${totalIn}`}
          highlight
        />
        <SummaryCard
          icon={<ArrowUpCircle className="h-4 w-4 text-red-600" />}
          label="Tổng xuất"
          value={`-${totalOut}`}
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
