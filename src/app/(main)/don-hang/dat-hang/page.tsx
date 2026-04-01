"use client";

import { useEffect, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Plus, Layers, Printer, XCircle } from "lucide-react";
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
} from "@/components/shared/inline-detail-panel";
import { formatCurrency, formatDate } from "@/lib/format";
import { exportToExcel, exportToCsv } from "@/lib/utils/export";
import { getOrders } from "@/lib/services";
import type { SalesOrder } from "@/lib/types";

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
}: {
  order: SalesOrder;
  onClose: () => void;
}) {
  const status = statusMap[order.status] ?? {
    label: order.statusName,
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
                  title={order.customerName}
                  code={order.code}
                  status={{
                    label: status.label,
                    variant: status.variant,
                    className:
                      status.variant === "default"
                        ? "bg-green-100 text-green-700 border-green-200"
                        : undefined,
                  }}
                  subtitle="Chi nhánh trung tâm"
                  meta={
                    <div className="flex items-center gap-4 flex-wrap text-xs">
                      <span>
                        Người tạo: <strong>{order.createdBy}</strong>
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
                        name: "San pham mau",
                        quantity: 1,
                        unitPrice: order.totalAmount,
                        total: order.totalAmount,
                      },
                    ] as Record<string, unknown>[]
                  }
                  summary={[
                    {
                      label: "Tong tien hang (1)",
                      value: formatCurrency(order.totalAmount),
                    },
                    {
                      label: "Khach can tra",
                      value: formatCurrency(order.totalAmount),
                      className: "font-bold text-base",
                    },
                    {
                      label: "Khach da tra",
                      value: formatCurrency(0),
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

export default function DatHangPage() {
  const [data, setData] = useState<SalesOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [starred, setStarred] = useState<Set<string>>(new Set());

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
      filters: {
        ...(selectedStatuses.length > 0 && { status: selectedStatuses }),
      },
    });
    setData(result.data);
    setTotal(result.total);
    setLoading(false);
  }, [page, pageSize, search, selectedStatuses]);

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
      { header: "Ma dat hang", key: "code", width: 15 },
      {
        header: "Thoi gian",
        key: "date",
        width: 18,
        format: (v: string) => formatDate(v),
      },
      { header: "Khach hang", key: "customerName", width: 25 },
      {
        header: "Tong tien",
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
      header: "Ma dat hang",
      size: 130,
      cell: ({ row }) => (
        <span className="font-medium text-primary">{row.original.code}</span>
      ),
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
      cell: () => "—",
    },
    {
      accessorKey: "customerName",
      header: "Khach hang",
      size: 180,
    },
    {
      accessorKey: "totalAmount",
      header: "Khach can tra",
      cell: ({ row }) => (
        <span className="text-right block">
          {formatCurrency(row.original.totalAmount)}
        </span>
      ),
    },
    {
      id: "paidAmount",
      header: "Khach da tra",
      cell: () => (
        <span className="text-right block">{formatCurrency(0)}</span>
      ),
    },
    {
      accessorKey: "status",
      header: "Trang thai",
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
    <ListPageLayout
      sidebar={
        <FilterSidebar>
          <FilterGroup label="Thoi gian">
            <DatePresetFilter value={datePreset} onChange={setDatePreset} />
          </FilterGroup>

          <FilterGroup label="Trang thai">
            <CheckboxFilter
              options={statusFilterOptions}
              selected={selectedStatuses}
              onChange={setSelectedStatuses}
            />
          </FilterGroup>

          <FilterGroup label="Doi tac giao hang">
            <SelectFilter
              options={deliveryPartnerOptions}
              value={deliveryPartner}
              onChange={setDeliveryPartner}
              placeholder="Chon doi tac giao hang"
            />
          </FilterGroup>

          <FilterGroup label="Thoi gian giao hang">
            <DatePresetFilter
              value={deliveryDatePreset}
              onChange={setDeliveryDatePreset}
            />
          </FilterGroup>

          <FilterGroup label="Khu vuc giao hang">
            <SelectFilter
              options={deliveryAreaOptions}
              value={deliveryArea}
              onChange={setDeliveryArea}
              placeholder="Chon khu vuc"
            />
          </FilterGroup>
        </FilterSidebar>
      }
    >
      <PageHeader
        title="Dat hang"
        searchPlaceholder="Theo ma don, khach hang"
        searchValue={search}
        onSearchChange={setSearch}
        onExport={{
          excel: () => handleExport("excel"),
          csv: () => handleExport("csv"),
        }}
        actions={[
          {
            label: "Dat hang",
            icon: <Plus className="h-4 w-4" />,
            variant: "default",
          },
          {
            label: "Gop don",
            icon: <Layers className="h-4 w-4" />,
            variant: "outline",
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
          <OrderDetail order={order} onClose={onClose} />
        )}
        rowActions={(row) => [
          {
            label: "In phieu",
            icon: <Printer className="h-4 w-4" />,
            onClick: () => {},
          },
          {
            label: "Huy",
            icon: <XCircle className="h-4 w-4" />,
            onClick: () => {},
            variant: "destructive",
            separator: true,
          },
        ]}
      />
    </ListPageLayout>
  );
}
