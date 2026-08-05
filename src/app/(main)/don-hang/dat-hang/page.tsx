"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useRevalidateOnFocus } from "@/lib/hooks/use-revalidate-on-focus";
import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable, StarCell } from "@/components/shared/data-table";
import { AllBranchesBanner } from "@/components/shared/all-branches-banner";
import { SummaryCard } from "@/components/shared/summary-card";
import {
  FilterSidebar,
  FilterGroup,
  DatePresetFilter,
  type DatePresetValue,
  SelectFilter,
  CheckboxFilter,
} from "@/components/shared/filter-sidebar";
// CEO 06/06/2026 Phase 3: chuẩn hoá 11 preset thời gian
import {
  STANDARD_LIST_PRESETS,
  STANDARD_LIST_PRESETS_WITH_ALL,
} from "@/lib/utils/list-date-preset-range";
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
import { buildSalesOrderPrintData, toPrintLines } from "@/lib/print-templates";
import { formatCurrency, formatDate, formatNumber, formatUser } from "@/lib/format";
import { exportToExcel, exportToCsv } from "@/lib/utils/export";
import { computeListPresetRange } from "@/lib/utils/list-date-preset-range";
import {
  getOrders,
  cancelInvoice,
  getDraftOrderItems,
  getDraftOrderById,
  getShippingOrderByInvoice,
  type SalesOrderItemRow,
} from "@/lib/services";
import type { EditOrderInput } from "@/components/shared/dialogs/create-order-dialog";
import type { SalesOrder, ShippingOrder } from "@/lib/types";
import { CancelImpactDialog } from "@/components/shared/dialogs/cancel-impact-dialog";
import { CreateShipmentDialog } from "@/components/shared/dialogs/create-shipment-dialog";
import { Button } from "@/components/ui/button";
// PERF (CEO 23/05/2026): Lazy-load CreateOrderDialog (562 dòng).
import dynamic from "next/dynamic";
const CreateOrderDialog = dynamic(
  () =>
    import("@/components/shared/dialogs/create-order-dialog").then(
      (m) => m.CreateOrderDialog,
    ),
  { ssr: false },
);
import { AuditLogDialog } from "@/components/shared/audit-log-dialog";
import { buildTransactionRowActions } from "@/components/shared/transaction-row-actions";
import { useTxRowPermissions } from "@/lib/permissions";
import { Icon } from "@/components/ui/icon";

// --- Status config ---

const statusMap: Record<
  string,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline" }
> = {
  draft: { label: "Chờ xử lý", variant: "secondary" },
  new: { label: "Phiếu tạm", variant: "secondary" },
  confirmed: { label: "Đã xác nhận", variant: "default" },
  delivering: { label: "Đang giao hàng", variant: "outline" },
  completed: { label: "Hoàn thành", variant: "default" },
  cancelled: { label: "Đã hủy", variant: "destructive" },
};

