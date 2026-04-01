"use client";

import { useEffect, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Plus, Printer } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable, StarCell } from "@/components/shared/data-table";
import {
  FilterSidebar,
  FilterGroup,
  CheckboxFilter,
  DatePresetFilter,
  type DatePresetValue,
  PersonFilter,
} from "@/components/shared/filter-sidebar";
import {
  InlineDetailPanel,
  DetailTabs,
  DetailHeader,
  DetailInfoGrid,
  DetailItemsTable,
} from "@/components/shared/inline-detail-panel";
import { formatCurrency, formatDate } from "@/lib/format";
import { exportToExcel, exportToCsv } from "@/lib/utils/export";
import { getReturns, getReturnStatuses } from "@/lib/services";
import type { ReturnOrder } from "@/lib/types";

// --- Status config ---

const statusMap: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" }
> = {
  completed: { label: "Da tra", variant: "default" },
  cancelled: { label: "Da huy", variant: "destructive" },
};

const returnTypeOptions = [
  { label: "Theo hoa don", value: "by_invoice" },
  { label: "Tra nhanh", value: "quick_return" },
  { label: "Chuyen hoan", value: "reverse" },
];

const returnStatusOptions = [
  { label: "Da tra", value: "completed" },
  { label: "Da huy", value: "cancelled" },
];

// --- Inline Detail ---

function ReturnDetail({
  returnOrder,
  onClose,
}: {
  returnOrder: ReturnOrder;
  onClose: () => void;
}) {
  const status = statusMap[returnOrder.status] ?? {
    label: returnOrder.status,
    variant: "secondary" as const,
  };

  return (
    <InlineDetailPanel open onClose={onClose}>
      <DetailTabs
        tabs={[
          {
            id: "info",
            label: "Thong tin",
            content: (
              <div className="space-y-4">
                <DetailHeader
                  title={returnOrder.customerName}
                  code={returnOrder.code}
                  status={{
                    label: status.label,
                    variant: status.variant,
                    className:
                      status.variant === "default"
                        ? "bg-green-100 text-green-700 border-green-200"
                        : status.variant === "destructive"
                          ? "bg-red-100 text-red-700 border-red-200"
                          : undefined,
                  }}
                  subtitle="Chi nhanh trung tam"
                  meta={
                    <div className="flex items-center gap-4 flex-wrap text-xs">
                      <span>
                        Nguoi tao:{" "}
                        <strong>{returnOrder.createdBy}</strong>
                      </span>
                      <span>
                        Nguoi nhan tra:{" "}
                        <strong>{returnOrder.createdBy}</strong>
                      </span>
                      <span>
                        Ngay tra:{" "}
                        <strong>{formatDate(returnOrder.date)}</strong>
                      </span>
                      <span>
                        Hoa don goc:{" "}
                        <strong>{returnOrder.invoiceCode}</strong>
                      </span>
                    </div>
                  }
                />

                <DetailItemsTable
                  columns={[
                    { header: "Ma hang", accessor: "code" as never },
                    { header: "Ten hang", accessor: "name" as never },
                    {
                      header: "So luong",
                      accessor: "quantity" as never,
                      align: "right",
                    },
                    {
                      header: "Don gia",
                      accessor: (item: Record<string, unknown>) =>
                        formatCurrency(item.unitPrice as number),
                      align: "right",
                    },
                    {
                      header: "Thanh tien",
                      accessor: (item: Record<string, unknown>) => (
                        <span className="text-primary font-semibold">
                          {formatCurrency(item.total as number)}
                        </span>
                      ),
                      align: "right",
                    },
                  ]}
                  items={
                    [
                      {
                        code: "SP001",
                        name: "San pham mau",
                        quantity: 1,
                        unitPrice: returnOrder.totalAmount,
                        total: returnOrder.totalAmount,
                      },
                    ] as Record<string, unknown>[]
                  }
                  summary={[
                    {
                      label: "Tong tien hang (1)",
                      value: formatCurrency(returnOrder.totalAmount),
                    },
                    {
                      label: "Can tra khach",
                      value: formatCurrency(returnOrder.totalAmount),
                      className: "font-bold text-base",
                    },
                    {
                      label: "Da tra khach",
                      value: formatCurrency(returnOrder.totalAmount),
                    },
                  ]}
                />

                <div className="border rounded-md p-3">
                  <textarea
                    placeholder="Ghi chu..."
                    className="w-full text-sm resize-none bg-transparent outline-none min-h-[60px]"
                  />
                </div>
              </div>
            ),
          },
          {
            id: "payment_history",
            label: "Lich su thanh toan",
            content: (
              <div className="text-sm text-muted-foreground py-4 text-center">
                Chua co lich su thanh toan
              </div>
            ),
          },
        ]}
      />
    </InlineDetailPanel>
  );
}

// --- Page ---

