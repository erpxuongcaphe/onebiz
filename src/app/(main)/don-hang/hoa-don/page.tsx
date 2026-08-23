"use client";

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useDebounce } from "@/lib/utils/use-debounce";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable, StarCell } from "@/components/shared/data-table";
import { AllBranchesBanner } from "@/components/shared/all-branches-banner";
import { ListMetric } from "@/components/shared/list-metric";
import { FilterChips, type ListFilterChip } from "@/components/shared/filter-chips";
import {
  FilterPanel,
  FilterGroup,
  CheckboxFilter,
  DatePresetFilter,
  type DatePresetValue,
} from "@/components/shared/filter-sidebar";
import {
  computeListPresetRange,
  STANDARD_LIST_PRESETS,
} from "@/lib/utils/list-date-preset-range";
import {
  InlineDetailPanel,
  DetailTabs,
  DetailHeader,
  DetailItemsTable,
  AuditHistoryTab,
} from "@/components/shared/inline-detail-panel";
import { PaymentHistoryTab } from "@/components/shared/payment-history-tab";
import { CancelImpactDialog } from "@/components/shared/dialogs/cancel-impact-dialog";
import { CreateShipmentDialog } from "@/components/shared/dialogs/create-shipment-dialog";
// PERF (CEO 23/05/2026): Lazy-load 2 dialog nặng — chỉ load khi user click
// "Sửa" / "Ghi nhận thanh toán". Save ~300KB initial.
// CEO 29/05/2026: "Tạo mới" hóa đơn nay vào thẳng POS Retail (bỏ popup tạo tay).
const EditInvoiceDialog = dynamic(
  () =>
    import("@/components/shared/dialogs/edit-invoice-dialog").then(
      (m) => m.EditInvoiceDialog,
    ),
  { ssr: false },
);
const RecordPaymentDialog = dynamic(
  () =>
    import("@/components/shared/dialogs/record-payment-dialog").then(
      (m) => m.RecordPaymentDialog,
    ),
  { ssr: false },
);
import { AuditLogDialog } from "@/components/shared/audit-log-dialog";
import { buildTransactionRowActions } from "@/components/shared/transaction-row-actions";
import { useTxRowPermissions, usePermissions } from "@/lib/permissions";
import { formatCurrency, formatDate, formatNumber, formatUser } from "@/lib/format";
import { exportToExcel, exportToCsv } from "@/lib/utils/export";
import {
  khoaChiSoHoaDon,
  taoBoNhoChiSo,
  phamViChiNhanhHoaDon,
  getInvoicesTheoPhamVi,
  demHoaDonChiNhanhKhac,
  getChiSoTheoPhamVi,
  type InvoiceListSummary,
  type InvoiceListSummaryParams,
  type PhamViChiNhanh,
  getInvoiceStatuses,
  cancelInvoice,
  voidCompletedInvoice,
  getInvoiceItems,
  getShippingOrderByInvoice,
  getTenantBusinessInfo,
  duplicateInvoice,
  updateInvoice,
  type InvoiceItemRow,
  type TenantBusinessInfo,
} from "@/lib/services";
import { DocumentNoteBox } from "@/components/shared/document-note-box";
import { useToast, useBranchFilter } from "@/lib/contexts";
import { buildInvoicePrintData, toPrintLines } from "@/lib/print-templates";
import { usePrintWithPicker } from "@/lib/hooks/use-print-with-picker";
import type { Invoice, ShippingOrder } from "@/lib/types";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import {
  getInvoiceItemTaxAmount,
  inferLegacyMixedTaxAmount,
  reconcileInvoiceTotal,
} from "@/lib/utils/invoice-reconciliation";
import {
  invoiceStatusesForKpi,
  isInvoiceKpiSelected,
  resolveInvoiceDeliveryFilter,
  type InvoiceKpiFilter,
} from "@/lib/utils/invoice-list-filters";
import {
  findInvoiceListRowByCode,
  getInvoiceListDeepLinkFilters,
  readInvoiceListDeepLink,
} from "@/lib/utils/invoice-list-deep-link";

const statusMap: Record<
  Invoice["status"],
  { label: string; variant: "default" | "secondary" | "destructive" }
> = {
  completed: { label: "Hoàn thành", variant: "default" },
  processing: { label: "Đang xử lý", variant: "secondary" },
  cancelled: { label: "Đã hủy", variant: "destructive" },
  delivery_failed: { label: "Giao thất bại", variant: "destructive" },
};

const invoiceTypeOptions = [
  { label: "Không giao hàng", value: "no_delivery" },
  { label: "Giao hàng", value: "delivery" },
];

