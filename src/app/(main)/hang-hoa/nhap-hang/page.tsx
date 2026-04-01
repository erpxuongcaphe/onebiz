"use client";

import { useEffect, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Plus, Download, Printer, Undo2, XCircle } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable, StarCell } from "@/components/shared/data-table";
import {
  FilterSidebar,
  FilterGroup,
  CheckboxFilter,
  SelectFilter,
  DatePresetFilter,
  PersonFilter,
  type DatePresetValue,
} from "@/components/shared/filter-sidebar";
import {
  InlineDetailPanel,
  DetailTabs,
  DetailHeader,
  DetailInfoGrid,
  DetailItemsTable,
} from "@/components/shared/inline-detail-panel";
import type { DetailTab } from "@/components/shared/inline-detail-panel";
import { formatCurrency, formatDate } from "@/lib/format";
import { exportToExcel, exportToCsv } from "@/lib/utils/export";
import { getPurchaseOrders, getPurchaseOrderStatuses } from "@/lib/services";
import type { PurchaseOrder } from "@/lib/types";

/* ------------------------------------------------------------------ */
/*  Status config                                                      */
/* ------------------------------------------------------------------ */
const statusMap: Record<
  PurchaseOrder["status"],
  { label: string; variant: "secondary" | "default" | "destructive" }
