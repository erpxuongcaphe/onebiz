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
import { useToast, useBranchFilter } from "@/lib/contexts";
import { printDocument } from "@/lib/print-document";
import { buildReturnPrintData } from "@/lib/print-templates";
import { formatCurrency, formatDate } from "@/lib/format";
import { exportToExcel, exportToCsv } from "@/lib/utils/export";
import { getReturns, getReturnStatuses } from "@/lib/services";
import type { ReturnOrder } from "@/lib/types";
import { CreateReturnDialog } from "@/components/shared/dialogs";

// --- Status config ---

const statusMap: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" }
> = {
  completed: { label: "Đã trả", variant: "default" },
  cancelled: { label: "Đã hủy", variant: "destructive" },
};

const returnTypeOptions = [
  { label: "Theo hóa đơn", value: "by_invoice" },
  { label: "Trả nhanh", value: "quick_return" },
  { label: "Chuyển hoàn", value: "reverse" },
];

const returnStatusOptions = [
  { label: "Đã trả", value: "completed" },
  { label: "Đã hủy", value: "cancelled" },
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
            label: "Thông tin",
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
                  subtitle="Chi nhánh trung tâm"
                  meta={
                    <div className="flex items-center gap-4 flex-wrap text-xs">
                      <span>
                        Người tạo:{" "}
                        <strong>{returnOrder.createdBy}</strong>
                      </span>
                      <span>
                        Người nhận trả:{" "}
                        <strong>{returnOrder.createdBy}</strong>
                      </span>
                      <span>
                        Ngày trả:{" "}
                        <strong>{formatDate(returnOrder.date)}</strong>
                      </span>
                      <span>
                        Hóa đơn gốc:{" "}
                        <strong>{returnOrder.invoiceCode}</strong>
                      </span>
                    </div>
                  }
                />

                <DetailItemsTable
                  columns={[
                    { header: "Mã hàng", accessor: "code" as never },
                    { header: "Tên hàng", accessor: "name" as never },
                    {
                      header: "Số lượng",
                      accessor: "quantity" as never,
                      align: "right",
                    },
                    {
                      header: "Đơn giá",
                      accessor: (item: Record<string, unknown>) =>
                        formatCurrency(item.unitPrice as number),
                      align: "right",
                    },
                    {
                      header: "Thành tiền",
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
                        name: "Sản phẩm mẫu",
                        quantity: 1,
                        unitPrice: returnOrder.totalAmount,
                        total: returnOrder.totalAmount,
                      },
                    ] as Record<string, unknown>[]
                  }
                  summary={[
                    {
                      label: "Tổng tiền hàng (1)",
                      value: formatCurrency(returnOrder.totalAmount),
                    },
                    {
                      label: "Cần trả khách",
                      value: formatCurrency(returnOrder.totalAmount),
                      className: "font-bold text-base",
                    },
                    {
                      label: "Đã trả khách",
                      value: formatCurrency(returnOrder.totalAmount),
                    },
                  ]}
                />

                <div className="border rounded-md p-3">
                  <textarea
                    placeholder="Ghi chú..."
                    className="w-full text-sm resize-none bg-transparent outline-none min-h-[60px]"
                  />
                </div>
              </div>
            ),
          },
          {
            id: "payment_history",
            label: "Lịch sử thanh toán",
            content: (
              <div className="text-sm text-muted-foreground py-4 text-center">
                Chưa có lịch sử thanh toán
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
  const { toast } = useToast();
  const { activeBranchId } = useBranchFilter();
  const [data, setData] = useState<ReturnOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [starred, setStarred] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);

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
      branchId: activeBranchId,
      filters: {
        ...(selectedStatuses.length > 0 && { status: selectedStatuses }),
        ...(selectedTypes.length > 0 && { type: selectedTypes }),
      },
    });
    setData(result.data);
    setTotal(result.total);
    setLoading(false);
  }, [page, pageSize, search, selectedStatuses, selectedTypes, activeBranchId]);

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
      { header: "Mã trả hàng", key: "code", width: 15 },
      { header: "Người bán", key: "createdBy", width: 18 },
      {
        header: "Thời gian",
        key: "date",
        width: 18,
        format: (v: string) => formatDate(v),
      },
      { header: "Khách hàng", key: "customerName", width: 25 },
      {
        header: "Tổng tiền hàng",
        key: "totalAmount",
        width: 15,
        format: (v: number) => v,
      },
      {
        header: "Trạng thái",
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
      header: "Mã trả hàng",
      size: 130,
      cell: ({ row }) => (
        <span className="font-medium text-primary">{row.original.code}</span>
      ),
    },
    {
      accessorKey: "createdBy",
      header: "Người bán",
      size: 130,
    },
    {
      accessorKey: "date",
      header: "Thời gian",
      size: 150,
      cell: ({ row }) => formatDate(row.original.date),
    },
    {
      accessorKey: "customerCode",
      header: "Mã KH",
      size: 100,
      cell: ({ row }) =>
        (row.original as ReturnOrder & { customerCode?: string })
          .customerCode ?? "-",
    },
    {
      accessorKey: "customerName",
      header: "Khách hàng",
      size: 180,
    },
    {
      accessorKey: "totalAmount",
      header: "Tổng tiền hàng",
      cell: ({ row }) => (
        <span className="text-right block">
          {formatCurrency(row.original.totalAmount)}
        </span>
      ),
    },
    {
      id: "refundAmount",
      header: "Cần trả khách",
      cell: ({ row }) => (
        <span className="text-right block text-primary font-semibold">
          {formatCurrency(row.original.totalAmount)}
        </span>
      ),
    },
  ];

  return (
    <>
    <ListPageLayout
      sidebar={
        <FilterSidebar>
          <FilterGroup label="Loại trả hàng">
            <CheckboxFilter
              options={returnTypeOptions}
              selected={selectedTypes}
              onChange={setSelectedTypes}
            />
          </FilterGroup>

          <FilterGroup label="Trạng thái">
            <CheckboxFilter
              options={returnStatusOptions}
              selected={selectedStatuses}
              onChange={setSelectedStatuses}
            />
          </FilterGroup>

          <FilterGroup label="Thời gian">
            <DatePresetFilter
              value={datePreset}
              onChange={setDatePreset}
            />
          </FilterGroup>

          <FilterGroup label="Người tạo">
            <PersonFilter
              value={createdBy}
              onChange={setCreatedBy}
              placeholder="Chọn người tạo"
            />
          </FilterGroup>

          <FilterGroup label="Người nhận trả">
            <PersonFilter
              value={receiver}
              onChange={setReceiver}
              placeholder="Chọn người nhận trả"
            />
          </FilterGroup>
        </FilterSidebar>
      }
    >
      <PageHeader
        title="Trả hàng"
        searchPlaceholder="Theo mã phiếu trả, hóa đơn, khách hàng"
        searchValue={search}
        onSearchChange={setSearch}
        onExport={{
          excel: () => handleExport("excel"),
          csv: () => handleExport("csv"),
        }}
        actions={[
          {
            label: "Trả hàng",
            icon: <Plus className="h-4 w-4" />,
            variant: "default",
            onClick: () => setCreateOpen(true),
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
            label: "In phiếu trả",
            icon: <Printer className="h-4 w-4" />,
            onClick: () => printDocument(buildReturnPrintData({
              code: row.code,
              date: row.date,
              customerName: row.customerName,
              totalRefund: row.totalAmount,
              createdBy: row.createdBy,
            })),
          },
        ]}
      />
    </ListPageLayout>

    <CreateReturnDialog
      open={createOpen}
      onOpenChange={setCreateOpen}
      onSuccess={fetchData}
    />
    </>
  );
}
