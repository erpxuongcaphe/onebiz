"use client";

import { useEffect, useState, useCallback } from "react";
import { useDebounce } from "@/lib/utils/use-debounce";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable, StarCell } from "@/components/shared/data-table";
import { SummaryCard } from "@/components/shared/summary-card";
import {
  FilterSidebar,
  FilterGroup,
  CheckboxFilter,
  DatePresetFilter,
  type DatePresetValue,
} from "@/components/shared/filter-sidebar";
import {
  InlineDetailPanel,
  DetailTabs,
  DetailHeader,
  DetailInfoGrid,
  DetailItemsTable,
  AuditHistoryTab,
} from "@/components/shared/inline-detail-panel";
import { ConfirmDialog } from "@/components/shared/dialogs";
// PERF (CEO 23/05/2026): Lazy-load 3 dialog nặng — chỉ load khi user click
// "Tạo hóa đơn" / "Sửa" / "Ghi nhận thanh toán". Save ~300KB initial.
const CreateInvoiceDialog = dynamic(
  () =>
    import("@/components/shared/dialogs/create-invoice-dialog").then(
      (m) => m.CreateInvoiceDialog,
    ),
  { ssr: false },
);
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
import { useTxRowPermissions } from "@/lib/permissions";
import { formatCurrency, formatDate, formatUser } from "@/lib/format";
import { exportToExcel, exportToCsv } from "@/lib/utils/export";
import {
  getInvoices,
  getInvoiceStatuses,
  cancelInvoice,
  voidCompletedInvoice,
  getInvoiceItems,
  getTenantBusinessInfo,
  duplicateInvoice,
  type InvoiceItemRow,
  type TenantBusinessInfo,
} from "@/lib/services";
import { useToast, useBranchFilter } from "@/lib/contexts";
import { buildInvoicePrintData } from "@/lib/print-templates";
import { usePrintWithPicker } from "@/lib/hooks/use-print-with-picker";
import type { Invoice } from "@/lib/types";
import { Icon } from "@/components/ui/icon";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

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
}: {
  invoice: Invoice;
  onClose: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  deleteLabel?: string;
}) {
  const status = statusMap[invoice.status];

  // Lazy fetch line items thay vì hardcode "Sản phẩm mẫu" (P0 audit fix).
  const [items, setItems] = useState<InvoiceItemRow[]>([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setItemsLoading(true);
    getInvoiceItems(invoice.id)
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setItemsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [invoice.id]);

  const subtotal = items.reduce((s, it) => s + it.unitPrice * it.quantity, 0);
  const itemDiscountSum = items.reduce((s, it) => s + it.discount, 0);

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
                        value: formatCurrency(invoice.discount),
                      },
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

                {/* Notes area */}
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
            content: <AuditHistoryTab entityType="invoice" entityId={invoice.id} />,
          },
        ]}
      />
    </InlineDetailPanel>
  );
}

/**
 * VoidInvoiceDialog — Hủy + HOÀN TÁC hóa đơn ĐÃ HOÀN THÀNH (CEO 29/05/2026).
 *
 * Khác "Hủy" thường (chỉ áp dụng cho phiếu tạm/chưa hoàn thành — flip status),
 * dialog này gọi RPC atomic đảo ngược TOÀN BỘ side-effect của hóa đơn đã chốt:
 * hoàn kho (SKU + NVL theo BOM), hồi lô FIFO, ghi phiếu chi hoàn tiền, xóa công
 * nợ HĐ, hoàn điểm tích lũy. Bản ghi hóa đơn được GIỮ LẠI (status='cancelled')
 * để truy vết. Có ô nhập lý do (tùy chọn) ghi vào audit log.
 */