> = {
  draft: { label: "Phiếu tạm", variant: "secondary" },
  imported: { label: "Đã nhập hàng", variant: "default" },
  cancelled: { label: "Đã hủy", variant: "destructive" },
};

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
function PurchaseOrderDetail({
  order,
  onClose,
}: {
  order: PurchaseOrder;
  onClose: () => void;
}) {
  const status = statusMap[order.status];

  const tabs: DetailTab[] = [
    {
      id: "info",
      label: "Thông tin",
      content: (
        <div className="space-y-4">
          <DetailHeader
            title={order.supplierName}
            code={order.code}
            status={{
              label: status.label,
              variant: status.variant,
              className:
                status.variant === "default"
                  ? "bg-blue-100 text-blue-700 border-blue-200"
                  : undefined,
            }}
            subtitle="Chi nhánh trung tâm"
            meta={
              <div className="flex items-center gap-4 flex-wrap text-xs">
                <span>
                  Người tạo: <strong>{order.createdBy}</strong>
                </span>
                {order.importedBy && (
                  <span>
                    Người nhập: <strong>{order.importedBy}</strong>
                  </span>
                )}
                <span>
                  Thời gian: <strong>{formatDate(order.date)}</strong>
                </span>
                {order.orderCode && (
                  <span>
                    Mã đặt hàng nhập: <strong>{order.orderCode}</strong>
                  </span>
                )}
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
                  unitPrice: order.amountOwed,
                  total: order.amountOwed,
                },
              ] as Record<string, unknown>[]
            }
            summary={[
              {
                label: "Tổng tiền hàng",
                value: formatCurrency(order.amountOwed),
              },
              {
                label: "Cần trả NCC",
                value: formatCurrency(order.amountOwed),
                className: "font-bold text-base",
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
  ];

  return (
    <InlineDetailPanel open onClose={onClose}>
      <div className="p-4 space-y-4">
        <DetailTabs tabs={tabs} defaultTab="info" />
      </div>
    </InlineDetailPanel>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */
export default function NhapHangPage() {
  const [data, setData] = useState<PurchaseOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);

  // Inline detail
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  // Stars
  const { starred, toggle: toggleStar } = useStarredSet();

  // Filters
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([
    "draft",
    "imported",
  ]);
  const [datePreset, setDatePreset] = useState<DatePresetValue>("this_month");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [creatorFilter, setCreatorFilter] = useState("");
  const [importerFilter, setImporterFilter] = useState("");
  const [costReturnFilter, setCostReturnFilter] = useState("all");

  const statuses = getPurchaseOrderStatuses();

  /* ---- Columns ---- */
  const columns: ColumnDef<PurchaseOrder, unknown>[] = [
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
      header: "Mã nhập hàng",
      size: 130,
      cell: ({ row }) => (
        <span className="font-medium text-primary">{row.original.code}</span>
      ),
    },
    {
      accessorKey: "orderCode",
      header: "Mã đặt hàng nhập",
      size: 140,
      cell: ({ row }) => row.original.orderCode || "—",
    },
    {
      accessorKey: "date",
      header: "Thời gian",
      size: 150,
      cell: ({ row }) => formatDate(row.original.date),
    },
    {
      accessorKey: "supplierCode",
      header: "Mã NCC",
      size: 100,
      cell: ({ row }) => row.original.supplierCode ?? "—",
    },
    {
      accessorKey: "supplierName",
      header: "Nhà cung cấp",
      size: 220,
    },
    {
      accessorKey: "amountOwed",
      header: "Cần trả NCC",
      cell: ({ row }) => (
        <span className="text-right block">
          {formatCurrency(row.original.amountOwed)}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: "Trạng thái",
      size: 130,
      cell: ({ row }) => {
        const { label } = statusMap[row.original.status];
        if (row.original.status === "imported") {
          return <span className="text-blue-600 font-medium">{label}</span>;
        }
        if (row.original.status === "cancelled") {
          return <span className="text-destructive">{label}</span>;
        }
        return <span className="text-muted-foreground">{label}</span>;
      },
    },
  ];

  /* ---- Fetch data ---- */
  const fetchData = useCallback(async () => {
    setLoading(true);
    const result = await getPurchaseOrders({
      page,
      pageSize,
      search,
      filters: {
        ...(selectedStatuses.length > 0 && { status: selectedStatuses }),
        ...(creatorFilter && { createdBy: creatorFilter }),
        ...(importerFilter && { importedBy: importerFilter }),
        ...(costReturnFilter !== "all" && { costReturn: costReturnFilter }),
      },
    });
    setData(result.data);
    setTotal(result.total);
    setLoading(false);
  }, [page, pageSize, search, selectedStatuses, creatorFilter, importerFilter, costReturnFilter]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(0);
    setExpandedRow(null);
  }, [search, selectedStatuses, datePreset, creatorFilter, importerFilter, costReturnFilter]);

  /* ---- Summary ---- */
  const totalAmountOwed = data.reduce((sum, o) => sum + o.amountOwed, 0);

  /* ---- Export ---- */
  const handleExport = (type: "excel" | "csv") => {
    const exportColumns = [
      { header: "Mã nhập hàng", key: "code", width: 15 },
      { header: "Mã đặt hàng nhập", key: "orderCode", width: 15 },
      { header: "Thời gian", key: "date", width: 18, format: (v: string) => formatDate(v) },
      { header: "Mã NCC", key: "supplierCode", width: 12 },
      { header: "Nhà cung cấp", key: "supplierName", width: 25 },
      { header: "Cần trả NCC", key: "amountOwed", width: 15, format: (v: number) => v },
      {
        header: "Trạng thái",
        key: "status",
        width: 15,
        format: (v: PurchaseOrder["status"]) => statusMap[v]?.label ?? v,
      },
    ];
    if (type === "excel") exportToExcel(data, exportColumns, "danh-sach-nhap-hang");
    else exportToCsv(data, exportColumns, "danh-sach-nhap-hang");
  };

  /* ---- Inline detail renderer ---- */
  const renderDetail = (order: PurchaseOrder, onClose: () => void) => (
    <PurchaseOrderDetail order={order} onClose={onClose} />
  );

  /* ---- Render ---- */
  return (
    <ListPageLayout
      sidebar={
        <FilterSidebar>
          <FilterGroup label="Trạng thái">
            <CheckboxFilter
              options={statuses}
              selected={selectedStatuses}
              onChange={setSelectedStatuses}
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
              presets={[
                { label: "Tháng này", value: "this_month" },
                { label: "Hôm nay", value: "today" },
                { label: "Hôm qua", value: "yesterday" },
                { label: "Tuần này", value: "this_week" },
                { label: "Tháng trước", value: "last_month" },
                { label: "Tùy chỉnh", value: "custom" },
              ]}
            />
          </FilterGroup>

          <FilterGroup label="Người tạo">
            <PersonFilter
              value={creatorFilter}
              onChange={setCreatorFilter}
              placeholder="Chọn người tạo"
              suggestions={[
                { label: "Admin", value: "admin" },
                { label: "Cao Thị Huyền Trang", value: "trang" },
              ]}
            />
          </FilterGroup>

          <FilterGroup label="Người nhập">
            <PersonFilter
              value={importerFilter}
              onChange={setImporterFilter}
              placeholder="Chọn người nhập"
              suggestions={[
                { label: "Admin", value: "admin" },
                { label: "Cao Thị Huyền Trang", value: "trang" },
              ]}
            />
          </FilterGroup>

          <FilterGroup label="Chi phí nhập trả NCC">
            <SelectFilter
              options={[
                { label: "Có chi phí", value: "has_cost" },
                { label: "Không chi phí", value: "no_cost" },
              ]}
              value={costReturnFilter}
              onChange={setCostReturnFilter}
              placeholder="Tất cả"
            />
          </FilterGroup>
        </FilterSidebar>
      }
    >
      <PageHeader
        title="Nhập hàng"
        searchPlaceholder="Theo mã phiếu nhập, mã NCC, tên NCC"
        searchValue={search}
        onSearchChange={setSearch}
        onExport={{
          excel: () => handleExport("excel"),
          csv: () => handleExport("csv"),
        }}
        actions={[
          {
            label: "Nhập hàng",
            icon: <Plus className="h-4 w-4" />,
            variant: "default",
          },
          {
            label: "Xuất file",
            icon: <Download className="h-4 w-4" />,
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
          amountOwed: formatCurrency(totalAmountOwed),
        }}
        expandedRow={expandedRow}
        onExpandedRowChange={setExpandedRow}
        renderDetail={renderDetail}
        getRowId={(row) => row.id}
        rowActions={(row) => [
          {
            label: "In phiếu",
            icon: <Printer className="h-4 w-4" />,
            onClick: () => {},
          },
          {
            label: "Trả hàng nhập",
            icon: <Undo2 className="h-4 w-4" />,
            onClick: () => {},
          },
          {
            label: "Hủy",
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
