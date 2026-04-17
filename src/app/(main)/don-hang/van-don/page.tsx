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
  SelectFilter,
  DatePresetFilter,
  type DatePresetValue,
} from "@/components/shared/filter-sidebar";
import {
  InlineDetailPanel,
  DetailTabs,
  DetailHeader,
  DetailInfoGrid,
} from "@/components/shared/inline-detail-panel";
import { formatCurrency, formatDate } from "@/lib/format";
import { exportToExcel, exportToCsv } from "@/lib/utils/export";
import { getShippingOrders, getShippingStatuses, getPartnerOptions } from "@/lib/services";
import { CreateShippingOrderDialog } from "@/components/shared/dialogs";
import type { ShippingOrder } from "@/lib/types";
import { useBranchFilter } from "@/lib/contexts";
import { Icon } from "@/components/ui/icon";

// --- Status config ---

const statusMap: Record<
  ShippingOrder["status"],
  { label: string; variant: "default" | "secondary" | "outline" | "destructive" }
> = {
  pending: { label: "Chờ lấy hàng", variant: "secondary" },
  picking: { label: "Đang lấy hàng", variant: "outline" },
  shipping: { label: "Đang giao", variant: "outline" },
  delivered: { label: "Đã giao", variant: "default" },
  failed: { label: "Giao thất bại", variant: "destructive" },
  returned: { label: "Đã hoàn", variant: "destructive" },
};

const statusOptions = getShippingStatuses();
const partnerOptions = getPartnerOptions();

const deliveryRegionOptions = [
  { label: "Miền Bắc", value: "north" },
  { label: "Miền Trung", value: "central" },
  { label: "Miền Nam", value: "south" },
];