export default function TraHangPage() {
  const [data, setData] = useState<ReturnOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [starred, setStarred] = useState<Set<string>>(new Set());

  // Filters
  const [selectedTypes, setSelectedTypes] = useState<string[]>([
    "by_invoice",
    "quick_return",
    "reverse",
  ]);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([
    "completed",
  ]);
  const [datePreset, setDatePreset] = useState<DatePresetValue>("this_month");
  const [createdBy, setCreatedBy] = useState("");
  const [receiver, setReceiver] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    const result = await getReturns({
      page,
      pageSize,
      search,
      filters: {
        ...(selectedStatuses.length > 0 && { status: selectedStatuses }),
        ...(selectedTypes.length > 0 && { type: selectedTypes }),
      },
    });
    setData(result.data);
    setTotal(result.total);
    setLoading(false);
  }, [page, pageSize, search, selectedStatuses, selectedTypes]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(0);
    setExpandedRow(null);
  }, [search, selectedStatuses, selectedTypes, datePreset, createdBy, receiver]);

  const toggleStar = (id: string) => {
    setStarred((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalReturnAmount = data.reduce((sum, o) => sum + o.totalAmount, 0);

  const handleExport = (type: "excel" | "csv") => {
    const exportColumns = [
      { header: "Ma tra hang", key: "code", width: 15 },
      { header: "Nguoi ban", key: "createdBy", width: 18 },
      {
        header: "Thoi gian",
        key: "date",
        width: 18,
        format: (v: string) => formatDate(v),
      },
      { header: "Khach hang", key: "customerName", width: 25 },
      {
        header: "Tong tien hang",
        key: "totalAmount",
        width: 15,
        format: (v: number) => v,
      },
      {
        header: "Trang thai",
        key: "status",
        width: 15,
        format: (v: string) => statusMap[v]?.label ?? v,
      },
    ];
    if (type === "excel")
      exportToExcel(data, exportColumns, "danh-sach-tra-hang");
    else exportToCsv(data, exportColumns, "danh-sach-tra-hang");
  };

  const columns: ColumnDef<ReturnOrder, unknown>[] = [
    {
      id: "star",
      header: "",
      size: 36,
      enableSorting: false,
      enableHiding: false,
      cell: ({ row }) => (
        <StarCell
          starred={starred.has(row.original.id)}
          onToggle={() => toggleStar(row.original.id)}
        />
      ),
    },
    {
      accessorKey: "code",
      header: "Ma tra hang",
      size: 130,
      cell: ({ row }) => (
        <span className="font-medium text-primary">{row.original.code}</span>
      ),
    },
    {
      accessorKey: "createdBy",
      header: "Nguoi ban",
      size: 130,
    },
    {
      accessorKey: "date",
      header: "Thoi gian",
      size: 150,
      cell: ({ row }) => formatDate(row.original.date),
    },
    {
      accessorKey: "customerCode",
      header: "Ma KH",
      size: 100,
      cell: ({ row }) =>
        (row.original as ReturnOrder & { customerCode?: string })
          .customerCode ?? "-",
    },
    {
      accessorKey: "customerName",
      header: "Khach hang",
      size: 180,
    },
    {
      accessorKey: "totalAmount",
      header: "Tong tien hang",
      cell: ({ row }) => (
        <span className="text-right block">
          {formatCurrency(row.original.totalAmount)}
        </span>
      ),
    },
    {
      id: "refundAmount",
      header: "Can tra khach",
      cell: ({ row }) => (
        <span className="text-right block text-primary font-semibold">
          {formatCurrency(row.original.totalAmount)}
        </span>
      ),
    },
  ];

  return (
    <ListPageLayout
      sidebar={
        <FilterSidebar>
          <FilterGroup label="Loai tra hang">
            <CheckboxFilter
              options={returnTypeOptions}
              selected={selectedTypes}
              onChange={setSelectedTypes}
            />
          </FilterGroup>

          <FilterGroup label="Trang thai">
            <CheckboxFilter
              options={returnStatusOptions}
              selected={selectedStatuses}
              onChange={setSelectedStatuses}
            />
          </FilterGroup>

          <FilterGroup label="Thoi gian">
            <DatePresetFilter
              value={datePreset}
              onChange={setDatePreset}
            />
          </FilterGroup>

          <FilterGroup label="Nguoi tao">
            <PersonFilter
              value={createdBy}
              onChange={setCreatedBy}
              placeholder="Chon nguoi tao"
            />
          </FilterGroup>

          <FilterGroup label="Nguoi nhan tra">
            <PersonFilter
              value={receiver}
              onChange={setReceiver}
              placeholder="Chon nguoi nhan tra"
            />
          </FilterGroup>
        </FilterSidebar>
      }
    >
      <PageHeader
        title="Tra hang"
        searchPlaceholder="Theo ma phieu tra, hoa don, khach hang"
        searchValue={search}
        onSearchChange={setSearch}
        onExport={{
          excel: () => handleExport("excel"),
          csv: () => handleExport("csv"),
        }}
        actions={[
          {
            label: "Tra hang",
            icon: <Plus className="h-4 w-4" />,
            variant: "default",
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
        selectable
        summaryRow={{
          totalAmount: formatCurrency(totalReturnAmount),
          refundAmount: formatCurrency(totalReturnAmount),
        }}
        expandedRow={expandedRow}
        onExpandedRowChange={setExpandedRow}
        renderDetail={(returnOrder, onClose) => (
          <ReturnDetail returnOrder={returnOrder} onClose={onClose} />
        )}
        rowActions={(row) => [
          {
            label: "In phieu tra",
            icon: <Printer className="h-4 w-4" />,
            onClick: () => {},
          },
        ]}
      />
    </ListPageLayout>
  );
}
