"use client";

import { useEffect, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Plus, Eye, Printer, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable } from "@/components/shared/data-table";
import {
  FilterSidebar,
  FilterGroup,
  SelectFilter,
  DateRangeFilter,
} from "@/components/shared/filter-sidebar";
import { CreateCashTransactionDialog } from "@/components/shared/dialogs";
import { formatCurrency, formatDate } from "@/lib/format";
import { exportToExcel, exportToCsv } from "@/lib/utils/export";
import { getCashBookEntries, getCashBookTypes, getCashBookSummary } from "@/lib/services";
import type { CashBookEntry } from "@/lib/types";

// === Columns ===
const columns: ColumnDef<CashBookEntry, unknown>[] = [
  {
    accessorKey: "code",
    header: "Mã phiếu",
    size: 120,
    cell: ({ row }) => (
      <span className="font-medium text-primary">{row.original.code}</span>
    ),
  },
  {
    accessorKey: "date",
    header: "Thời gian",
    size: 150,
    cell: ({ row }) => formatDate(row.original.date),
  },
  {
    accessorKey: "typeName",
    header: "Loại",
    size: 110,
    cell: ({ row }) => {
      const variant =
        row.original.type === "receipt" ? "default" : "destructive";
      return <Badge variant={variant}>{row.original.typeName}</Badge>;
    },
  },
  {
    accessorKey: "category",
    header: "Danh mục",
    size: 160,
  },
  {
    accessorKey: "counterparty",
    header: "Đối tượng",
    size: 180,
  },
  {
    accessorKey: "amount",
    header: "Số tiền",
    cell: ({ row }) => {
      const isReceipt = row.original.type === "receipt";
      return (
        <span
          className={`font-medium ${
            isReceipt ? "text-green-600" : "text-destructive"
          }`}
        >
          {isReceipt ? "+" : "-"}
          {formatCurrency(row.original.amount)}
        </span>
      );
    },
  },
  {
    accessorKey: "note",
    header: "Ghi chú",
    size: 180,
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.note || "—"}
      </span>
    ),
  },
  {
    accessorKey: "createdBy",
    header: "Người tạo",
    size: 130,
  },
];

export default function SoQuyPage() {
  const [data, setData] = useState<CashBookEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [search, setSearch] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [createType, setCreateType] = useState<"receipt" | "payment">("receipt");

  // Filters
  const [typeFilter, setTypeFilter] = useState("all");
  const [datePreset, setDatePreset] = useState<
    "today" | "this_week" | "this_month" | "all" | "custom"
  >("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const typeOptions = getCashBookTypes();

  const fetchData = useCallback(async () => {
    setLoading(true);
    const result = await getCashBookEntries({
      page,
      pageSize,
      search,
      filters: {
        ...(typeFilter !== "all" && { type: typeFilter }),
      },
    });
    setData(result.data);
    setTotal(result.total);
    setLoading(false);
  }, [search, typeFilter, page, pageSize]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleExport = (type: "excel" | "csv") => {
    const exportColumns = [
      { header: "Mã phiếu", key: "code", width: 15 },
      { header: "Thời gian", key: "date", width: 18, format: (v: string) => formatDate(v) },
      { header: "Loại", key: "typeName", width: 12 },
      { header: "Danh mục", key: "category", width: 20 },
      { header: "Đối tượng", key: "counterparty", width: 22 },
      { header: "Số tiền", key: "amount", width: 15, format: (v: number) => v },
    ];
    if (type === "excel") exportToExcel(data, exportColumns, "so-quy");
    else exportToCsv(data, exportColumns, "so-quy");
  };

  // Summary calculations
  const { totalReceipt, totalPayment } = getCashBookSummary();

  const summaryRow: Record<string, string | number> = {
    code: "Tổng cộng",
    typeName: "",
    category: "",
    counterparty: "",
    amount: "",
    note: `Thu: ${formatCurrency(totalReceipt)} | Chi: ${formatCurrency(totalPayment)}`,
    createdBy: "",
    date: "",
  };

  return (
    <>
    <ListPageLayout
      sidebar={
        <FilterSidebar>
          <FilterGroup label="Loại phiếu">
            <SelectFilter
              options={typeOptions}
              value={typeFilter}
              onChange={setTypeFilter}
              placeholder="Tất cả"
            />
          </FilterGroup>
          <FilterGroup label="Thời gian">
            <DateRangeFilter
              preset={datePreset}
              onPresetChange={setDatePreset}
              from={dateFrom}
              to={dateTo}
              onFromChange={setDateFrom}
              onToChange={setDateTo}
            />
          </FilterGroup>
        </FilterSidebar>
      }
    >
      <PageHeader
        title="Sổ quỹ"
        searchPlaceholder="Theo mã phiếu, đối tượng"
        searchValue={search}
        onSearchChange={(v) => {
          setSearch(v);
          setPage(0);
        }}
        onExport={{ excel: () => handleExport("excel"), csv: () => handleExport("csv") }}
        actions={[
          {
            label: "Tạo phiếu thu",
            icon: <Plus className="h-4 w-4" />,
            variant: "default",
            onClick: () => { setCreateType("receipt"); setCreateOpen(true); },
          },
          {
            label: "Tạo phiếu chi",
            icon: <Plus className="h-4 w-4" />,
            variant: "outline",
            onClick: () => { setCreateType("payment"); setCreateOpen(true); },
          },
        ]}
      />
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
        summaryRow={summaryRow}
        rowActions={(row) => [
          { label: "Xem chi tiết", icon: <Eye className="h-4 w-4" />, onClick: () => {} },
          { label: "In phiếu", icon: <Printer className="h-4 w-4" />, onClick: () => {} },
          { label: "Xóa", icon: <Trash2 className="h-4 w-4" />, onClick: () => {}, variant: "destructive", separator: true },
        ]}
      />
    </ListPageLayout>

    <CreateCashTransactionDialog
      open={createOpen}
      onOpenChange={setCreateOpen}
      defaultType={createType}
      onSuccess={fetchData}
    />
    </>
  );
}