// Bộ lọc trạng thái cho sidebar — chỉ 3 mốc chính người dùng quan tâm.
const statusFilterOptions = [
  { label: "Chờ xử lý", value: "draft" },
  { label: "Hoàn thành", value: "completed" },
  { label: "Đã hủy", value: "cancelled" },
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
  onDataChanged,
}: {
  order: SalesOrder;
  onClose: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  /** Gọi khi data đơn đổi (gắn vận đơn làm tổng tiền đổi) → refetch list. */
  onDataChanged?: () => void;
}) {
  // CEO 14/07: đơn đã xuất hóa đơn RIÊNG → hiện "Đã xuất hóa đơn" ở mọi nơi
  // trong chi tiết (không phải trạng thái bán, số bán thật ở hóa đơn kia).
  const status = order.fulfilledById
    ? {
        label: order.fulfilledInvoiceCode
          ? `Đã xuất hóa đơn · ${order.fulfilledInvoiceCode}`
          : "Đã xuất hóa đơn",
        variant: "default" as const,
      }
    : statusMap[order.status] ?? {
        label: order.statusName,
        variant: "secondary" as const,
      };

  // Lazy fetch line items thật (P0 audit fix — trước hardcode "SP001").
  const [items, setItems] = useState<SalesOrderItemRow[]>([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  // CEO 08/07: vận đơn gắn đơn — khối "Giao hàng" + nút "Tạo vận đơn" khi chưa có.
  const [shipment, setShipment] = useState<ShippingOrder | null>(null);
  const [shipDialogOpen, setShipDialogOpen] = useState(false);
  const loadShipment = useCallback(() => {
    getShippingOrderByInvoice(order.id)
      .then(setShipment)
      .catch(() => setShipment(null));
  }, [order.id]);
  useEffect(() => {
    let cancelled = false;
    setItemsLoading(true);
    getDraftOrderItems(order.id)
      .then((rows) => { if (!cancelled) setItems(rows); })
      .catch(() => { if (!cancelled) setItems([]); })
      .finally(() => { if (!cancelled) setItemsLoading(false); });
    loadShipment();
    return () => { cancelled = true; };
  }, [order.id, loadShipment]);

  const subtotal = items.reduce((s, it) => s + it.unitPrice * it.quantity, 0);
  const itemDiscountSum = items.reduce((s, it) => s + it.discount, 0);

  return (
    <InlineDetailPanel
      open
      onClose={onClose}
      onEdit={onEdit}
      onDelete={onDelete}
      // CEO 20/07: nút chính = "Sửa đơn" (mở form giống form tạo, có cảnh báo);
      // "Chuyển thành hóa đơn (thu tiền)" nằm trong menu "..." của dòng.
      editLabel="Sửa đơn"
      deleteLabel="Hủy đơn"
    >
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
                  subtitle={order.branchName || "—"}
                  meta={
                    <div className="flex items-center gap-4 flex-wrap text-xs">
                      <span>
                        Người tạo: <strong>{formatUser(order.createdByName, order.createdBy)}</strong>
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

                {/* CEO 08/07: khối Giao hàng — vận đơn gắn đơn (như KiotViet) */}
                {shipment ? (
                  <div className="rounded-lg border bg-muted/20 p-3">
                    <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
                      <Icon name="local_shipping" size={16} />
                      Giao hàng — {shipment.code}
                      <Badge variant="outline">{shipment.statusName}</Badge>
                    </div>
                    <div className="grid gap-1 text-sm sm:grid-cols-2">
                      <div>
                        Người nhận: <strong>{shipment.customerName}</strong>
                        {shipment.customerPhone ? ` — ${shipment.customerPhone}` : ""}
                      </div>
                      <div>
                        Đối tác giao: <strong>{shipment.deliveryPartner}</strong>
                      </div>
                      <div className="sm:col-span-2">
                        Địa chỉ: {shipment.address}
                      </div>
                      <div>
                        Phí giao hàng: <strong>{formatCurrency(shipment.fee ?? 0)}</strong>
                      </div>
                      <div>
                        Thu hộ (COD): <strong>{formatCurrency(shipment.cod ?? 0)}</strong>
                      </div>
                    </div>
                  </div>
                ) : order.status !== "cancelled" ? (
                  <div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShipDialogOpen(true)}
                    >
                      <Icon name="local_shipping" size={16} className="mr-1" />
                      Tạo vận đơn
                    </Button>
                  </div>
                ) : null}

                <CreateShipmentDialog
                  open={shipDialogOpen}
                  onOpenChange={setShipDialogOpen}
                  invoiceId={order.id}
                  invoiceCode={order.code}
                  defaultReceiverName={order.customerName}
                  defaultReceiverPhone={order.customerPhone}
                  currentTotal={order.totalAmount}
                  currentFee={order.shippingFee ?? 0}
                  onSuccess={() => {
                    loadShipment();
                    onDataChanged?.();
                  }}
                />

                {itemsLoading ? (
                  <div className="text-sm text-muted-foreground py-4 text-center">
                    Đang tải sản phẩm...
                  </div>
                ) : items.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-4 text-center">
                    Đơn hàng này không có sản phẩm.
                  </div>
                ) : (
                  <DetailItemsTable
                    columns={[
                      { header: "Mã hàng", accessor: "productCode" as never },
                      { header: "Tên hàng", accessor: "productName" as never },
                      { header: "Đơn vị", accessor: "unit" as never },
                      {
                        header: "SL",
                        accessor: (item: Record<string, unknown>) =>
                          formatNumber(Number(item.quantity ?? 0)),
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
                    items={items as unknown as Record<string, unknown>[]}
                    summary={[
                      {
                        label: `Tổng tiền hàng (${items.length})`,
                        value: formatCurrency(subtotal),
                      },
                      ...(itemDiscountSum > 0
                        ? [
                            {
                              label: "Giảm giá dòng",
                              value: formatCurrency(itemDiscountSum),
                            },
                          ]
                        : []),
                      ...((order.shippingFee ?? 0) > 0
                        ? [
                            {
                              label: "Phí giao hàng",
                              value: formatCurrency(order.shippingFee ?? 0),
                            },
                          ]
                        : []),
                      {
                        label: "Khách cần trả",
                        value: formatCurrency(order.totalAmount),
                        className: "font-bold text-base",
                      },
                    ]}
                  />
                )}

                <div className="border rounded-lg p-3">
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
  const router = useRouter();
  const { activeBranchId, currentBranch } = useBranchFilter();
  const { printWithPicker, printerDialog } = usePrintWithPicker();
  const txPerms = useTxRowPermissions("sales_order");
  const [data, setData] = useState<SalesOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  // CEO 05/07: ô "Tìm theo" — "all" = gộp mã+tên+SĐT như cũ.
  const [searchField, setSearchField] = useState("all");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [starred, setStarred] = useState<Set<string>>(new Set());
  const [createOpen, setCreateOpen] = useState(false);
  // CEO 20/07: sửa đơn qua chính form tạo (đồng bộ) — null = không sửa.
  const [editingOrder, setEditingOrder] = useState<EditOrderInput | null>(null);
  const [loadingEdit, setLoadingEdit] = useState(false);
  const [cancellingItem, setCancellingItem] = useState<SalesOrder | null>(null);
  // Sprint UX-1 Stage 4: Audit log dialog
  const [auditDialogTarget, setAuditDialogTarget] = useState<SalesOrder | null>(null);

  // Filters
  const [datePreset, setDatePreset] = useState<DatePresetValue>("this_month");
  // CEO 08/07: lọc trạng thái — rỗng = tất cả (đơn đã giữ đủ mọi trạng thái).
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [deliveryPartner, setDeliveryPartner] = useState("all");
  const [deliveryDatePreset, setDeliveryDatePreset] =
    useState<DatePresetValue>("all");
  const [deliveryArea, setDeliveryArea] = useState("all");
  // CEO 08/07: xem tất cả chi nhánh (cục bộ) khi bảng trống vì lọc chi nhánh.
  const [viewAllBranches, setViewAllBranches] = useState(false);
  const [otherBranchCount, setOtherBranchCount] = useState(0);
  // Đổi chi nhánh ở global switcher → về lại chế độ lọc theo chi nhánh.
  useEffect(() => {
    setViewAllBranches(false);
  }, [activeBranchId]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    // Trước đây không có try/finally: truy vấn lỗi là cờ loading không bao giờ
    // tắt → trang treo mãi ở vòng xoay, không nói vì sao.
    try {
    // FIX (CEO 08/07): áp ô "Thời gian" (trước đây không lọc ngày). getOrders
    // đọc hóa đơn nháp — bỏ lọc status cũ (mọi đơn đều là nháp/chờ xử lý).
    const presetRange = computeListPresetRange(datePreset);
    const commonFilters: Record<string, string | string[]> = {
      ...(presetRange.from && { dateFrom: presetRange.from }),
      ...(presetRange.to && { dateTo: presetRange.to }),
      ...(selectedStatuses.length > 0 && { status: selectedStatuses }),
    };
    const branchScope = viewAllBranches ? undefined : activeBranchId;
    const result = await getOrders({
      page,
      pageSize,
      search,
      searchField,
      branchId: branchScope,
      filters: commonFilters,
    });
    setData(result.data);
    setTotal(result.total);
    // Bảng trống vì lọc chi nhánh? Đếm phiếu ở chi nhánh khác để gợi ý (cùng bộ
    // lọc, bỏ branch). Chỉ khi đang lọc theo 1 chi nhánh cụ thể.
    if (result.data.length === 0 && !viewAllBranches && activeBranchId) {
      const all = await getOrders({
        page: 0,
        pageSize: 1,
        search,
        searchField,
        branchId: undefined,
        filters: commonFilters,
      });
      setOtherBranchCount(all.total);
    } else {
      setOtherBranchCount(0);
    }
    } catch (e) {
      toast({
        variant: "error",
        title: "Không tải được danh sách đơn đặt hàng",
        description: e instanceof Error ? e.message : "Lỗi không xác định",
      });
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, search, searchField, datePreset, selectedStatuses, activeBranchId, viewAllBranches, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // CEO 20/07: mở form SỬA đơn — load đủ dòng hàng rồi bật dialog (chế độ sửa).
  const openEditOrder = useCallback(
    async (row: SalesOrder) => {
      setLoadingEdit(true);
      try {
        const detail = await getDraftOrderById(row.id);
        if (!detail) {
          toast({ title: "Không tải được đơn để sửa", variant: "error" });
          return;
        }
        setEditingOrder({
          id: detail.id,
          code: detail.code,
          customerId: detail.customerId,
          customerName: detail.customerName,
          deliveryFee: detail.deliveryFee ?? row.shippingFee ?? 0,
          note: detail.note,
          items: detail.items.map((it) => ({
            productId: it.productId,
            productName: it.productName,
            unit: it.unit,
            quantity: it.quantity,
            price: it.unitPrice,
            note: it.note,
          })),
        });
      } catch (err) {
        toast({
          title: "Không tải được đơn để sửa",
          description: err instanceof Error ? err.message : undefined,
          variant: "error",
        });
      } finally {
        setLoadingEdit(false);
      }
    },
    [toast],
  );

  // CEO 23/05/2026: refetch khi tab visible/focus lại → fix bug F5 stale
  useRevalidateOnFocus(fetchData);

  useEffect(() => {
    setPage(0);
    setExpandedRow(null);
  }, [search, datePreset, selectedStatuses, deliveryPartner, deliveryDatePreset, deliveryArea]);

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
      cell: ({ row }) => (
        <span className="text-right block">
          {formatCurrency(row.original.paid ?? 0)}
        </span>
      ),
    },
    {
      accessorKey: "status",
      header: "Trạng thái",
      cell: ({ row }) => {
        // CEO 14/07: đơn đã xuất thành hóa đơn RIÊNG → badge "Đã xuất hóa đơn"
        // (không phải một lần bán riêng; số bán thật ở hóa đơn kia).
        if (row.original.fulfilledById) {
          return (
            <Badge
              variant="default"
              className="bg-status-success/10 text-status-success border-status-success/25"
            >
              Đã xuất hóa đơn
              {row.original.fulfilledInvoiceCode
                ? ` · ${row.original.fulfilledInvoiceCode}`
                : ""}
            </Badge>
          );
        }
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
            <DatePresetFilter
              value={datePreset}
              onChange={setDatePreset}
              presets={STANDARD_LIST_PRESETS}
            />
          </FilterGroup>

          {/* CEO 08/07: lọc "Trạng thái" — đơn đặt hàng nay GIỮ qua mọi trạng
              thái (Chờ xử lý → Hoàn thành → Đã hủy) nên lọc lại có ý nghĩa.
              Rỗng = tất cả. */}
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
              presets={STANDARD_LIST_PRESETS_WITH_ALL}
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
        searchFields={[
          { value: "all", label: "Tất cả" },
          { value: "code", label: "Mã đơn" },
          { value: "customer_name", label: "Khách hàng" },
          { value: "customer_phone", label: "SĐT" },
        ]}
        searchField={searchField}
        onSearchFieldChange={(v) => {
          setSearchField(v);
          setPage(0);
        }}
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

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 pt-4">
        <SummaryCard
          icon={<Icon name="receipt_long" size={16} />}
          label="Tổng đơn"
          value={total.toString()}
        />
        <SummaryCard
          icon={<Icon name="shopping_bag" size={16} />}
          label="Tổng tiền hàng"
          value={formatCurrency(
            data
              .filter((r) => r.status !== "cancelled" && !r.fulfilledById)
              .reduce(
                (sum, r) => sum + ((r.totalAmount ?? 0) - (r.shippingFee ?? 0)),
                0,
              ),
          )}
        />
        <SummaryCard
          icon={<Icon name="local_shipping" size={16} />}
          label="Tổng phí giao"
          value={formatCurrency(
            data
              .filter((r) => r.status !== "cancelled" && !r.fulfilledById)
              .reduce((sum, r) => sum + (r.shippingFee ?? 0), 0),
          )}
        />
        <SummaryCard
          icon={<Icon name="payments" size={16} />}
          label="Tổng cần thu"
          value={formatCurrency(
            data
              .filter((r) => r.status !== "cancelled" && !r.fulfilledById)
              .reduce((sum, r) => sum + (r.debt ?? 0), 0),
          )}
        />
      </div>

      {viewAllBranches && (
        <AllBranchesBanner
          branchName={currentBranch?.name}
          onBackToBranch={() => setViewAllBranches(false)}
        />
      )}

      <DataTable
        columns={columns}
        data={data}
        loading={loading}
        total={total}
        emptyBranchHint={{
          otherBranchCount,
          onViewAllBranches: () => setViewAllBranches(true),
          entityLabel: "đơn đặt hàng",
        }}
        pageIndex={page}
        pageSize={pageSize}
        pageCount={Math.ceil(total / pageSize)}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(0);
        }}
        selectable
        bulkActions={[
          {
            label: "Xuất Excel",
            icon: <Icon name="download" size={16} />,
            onClick: (selectedRows) => {
              const cols = [
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
              exportToExcel(selectedRows, cols, "dat-hang-da-chon");
              toast({
                title: "Đã xuất Excel",
                description: `${selectedRows.length} đơn đặt hàng`,
                variant: "success",
              });
            },
          },
          {
            label: "In hàng loạt",
            icon: <Icon name="print" size={16} />,
            onClick: async (selectedRows) => {
              for (const row of selectedRows) {
                const items = await getDraftOrderItems(row.id);
                printWithPicker(
                  buildSalesOrderPrintData(row, toPrintLines(items)),
                  "In đơn đặt hàng",
                  { channel: "retail", docType: "sales_order", branchId: activeBranchId },
                );
              }
            },
          },
          {
            label: "Hủy hàng loạt",
            icon: <Icon name="cancel" size={16} />,
            variant: "destructive",
            onClick: async (selectedRows) => {
              const cancellable = selectedRows.filter(
                (r) =>
                  r.status !== "completed" &&
                  r.status !== "cancelled" &&
                  !r.fulfilledById, // đơn đã xuất hóa đơn: đã bán rồi, không hủy
              );
              if (cancellable.length === 0) {
                toast({
                  title: "Không có đơn nào có thể hủy",
                  description:
                    "Chỉ hủy được đơn chưa hoàn thành / chưa hủy",
                  variant: "info",
                });
                return;
              }
              if (
                !window.confirm(
                  `Hủy ${cancellable.length} đơn đặt hàng? Thao tác này không thể hoàn tác.`,
                )
              )
                return;
              try {
                await Promise.all(
                  cancellable.map((r) => cancelInvoice(r.id)),
                );
                toast({
                  title: `Đã hủy ${cancellable.length} đơn`,
                  variant: "success",
                });
                await fetchData();
              } catch (err) {
                toast({
                  title: "Lỗi hủy hàng loạt",
                  description:
                    err instanceof Error ? err.message : "Vui lòng thử lại",
                  variant: "error",
                });
              }
            },
          },
        ]}
        summaryRow={{
          totalAmount: formatCurrency(totalAmount),
        }}
        expandedRow={expandedRow}
        onExpandedRowChange={setExpandedRow}
        renderDetail={(order, onClose) => (
          <OrderDetail
            order={order}
            onClose={onClose}
            onDataChanged={fetchData}
            onEdit={
              // CEO 20/07: nút chính "Sửa đơn" → mở form sửa (giống form tạo,
              // có cảnh báo thay đổi). Chuyển thành hóa đơn/thanh toán nằm ở menu.
              order.status !== "completed" && order.status !== "cancelled"
                ? () => openEditOrder(order)
                : undefined
            }
            onDelete={
              order.status !== "completed" && order.status !== "cancelled"
                ? () => setCancellingItem(order)
                : undefined
            }
          />
        )}
        rowActions={(row) =>
          buildTransactionRowActions({
            row,
            kind: "sales_order",
            permissions: txPerms,
            // CEO 20/07: "Sửa đơn" mở form sửa (thêm/bớt hàng + cảnh báo).
            onEdit:
              row.status !== "completed" && row.status !== "cancelled"
                ? () => openEditOrder(row)
                : undefined,
            onPrint: async () => {
              const items = await getDraftOrderItems(row.id);
              printWithPicker(
                buildSalesOrderPrintData(row, toPrintLines(items)),
                "In đơn đặt hàng",
                { channel: "retail", docType: "sales_order", branchId: activeBranchId },
              );
            },
            // "Chuyển thành hóa đơn" (thu tiền) → mở POS. Chỉ đơn chưa hủy/tất toán.
            workflowActions:
              row.status !== "completed" && row.status !== "cancelled"
                ? [{
                    label: "Chuyển thành hóa đơn (thu tiền)",
                    icon: <Icon name="point_of_sale" size={16} />,
                    onClick: () => router.push(`/pos?draftId=${row.id}`),
                  }]
                : [],
            // Audit log shortcut
            onAuditLog: () => setAuditDialogTarget(row),
            // Hủy — chỉ chưa completed/cancelled
            onCancel:
              row.status !== "completed" && row.status !== "cancelled"
                ? () => setCancellingItem(row)
                : undefined,
          })
        }
      />
    </ListPageLayout>

    <CreateOrderDialog
      open={createOpen}
      onOpenChange={setCreateOpen}
      onSuccess={fetchData}
    />

    {loadingEdit && (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/20">
        <div className="flex items-center gap-2 rounded-lg bg-popover px-4 py-3 text-sm shadow-lg">
          <Icon name="progress_activity" size={18} className="animate-spin" />
          Đang tải đơn để sửa...
        </div>
      </div>
    )}

    {/* CEO 20/07: SỬA đơn qua chính form tạo (đồng bộ) — cùng component, chế độ edit */}
    {editingOrder && (
      <CreateOrderDialog
        open={!!editingOrder}
        onOpenChange={(o) => { if (!o) setEditingOrder(null); }}
        onSuccess={fetchData}
        editOrder={editingOrder}
      />
    )}

    {/* 21/07: dialog hủy hợp nhất — đơn đặt hàng chưa phát sinh giao dịch nên
        bảng tác động hiện gọn "chỉ gỡ đơn". Đồng bộ khuôn với trang Hóa đơn. */}
    <CancelImpactDialog
      target={
        cancellingItem
          ? { type: "invoice", id: cancellingItem.id, code: cancellingItem.code }
          : null
      }
      onClose={() => setCancellingItem(null)}
      onDone={fetchData}
      onConfirm={async () => {
        if (!cancellingItem) return;
        await cancelInvoice(cancellingItem.id);
      }}
    />

    {printerDialog}

    {/* Sprint UX-1 Stage 4: Audit log shortcut từ row action */}
    {auditDialogTarget && (
      <AuditLogDialog
        entityType="sales_order"
        entityId={auditDialogTarget.id}
        entityCode={auditDialogTarget.code}
        onClose={() => setAuditDialogTarget(null)}
      />
    )}
    </>
  );
}
