"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import { useRevalidateOnFocus } from "@/lib/hooks/use-revalidate-on-focus";
import { useDebounce } from "@/lib/utils/use-debounce";
import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable, StarCell } from "@/components/shared/data-table";
import { AllBranchesBanner } from "@/components/shared/all-branches-banner";
import { ListMetric } from "@/components/shared/list-metric";
import {
  FilterChips,
  type ListFilterChip,
} from "@/components/shared/filter-chips";
import {
  FilterPanel,
  FilterGroup,
  DatePresetFilter,
  type DatePresetValue,
  SelectFilter,
  CheckboxFilter,
} from "@/components/shared/filter-sidebar";
import { Input } from "@/components/ui/input";
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
import { DocumentNoteBox } from "@/components/shared/document-note-box";
import { usePrintWithPicker } from "@/lib/hooks/use-print-with-picker";
import { buildSalesOrderPrintData, toPrintLines } from "@/lib/print-templates";
import { formatCurrency, formatDate, formatNumber, formatUser } from "@/lib/format";
import { exportToExcel, exportToCsv } from "@/lib/utils/export";
import { computeListPresetRange } from "@/lib/utils/list-date-preset-range";
import {
  cancelInvoice,
  getDraftOrderItems,
  getDraftOrderById,
  getShippingOrderByInvoice,
  getPartnerOptionsAsync,
  phamViDonDatHang,
  getOrdersTheoPhamVi,
  demDonDatHangChiNhanhKhac,
  getChiSoDonDatHangTheoPhamVi,
  khoaChiSoDonDatHang,
  taoBoNhoChiSoDonDatHang,
  type PhamViDonDatHang,
  type SalesOrderListSummary,
  type SalesOrderListSummaryParams,
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
import { usePermissions, useTxRowPermissions } from "@/lib/permissions";
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

// Trạng thái thật của invoices nguồn đơn đặt hàng.
const statusFilterOptions = [
  { label: "Chờ xử lý", value: "draft" },
  { label: "Đã xác nhận", value: "confirmed" },
  { label: "Đang giao hàng", value: "delivering" },
  { label: "Hoàn thành", value: "completed" },
  { label: "Đã hủy", value: "cancelled" },
];

const fulfillmentOptions = [
  { label: "Tất cả", value: "all" },
  { label: "Chưa xuất hóa đơn", value: "pending" },
  { label: "Đã xuất hóa đơn", value: "fulfilled" },
];

const debtStateOptions = [
  { label: "Tất cả", value: "all" },
  { label: "Còn phải thu", value: "outstanding" },
  { label: "Đã thu đủ", value: "settled" },
];

const shippingStateOptions = [
  { label: "Tất cả", value: "all" },
  { label: "Chưa có vận đơn", value: "none" },
  { label: "Đã có vận đơn", value: "any" },
  { label: "Chờ lấy hàng", value: "pending" },
  { label: "Đã lấy hàng", value: "picked_up" },
  { label: "Đang giao", value: "in_transit" },
  { label: "Đã giao", value: "delivered" },
  { label: "Đã hoàn", value: "returned" },
  { label: "Đã hủy vận đơn", value: "cancelled" },
];

function resolveDateRange(
  preset: DatePresetValue,
  customFrom: string,
  customTo: string,
) {
  if (preset === "custom") {
    return {
      from: customFrom || undefined,
      to: customTo || undefined,
    };
  }
  return computeListPresetRange(preset);
}

function labelForOption(
  options: Array<{ label: string; value: string }>,
  value: string,
) {
  return options.find((option) => option.value === value)?.label ?? value;
}

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

                {/* 06/08: trước là <textarea> trần không hiện note đã lưu.
                    Chỉ hiển thị — muốn sửa ghi chú dùng nút "Sửa đơn"
                    (CreateOrderDialog chế độ editOrder đã có ô ghi chú). */}
                <DocumentNoteBox note={order.note} />
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
  const {
    activeBranchId,
    currentBranch,
    branches,
    isReady: branchScopeReady,
  } = useBranchFilter();
  const { printWithPicker, printerDialog } = usePrintWithPicker();
  const txPerms = useTxRowPermissions("sales_order");
  const { hasAny } = usePermissions();
  const duocXemToanChuoi = hasAny([
    "reports.view_all_branches",
    "system.manage_branches",
  ]);
  const [data, setData] = useState<SalesOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const fetchLuotRef = useRef(0);
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
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
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // CEO 08/07: lọc trạng thái — rỗng = tất cả (đơn đã giữ đủ mọi trạng thái).
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [fulfillmentState, setFulfillmentState] = useState("all");
  const [debtState, setDebtState] = useState("all");
  const [amountMin, setAmountMin] = useState("");
  const [amountMax, setAmountMax] = useState("");
  const [shippingState, setShippingState] = useState("all");
  const [deliveryPartner, setDeliveryPartner] = useState("all");
  const [deliveryPartnerOptions, setDeliveryPartnerOptions] = useState<
    Array<{ value: string; label: string }>
  >([{ value: "all", label: "Tất cả" }]);
  const [deliveryDatePreset, setDeliveryDatePreset] =
    useState<DatePresetValue>("all");
  const [deliveryDateFrom, setDeliveryDateFrom] = useState("");
  const [deliveryDateTo, setDeliveryDateTo] = useState("");
  const [deliveryArea, setDeliveryArea] = useState("");
  const debouncedDeliveryArea = useDebounce(deliveryArea, 300);
  const [filterOpen, setFilterOpen] = useState(false);
  // CEO 08/07: xem tất cả chi nhánh (cục bộ) khi bảng trống vì lọc chi nhánh.
  const [viewAllBranches, setViewAllBranches] = useState(false);
  const [otherBranchCount, setOtherBranchCount] = useState(0);
  const phamViHienTai = useMemo(
    () =>
      phamViDonDatHang({
        activeBranchId,
        viewAllBranches,
        duocXemToanChuoi,
      }),
    [activeBranchId, viewAllBranches, duocXemToanChuoi],
  );
  const chuaCoPhamVi = branchScopeReady && phamViHienTai.mode === "none";
  // Đổi chi nhánh ở global switcher → về lại chế độ lọc theo chi nhánh.
  useEffect(() => {
    setViewAllBranches(false);
  }, [activeBranchId]);

  useEffect(() => {
    if (!duocXemToanChuoi) setViewAllBranches(false);
  }, [duocXemToanChuoi]);

  useEffect(() => {
    getPartnerOptionsAsync()
      .then(setDeliveryPartnerOptions)
      .catch(() => {
        // Giữ lựa chọn "Tất cả"; danh sách đơn vẫn dùng được khi tải đối tác lỗi.
      });
  }, []);

  const datePresetLabel =
    STANDARD_LIST_PRESETS.find((preset) => preset.value === datePreset)?.label ??
    "Thời gian";
  const deliveryDateLabel =
    STANDARD_LIST_PRESETS_WITH_ALL.find(
      (preset) => preset.value === deliveryDatePreset,
    )?.label ?? "Tất cả";
  const orderDateDisplay =
    datePreset === "custom"
      ? `${dateFrom || "..."} đến ${dateTo || "..."}`
      : datePresetLabel;
  const shippingDateDisplay =
    deliveryDatePreset === "custom"
      ? `${deliveryDateFrom || "..."} đến ${deliveryDateTo || "..."}`
      : deliveryDateLabel;
  const deliveryPartnerLabel =
    deliveryPartnerOptions.find((option) => option.value === deliveryPartner)
      ?.label ?? deliveryPartner;
  const filterChips: ListFilterChip[] = [];
  if (datePreset !== "this_month") {
    filterChips.push({
      key: "order-date",
      label: "Thời gian tạo đơn",
      value: orderDateDisplay,
      onClear: () => {
        setDatePreset("this_month");
        setDateFrom("");
        setDateTo("");
      },
    });
  }
  if (selectedStatuses.length > 0) {
    const labels = statusFilterOptions
      .filter((option) => selectedStatuses.includes(option.value))
      .map((option) => option.label);
    filterChips.push({
      key: "status",
      label: "Trạng thái",
      value: labels.join(", ") || `${selectedStatuses.length} lựa chọn`,
      onClear: () => setSelectedStatuses([]),
    });
  }
  if (deliveryPartner !== "all") {
    filterChips.push({
      key: "delivery-partner",
      label: "Đối tác giao hàng",
      value: deliveryPartnerLabel,
      onClear: () => setDeliveryPartner("all"),
    });
  }
  if (fulfillmentState !== "all") {
    filterChips.push({
      key: "fulfillment",
      label: "Xuất hóa đơn",
      value: labelForOption(fulfillmentOptions, fulfillmentState),
      onClear: () => setFulfillmentState("all"),
    });
  }
  if (debtState !== "all") {
    filterChips.push({
      key: "debt",
      label: "Công nợ",
      value: labelForOption(debtStateOptions, debtState),
      onClear: () => setDebtState("all"),
    });
  }
  if (amountMin || amountMax) {
    filterChips.push({
      key: "amount",
      label: "Giá trị đơn",
      value: `${amountMin || "0"} đến ${amountMax || "không giới hạn"}`,
      onClear: () => {
        setAmountMin("");
        setAmountMax("");
      },
    });
  }
  if (shippingState !== "all") {
    filterChips.push({
      key: "shipping-state",
      label: "Vận đơn",
      value: labelForOption(shippingStateOptions, shippingState),
      onClear: () => setShippingState("all"),
    });
  }
  if (deliveryDatePreset !== "all") {
    filterChips.push({
      key: "shipping-date",
      label: "Thời gian tạo vận đơn",
      value: shippingDateDisplay,
      onClear: () => {
        setDeliveryDatePreset("all");
        setDeliveryDateFrom("");
        setDeliveryDateTo("");
      },
    });
  }
  if (debouncedDeliveryArea) {
    filterChips.push({
      key: "delivery-area",
      label: "Địa chỉ giao hàng",
      value: debouncedDeliveryArea,
      onClear: () => setDeliveryArea(""),
    });
  }
  const clearListFilters = () => {
    setDatePreset("this_month");
    setDateFrom("");
    setDateTo("");
    setSelectedStatuses([]);
    setFulfillmentState("all");
    setDebtState("all");
    setAmountMin("");
    setAmountMax("");
    setShippingState("all");
    setDeliveryPartner("all");
    setDeliveryDatePreset("all");
    setDeliveryDateFrom("");
    setDeliveryDateTo("");
    setDeliveryArea("");
  };

  const buildFilters = useCallback(() => {
    const orderRange = resolveDateRange(datePreset, dateFrom, dateTo);
    const shippingRange = resolveDateRange(
      deliveryDatePreset,
      deliveryDateFrom,
      deliveryDateTo,
    );
    return {
      ...(orderRange.from && { dateFrom: orderRange.from }),
      ...(orderRange.to && { dateTo: orderRange.to }),
      ...(selectedStatuses.length > 0 && { status: selectedStatuses }),
      ...(fulfillmentState !== "all" && { fulfillmentState }),
      ...(debtState !== "all" && { debtState }),
      ...(amountMin && { amountMin }),
      ...(amountMax && { amountMax }),
      ...(shippingState !== "all" && { shippingState }),
      ...(deliveryPartner !== "all" && {
        deliveryPartnerId: deliveryPartner,
      }),
      ...(shippingRange.from && { shippingDateFrom: shippingRange.from }),
      ...(shippingRange.to && { shippingDateTo: shippingRange.to }),
      ...(debouncedDeliveryArea && { deliveryArea: debouncedDeliveryArea }),
    } satisfies Record<string, string | string[]>;
  }, [
    datePreset,
    dateFrom,
    dateTo,
    selectedStatuses,
    fulfillmentState,
    debtState,
    amountMin,
    amountMax,
    shippingState,
    deliveryPartner,
    deliveryDatePreset,
    deliveryDateFrom,
    deliveryDateTo,
    debouncedDeliveryArea,
  ]);

  const fetchData = useCallback(async () => {
    if (!branchScopeReady) return;
    const luot = ++fetchLuotRef.current;
    setLoading(true);
    // Trước đây không có try/finally: truy vấn lỗi là cờ loading không bao giờ
    // tắt → trang treo mãi ở vòng xoay, không nói vì sao.
    try {
    const commonFilters = buildFilters();
    const result = await getOrdersTheoPhamVi(phamViHienTai, {
      page,
      pageSize,
      search: debouncedSearch,
      searchField,
      filters: commonFilters,
    });
    let soDonChiNhanhKhac = 0;
    // Bảng trống vì lọc chi nhánh? Đếm phiếu ở chi nhánh khác để gợi ý (cùng bộ
    // lọc, bỏ branch). Chỉ khi đang lọc theo 1 chi nhánh cụ thể.
    if (result.data.length === 0) {
      soDonChiNhanhKhac = await demDonDatHangChiNhanhKhac(phamViHienTai, {
        search: debouncedSearch,
        searchField,
        filters: commonFilters,
      });
    }
    if (luot !== fetchLuotRef.current) return;
    setData(result.data);
    setTotal(result.total);
    setOtherBranchCount(soDonChiNhanhKhac);
    } catch (e) {
      if (luot !== fetchLuotRef.current) return;
      toast({
        variant: "error",
        title: "Không tải được danh sách đơn đặt hàng",
        description: e instanceof Error ? e.message : "Lỗi không xác định",
      });
    } finally {
      if (luot === fetchLuotRef.current) setLoading(false);
    }
  }, [
    branchScopeReady,
    buildFilters,
    phamViHienTai,
    page,
    pageSize,
    debouncedSearch,
    searchField,
    toast,
  ]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const [chiSo, setChiSo] = useState<SalesOrderListSummary | null>(null);
  const [chiSoLoi, setChiSoLoi] = useState(false);
  const [nhipChiSo, setNhipChiSo] = useState(0);
  const [boNhoChiSo] = useState(() => taoBoNhoChiSoDonDatHang());
  const thamSoChiSo = useMemo<
    Omit<SalesOrderListSummaryParams, "branchId"> & {
      phamVi: PhamViDonDatHang;
    }
  >(() => {
    const orderRange = resolveDateRange(datePreset, dateFrom, dateTo);
    const shippingRange = resolveDateRange(
      deliveryDatePreset,
      deliveryDateFrom,
      deliveryDateTo,
    );
    const parsedAmountMin = amountMin === "" ? undefined : Number(amountMin);
    const parsedAmountMax = amountMax === "" ? undefined : Number(amountMax);
    return {
      phamVi: phamViHienTai,
      dateFrom: orderRange.from,
      dateTo: orderRange.to,
      statuses: selectedStatuses,
      fulfillmentState,
      debtState,
      shippingState,
      amountMin:
        Number.isFinite(parsedAmountMin) && (parsedAmountMin ?? -1) >= 0
          ? parsedAmountMin
          : undefined,
      amountMax:
        Number.isFinite(parsedAmountMax) && (parsedAmountMax ?? -1) >= 0
          ? parsedAmountMax
          : undefined,
      search: debouncedSearch,
      searchField,
      deliveryPartnerId:
        deliveryPartner === "all" ? undefined : deliveryPartner,
      shippingDateFrom: shippingRange.from,
      shippingDateTo: shippingRange.to,
      deliveryArea: debouncedDeliveryArea,
    };
  }, [
    datePreset,
    dateFrom,
    dateTo,
    deliveryDatePreset,
    deliveryDateFrom,
    deliveryDateTo,
    phamViHienTai,
    selectedStatuses,
    fulfillmentState,
    debtState,
    shippingState,
    amountMin,
    amountMax,
    debouncedSearch,
    searchField,
    deliveryPartner,
    debouncedDeliveryArea,
  ]);

  useEffect(() => {
    if (!branchScopeReady) return;
    const khoa =
      JSON.stringify(thamSoChiSo.phamVi) +
      "|" +
      khoaChiSoDonDatHang(thamSoChiSo);
    const { luot, sanCo } = boNhoChiSo.batDau(khoa);
    if (thamSoChiSo.phamVi.mode === "none") {
      setChiSo(null);
      setChiSoLoi(false);
      return;
    }
    if (sanCo) {
      setChiSo(sanCo);
      setChiSoLoi(false);
      return;
    }
    setChiSo(null);
    setChiSoLoi(false);
    getChiSoDonDatHangTheoPhamVi(thamSoChiSo.phamVi, thamSoChiSo)
      .then((ketQua) => {
        if (!boNhoChiSo.conMoiNhat(luot)) return;
        if (ketQua) boNhoChiSo.luu(khoa, ketQua);
        setChiSo(ketQua);
        setChiSoLoi(false);
      })
      .catch((error: unknown) => {
        if (!boNhoChiSo.conMoiNhat(luot)) return;
        console.error("[Đơn đặt hàng] không lấy được chỉ số:", error);
        setChiSo(null);
        setChiSoLoi(true);
      });
  }, [boNhoChiSo, branchScopeReady, thamSoChiSo, nhipChiSo]);

  const lamMoiChiSo = useCallback(() => {
    boNhoChiSo.xoaHet();
    setNhipChiSo((nhip) => nhip + 1);
  }, [boNhoChiSo]);

  const taiLaiSauKhiDoiDuLieu = useCallback(async () => {
    lamMoiChiSo();
    await fetchData();
  }, [fetchData, lamMoiChiSo]);

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

  // Khi quay lại tab, làm mới cả bảng và chỉ số; không giữ KPI cũ từ cache.
  useRevalidateOnFocus(taiLaiSauKhiDoiDuLieu);

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

  const totalAmount = useMemo(
    () => data.reduce((sum, order) => sum + order.totalAmount, 0),
    [data],
  );
  const dangTaiChiSo =
    !branchScopeReady || (!chuaCoPhamVi && !chiSo && !chiSoLoi);
  const moTaChuaCoPhamVi =
    branches.length > 0
      ? "Chọn chi nhánh trên thanh phía trên để xem đúng đơn và chỉ số."
      : "Tài khoản chưa được phân quyền chi nhánh. Vui lòng liên hệ quản trị viên.";

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
    <ListPageLayout sidebar={null}>
      <PageHeader
        title="Đặt hàng"
        density="compact"
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
        density="compact"
        columnToggle
        toolbarMetrics={
          <>
            <ListMetric
              icon={<Icon name="receipt_long" size={15} />}
              label="Số đơn"
              value={chiSo ? formatNumber(chiSo.tongDon) : "—"}
              loading={dangTaiChiSo}
              hint={chiSoLoi ? "Chưa cập nhật được" : "Theo toàn bộ bộ lọc"}
            />
            <ListMetric
              icon={<Icon name="shopping_bag" size={15} />}
              label="Tiền hàng"
              value={chiSo ? formatCurrency(chiSo.tongTienHang) : "—"}
              loading={dangTaiChiSo}
              tone="primary"
              hint="Không gồm phí giao"
            />
            <ListMetric
              icon={<Icon name="local_shipping" size={15} />}
              label="Phí giao"
              value={chiSo ? formatCurrency(chiSo.tongPhiGiao) : "—"}
              loading={dangTaiChiSo}
              hint="Theo toàn bộ bộ lọc"
            />
            <ListMetric
              icon={<Icon name="payments" size={15} />}
              label="Cần thu"
              value={chiSo ? formatCurrency(chiSo.tongCanThu) : "—"}
              loading={dangTaiChiSo}
              tone={(chiSo?.tongCanThu ?? 0) > 0 ? "danger" : "default"}
              hint="Không tính đơn đã hủy hoặc đã xuất hóa đơn riêng"
            />
          </>
        }
        toolbarActions={
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 px-2 text-xs pointer-coarse:min-h-11"
              onClick={() => setFilterOpen(true)}
            >
              <Icon name="calendar_today" size={15} />
              <span className="hidden sm:inline">{datePresetLabel}</span>
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="relative h-8 gap-1.5 px-2 text-xs pointer-coarse:min-h-11"
              onClick={() => setFilterOpen(true)}
              aria-label={`Mở bộ lọc${filterChips.length > 0 ? `, ${filterChips.length} điều kiện` : ""}`}
            >
              <Icon name="filter_alt" size={15} />
              <span className="hidden sm:inline">Bộ lọc</span>
              {filterChips.length > 0 && (
                <span className="min-w-4 rounded-full bg-primary px-1 text-xs font-bold text-primary-foreground">
                  {filterChips.length}
                </span>
              )}
            </Button>
          </>
        }
        toolbarFooter={
          <FilterChips
            filters={filterChips}
            onClearAll={filterChips.length > 1 ? clearListFilters : undefined}
          />
        }
        emptyTitle={
          chuaCoPhamVi ? "Chưa có chi nhánh làm việc" : "Không tìm thấy đơn đặt hàng"
        }
        emptyDescription={
          chuaCoPhamVi
            ? moTaChuaCoPhamVi
            : "Thử thay đổi thời gian, trạng thái hoặc từ khóa tìm kiếm."
        }
        emptyIcon={chuaCoPhamVi ? "apartment" : "receipt_long"}
        emptyBranchHint={
          duocXemToanChuoi
            ? {
                otherBranchCount,
                onViewAllBranches: () => setViewAllBranches(true),
                entityLabel: "đơn đặt hàng",
              }
            : undefined
        }
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
                await taiLaiSauKhiDoiDuLieu();
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
            onDataChanged={taiLaiSauKhiDoiDuLieu}
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

      <FilterPanel
        open={filterOpen}
        onOpenChange={setFilterOpen}
        activeCount={filterChips.length}
        onClearAll={clearListFilters}
        title="Bộ lọc đơn đặt hàng"
      >
        <FilterGroup label="Thời gian tạo đơn" activeHint={orderDateDisplay}>
          <DatePresetFilter
            value={datePreset}
            onChange={setDatePreset}
            from={dateFrom}
            to={dateTo}
            onFromChange={setDateFrom}
            onToChange={setDateTo}
            presets={STANDARD_LIST_PRESETS}
          />
        </FilterGroup>

        <FilterGroup
          label="Trạng thái"
          activeHint={
            selectedStatuses.length > 0
              ? `${selectedStatuses.length} lựa chọn`
              : undefined
          }
        >
          <CheckboxFilter
            options={statusFilterOptions}
            selected={selectedStatuses}
            onChange={setSelectedStatuses}
          />
        </FilterGroup>

        <FilterGroup
          label="Tình trạng xuất hóa đơn"
          activeHint={
            fulfillmentState === "all"
              ? undefined
              : labelForOption(fulfillmentOptions, fulfillmentState)
          }
        >
          <SelectFilter
            options={fulfillmentOptions}
            value={fulfillmentState}
            onChange={setFulfillmentState}
            placeholder="Tất cả"
          />
        </FilterGroup>

        <FilterGroup
          label="Công nợ"
          activeHint={
            debtState === "all"
              ? undefined
              : labelForOption(debtStateOptions, debtState)
          }
        >
          <SelectFilter
            options={debtStateOptions}
            value={debtState}
            onChange={setDebtState}
            placeholder="Tất cả"
          />
        </FilterGroup>

        <FilterGroup
          label="Giá trị đơn"
          activeHint={amountMin || amountMax ? "Đang lọc" : undefined}
        >
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
            <Input
              type="number"
              min="0"
              inputMode="decimal"
              value={amountMin}
              onChange={(event) => setAmountMin(event.target.value)}
              placeholder="Từ"
              className="h-9 min-w-0 text-sm"
            />
            <span className="text-xs text-muted-foreground">đến</span>
            <Input
              type="number"
              min="0"
              inputMode="decimal"
              value={amountMax}
              onChange={(event) => setAmountMax(event.target.value)}
              placeholder="Đến"
              className="h-9 min-w-0 text-sm"
            />
          </div>
        </FilterGroup>

        <FilterGroup
          label="Tình trạng vận đơn"
          activeHint={
            shippingState === "all"
              ? undefined
              : labelForOption(shippingStateOptions, shippingState)
          }
        >
          <SelectFilter
            options={shippingStateOptions}
            value={shippingState}
            onChange={(value) => {
              setShippingState(value);
              if (value === "none") {
                setDeliveryPartner("all");
                setDeliveryDatePreset("all");
                setDeliveryDateFrom("");
                setDeliveryDateTo("");
                setDeliveryArea("");
              }
            }}
            placeholder="Tất cả"
          />
        </FilterGroup>

        <FilterGroup
          label="Đối tác giao hàng"
          activeHint={
            deliveryPartner === "all" ? undefined : deliveryPartnerLabel
          }
        >
          <SelectFilter
            options={deliveryPartnerOptions}
            value={deliveryPartner}
            onChange={(value) => {
              setDeliveryPartner(value);
              if (value !== "all" && shippingState === "none") {
                setShippingState("any");
              }
            }}
            placeholder="Tất cả"
          />
        </FilterGroup>

        <FilterGroup
          label="Thời gian tạo vận đơn"
          activeHint={
            deliveryDatePreset === "all" ? undefined : shippingDateDisplay
          }
        >
          <DatePresetFilter
            value={deliveryDatePreset}
            onChange={(value) => {
              setDeliveryDatePreset(value);
              if (value !== "all" && shippingState === "none") {
                setShippingState("any");
              }
            }}
            from={deliveryDateFrom}
            to={deliveryDateTo}
            onFromChange={setDeliveryDateFrom}
            onToChange={setDeliveryDateTo}
            presets={STANDARD_LIST_PRESETS_WITH_ALL}
          />
        </FilterGroup>

        <FilterGroup
          label="Địa chỉ giao hàng"
          activeHint={debouncedDeliveryArea || undefined}
        >
          <Input
            value={deliveryArea}
            onChange={(event) => {
              setDeliveryArea(event.target.value);
              if (event.target.value && shippingState === "none") {
                setShippingState("any");
              }
            }}
            placeholder="Tỉnh, quận hoặc địa chỉ"
            className="h-9 text-sm"
          />
        </FilterGroup>
      </FilterPanel>
    </ListPageLayout>

    <CreateOrderDialog
      open={createOpen}
      onOpenChange={setCreateOpen}
      onSuccess={taiLaiSauKhiDoiDuLieu}
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
        onSuccess={taiLaiSauKhiDoiDuLieu}
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
      onDone={taiLaiSauKhiDoiDuLieu}
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