/* ------------------------------------------------------------------ */
/*  Starred set                                                        */
/* ------------------------------------------------------------------ */
function useStarredSet() {
  const [starred, setStarred] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setStarred((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return { starred, toggle };
}

/* ------------------------------------------------------------------ */
/*  Inline detail                                                      */
/* ------------------------------------------------------------------ */
function ShippingOrderDetail({
  order,
  onClose,
}: {
  order: ShippingOrder;
  onClose: () => void;
}) {
  const status = statusMap[order.status];

  return (
    <InlineDetailPanel open onClose={onClose}>
      <DetailTabs
        tabs={[
          {
            id: "receiver",
            label: "Thông tin người nhận",
            content: (
              <DetailInfoGrid
                columns={2}
                fields={[
                  { label: "Người nhận", value: order.customerName },
                  { label: "Điện thoại", value: order.customerPhone },
                  { label: "Địa chỉ", value: order.address, fullWidth: true },
                  { label: "Khu vực", value: "—" },
                ]}
              />
            ),
          },
          {
            id: "invoice",
            label: "Thông tin hóa đơn",
            content: (
              <DetailInfoGrid
                columns={2}
                fields={[
                  { label: "Mã HD", value: order.invoiceCode },
                  { label: "Chi nhánh", value: "Chi nhánh trung tâm" },
                  { label: "Khách hàng", value: order.customerName },
                  {
                    label: "Số lượng hàng",
                    value: "1",
                  },
                  {
                    label: "Giá trị",
                    value: formatCurrency(order.cod),
                  },
                ]}
              />
            ),
          },
          {
            id: "payment_history",
            label: "Lịch sử thanh toán với ĐTGH",
            content: (
              <div className="text-sm text-muted-foreground py-4 text-center">
                Chưa có lịch sử thanh toán
              </div>
            ),
          },
          {
            id: "delivery_history",
            label: "Lịch sử giao hàng",
            content: (
              <div className="text-sm text-muted-foreground py-4 text-center">
                Chưa có lịch sử giao hàng
              </div>
            ),
          },
        ]}
        defaultTab="receiver"
      />
    </InlineDetailPanel>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */
export default function VanDonPage() {
  const { activeBranchId } = useBranchFilter();
  const [data, setData] = useState<ShippingOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  // Stars
  const { starred, toggle: toggleStar } = useStarredSet();

  // Filters
  const [statusFilter, setStatusFilter] = useState("all");
  const [partnerFilter, setPartnerFilter] = useState("all");
  const [createdDatePreset, setCreatedDatePreset] = useState<DatePresetValue>("all");
  const [completedDatePreset, setCompletedDatePreset] = useState<DatePresetValue>("all");
  const [regionFilter, setRegionFilter] = useState("all");

  const fetchData = useCallback(async () => {
    setLoading(true);
    const result = await getShippingOrders({
      page,
      pageSize,
      search,
      branchId: activeBranchId,
      filters: {
        ...(statusFilter !== "all" && { status: statusFilter }),
        ...(partnerFilter !== "all" && { partner: partnerFilter }),
        ...(regionFilter !== "all" && { region: regionFilter }),
      },
    });
    setData(result.data);
    setTotal(result.total);
    setLoading(false);
  }, [page, pageSize, search, statusFilter, partnerFilter, regionFilter, activeBranchId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(0);
    setExpandedRow(null);
  }, [search, statusFilter, partnerFilter, createdDatePreset, completedDatePreset, regionFilter]);

  /* ---- Export ---- */
  const handleExport = (type: "excel" | "csv") => {
    const exportColumns = [
      { header: "Mã vận đơn", key: "code", width: 15 },
      { header: "Thời gian tạo", key: "createdAt", width: 18, format: (v: string) => formatDate(v) },
      { header: "Mã hóa đơn", key: "invoiceCode", width: 15 },
      { header: "Khách hàng", key: "customerName", width: 25 },
      { header: "Đối tác giao hàng", key: "deliveryPartner", width: 20 },
      {
        header: "Trạng thái",
        key: "status",
        width: 15,
        format: (v: ShippingOrder["status"]) => statusMap[v]?.label ?? v,
      },
    ];
    if (type === "excel") exportToExcel(data, exportColumns, "danh-sach-van-don");
    else exportToCsv(data, exportColumns, "danh-sach-van-don");
  };

  /* ---- Columns ---- */
  const columns: ColumnDef<ShippingOrder, unknown>[] = [
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
      header: "Mã vận đơn",
      size: 130,
      cell: ({ row }) => (
        <span className="font-medium text-primary">{row.original.code}</span>
      ),
    },
    {
      accessorKey: "createdAt",
      header: "Thời gian tạo",
      size: 150,
      cell: ({ row }) => formatDate(row.original.createdAt),
    },
    {
      accessorKey: "invoiceCode",
      header: "Mã hóa đơn",
      size: 120,
    },
    {
      id: "customerCode",
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
      accessorKey: "deliveryPartner",
      header: "Đối tác giao hàng",
      size: 160,
    },
    {
      accessorKey: "status",
      header: "Trạng thái giao",
      cell: ({ row }) => {
        const s = statusMap[row.original.status];
        return <Badge variant={s.variant}>{s.label}</Badge>;
      },
    },
    {
      id: "deliveredAt",
      header: "Thời gian giao",
      size: 150,
      cell: ({ row }) =>
        row.original.status === "delivered" ? formatDate(row.original.createdAt) : "—",
    },
  ];

  /* ---- Render ---- */
  return (
    <ListPageLayout
      sidebar={
        <FilterSidebar>
          <FilterGroup label="Trạng thái giao hàng">
            <SelectFilter
              options={statusOptions}
              value={statusFilter}
              onChange={setStatusFilter}
              placeholder="Tất cả"
            />
          </FilterGroup>

          <FilterGroup label="Đối tác giao hàng">
            <SelectFilter
              options={partnerOptions}
              value={partnerFilter}
              onChange={setPartnerFilter}
              placeholder="Tất cả"
            />
          </FilterGroup>

          <FilterGroup label="Thời gian tạo">
            <DatePresetFilter
              value={createdDatePreset}
              onChange={setCreatedDatePreset}
            />
          </FilterGroup>

          <FilterGroup label="Thời gian hoàn thành">
            <DatePresetFilter
              value={completedDatePreset}
              onChange={setCompletedDatePreset}
            />
          </FilterGroup>

          <FilterGroup label="Khu vực giao hàng">
            <SelectFilter
              options={deliveryRegionOptions}
              value={regionFilter}
              onChange={setRegionFilter}
              placeholder="Tất cả"
            />
          </FilterGroup>
        </FilterSidebar>
      }
    >
      <PageHeader
        title="Vận đơn"
        searchPlaceholder="Theo mã vận đơn, SĐT"
        searchValue={search}
        onSearchChange={setSearch}
        onExport={{
          excel: () => handleExport("excel"),
          csv: () => handleExport("csv"),
        }}
        actions={[
          {
            label: "Tạo vận đơn",
            icon: <Icon name="add" size={16} />,
            variant: "default",
            onClick: () => setCreateOpen(true),
          },
        ]}
      />

      <CreateShippingOrderDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={fetchData}
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
        expandedRow={expandedRow}
        onExpandedRowChange={setExpandedRow}
        renderDetail={(order, onClose) => (
          <ShippingOrderDetail order={order} onClose={onClose} />
        )}
        getRowId={(row) => row.id}
      />
    </ListPageLayout>
  );
}
