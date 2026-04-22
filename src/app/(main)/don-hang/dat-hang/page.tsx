"use client";

import { useEffect, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
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
  SelectFilter,
} from "@/components/shared/filter-sidebar";
import {
  InlineDetailPanel,
  DetailTabs,
  DetailHeader,
  DetailInfoGrid,
  DetailItemsTable,
  AuditHistoryTab,
} from "@/components/shared/inline-detail-panel";
import { useToast, useBranchFilter } from "@/lib/contexts";
import { usePrintWithPicker } from "@/lib/hooks/use-print-with-picker";
import { buildSalesOrderPrintData } from "@/lib/print-templates";
import { formatCurrency, formatDate, formatUser } from "@/lib/format";
import { exportToExcel, exportToCsv } from "@/lib/utils/export";
import { getOrders } from "@/lib/services";
import type { SalesOrder } from "@/lib/types";
import { CreateOrderDialog, ConfirmDialog } from "@/components/shared/dialogs";
import { Icon } from "@/components/ui/icon";

// --- Status config ---

const statusMap: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  new: { label: "Phiếu tạm", variant: "secondary" },
  confirmed: { label: "Đã xác nhận", variant: "default" },
  delivering: { label: "Đang giao hàng", variant: "outline" },
  completed: { label: "Hoàn thành", variant: "default" },
  cancelled: { label: "Đã hủy", variant: "destructive" },
};

const statusFilterOptions = [
  { label: "Phiếu tạm", value: "new" },
  { label: "Đang giao hàng", value: "delivering" },
  { label: "Hoàn thành", value: "completed" },
];

const deliveryPartnerOptions = [
  { label: "Giao Hàng Nhanh", value: "ghn" },
  { label: "Giao Hàng Tiết Kiệm", value: "ghtk" },
  { label: "Viettel Post", value: "vtp" },
  { label: "J&T Express", value: "jt" },
];

const deliveryAreaOptions = [
  { label: "Miền Bắc", value: "north" },
  { label: "Miền Trung", value: "central" },
  { label: "Miền Nam", value: "south" },
];

// --- Inline detail ---