function InvoiceDetail({
  invoice,
  onClose,
  onEdit,
  onDelete,
  deleteLabel = "Hủy",
  onDataChanged,
}: {
  invoice: Invoice;
  onClose: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  deleteLabel?: string;
  /** Gọi khi data hóa đơn đổi (vd gắn vận đơn làm tổng tiền đổi) → refetch list. */
  onDataChanged?: () => void;
}) {
  const status = statusMap[invoice.status];
  const { toast } = useToast();

  // Lazy fetch line items thay vì hardcode "Sản phẩm mẫu" (P0 audit fix).
  const [items, setItems] = useState<InvoiceItemRow[]>([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  // CEO 08/07: vận đơn gắn hóa đơn — khối "Giao hàng" trong chi tiết + nút
  // "Tạo vận đơn" cho đơn CHƯA có (kể cả completed cũ, như KiotViet).
  const [shipment, setShipment] = useState<ShippingOrder | null>(null);
  const [shipDialogOpen, setShipDialogOpen] = useState(false);
  const loadShipment = useCallback(() => {
    getShippingOrderByInvoice(invoice.id)
      .then(setShipment)
      .catch(() => setShipment(null));
  }, [invoice.id]);
  useEffect(() => {
    loadShipment();
  }, [loadShipment]);
  useEffect(() => {
    let cancelled = false;
    setItemsLoading(true);
    getInvoiceItems(invoice.id)
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch((err: unknown) => {
        // CEO 05/06/2026: bỏ silent catch — hiện toast lỗi rõ thay vì
        // panel empty làm user tưởng "không xem được". Console log full
        // error để debug RLS/network/permission.
        const msg = err instanceof Error ? err.message : "Lỗi tải chi tiết";
        console.error("[InvoiceDetail] getInvoiceItems lỗi:", err);
        if (!cancelled) {
          setItems([]);
          toast({
            title: "Không tải được chi tiết hoá đơn",
            description: msg,
            variant: "error",
          });
        }
      })
      .finally(() => {
        if (!cancelled) setItemsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [invoice.id, toast]);

  const subtotal = items.reduce((s, it) => s + it.unitPrice * it.quantity, 0);
  const itemDiscountSum = items.reduce((s, it) => s + it.discount, 0);
  const storedItemTaxSum = items.reduce(
    (sum, item) => sum + item.vatAmount,
    0,
  );
  const inferredItemTaxSum = items.reduce(
    (sum, item) => sum + getInvoiceItemTaxAmount(item),
    0,
  );
  const unexplainedHeaderAmount =
    invoice.totalAmount -
    (subtotal - invoice.discount + (invoice.shippingFee ?? 0));
  const legacyMixedTaxSum =
    storedItemTaxSum <= 0 &&
    inferredItemTaxSum <= 0 &&
    (invoice.taxAmount ?? 0) <= 0 &&
    itemDiscountSum <= 0 &&
    invoice.discount <= 0 &&
    (invoice.shippingFee ?? 0) <= 0
      ? inferLegacyMixedTaxAmount(items, unexplainedHeaderAmount)
      : 0;
  const reconciliation = reconcileInvoiceTotal({
    subtotal,
    lineDiscount: itemDiscountSum,
    totalDiscount: invoice.discount,
    itemTaxAmount: storedItemTaxSum,
    inferredItemTaxAmount: inferredItemTaxSum || legacyMixedTaxSum,
    reportedTaxAmount: invoice.taxAmount ?? 0,
    deliveryFee: invoice.shippingFee ?? 0,
    invoiceTotal: invoice.totalAmount,
  });

  return (
    <InlineDetailPanel
      open
      onClose={onClose}
      onEdit={onEdit}
      onDelete={onDelete}
      deleteLabel={deleteLabel}
    >
      <DetailTabs
        tabs={[
          {
            id: "info",
            label: "Thông tin",
            content: (
              <div className="space-y-4">
                <DetailHeader
                  title={invoice.customerName}
                  code={invoice.code}
                  status={{
                    label: status.label,
                    variant: status.variant,
                    className:
                      status.variant === "default"
                        ? "bg-status-success/10 text-status-success border-status-success/25"
                        : undefined,
                  }}
                  subtitle={invoice.branchName || "—"}
                  meta={
                    <div className="flex items-center gap-4 flex-wrap text-xs">
                      <span>
                        Người tạo:{" "}
                        <strong>{formatUser(undefined, invoice.createdBy)}</strong>
                      </span>
                      <span>
                        Ngày bán:{" "}
                        <strong>{formatDate(invoice.date)}</strong>
                      </span>
                      {invoice.customerCode && (
                        <span>
                          Mã KH: <strong>{invoice.customerCode}</strong>
                        </span>
                      )}
                    </div>
                  }
                />

                {/* CEO 08/07: khối Giao hàng — vận đơn gắn hóa đơn */}
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
                        Thu khi giao: <strong>{formatCurrency(shipment.cod ?? 0)}</strong>
                      </div>
                    </div>
                  </div>
                ) : invoice.status !== "cancelled" ? (
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
                  invoiceId={invoice.id}
                  invoiceCode={invoice.code}
                  defaultReceiverName={invoice.customerName}
                  defaultReceiverPhone={invoice.customerPhone}
                  defaultReceiverAddress={invoice.customerAddress}
                  buyerCustomerId={invoice.customerId || null}
                  currentTotal={invoice.totalAmount}
                  currentFee={invoice.shippingFee}
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
                    Hóa đơn này không có sản phẩm hoặc dữ liệu lô bị mất.
                  </div>
                ) : (
                  <DetailItemsTable
                    columns={[
                      { header: "Mã hàng", accessor: "productCode" as never },
                      { header: "Tên hàng", accessor: "productName" as never },
                      {
                        header: "Đơn vị",
                        accessor: (item: Record<string, unknown>) =>
                          (item.unit as string) ?? "—",
                      },
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
                        header: "Giảm",
                        accessor: (item: Record<string, unknown>) =>
                          formatCurrency(item.discount as number),
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
                      {
                        label: "Giảm giá dòng",
                        value: formatCurrency(itemDiscountSum),
                      },
                      {
                        label: "Giảm giá hóa đơn",
                        value: formatCurrency(reconciliation.orderDiscount),
                      },
                      ...(reconciliation.taxAmount > 0
                        ? [
                            {
                              label: "VAT",
                              value: formatCurrency(reconciliation.taxAmount),
                            },
                          ]
                        : []),
                      ...((invoice.shippingFee ?? 0) > 0
                        ? [
                            {
                              label: "Phí giao hàng",
                              value: formatCurrency(invoice.shippingFee),
                            },
                          ]
                        : []),
                      ...(reconciliation.hasDifference
                        ? [
                            {
                              label: "Chênh lệch dữ liệu",
                              value: (
                                <span className="text-destructive font-semibold">
                                  {reconciliation.difference > 0 ? "+" : "-"}
                                  {formatCurrency(Math.abs(reconciliation.difference))}
                                </span>
                              ),
                            },
                          ]
                        : []),
                      {
                        label: "Khách cần trả",
                        value: formatCurrency(invoice.totalAmount),
                        className: "font-bold text-base",
                      },
                      {
                        label: "Khách đã trả",
                        value: formatCurrency(invoice.paid),
                      },
                      ...((invoice.debt ?? 0) > 0
                        ? [
                            {
                              label: "Còn nợ",
                              value: (
                                <span className="text-destructive font-semibold">
                                  {formatCurrency(invoice.debt)}
                                </span>
                              ),
                            },
                          ]
                        : []),
                    ]}
                  />
                )}

                {/* 06/08 (CEO phát hiện trên HD001512): trước đây là <textarea>
                    trần — không hiện note đã lưu, gõ vào cũng không lưu.
                    Sửa được CHỈ khi hóa đơn còn nháp + chưa thu tiền — đúng
                    guard của RPC update_draft_invoice_atomic (00271:52);
                    hóa đơn hoàn thành: chỉ xem (như bản in). */}
                <DocumentNoteBox
                  note={invoice.note}
                  editable={invoice.status === "processing" && Number(invoice.paid) === 0}
                  onSave={async (note) => {
                    try {
                      await updateInvoice(invoice.id, { note });
                      toast({ title: "Đã lưu ghi chú", variant: "success" });
                      onDataChanged?.();
                    } catch (error) {
                      toast({
                        title: "Không lưu được ghi chú",
                        description: error instanceof Error ? error.message : "Vui lòng thử lại.",
                        variant: "error",
                      });
                    }
                  }}
                />
              </div>
            ),
          },
          {
            id: "payment_history",
            label: "Thanh toán",
            content: <PaymentHistoryTab referenceType="invoice" referenceId={invoice.id} />,
          },
          {
            id: "audit_history",
            label: "Lịch sử",
            content: <AuditHistoryTab entityType="invoice" entityId={invoice.id} />,
          },
        ]}
      />
    </InlineDetailPanel>
  );
}

export default function HoaDonPage() {
  const { toast } = useToast();
  const { activeBranchId, currentBranch, branches, isReady: branchScopeReady } = useBranchFilter();
  const router = useRouter();
  const { printWithPicker, printerDialog } = usePrintWithPicker();
  const txPerms = useTxRowPermissions("invoice");
  // K2 08/08: nút "Xem tất cả chi nhánh" trước đây KHÔNG kiểm quyền — nhân
  // viên chỉ được gán 1 chi nhánh vẫn bấm được và danh sách chạy toàn tenant.
  // Nay khoá đúng 2 mã quyền mà RPC chỉ số dùng, để bảng và dải chỉ số cùng
  // một phạm vi. Chỉ chặn ở TẦNG ĐỌC, không đụng dữ liệu.
  const { hasAny } = usePermissions();
  const duocXemToanChuoi = hasAny([
    "reports.view_all_branches",
    "system.manage_branches",
  ]);
  const [data, setData] = useState<Invoice[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [invoiceToOpen, setInvoiceToOpen] = useState<string | null>(null);
  const [deepLinkReady, setDeepLinkReady] = useState(false);
  // CEO 28/05/2026: debounce search 300ms — tránh gọi server mỗi keystroke.
  const debouncedSearch = useDebounce(search, 300);
  // CEO 04/07: ô "Tìm theo" — "all" = gộp mã+tên KH như cũ.
  const [searchField, setSearchField] = useState("all");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [starred, setStarred] = useState<Set<string>>(new Set());

  const [editingItem, setEditingItem] = useState<Invoice | null>(null);
  // 21/07: 1 dialog hủy DUY NHẤT (CancelImpactDialog) cho cả nháp + đã hoàn
  // thành — hiện bảng tác động 3 sổ + chọn phương thức hoàn. Route theo status.
  const [cancellingItem, setCancellingItem] = useState<Invoice | null>(null);
  const [payingItem, setPayingItem] = useState<Invoice | null>(null);
  // Sprint UX-1 Stage 4: Audit log dialog + duplicating state
  const [auditDialogTarget, setAuditDialogTarget] = useState<Invoice | null>(null);
  const [duplicating, setDuplicating] = useState(false);

  // Tenant business info — load 1 lần khi page mount để in hóa đơn có
  // MST + địa chỉ pháp lý (HT-2 wire).
  const [businessInfo, setBusinessInfo] = useState<TenantBusinessInfo | null>(null);
  useEffect(() => {
    getTenantBusinessInfo()
      .then(setBusinessInfo)
      .catch((err: unknown) => {
        // Không block UI nhưng log để CEO biết — in hoá đơn sẽ thiếu
        // header MST / địa chỉ pháp lý nếu fail.
        console.error("[Invoices] load tenant business info failed:", err);
        setBusinessInfo(null);
      });
  }, []);

  // Filters
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([
    "confirmed",
    "draft",
    "completed",
  ]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([
    "no_delivery",
    "delivery",
  ]);
  const deliveryFilter = useMemo(
    () => resolveInvoiceDeliveryFilter(selectedTypes),
    [selectedTypes],
  );
  const [datePreset, setDatePreset] = useState<DatePresetValue>("this_month");
  const [filterOpen, setFilterOpen] = useState(false);
  // Nút "Mở trang chứng từ" và mã HD con đều truyền ?tim=<mã>. Riêng
  // ?mo=1 yêu cầu mở chi tiết, đồng thời bỏ giới hạn "Tháng này" để hóa đơn
  // cũ vẫn hiện đúng; chỉ tìm kiếm thông thường thì giữ bộ lọc người dùng.
  useEffect(() => {
    const target = readInvoiceListDeepLink(window.location.search);
    if (target.code) {
      setSearch(target.code);
      const filters = getInvoiceListDeepLinkFilters(target);
      if (filters.datePreset) {
        setDatePreset(filters.datePreset);
        // A direct-open link must not be hidden by remembered list defaults.
        // Server-side tenant and branch guards still define readable scope.
        setSelectedStatuses(filters.statuses ?? []);
        setSelectedTypes(filters.types ?? ["no_delivery", "delivery"]);
        setInvoiceToOpen(target.code);
      }
    }

    setDeepLinkReady(true);
  }, []);
  // CEO 08/07: xem tất cả chi nhánh (cục bộ) khi bảng trống vì lọc chi nhánh.
  const [viewAllBranches, setViewAllBranches] = useState(false);
  const [otherBranchCount, setOtherBranchCount] = useState(0);
  const phamViHienTai = useMemo(
    () => phamViChiNhanhHoaDon({ activeBranchId, viewAllBranches, duocXemToanChuoi }),
    [activeBranchId, viewAllBranches, duocXemToanChuoi],
  );
  const chuaCoPhamVi = branchScopeReady && phamViHienTai.mode === "none";
  // Đổi chi nhánh ở global switcher → về lại chế độ lọc theo chi nhánh.
  useEffect(() => {
    setViewAllBranches(false);
  }, [activeBranchId]);
  // Mất quyền (đổi vai trò, thu hồi riêng) thì tự thoát chế độ xem toàn chuỗi
  // ngay, không đợi thao tác nào.
  useEffect(() => {
    if (!duocXemToanChuoi) setViewAllBranches(false);
  }, [duocXemToanChuoi]);

  const statuses = getInvoiceStatuses();
  const datePresetLabel =
    STANDARD_LIST_PRESETS.find((preset) => preset.value === datePreset)?.label ??
    "Thời gian";
  const filterChips: ListFilterChip[] = [];
  if (selectedStatuses.length > 0) {
    const labels = statuses
      .filter((status) => selectedStatuses.includes(status.value))
      .map((status) => status.label);
    filterChips.push({
      key: "status",
      label: "Trạng thái",
      value: labels.join(", ") || `${selectedStatuses.length} lựa chọn`,
      onClear: () => setSelectedStatuses([]),
    });
  }
  if (deliveryFilter !== "all") {
    filterChips.push({
      key: "delivery",
      label: "Loại hóa đơn",
      value: deliveryFilter === "delivery" ? "Giao hàng" : "Không giao hàng",
      onClear: () => setSelectedTypes(["no_delivery", "delivery"]),
    });
  }
  const clearListFilters = () => {
    setSelectedStatuses([]);
    setSelectedTypes(["no_delivery", "delivery"]);
  };
  const emptyState = chuaCoPhamVi
    ? "no-scope"
    : debouncedSearch.trim() || datePreset !== "all" || filterChips.length > 0
      ? "no-results"
      : "no-data";

  // CEO 06/06/2026: chuyển sang utility chung computeListPresetRange()
  // để chuẩn hoá 11 preset (thêm last_week, this_quarter, last_quarter,
  // this_year, last_year). Function inline cũ chỉ handle 5 preset.
  const dateRange = useCallback(() => computeListPresetRange(datePreset), [datePreset]);

  const fetchData = useCallback(async () => {
    if (!branchScopeReady || !deepLinkReady) return;
    setLoading(true);
    // Không có try/finally thì truy vấn lỗi là cờ loading không bao giờ tắt →
    // trang treo mãi ở vòng xoay, người dùng không biết vì sao.
    try {
    const range = dateRange();
    const commonFilters: Record<string, string | string[]> = {};
    if (selectedStatuses.length > 0) commonFilters.status = selectedStatuses;
    commonFilters.delivery = deliveryFilter;
    if (range.from) commonFilters.dateFrom = range.from;
    if (range.to) commonFilters.dateTo = range.to;
    // mode "none" = chưa có chi nhánh và chưa chủ động xem toàn chuỗi → hàm
    // này KHÔNG gọi getInvoices, trả rỗng và đợi người dùng chọn chi nhánh.
    const result = await getInvoicesTheoPhamVi(phamViHienTai, {
      page,
      pageSize,
      search: debouncedSearch,
      searchField,
      filters: commonFilters,
    });
    setData(result.data);
    setTotal(result.total);
    // Bảng trống vì lọc chi nhánh? Đếm hóa đơn ở chi nhánh khác để gợi ý (cùng
    // bộ lọc, bỏ branch). Chỉ khi đang lọc theo 1 chi nhánh cụ thể.
    // KHÔNG có quyền xem toàn chuỗi thì tuyệt đối không phát sinh lời gọi
    // getInvoices với branchId undefined — kể cả chỉ để đếm.
    if (result.data.length === 0) {
      setOtherBranchCount(
        await demHoaDonChiNhanhKhac(phamViHienTai, {
          search: debouncedSearch,
          searchField,
          filters: commonFilters,
        }),
      );
    } else {
      setOtherBranchCount(0);
    }
    } catch (e) {
      toast({
        variant: "error",
        title: "Không tải được danh sách hoá đơn",
        description: e instanceof Error ? e.message : "Lỗi không xác định",
      });
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, debouncedSearch, searchField, selectedStatuses, deliveryFilter, branchScopeReady, deepLinkReady, dateRange, phamViHienTai, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);


  useEffect(() => {
    setPage(0);
    setExpandedRow(null);
  }, [debouncedSearch, selectedStatuses, selectedTypes, datePreset]);

  useEffect(() => {
    if (!invoiceToOpen || loading) return;

    const rowIndex = findInvoiceListRowByCode(data, invoiceToOpen);
    if (rowIndex >= 0) {
      setExpandedRow(rowIndex);
      setInvoiceToOpen(null);
    }
  }, [data, invoiceToOpen, loading]);

  const toggleStar = (id: string) => {
    setStarred((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // ── K2 08/08: chỉ số lấy từ máy chủ, không cộng từ trang đang xem ──────
  // Trước đây 4 thẻ cộng từ `data` — CHỈ 15 dòng của trang hiện tại — nhưng
  // đặt cạnh "Tổng HĐ" lấy từ `total` của cả bộ lọc. Sang trang 2 là ba số
  // đổi còn số đầu đứng yên. RPC 00305 tính trên toàn bộ phạm vi lọc.
  const [chiSo, setChiSo] = useState<InvoiceListSummary | null>(null);
  const [chiSoLoi, setChiSoLoi] = useState(false);
  // Số thứ tự lượt gọi: kết quả về muộn của bộ lọc cũ KHÔNG được đè kết quả mới.
  // Nhớ tạm theo khoá bộ lọc (KHÔNG gồm số trang) → lật trang không gọi lại,
  // kèm cơ chế chống kết quả cũ đè kết quả mới. Logic nằm ở tầng dịch vụ để
  // test được hành vi thật.
  const boNhoRef = useRef(taoBoNhoChiSo());

  // Dòng tổng ở CHÂN BẢNG là tổng của trang đang xem — đúng bản chất chân
  // bảng, khác hẳn dải chỉ số phía trên (toàn bộ phạm vi lọc). Giữ riêng để
  // không ai nhầm hai con số này với nhau.
  const tongTrang = useMemo(() => {
    let tien = 0;
    let giam = 0;
    for (const inv of data) {
      tien += inv.totalAmount;
      giam += inv.discount;
    }
    return { tien, giam };
  }, [data]);

  const thamSoChiSo = useMemo<
    Omit<InvoiceListSummaryParams, "branchId"> & { phamVi: PhamViChiNhanh }
  >(() => {
    const range = computeListPresetRange(datePreset);
    return {
      phamVi: phamViHienTai,
      dateFrom: range.from,
      dateTo: range.to,
      // Truyền THẲNG trạng thái của giao diện. RPC vẫn hỗ trợ alias legacy
      // processing → draft + confirmed, nhưng UI dùng giá trị thật để ô chọn
      // và chip phản ánh đúng phạm vi đang lọc.
      statuses: selectedStatuses,
      search: debouncedSearch,
      searchField,
      delivery: deliveryFilter,
    };
  }, [datePreset, phamViHienTai, selectedStatuses, debouncedSearch, searchField, deliveryFilter]);

  const locTheoChiSo = useCallback((filter: InvoiceKpiFilter) => {
    setSelectedStatuses(invoiceStatusesForKpi(filter));
  }, []);

  // Mỗi lần dữ liệu hoá đơn đổi (hủy, sửa, thanh toán, gắn vận đơn…) thì tăng
  // số này → xoá nhớ tạm và gọi lại RPC. Không có nó thì hủy một hoá đơn xong
  // chỉ số vẫn hiện số cũ vì khoá bộ lọc không đổi.
  const [nhipChiSo, setNhipChiSo] = useState(0);
  const lamMoiChiSo = useCallback(() => {
    boNhoRef.current.xoaHet();
    setNhipChiSo((n) => n + 1);
  }, []);

  // Sau MỌI thao tác đổi dữ liệu hoá đơn (hủy, hủy hàng loạt, sửa, gắn vận
  // đơn, thanh toán, onDataChanged) phải gọi hàm này — KHÔNG gọi fetchData()
  // trần. Gọi trần thì bảng mới còn dải chỉ số vẫn là số cũ.
  const taiLaiSauKhiDoiDuLieu = useCallback(async () => {
    lamMoiChiSo();
    await fetchData();
  }, [fetchData, lamMoiChiSo]);

  useEffect(() => {
    if (!branchScopeReady) return;
    // TĂNG SỐ LƯỢT TRƯỚC khi xét nhớ tạm. Nếu để sau, tình huống sau làm hỏng
    // số: lượt A đang bay → đổi sang bộ lọc B đã có sẵn trong nhớ tạm → thoát
    // sớm mà KHÔNG tăng số lượt → A về muộn vẫn khớp số lượt và ghi đè số của
    // B. Tăng trước là vô hiệu hoá mọi lượt đang bay, kể cả khi đi đường cache.
    const khoa =
      JSON.stringify(thamSoChiSo.phamVi) + "|" + khoaChiSoHoaDon(thamSoChiSo);
    const { luot, sanCo } = boNhoRef.current.batDau(khoa);
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
    getChiSoTheoPhamVi(thamSoChiSo.phamVi, thamSoChiSo)
      .then((kq: InvoiceListSummary | null) => {
        if (!boNhoRef.current.conMoiNhat(luot)) return; // lượt cũ, bỏ
        // null = chưa chọn chi nhánh → không có gì để hiện, cũng không lỗi.
        if (kq) boNhoRef.current.luu(khoa, kq);
        setChiSo(kq);
        setChiSoLoi(false);
      })
      .catch((err: unknown) => {
        if (!boNhoRef.current.conMoiNhat(luot)) return;
        // KHÔNG quay lại cộng từ trang hiện tại — làm vậy là tái tạo đúng lỗi
        // vừa sửa. Giữ số hợp lệ gần nhất và báo rõ là chưa cập nhật được.
        console.error("[Hoá đơn] không lấy được chỉ số:", err);
        setChiSoLoi(true);
      });
  }, [branchScopeReady, thamSoChiSo, nhipChiSo]);

  const dangTaiChiSo =
    !branchScopeReady || (!chuaCoPhamVi && !chiSo && !chiSoLoi);
  const moTaChuaCoPhamVi =
    branches.length > 0
      ? "Chọn chi nhánh trên thanh phía trên để xem đúng hóa đơn và chỉ số."
      : "Tài khoản chưa được phân quyền chi nhánh. Vui lòng liên hệ quản trị viên.";

  const handleExport = (type: "excel" | "csv") => {
    const exportColumns = [
      { header: "Mã HD", key: "code", width: 15 },
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
        header: "Giảm giá",
        key: "discount",
        width: 15,
        format: (v: number) => v,
      },
      {
        header: "Trạng thái",
        key: "status",
        width: 15,
        format: (v: Invoice["status"]) => statusMap[v]?.label ?? v,
      },
    ];
    if (type === "excel")
      exportToExcel(data, exportColumns, "danh-sach-hoa-don");
    else exportToCsv(data, exportColumns, "danh-sach-hoa-don");
  };

  const columns: ColumnDef<Invoice, unknown>[] = [
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
      header: "Mã hóa đơn",
      size: 130,
      cell: ({ row }) => {
        // BATCH 3R: badge trả hàng — suy từ returnedAmount vs totalAmount.
        const returned = row.original.returnedAmount ?? 0;
        const total = row.original.totalAmount ?? 0;
        const returnBadge =
          returned > 0
            ? returned >= total
              ? { label: "Đã trả toàn bộ", cls: "border-destructive/30 bg-destructive/10 text-destructive" }
              : { label: "Đã trả 1 phần", cls: "border-status-warning/40 bg-status-warning/10 text-status-warning" }
            : null;
        return (
          <div className="flex flex-col gap-0.5">
            <span className="font-medium text-primary">{row.original.code}</span>
            {returnBadge && (
              <Badge variant="outline" className={`h-4 px-1.5 text-[10px] ${returnBadge.cls}`}>
                {returnBadge.label}
              </Badge>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "date",
      header: "Thời gian",
      size: 150,
      cell: ({ row }) => formatDate(row.original.date),
    },
    {
      accessorKey: "returnCode",
      header: "Mã trả hàng",
      size: 120,
      cell: ({ row }) => row.original.returnCode ?? "—",
    },
    {
      accessorKey: "customerCode",
      header: "Mã KH",
      size: 100,
      cell: ({ row }) =>
        (row.original as Invoice & { customerCode?: string }).customerCode ??
        "—",
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
      accessorKey: "discount",
      header: "Giảm giá",
      cell: ({ row }) => {
        const discount = row.original.discount;
        return discount > 0 ? (
          <span className="text-status-warning text-right block">
            {formatCurrency(discount)}
          </span>
        ) : (
          <span className="text-right block">{formatCurrency(0)}</span>
        );
      },
    },
    {
      accessorKey: "debt",
      // CEO 20/07: "Công nợ" gây tưởng là TỔNG nợ khách — đây là nợ CỦA ĐƠN NÀY.
      header: "Còn nợ (đơn)",
      cell: ({ row }) => {
        const debt = row.original.debt;
        if (row.original.status !== "completed") {
          // 00332: ĐƠN ĐẶT HÀNG gốc đã gắn hóa đơn con thì KHÔNG phải "chưa
          // hoàn tất" — nó đã được xử lý, tiền nằm ở hóa đơn con. Đơn gốc cố ý
          // giữ status='draft' (RPC chỉ ghi fulfilled_by_id, không đụng status,
          // tiền, kho hay công nợ) nên phải phân biệt ở chỗ TRÌNH BÀY.
          if (row.original.status !== "cancelled" && row.original.fulfilledById) {
            return (
              <span
                className="text-status-success text-right block"
                title="Đơn đặt hàng này đã được xuất thành hóa đơn con"
              >
                Đã xử lý
                {row.original.fulfilledInvoiceCode
                  ? ` · ${row.original.fulfilledInvoiceCode}`
                  : ""}
              </span>
            );
          }
          return (
            <span className="text-status-warning text-right block">
              {row.original.status === "cancelled" ? "Đã hủy" : "Chưa hoàn tất"}
            </span>
          );
        }
        return debt > 0 ? (
          <span className="text-destructive font-medium text-right block">
            {formatCurrency(debt)}
          </span>
        ) : (
          <span className="text-status-success text-right block">Đã TT</span>
        );
      },
    },
  ];

  return (
    <>
      <ListPageLayout sidebar={null}>
        <PageHeader
          title="Hóa đơn"
          density="compact"
          searchPlaceholder="Theo mã hóa đơn"
          searchValue={search}
          onSearchChange={setSearch}
          searchFields={[
            { value: "all", label: "Tất cả" },
            { value: "code", label: "Mã HĐ" },
            { value: "customer_name", label: "Khách hàng" },
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
              label: "Tạo mới",
              icon: <Icon name="point_of_sale" size={16} />,
              variant: "default",
              // CEO 29/05/2026: tạo hóa đơn mới = vào thẳng POS Retail (đúng quy
              // trình bán hàng), không mở popup tạo tay nữa.
              onClick: () => router.push("/pos"),
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
                icon={<Icon name="receipt" size={15} />}
                label="Tất cả"
                value={chiSo ? formatNumber(chiSo.tatCaHoaDon) : "—"}
                loading={dangTaiChiSo}
                onClick={() => locTheoChiSo("all")}
                selected={isInvoiceKpiSelected(selectedStatuses, "all")}
              />
              <ListMetric
                icon={<Icon name="check_circle" size={15} />}
                label="Hoàn thành"
                value={chiSo ? formatNumber(chiSo.hoanThanh) : "—"}
                loading={dangTaiChiSo}
                onClick={() => locTheoChiSo("completed")}
                selected={isInvoiceKpiSelected(selectedStatuses, "completed")}
              />
              <ListMetric
                icon={<Icon name="cancel" size={15} />}
                label="Đã hủy"
                value={chiSo ? formatNumber(chiSo.daHuy) : "—"}
                loading={dangTaiChiSo}
                tone="danger"
                onClick={() => locTheoChiSo("cancelled")}
                selected={isInvoiceKpiSelected(selectedStatuses, "cancelled")}
              />
              <ListMetric
                icon={<Icon name="payments" size={15} />}
                label="Giá trị hoàn thành"
                value={chiSo ? formatCurrency(chiSo.giaTriHoanThanh) : "—"}
                loading={dangTaiChiSo}
                tone="primary"
                hint={
                  chiSoLoi
                    ? "Chưa cập nhật được"
                    : chiSo
                      ? `Giảm giá đã áp dụng: ${formatCurrency(chiSo.giamGiaApDung)}`
                      : chuaCoPhamVi
                        ? "Chưa có phạm vi chi nhánh"
                        : undefined
                }
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
          emptyState={emptyState}
          emptyTitle={
            chuaCoPhamVi
              ? "Chưa có chi nhánh làm việc"
              : emptyState === "no-results"
                ? "Không tìm thấy hóa đơn"
                : "Chưa có hóa đơn"
          }
          emptyDescription={
            chuaCoPhamVi
              ? moTaChuaCoPhamVi
              : emptyState === "no-results"
                ? "Thử thay đổi thời gian, trạng thái hoặc từ khóa tìm kiếm."
                : "Hóa đơn mới sẽ hiển thị tại đây sau khi được tạo."
          }
          emptyIcon={chuaCoPhamVi ? "apartment" : "receipt_long"}
          emptyBranchHint={
            // Không có quyền xem toàn chuỗi thì KHÔNG hiện gợi ý luôn — hiện
            // ra rồi bấm không được còn khó chịu hơn.
            duocXemToanChuoi
              ? {
                  otherBranchCount,
                  onViewAllBranches: () => setViewAllBranches(true),
                  entityLabel: "hóa đơn",
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
                  { header: "Mã HD", key: "code", width: 15 },
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
                    header: "Giảm giá",
                    key: "discount",
                    width: 15,
                    format: (v: number) => v,
                  },
                  {
                    header: "Trạng thái",
                    key: "status",
                    width: 15,
                    format: (v: Invoice["status"]) =>
                      statusMap[v]?.label ?? v,
                  },
                ];
                exportToExcel(selectedRows, cols, "hoa-don-da-chon");
                toast({
                  title: "Đã xuất Excel",
                  description: `${selectedRows.length} hoá đơn`,
                  variant: "success",
                });
              },
            },
            {
              label: "In hàng loạt",
              icon: <Icon name="print" size={16} />,
              onClick: async (selectedRows) => {
                for (const row of selectedRows) {
                  const items = await getInvoiceItems(row.id);
                  printWithPicker(
                    buildInvoicePrintData(
                      row,
                      businessInfo ?? undefined,
                      toPrintLines(items),
                    ),
                    "In hóa đơn",
                    { channel: "retail", docType: "sale_invoice", branchId: row.branchId ?? activeBranchId },
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
                  (r) => r.status !== "completed" && r.status !== "cancelled",
                );
                if (cancellable.length === 0) {
                  toast({
                    title: "Không có hoá đơn nào có thể hủy",
                    description:
                      "Chỉ hủy được hoá đơn chưa hoàn thành / chưa hủy",
                    variant: "info",
                  });
                  return;
                }
                if (
                  !window.confirm(
                    `Hủy ${cancellable.length} hoá đơn? Thao tác này không thể hoàn tác.`,
                  )
                )
                  return;
                try {
                  await Promise.all(
                    cancellable.map((r) => cancelInvoice(r.id)),
                  );
                  toast({
                    title: `Đã hủy ${cancellable.length} hoá đơn`,
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
            totalAmount: formatCurrency(tongTrang.tien),
            discount: formatCurrency(tongTrang.giam),
          }}
          expandedRow={expandedRow}
          onExpandedRowChange={setExpandedRow}
          renderDetail={(invoice, onClose) => (
            <InvoiceDetail
              invoice={invoice}
              onClose={onClose}
              onDataChanged={taiLaiSauKhiDoiDuLieu}
              onEdit={
                // CEO 05/06/2026: bỏ EditInvoiceDialog (sửa được mỗi tên KH
                // + giảm giá là vô nghĩa). Nút Sửa giờ mở thẳng POS Retail
                // với cart đã load từ draft → cashier sửa được tất cả
                // (dòng hàng, giá, số lượng, KH, KM) → checkout cập nhật
                // in-place (không tạo HĐ mới).
                invoice.status === "processing"
                  ? () => router.push(`/pos?draftId=${invoice.id}`)
                  : undefined
              }
              onDelete={
                invoice.status === "completed"
                  ? txPerms.canCancel
                    ? () => setCancellingItem(invoice)
                    : undefined
                  : invoice.status !== "cancelled"
                    ? () => setCancellingItem(invoice)
                    : undefined
              }
              deleteLabel={
                invoice.status === "completed" ? "Hủy & hoàn tác" : "Hủy"
              }
            />
          )}
          rowActions={(row) =>
            buildTransactionRowActions({
              row,
              kind: "invoice",
              permissions: txPerms,
              // Sửa — chỉ status processing → mở POS Retail (CEO 05/06/2026)
              onEdit:
                row.status === "processing"
                  ? () => router.push(`/pos?draftId=${row.id}`)
                  : undefined,
              // Sao chép (CEO 04/05): tạo draft mới + redirect ngay vào
              // POS Retail với data pre-loaded → cashier sửa + thanh toán.
              // Trước đây chỉ tạo draft trên server → user không biết tìm
              // ở đâu. Giờ ?draftId=xxx → POS auto-load.
              onDuplicate: async () => {
                if (duplicating) return;
                setDuplicating(true);
                try {
                  const result = await duplicateInvoice(row.id);
                  toast({
                    variant: "success",
                    title: "Đã sao chép — đang mở POS Retail",
                    description: `Bản mới: ${result.invoiceCode}`,
                  });
                  router.push(`/pos?draftId=${result.invoiceId}`);
                } catch (err) {
                  toast({
                    variant: "error",
                    title: "Không sao chép được",
                    description: err instanceof Error ? err.message : "Lỗi không xác định",
                  });
                } finally {
                  setDuplicating(false);
                }
              },
              // In phiếu — nạp chi tiết hàng trước rồi mới in (nếu thiếu sẽ
              // chỉ in phần đầu, không có dòng mặt hàng).
              onPrint: async () => {
                const items = await getInvoiceItems(row.id);
                printWithPicker(
                  buildInvoicePrintData(
                    row,
                    businessInfo ?? undefined,
                    toPrintLines(items),
                  ),
                  "In hóa đơn",
                  { channel: "retail", docType: "sale_invoice", branchId: row.branchId ?? activeBranchId },
                );
              },
              // Trả hàng (redirect)
              onReturn: () => {
                toast({ variant: "info", title: "Chuyển đến trang trả hàng" });
                router.push("/don-hang/tra-hang");
              },
              // Thu nợ — chỉ debt > 0
              onPayment: row.debt > 0 ? () => setPayingItem(row) : undefined,
              // Audit log shortcut
              onAuditLog: () => setAuditDialogTarget(row),
              // Hủy — chỉ chưa completed/cancelled (flip status, không reverse)
              onCancel:
                row.status !== "completed" && row.status !== "cancelled"
                  ? () => setCancellingItem(row)
                  : undefined,
              // CEO 29/05/2026: HĐ nháp/đang xử lý → nút mở thẳng POS để hoàn
              // tất đơn (POS load draft → loadedDraftId set → bấm Thanh toán
              // là xong, không còn kẹt nháp).
              // Hủy + HOÀN TÁC — chỉ HĐ đã hoàn thành (giữ bản ghi), gate quyền
              // POS_RETAIL_VOID. Gọi RPC atomic đảo kho/lô/tiền/nợ/điểm.
              extraActions: [
                ...(row.status === "processing"
                  ? [
                      {
                        label: "Hoàn thành đơn (POS)",
                        icon: <Icon name="point_of_sale" size={16} />,
                        onClick: () => router.push(`/pos?draftId=${row.id}`),
                      },
                    ]
                  : []),
                ...(row.status === "completed" && txPerms.canCancel
                  ? [
                      {
                        label: "Hủy & hoàn tác",
                        icon: <Icon name="cancel" size={16} />,
                        variant: "destructive" as const,
                        separator: true,
                        onClick: () => setCancellingItem(row),
                      },
                    ]
                  : []),
              ],
            })
          }
        />
      </ListPageLayout>

      <FilterPanel
        open={filterOpen}
        onOpenChange={setFilterOpen}
        activeCount={filterChips.length}
        onClearAll={clearListFilters}
        title="Bộ lọc hóa đơn"
      >
        <FilterGroup label="Thời gian" activeHint={datePresetLabel}>
          <DatePresetFilter
            value={datePreset}
            onChange={setDatePreset}
            presets={STANDARD_LIST_PRESETS}
          />
        </FilterGroup>

        <FilterGroup
          label="Loại hóa đơn"
          activeHint={deliveryFilter === "all" ? undefined : "Đã lọc"}
        >
          <CheckboxFilter
            options={invoiceTypeOptions}
            selected={selectedTypes}
            onChange={setSelectedTypes}
          />
        </FilterGroup>

        <FilterGroup
          label="Trạng thái hóa đơn"
          activeHint={selectedStatuses.length > 0 ? `${selectedStatuses.length} chọn` : undefined}
        >
          <CheckboxFilter
            options={statuses}
            selected={selectedStatuses}
            onChange={setSelectedStatuses}
          />
        </FilterGroup>
      </FilterPanel>

      <EditInvoiceDialog
        open={!!editingItem}
        onOpenChange={(open) => { if (!open) setEditingItem(null); }}
        invoice={editingItem}
        onSuccess={taiLaiSauKhiDoiDuLieu}
      />

      {printerDialog}

      {payingItem && (
        <RecordPaymentDialog
          open={!!payingItem}
          onOpenChange={(open) => { if (!open) setPayingItem(null); }}
          onSuccess={taiLaiSauKhiDoiDuLieu}
          type="invoice"
          referenceId={payingItem.id}
          referenceCode={payingItem.code}
          counterpartyName={payingItem.customerName}
          currentDebt={payingItem.debt}
        />
      )}

      {/* Sprint UX-1 Stage 4: Audit log shortcut từ row action */}
      {auditDialogTarget && (
        <AuditLogDialog
          entityType="invoice"
          entityId={auditDialogTarget.id}
          entityCode={auditDialogTarget.code}
          onClose={() => setAuditDialogTarget(null)}
        />
      )}

      {/* 21/07: 1 dialog hủy hợp nhất — bảng tác động 3 sổ + chọn phương thức
          hoàn. Route theo status: completed → void atomic (hoàn kho/tiền/nợ/
          điểm); nháp/xử lý → cancelInvoice (flip status). */}
      <CancelImpactDialog
        target={
          cancellingItem
            ? { type: "invoice", id: cancellingItem.id, code: cancellingItem.code }
            : null
        }
        onClose={() => setCancellingItem(null)}
        onDone={taiLaiSauKhiDoiDuLieu}
        onConfirm={async ({ refundMethod, reason }) => {
          if (!cancellingItem) return;
          if (cancellingItem.status === "completed") {
            await voidCompletedInvoice({
              invoiceId: cancellingItem.id,
              reason,
              refundMethod,
            });
          } else {
            await cancelInvoice(cancellingItem.id);
          }
        }}
      />
    </>
  );
}