function VoidInvoiceDialog({
  invoice,
  onClose,
  onSuccess,
}: {
  invoice: Invoice | null;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  // Reset lý do mỗi lần mở cho hóa đơn khác.
  useEffect(() => {
    setReason("");
  }, [invoice?.id]);

  const handleConfirm = async () => {
    if (!invoice) return;
    setLoading(true);
    try {
      const res = await voidCompletedInvoice({
        invoiceId: invoice.id,
        reason: reason.trim(),
      });
      toast({
        title: "Đã hủy & hoàn tác hóa đơn",
        description: `${invoice.code}: hoàn ${res.reversedStockMovements} dòng kho, chi hoàn ${formatCurrency(res.reversedCash)}.`,
        variant: "success",
      });
      onSuccess();
      onClose();
    } catch (err) {
      toast({
        title: "Lỗi hủy & hoàn tác",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open={!!invoice}
      onOpenChange={(o) => {
        if (!o && !loading) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="warning" size={20} className="text-destructive" />
            Hủy &amp; hoàn tác hóa đơn
          </DialogTitle>
          <DialogDescription>
            Hóa đơn <strong>{invoice?.code}</strong>
            {invoice ? ` (${formatCurrency(invoice.totalAmount)})` : ""} đã hoàn
            thành. Hệ thống sẽ tự động hoàn tác toàn bộ tác động:
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="rounded-lg border border-status-warning/40 bg-status-warning/10 p-3 space-y-1.5">
            <div className="flex items-center gap-2">
              <Icon name="inventory_2" size={15} className="text-status-warning" />
              Hoàn lại tồn kho đã trừ (SKU + nguyên vật liệu theo BOM)
            </div>
            <div className="flex items-center gap-2">
              <Icon name="layers" size={15} className="text-status-warning" />
              Hồi lại lô đã xuất (FIFO)
            </div>
            <div className="flex items-center gap-2">
              <Icon name="payments" size={15} className="text-status-warning" />
              Ghi phiếu chi hoàn lại số tiền đã thu
            </div>
            <div className="flex items-center gap-2">
              <Icon name="account_balance_wallet" size={15} className="text-status-warning" />
              Xóa công nợ của hóa đơn này
            </div>
            <div className="flex items-center gap-2">
              <Icon name="loyalty" size={15} className="text-status-warning" />
              Hoàn lại điểm tích lũy đã cộng (nếu có)
            </div>
          </div>

          <p className="text-xs text-muted-foreground">
            Bản ghi hóa đơn vẫn được <strong>giữ lại</strong> (trạng thái “Đã
            hủy”) để truy vết. Thao tác này an toàn với dữ liệu và không thể đảo
            ngược lần thứ hai.
          </p>

          <div>
            <label className="block text-xs font-medium mb-1">
              Lý do hủy (không bắt buộc)
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Ví dụ: nhập sai khách, bán nhầm giá, đơn test..."
              className="w-full text-sm border rounded-lg px-2 py-1.5 min-h-[60px] resize-none bg-white outline-none focus:border-primary"
              disabled={loading}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={loading} onClick={onClose}>
            Đóng
          </Button>
          <Button
            variant="destructive"
            disabled={loading}
            onClick={handleConfirm}
          >
            {loading ? "Đang hoàn tác..." : "Xác nhận hủy & hoàn tác"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function HoaDonPage() {
  const { toast } = useToast();
  const { activeBranchId } = useBranchFilter();
  const router = useRouter();
  const { printWithPicker, printerDialog } = usePrintWithPicker();
  const txPerms = useTxRowPermissions("invoice");
  const [data, setData] = useState<Invoice[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  // CEO 28/05/2026: debounce search 300ms — tránh gọi server mỗi keystroke.
  const debouncedSearch = useDebounce(search, 300);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [starred, setStarred] = useState<Set<string>>(new Set());

  const [createOpen, setCreateOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Invoice | null>(null);
  const [cancellingItem, setCancellingItem] = useState<Invoice | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [payingItem, setPayingItem] = useState<Invoice | null>(null);
  // Sprint UX-1 Stage 4: Audit log dialog + duplicating state
  const [auditDialogTarget, setAuditDialogTarget] = useState<Invoice | null>(null);
  const [duplicating, setDuplicating] = useState(false);
  // CEO 29/05/2026: Hủy + hoàn tác hóa đơn ĐÃ HOÀN THÀNH (giữ bản ghi).
  const [voidingItem, setVoidingItem] = useState<Invoice | null>(null);

  // Tenant business info — load 1 lần khi page mount để in hóa đơn có
  // MST + địa chỉ pháp lý (HT-2 wire).
  const [businessInfo, setBusinessInfo] = useState<TenantBusinessInfo | null>(null);
  useEffect(() => {
    getTenantBusinessInfo()
      .then(setBusinessInfo)
      .catch(() => setBusinessInfo(null));
  }, []);

  // Filters
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([
    "processing",
    "completed",
  ]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>([
    "no_delivery",
    "delivery",
  ]);
  const [datePreset, setDatePreset] = useState<DatePresetValue>("this_month");

  const statuses = getInvoiceStatuses();

  // Convert datePreset → ISO range để pass vào filters. Trước đây datePreset
  // tồn tại trong UI nhưng không gửi xuống service → filter giả.
  const dateRange = useCallback(() => {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const toISO = (d: Date) => d.toISOString();
    switch (datePreset) {
      case "today":
        return { from: toISO(today), to: toISO(today) };
      case "yesterday": {
        const y = new Date(today);
        y.setDate(y.getDate() - 1);
        return { from: toISO(y), to: toISO(y) };
      }
      case "this_week": {
        const dow = today.getDay() || 7;
        const start = new Date(today);
        start.setDate(start.getDate() - dow + 1);
        return { from: toISO(start), to: toISO(today) };
      }
      case "this_month": {
        const start = new Date(today.getFullYear(), today.getMonth(), 1);
        return { from: toISO(start), to: toISO(today) };
      }
      case "last_month": {
        const start = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const end = new Date(today.getFullYear(), today.getMonth(), 0);
        return { from: toISO(start), to: toISO(end) };
      }
      default:
        return { from: undefined, to: undefined };
    }
  }, [datePreset]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    const range = dateRange();
    const filters: Record<string, string | string[]> = {};
    if (selectedStatuses.length > 0) filters.status = selectedStatuses;
    if (range.from) filters.dateFrom = range.from;
    if (range.to) filters.dateTo = range.to;
    const result = await getInvoices({
      page,
      pageSize,
      search: debouncedSearch,
      branchId: activeBranchId,
      filters,
    });
    setData(result.data);
    setTotal(result.total);
    setLoading(false);
  }, [page, pageSize, debouncedSearch, selectedStatuses, activeBranchId, dateRange]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(0);
    setExpandedRow(null);
  }, [debouncedSearch, selectedStatuses, selectedTypes, datePreset]);

  const toggleStar = (id: string) => {
    setStarred((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const totalAmount = data.reduce((sum, inv) => sum + inv.totalAmount, 0);
  const totalDiscount = data.reduce((sum, inv) => sum + inv.discount, 0);

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
      header: "Công nợ",
      cell: ({ row }) => {
        const debt = row.original.debt;
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
      <ListPageLayout
        sidebar={
          <FilterSidebar>
            <FilterGroup label="Thời gian">
              <DatePresetFilter
                value={datePreset}
                onChange={setDatePreset}
              />
            </FilterGroup>

            <FilterGroup label="Loại hóa đơn">
              <CheckboxFilter
                options={invoiceTypeOptions}
                selected={selectedTypes}
                onChange={setSelectedTypes}
              />
            </FilterGroup>

            <FilterGroup label="Trạng thái hóa đơn">
              <CheckboxFilter
                options={statuses}
                selected={selectedStatuses}
                onChange={setSelectedStatuses}
              />
            </FilterGroup>

            <FilterGroup label="Trạng thái giao hàng">
              <CheckboxFilter
                options={[
                  { label: "Chờ lấy hàng", value: "pending" },
                  { label: "Đã lấy hàng", value: "picked_up" },
                  { label: "Đang giao", value: "in_transit" },
                  { label: "Đã giao", value: "delivered" },
                  { label: "Đã hoàn", value: "returned" },
                  { label: "Đã hủy", value: "cancelled" },
                ]}
                selected={[]}
                onChange={() => {}}
              />
            </FilterGroup>

            <FilterGroup label="Đối tác giao hàng">
              <select className="w-full h-8 text-sm border rounded-lg px-2 bg-white">
                <option value="">Chọn đối tác giao hàng</option>
              </select>
            </FilterGroup>
          </FilterSidebar>
        }
      >
        <PageHeader
          title="Hóa đơn"
          searchPlaceholder="Theo mã hóa đơn"
          searchValue={search}
          onSearchChange={setSearch}
          onExport={{
            excel: () => handleExport("excel"),
            csv: () => handleExport("csv"),
          }}
          actions={[
            {
              label: "Tạo mới",
              icon: <Icon name="add" size={16} />,
              variant: "default",
              onClick: () => setCreateOpen(true),
            },
          ]}
        />

        {/* KPI row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 pt-4">
          <SummaryCard
            icon={<Icon name="receipt" size={16} />}
            label="Tổng HĐ"
            value={total.toString()}
          />
          <SummaryCard
            icon={<Icon name="check_circle" size={16} />}
            label="Hoàn thành"
            value={data.filter((r) => r.status === "completed").length.toString()}
          />
          <SummaryCard
            icon={<Icon name="warning" size={16} className="text-destructive" />}
            label="Giao thất bại"
            value={data.filter((r) => r.status === "delivery_failed").length.toString()}
            danger={data.filter((r) => r.status === "delivery_failed").length > 0}
            hint={data.filter((r) => r.status === "delivery_failed").length > 0 ? "Cần xử lý" : undefined}
          />
          <SummaryCard
            icon={<Icon name="payments" size={16} />}
            label="Tổng doanh thu"
            value={formatCurrency(totalAmount - totalDiscount)}
          />
        </div>

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
              onClick: (selectedRows) => {
                selectedRows.forEach((row) =>
                  printWithPicker(
                    buildInvoicePrintData(row, businessInfo ?? undefined),
                    "In hóa đơn",
                  ),
                );
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
            discount: formatCurrency(totalDiscount),
          }}
          expandedRow={expandedRow}
          onExpandedRowChange={setExpandedRow}
          renderDetail={(invoice, onClose) => (
            <InvoiceDetail
              invoice={invoice}
              onClose={onClose}
              onEdit={
                invoice.status === "processing"
                  ? () => setEditingItem(invoice)
                  : undefined
              }
              onDelete={
                invoice.status === "completed"
                  ? txPerms.canCancel
                    ? () => setVoidingItem(invoice)
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
              // Sửa — chỉ status processing
              onEdit:
                row.status === "processing"
                  ? () => setEditingItem(row)
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
              // In phiếu
              onPrint: () =>
                printWithPicker(
                  buildInvoicePrintData(row, businessInfo ?? undefined),
                  "In hóa đơn",
                ),
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
              // Hủy + HOÀN TÁC — chỉ HĐ đã hoàn thành (giữ bản ghi), gate quyền
              // POS_RETAIL_VOID. Gọi RPC atomic đảo kho/lô/tiền/nợ/điểm.
              extraActions:
                row.status === "completed" && txPerms.canCancel
                  ? [
                      {
                        label: "Hủy & hoàn tác",
                        icon: <Icon name="cancel" size={16} />,
                        variant: "destructive" as const,
                        separator: true,
                        onClick: () => setVoidingItem(row),
                      },
                    ]
                  : [],
            })
          }
        />
      </ListPageLayout>

      <CreateInvoiceDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={fetchData}
      />

      <EditInvoiceDialog
        open={!!editingItem}
        onOpenChange={(open) => { if (!open) setEditingItem(null); }}
        invoice={editingItem}
        onSuccess={fetchData}
      />

      {printerDialog}

      {payingItem && (
        <RecordPaymentDialog
          open={!!payingItem}
          onOpenChange={(open) => { if (!open) setPayingItem(null); }}
          onSuccess={fetchData}
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

      <ConfirmDialog
        open={!!cancellingItem}
        onOpenChange={(open) => { if (!open) setCancellingItem(null); }}
        title="Hủy hoá đơn"
        description={`Bạn có chắc muốn hủy hoá đơn ${cancellingItem?.code ?? ""}? Thao tác này không thể hoàn tác.`}
        confirmLabel="Hủy hoá đơn"
        cancelLabel="Đóng"
        variant="destructive"
        loading={cancelLoading}
        onConfirm={async () => {
          if (!cancellingItem) return;
          setCancelLoading(true);
          try {
            await cancelInvoice(cancellingItem.id);
            toast({
              title: "Đã hủy hoá đơn",
              description: `Hoá đơn ${cancellingItem.code} đã được hủy thành công`,
              variant: "success",
            });
            await fetchData();
          } catch (err) {
            toast({
              title: "Lỗi hủy hoá đơn",
              description: err instanceof Error ? err.message : "Vui lòng thử lại",
              variant: "error",
            });
          } finally {
            setCancelLoading(false);
            setCancellingItem(null);
          }
        }}
      />

      {/* CEO 29/05/2026: Hủy + hoàn tác HĐ đã hoàn thành (giữ bản ghi + audit) */}
      <VoidInvoiceDialog
        invoice={voidingItem}
        onClose={() => setVoidingItem(null)}
        onSuccess={fetchData}
      />
    </>
  );
}