function OrderDetail({
  order,
  onClose,
  onEdit,
  onDelete,
}: {
  order: SalesOrder;
  onClose: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const status = statusMap[order.status] ?? {
    label: order.statusName,
    variant: "secondary" as const,
  };

  return (
    <InlineDetailPanel open onClose={onClose} onEdit={onEdit} onDelete={onDelete}>
      <DetailTabs
        tabs={[
          {
            id: "info",
            label: "Thông tin",
            content: (
              <div className="space-y-4">
                <DetailHeader
                  title={order.customerName}
                  code={order.code}
                  status={{
                    label: status.label,
                    variant: status.variant,
                    className:
                      status.variant === "default"
                        ? "bg-status-success/10 text-status-success border-status-success/25"
                        : undefined,
                  }}
                  subtitle="Chi nhánh trung tâm"
                  meta={
                    <div className="flex items-center gap-4 flex-wrap text-xs">
                      <span>
                        Người tạo: <strong>{formatUser(undefined, order.createdBy)}</strong>
                      </span>
                      <span>
                        Ngày đặt: <strong>{formatDate(order.date)}</strong>
                      </span>
                      <span>
                        SĐT: <strong>{order.customerPhone}</strong>
                      </span>
                    </div>
                  }
                />

                <DetailInfoGrid
                  fields={[
                    { label: "Mã đặt hàng", value: order.code },
                    {
                      label: "Khách hàng",
                      value: order.customerName,
                    },
                    { label: "SĐT", value: order.customerPhone },
                    {
                      label: "Trạng thái",
                      value: (
                        <Badge variant={status.variant}>{status.label}</Badge>
                      ),
                    },
                  ]}
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
                        unitPrice: order.totalAmount,
                        total: order.totalAmount,
                      },
                    ] as Record<string, unknown>[]
                  }
                  summary={[
                    {
                      label: "Tổng tiền hàng (1)",
                      value: formatCurrency(order.totalAmount),
                    },
                    {
                      label: "Khách cần trả",
                      value: formatCurrency(order.totalAmount),
                      className: "font-bold text-base",
                    },
                    {
                      label: "Khách đã trả",
                      value: formatCurrency(0),
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
            label: "Lịch sử",
            content: <AuditHistoryTab entityType="sales_order" entityId={order.id} />,
          },
        ]}
      />
    </InlineDetailPanel>
  );
}

// --- Page ---

export default function DatHangPage() {
  const { toast } = useToast();
  const { activeBranchId } = useBranchFilter();
  const { printWithPicker, printerDialog } = usePrintWithPicker();
  const [data, setData] = useState<SalesOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [starred, setStarred] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  const [cancellingItem, setCancellingItem] = useState<SalesOrder | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);

  // Filters
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([
    "new",
    "delivering",
    "completed",
  ]);
  const [datePreset, setDatePreset] = useState<DatePresetValue>("this_month");
  const [deliveryPartner, setDeliveryPartner] = useState("all");
  const [deliveryDatePreset, setDeliveryDatePreset] =
    useState<DatePresetValue>("all");
  const [deliveryArea, setDeliveryArea] = useState("all");

  const fetchData = useCallback(async () => {
    setLoading(true);
    const result = await getOrders({
      page,
      pageSize,
      search,
      branchId: activeBranchId,
      filters: {
        ...(selectedStatuses.length > 0 && { status: selectedStatuses }),
      },
    });
    setData(result.data);
    setTotal(result.total);
    setLoading(false);
  }, [page, pageSize, search, selectedStatuses, activeBranchId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(0);
    setExpandedRow(null);
  }, [search, selectedStatuses, datePreset, deliveryPartner, deliveryDatePreset, deliveryArea]);

  const toggleStar = (id: string) => {
    setStarred((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalAmount = data.reduce((sum, o) => sum + o.totalAmount, 0);

  const handleExport = (type: "excel" | "csv") => {
    const exportColumns = [
      { header: "Mã đặt hàng", key: "code", width: 15 },
      {
        header: "Thời gian",
        key: "date",
        width: 18,
        format: (v: string) => formatDate(v),
      },
      { header: "Khách hàng", key: "customerName", width: 25 },
      {
        header: "Tổng tiền",
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
      exportToExcel(data, exportColumns, "danh-sach-dat-hang");
    else exportToCsv(data, exportColumns, "danh-sach-dat-hang");
  };

  // --- Columns ---

  const columns: ColumnDef<SalesOrder, unknown>[] = [
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
      header: "Mã đặt hàng",
      size: 130,
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
      accessorKey: "customerCode",
      header: "Mã KH",
      size: 100,
      cell: () => "—",
    },
    {
      accessorKey: "customerName",
      header: "Khách hàng",
      size: 180,
    },
    {
      accessorKey: "totalAmount",
      header: "Khách cần trả",
      cell: ({ row }) => (
        <span className="text-right block">
          {formatCurrency(row.original.totalAmount)}
        </span>
      ),
    },
    {
      id: "paidAmount",
      header: "Khách đã trả",
      cell: () => (
        <span className="text-right block">{formatCurrency(0)}</span>
      ),
    },
    {
      accessorKey: "status",
      header: "Trạng thái",
      cell: ({ row }) => {
        const s = statusMap[row.original.status] ?? {
          label: row.original.statusName,
          variant: "secondary" as const,
        };
        return <Badge variant={s.variant}>{s.label}</Badge>;
      },
    },
  ];

  return (
    <>
    <ListPageLayout
      sidebar={
        <FilterSidebar>
          <FilterGroup label="Thời gian">
            <DatePresetFilter value={datePreset} onChange={setDatePreset} />
          </FilterGroup>

          <FilterGroup label="Trạng thái">
            <CheckboxFilter
              options={statusFilterOptions}
              selected={selectedStatuses}
              onChange={setSelectedStatuses}
            />
          </FilterGroup>

          <FilterGroup label="Đối tác giao hàng">
            <SelectFilter
              options={deliveryPartnerOptions}
              value={deliveryPartner}
              onChange={setDeliveryPartner}
              placeholder="Chọn đối tác giao hàng"
            />
          </FilterGroup>

          <FilterGroup label="Thời gian giao hàng">
            <DatePresetFilter
              value={deliveryDatePreset}
              onChange={setDeliveryDatePreset}
            />
          </FilterGroup>

          <FilterGroup label="Khu vực giao hàng">
            <SelectFilter
              options={deliveryAreaOptions}
              value={deliveryArea}
              onChange={setDeliveryArea}
              placeholder="Chọn khu vực"
            />
          </FilterGroup>
        </FilterSidebar>
      }
    >
      <PageHeader
        title="Đặt hàng"
        searchPlaceholder="Theo mã đơn, khách hàng"
        searchValue={search}
        onSearchChange={setSearch}
        onExport={{
          excel: () => handleExport("excel"),
          csv: () => handleExport("csv"),
        }}
        actions={[
          {
            label: "Đặt hàng",
            icon: <Icon name="add" size={16} />,
            variant: "default",
            onClick: () => setCreateOpen(true),
          },
          {
            label: "Gộp đơn",
            icon: <Icon name="layers" size={16} />,
            variant: "outline",
            onClick: () => toast({ variant: "info", title: "Tính năng gộp đơn sẽ có trong phiên bản tới" }),
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
          totalAmount: formatCurrency(totalAmount),
        }}
        expandedRow={expandedRow}
        onExpandedRowChange={setExpandedRow}
        renderDetail={(order, onClose) => (
          <OrderDetail
            order={order}
            onClose={onClose}
            onDelete={
              order.status !== "completed" && order.status !== "cancelled"
                ? () => setCancellingItem(order)
                : undefined
            }
          />
        )}
        rowActions={(row) => [
          {
            label: "In phiếu",
            icon: <Icon name="print" size={16} />,
            onClick: () => printWithPicker(buildSalesOrderPrintData(row), "In đơn đặt hàng"),
          },
          ...(row.status !== "completed" && row.status !== "cancelled"
            ? [
                {
                  label: "Hủy",
                  icon: <Icon name="cancel" size={16} />,
                  onClick: () => setCancellingItem(row),
                  variant: "destructive" as const,
                  separator: true,
                },
              ]
            : []),
        ]}
      />
    </ListPageLayout>

    <CreateOrderDialog
      open={createOpen}
      onOpenChange={setCreateOpen}
      onSuccess={fetchData}
    />

    <ConfirmDialog
      open={!!cancellingItem}
      onOpenChange={(open) => { if (!open) setCancellingItem(null); }}
      title="Hủy đơn đặt hàng"
      description={`Bạn có chắc muốn hủy đơn đặt hàng ${cancellingItem?.code ?? ""}? Thao tác này không thể hoàn tác.`}
      confirmLabel="Hủy đơn"
      cancelLabel="Đóng"
      variant="destructive"
      loading={cancelLoading}
      onConfirm={async () => {
        if (!cancellingItem) return;
        setCancelLoading(true);
        try {
          // Mock data — toast success + refetch
          toast({
            title: "Đã hủy đơn đặt hàng",
            description: `Đơn ${cancellingItem.code} đã được hủy thành công`,
            variant: "success",
          });
          await fetchData();
        } finally {
          setCancelLoading(false);
          setCancellingItem(null);
        }
      }}
    />

    {printerDialog}
    </>
  );
}
