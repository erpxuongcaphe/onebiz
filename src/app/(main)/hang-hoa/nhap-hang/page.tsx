"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable, StarCell } from "@/components/shared/data-table";
import { SummaryCard } from "@/components/shared/summary-card";
import { KanbanBoard, type KanbanColumn } from "@/components/shared/kanban-board";
import { PipelineStatusBadge } from "@/components/shared/pipeline";
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
  DetailItemsTable,
  AuditHistoryTab,
} from "@/components/shared/inline-detail-panel";
import type { DetailTab } from "@/components/shared/inline-detail-panel";
import { useToast, useBranchFilter } from "@/lib/contexts";
import { usePrintWithPicker } from "@/lib/hooks/use-print-with-picker";
import { buildGoodsReceiptPrintData } from "@/lib/print-templates";
import { formatCurrency, formatDate, formatNumber, formatUser } from "@/lib/format";
import { exportToExcel, exportToCsv } from "@/lib/utils/export";
import {
  exportReportToExcel,
  buildInfoSheet,
  type ExcelSheet,
} from "@/lib/utils/excel-export";
import {
  getPurchaseOrders,
  getPurchaseOrderStatuses,
  getPurchaseOrderStatusMeta,
  updatePurchaseOrderStatus,
  canTransitionPurchaseStatus,
  getPurchaseOrderItems,
  getPaymentHistory,
  closePurchaseOrderShort,
  type PurchaseOrderItemRow,
} from "@/lib/services";
import type { PurchaseOrder, PurchaseOrderStatus } from "@/lib/types";
import { RecordPaymentDialog } from "@/components/shared/dialogs/record-payment-dialog";
import { PartialReceiveDialog } from "@/components/shared/dialogs/partial-receive-dialog";
// PERF (CEO 23/05/2026): Lazy-load CreatePurchaseOrderDialog (819 dòng).
import dynamic from "next/dynamic";
const CreatePurchaseOrderDialog = dynamic(
  () =>
    import("@/components/shared/dialogs/create-purchase-order-dialog").then(
      (m) => m.CreatePurchaseOrderDialog,
    ),
  { ssr: false },
);
import { AuditLogDialog } from "@/components/shared/audit-log-dialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { buildTransactionRowActions } from "@/components/shared/transaction-row-actions";
import { useTxRowPermissions } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

type ViewMode = "list" | "kanban";

/* ------------------------------------------------------------------ */
/*  Status config — full pipeline                                      */
/* ------------------------------------------------------------------ */
const STATUS_META = getPurchaseOrderStatusMeta();

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
/*  Payment history tab                                                */
/* ------------------------------------------------------------------ */
type PaymentHistoryRow = Awaited<ReturnType<typeof getPaymentHistory>>[number];

function PaymentHistoryTab({ orderId }: { orderId: string }) {
  const [rows, setRows] = useState<PaymentHistoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getPaymentHistory("purchase_order", orderId)
      .then((data) => {
        if (!cancelled) setRows(data);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Không tải được lịch sử thanh toán");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orderId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground gap-2">
        <Icon name="progress_activity" size={16} className="animate-spin" />
        Đang tải lịch sử thanh toán...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-status-error gap-2">
        <Icon name="error" size={16} />
        {error}
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-8 text-center">
        Chưa có lịch sử thanh toán
      </div>
    );
  }

  const totalPaid = rows.reduce((sum, r) => sum + Number(r.amount ?? 0), 0);
  const paymentMethodLabel: Record<string, string> = {
    cash: "Tiền mặt",
    transfer: "Chuyển khoản",
    card: "Thẻ",
  };

  return (
    <div className="space-y-3">
      {/* Summary */}
      <div className="flex items-center justify-between rounded-xl bg-surface-container px-3 py-2">
        <span className="text-xs text-muted-foreground">
          {rows.length} lần thanh toán
        </span>
        <span className="text-sm font-semibold text-primary tabular-nums">
          Tổng đã trả: {formatCurrency(totalPaid)}
        </span>
      </div>

      {/* List */}
      <div className="border rounded-xl overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-surface-container-low border-b">
            <tr>
              <th className="text-left px-3 py-2 font-medium uppercase tracking-wider text-[10px]">
                Mã phiếu
              </th>
              <th className="text-left px-3 py-2 font-medium uppercase tracking-wider text-[10px]">
                Ngày
              </th>
              <th className="text-left px-3 py-2 font-medium uppercase tracking-wider text-[10px]">
                Phương thức
              </th>
              <th className="text-right px-3 py-2 font-medium uppercase tracking-wider text-[10px]">
                Số tiền
              </th>
              <th className="text-left px-3 py-2 font-medium uppercase tracking-wider text-[10px]">
                Ghi chú
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b last:border-0 hover:bg-surface-container-low/60">
                <td className="px-3 py-2 font-mono text-primary">{r.code}</td>
                <td className="px-3 py-2 text-muted-foreground">{formatDate(r.date)}</td>
                <td className="px-3 py-2">
                  {paymentMethodLabel[r.paymentMethod ?? ""] ?? r.paymentMethod ?? "—"}
                </td>
                <td className="px-3 py-2 text-right font-mono font-semibold text-status-error">
                  -{formatCurrency(Number(r.amount ?? 0))}
                </td>
                <td className="px-3 py-2 text-muted-foreground truncate max-w-[220px]">
                  {r.note ?? "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Inline detail                                                      */
/* ------------------------------------------------------------------ */
function PurchaseOrderDetail({
  order,
  onClose,
  onRequestPartialReceive,
  onEdit,
  onDelete,
}: {
  order: PurchaseOrder;
  onClose: () => void;
  onRequestPartialReceive: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const status = STATUS_META[order.status];
  const [items, setItems] = useState<PurchaseOrderItemRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getPurchaseOrderItems(order.id)
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [order.id]);

  const totalOrdered = items.reduce((s, i) => s + i.lineTotal, 0);
  const totalReceivedValue = items.reduce(
    (s, i) => s + i.receivedQuantity * i.unitPrice,
    0,
  );
  const totalRemainingValue = Math.max(0, totalOrdered - totalReceivedValue);
  const totalOrderedQty = items.reduce((s, i) => s + i.quantity, 0);
  const totalReceivedQty = items.reduce((s, i) => s + i.receivedQuantity, 0);
  const totalRemaining = items.reduce((s, i) => s + i.remaining, 0);
  const receivePercent =
    totalOrderedQty > 0 ? Math.min(100, Math.round((totalReceivedQty / totalOrderedQty) * 100)) : 0;
  const canPartialReceive = (order.status === "ordered" || order.status === "partial") && totalRemaining > 0;

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
              variant: "default",
              className: "",
            }}
            subtitle="Chi nhánh trung tâm"
            meta={
              <div className="flex items-center gap-4 flex-wrap text-xs">
                <span>
                  Người tạo: <strong>{formatUser(order.createdByName, order.createdBy)}</strong>
                </span>
                {order.importedBy && (
                  <span>
                    Người nhập: <strong>{formatUser(undefined, order.importedBy)}</strong>
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

          {loading ? (
            <div className="flex items-center justify-center py-6">
              <Icon name="progress_activity" size={20} className="animate-spin text-muted-foreground" />
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
              Đơn này không có sản phẩm.
            </div>
          ) : (
            <>
              <div className="rounded-xl border bg-surface-container-lowest p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold">Tiến độ nhận hàng</div>
                    <div className="text-xs text-muted-foreground">
                      {items.length} mặt hàng · Đã nhập {formatNumber(totalReceivedQty)} / {formatNumber(totalOrderedQty)}
                    </div>
                  </div>
                  {canPartialReceive && (
                    <Button size="sm" variant="outline" onClick={onRequestPartialReceive}>
                      <Icon name="call_received" size={14} />
                      <span className="ml-1">Nhận hàng</span>
                    </Button>
                  )}
                </div>
                <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${receivePercent}%` }} />
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <div className="rounded-lg bg-muted/40 px-3 py-2">
                    <div className="text-xs text-muted-foreground">Đã nhận</div>
                    <div className="font-semibold tabular-nums text-status-success">
                      {formatCurrency(totalReceivedValue)}
                    </div>
                  </div>
                  <div className="rounded-lg bg-muted/40 px-3 py-2">
                    <div className="text-xs text-muted-foreground">Còn nhận</div>
                    <div className="font-semibold tabular-nums text-status-warning">
                      {formatCurrency(totalRemainingValue)}
                    </div>
                  </div>
                  <div className="rounded-lg bg-muted/40 px-3 py-2">
                    <div className="text-xs text-muted-foreground">Cần trả NCC</div>
                    <div className="font-semibold tabular-nums text-primary">
                      {formatCurrency(order.amountOwed)}
                    </div>
                  </div>
                </div>
              </div>
              <DetailItemsTable
                columns={[
                  { header: "Mã hàng", accessor: "productCode" as never },
                  { header: "Tên hàng", accessor: "productName" as never },
                  {
                    header: "Đã nhập / SL",
                    accessor: (item: Record<string, unknown>) => {
                      const received = item.receivedQuantity as number;
                      const total = item.quantity as number;
                      const unit = (item.unit as string) || "";
                      const done = received >= total;
                      return (
                        <span className={done ? "text-status-success font-semibold" : "text-status-warning"}>
                          {formatNumber(received)} / {formatNumber(total)} {unit}
                        </span>
                      );
                    },
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
                        {formatCurrency(item.lineTotal as number)}
                      </span>
                    ),
                    align: "right",
                  },
                ]}
                items={items as unknown as Record<string, unknown>[]}
                summary={[
                  {
                    label: "Tổng tiền hàng",
                    value: formatCurrency(totalOrdered),
                  },
                  {
                    label: "Đã nhập",
                    value: formatCurrency(totalReceivedValue),
                  },
                  {
                    label: "Cần trả NCC",
                    value: formatCurrency(order.amountOwed),
                    className: "font-bold text-base",
                  },
                ]}
              />
            </>
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
      label: "Lịch sử thanh toán",
      content: <PaymentHistoryTab orderId={order.id} />,
    },
    {
      id: "audit_history",
      label: "Lịch sử thay đổi",
      content: <AuditHistoryTab entityType="purchase_order" entityId={order.id} />,
    },
  ];

  return (
    <InlineDetailPanel
      open
      onClose={onClose}
      onEdit={onEdit}
      onDelete={onDelete}
      deleteLabel="Hủy"
    >
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
  const { toast } = useToast();
  const { activeBranchId } = useBranchFilter();
  const router = useRouter();
  const { printWithPicker, printerDialog } = usePrintWithPicker();
  const txPerms = useTxRowPermissions("goods_receipt");
  const [data, setData] = useState<PurchaseOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingPO, setEditingPO] = useState<{
    id: string;
    code: string;
    supplierId: string;
    supplierName: string;
    total?: number;
    taxAmount?: number;
    note?: string;
    paid?: number;
    /** Phase 1.5 (CEO 01/06/2026): nếu 'ordered' → dialog chỉ cho sửa paid+note. */
    status?: "draft" | "ordered" | "partial" | "completed" | "cancelled";
  } | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [payingItem, setPayingItem] = useState<PurchaseOrder | null>(null);
  const [partialReceiveOrder, setPartialReceiveOrder] = useState<PurchaseOrder | null>(null);
  // Day 2 16/05: Đóng đơn còn thiếu — partial/ordered → completed kèm reason
  const [closeShortTarget, setCloseShortTarget] = useState<PurchaseOrder | null>(null);
  const [closeShortReason, setCloseShortReason] = useState("");
  const [closingShort, setClosingShort] = useState(false);
  // Sprint UX-1 Stage 4: Audit log dialog
  const [auditDialogTarget, setAuditDialogTarget] = useState<PurchaseOrder | null>(null);

  // Inline detail
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  // Stars
  const { starred, toggle: toggleStar } = useStarredSet();

  // Filters — default = pipeline thực sự (loại trừ cancelled)
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([
    "draft",
    "ordered",
    "partial",
    "completed",
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
      size: 150,
      cell: ({ row }) => {
        const meta = STATUS_META[row.original.status];
        return <PipelineStatusBadge name={meta.label} color={meta.color} size="sm" />;
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
      branchId: activeBranchId,
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
  }, [page, pageSize, search, selectedStatuses, creatorFilter, importerFilter, costReturnFilter, activeBranchId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(0);
    setExpandedRow(null);
  }, [search, selectedStatuses, datePreset, creatorFilter, importerFilter, costReturnFilter]);

  /* ---- Summary ---- */
  const totalAmountOwed = data.reduce((sum, o) => sum + o.amountOwed, 0);

  /* ---- Export — Day 3 16/05/2026: focused per-module pattern ---- */
  const handleExport = (type: "excel" | "csv") => {
    if (type === "csv") {
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
          format: (v: PurchaseOrderStatus) => STATUS_META[v]?.label ?? v,
        },
      ];
      exportToCsv(data, exportColumns, "danh-sach-nhap-hang");
      return;
    }

    // ---- Excel: Info + Chi tiết + Theo NCC + Theo trạng thái ----
    const today = new Date().toISOString().slice(0, 10);
    const dateFromIso = dateFrom || today;
    const dateToIso = dateTo || today;

    const detailRows = data.map((o) => ({
      code: o.code,
      date: formatDate(o.date),
      supplierName: o.supplierName ?? "",
      status: STATUS_META[o.status]?.label ?? o.status,
      total: o.total,
      paid: o.paid,
      amountOwed: o.amountOwed,
      tax: o.taxAmount,
      createdByName: o.createdByName ?? "",
    }));
    const totalTotal = data.reduce((s, o) => s + (o.total ?? 0), 0);
    const totalPaid = data.reduce((s, o) => s + (o.paid ?? 0), 0);
    const totalTax = data.reduce((s, o) => s + (o.taxAmount ?? 0), 0);

    const detailSheet: ExcelSheet = {
      name: "Đơn nhập chi tiết",
      titleRows: ["DANH SÁCH ĐƠN NHẬP HÀNG"],
      columns: [
        { label: "Mã đơn", key: "code", width: 14 },
        { label: "Ngày", key: "date", width: 14, format: "text" },
        { label: "Nhà cung cấp", key: "supplierName", width: 28 },
        { label: "Trạng thái", key: "status", width: 14 },
        { label: "Tổng tiền", key: "total", width: 16, format: "currency" },
        { label: "Thuế", key: "tax", width: 14, format: "currency" },
        { label: "Đã trả", key: "paid", width: 14, format: "currency" },
        { label: "Còn nợ", key: "amountOwed", width: 14, format: "currency" },
        { label: "Người lập", key: "createdByName", width: 18 },
      ],
      rows: detailRows,
      footer: {
        code: "",
        date: "",
        supplierName: "TỔNG CỘNG",
        status: "",
        total: totalTotal,
        tax: totalTax,
        paid: totalPaid,
        amountOwed: totalAmountOwed,
        createdByName: "",
      },
      footerLabel: `${detailRows.length} đơn`,
      withSignature: true,
    };

    // Pivot theo NCC
    const bySupplier = new Map<
      string,
      { name: string; count: number; total: number; paid: number; debt: number }
    >();
    for (const o of data) {
      const key = o.supplierName ?? "(không xác định)";
      const ex = bySupplier.get(key) ?? {
        name: key,
        count: 0,
        total: 0,
        paid: 0,
        debt: 0,
      };
      ex.count += 1;
      ex.total += o.total ?? 0;
      ex.paid += o.paid ?? 0;
      ex.debt += o.amountOwed ?? 0;
      bySupplier.set(key, ex);
    }
    const supplierRows = Array.from(bySupplier.values()).sort(
      (a, b) => b.total - a.total,
    );
    const supplierSheet: ExcelSheet = {
      name: "Theo NCC",
      titleRows: ["NHẬP HÀNG THEO NHÀ CUNG CẤP"],
      columns: [
        { label: "Nhà cung cấp", key: "name", width: 28 },
        { label: "Số đơn", key: "count", width: 12, format: "number" },
        { label: "Tổng tiền", key: "total", width: 16, format: "currency" },
        { label: "Đã trả", key: "paid", width: 16, format: "currency" },
        { label: "Còn nợ", key: "debt", width: 16, format: "currency" },
      ],
      rows: supplierRows,
      footer: {
        name: "TỔNG",
        count: detailRows.length,
        total: totalTotal,
        paid: totalPaid,
        debt: totalAmountOwed,
      },
    };

    // Pivot theo trạng thái
    const byStatus = new Map<
      string,
      { label: string; count: number; total: number }
    >();
    for (const o of data) {
      const k = STATUS_META[o.status]?.label ?? o.status;
      const ex = byStatus.get(k) ?? { label: k, count: 0, total: 0 };
      ex.count += 1;
      ex.total += o.total ?? 0;
      byStatus.set(k, ex);
    }
    const statusRows = Array.from(byStatus.values()).sort(
      (a, b) => b.count - a.count,
    );
    const statusSheet: ExcelSheet = {
      name: "Theo trạng thái",
      titleRows: ["NHẬP HÀNG THEO TRẠNG THÁI"],
      columns: [
        { label: "Trạng thái", key: "label", width: 20 },
        { label: "Số đơn", key: "count", width: 12, format: "number" },
        { label: "Tổng tiền", key: "total", width: 16, format: "currency" },
      ],
      rows: statusRows,
      footer: {
        label: "TỔNG",
        count: detailRows.length,
        total: totalTotal,
      },
    };

    const infoSheet = buildInfoSheet({
      title: "BÁO CÁO NHẬP HÀNG",
      description: "Danh sách đơn nhập + tổng theo NCC + theo trạng thái",
      range: { from: dateFromIso, to: dateToIso },
      branchName: activeBranchId ? "Chi nhánh đang chọn" : "Tất cả chi nhánh",
      tenantName: "OneBiz",
      generatedAt: new Date(),
      disclaimer:
        "Báo cáo quản trị nội bộ — không thay thế Báo cáo Tài chính theo TT200/133.",
    });

    try {
      exportReportToExcel({
        kind: "dat-hang",
        mode: "full",
        range: { from: dateFromIso, to: dateToIso },
        branchName: activeBranchId ? "Chi nhánh đang chọn" : undefined,
        tenantName: "OneBiz",
        sheets: [infoSheet, detailSheet, supplierSheet, statusSheet],
      });
      toast({
        title: "Đã xuất Excel đơn nhập",
        description: `4 sheet: Info + Chi tiết (${detailRows.length}) + Theo NCC (${supplierRows.length}) + Theo trạng thái (${statusRows.length})`,
        variant: "success",
      });
    } catch (err) {
      toast({
        title: "Lỗi xuất Excel",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    }
  };

  /* ---- Inline detail renderer ---- */
  const renderDetail = (order: PurchaseOrder, onClose: () => void) => (
    <PurchaseOrderDetail
      order={order}
      onClose={onClose}
      onRequestPartialReceive={() => setPartialReceiveOrder(order)}
      onEdit={
        // Phase 1.5 (CEO 01/06/2026): cho sửa cả status='ordered' nhưng dialog
        // chỉ enable paid + note (không đụng tồn). Items thay đổi → Huỷ phiếu.
        order.status === "draft" || order.status === "ordered"
          ? () => {
              setEditingPO({
                id: order.id,
                code: order.code,
                supplierId: order.supplierId,
                supplierName: order.supplierName,
                total: order.total,
                taxAmount: order.taxAmount,
                paid: order.paid,
                status: order.status,
              });
              setCreateOpen(true);
            }
          : undefined
      }
      onDelete={
        order.status !== "completed" && order.status !== "cancelled"
          ? () => handleAdvanceStatus(order, "cancelled")
          : undefined
      }
    />
  );

  /* ---- Kanban derivation ---- */
  const KANBAN_STATUSES: PurchaseOrderStatus[] = [
    "draft",
    "ordered",
    "partial",
    "completed",
  ];

  const kanbanColumns: KanbanColumn<PurchaseOrder>[] = KANBAN_STATUSES.map(
    (status) => ({
      id: status,
      label: STATUS_META[status].label,
      color: STATUS_META[status].color,
      items: data.filter((o) => o.status === status),
    })
  );

  const handleCardMove = async (
    itemId: string,
    _from: string,
    to: string
  ) => {
    try {
      await updatePurchaseOrderStatus(itemId, to as PurchaseOrderStatus);
      toast({
        title: "Đã chuyển trạng thái",
        description: STATUS_META[to as PurchaseOrderStatus].label,
        variant: "success",
      });
      fetchData();
    } catch (err) {
      toast({
        title: "Không thể chuyển trạng thái",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    }
  };

  const handleAdvanceStatus = async (
    order: PurchaseOrder,
    target: PurchaseOrderStatus
  ) => {
    try {
      await updatePurchaseOrderStatus(order.id, target);
      toast({
        title: "Đã chuyển trạng thái",
        description: `${order.code} → ${STATUS_META[target].label}`,
        variant: "success",
      });
      fetchData();
    } catch (err) {
      toast({
        title: "Không thể chuyển trạng thái",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    }
  };

  // Day 2 16/05: Đóng đơn còn thiếu — RPC close_purchase_order_short
  const handleConfirmCloseShort = async () => {
    if (!closeShortTarget || closingShort) return;
    if (closeShortReason.trim().length < 5) {
      toast({
        title: "Lý do tối thiểu 5 ký tự",
        description: "Bắt buộc cho audit — VD: NCC hết hàng, đã đổi NCC khác.",
        variant: "warning",
      });
      return;
    }
    setClosingShort(true);
    try {
      const result = await closePurchaseOrderShort(
        closeShortTarget.id,
        closeShortReason.trim(),
      );
      toast({
        title: "Đã đóng đơn còn thiếu",
        description: `${result.code} — nhận đủ ${result.itemsReceivedFully} dòng, đóng ${result.itemsRemaining} dòng còn thiếu.`,
        variant: "success",
      });
      setCloseShortTarget(null);
      setCloseShortReason("");
      fetchData();
    } catch (err) {
      toast({
        title: "Đóng đơn thất bại",
        description: err instanceof Error ? err.message : "Lỗi không xác định",
        variant: "error",
      });
    } finally {
      setClosingShort(false);
    }
  };

  /* ---- KPI row (derived từ current fetched data) ---- */
  // View-over-current-result: không query thêm để tránh roundtrip.
  // `total` là tổng server-side, `data` là rows trang hiện tại.
  const kpiTotalAmount = data.reduce((sum, d) => sum + (d.total ?? 0), 0);
  const kpiTotalOwed = data.reduce((sum, d) => sum + (d.amountOwed ?? 0), 0);
  const kpiPartial = data.filter((d) => d.status === "partial").length;
  const kpiCompleted = data.filter((d) => d.status === "completed").length;

  /* ---- Render ---- */
  return (
    <>
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
            label: viewMode === "list" ? "Xem Kanban" : "Xem danh sách",
            icon:
              viewMode === "list" ? (
                <Icon name="view_kanban" size={16} />
              ) : (
                <Icon name="list" size={16} />
              ),
            variant: "outline",
            onClick: () => setViewMode(viewMode === "list" ? "kanban" : "list"),
          },
          {
            label: "Nhập hàng",
            icon: <Icon name="add" size={16} />,
            variant: "default",
            onClick: () => setCreateOpen(true),
          },
          {
            label: "Xuất file",
            icon: <Icon name="download" size={16} />,
          },
        ]}
      />

      {!loading && data.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 pt-4">
          <SummaryCard
            icon={<Icon name="receipt_long" size={16} />}
            label="Tổng phiếu nhập"
            value={total.toString()}
          />
          <SummaryCard
            icon={<Icon name="hourglass_bottom" size={16} />}
            label="Đang nhận"
            value={kpiPartial.toString()}
            highlight={kpiPartial > 0}
          />
          <SummaryCard
            icon={<Icon name="check_circle" size={16} />}
            label="Đã hoàn tất"
            value={kpiCompleted.toString()}
          />
          <SummaryCard
            icon={<Icon name="payments" size={16} />}
            label="Công nợ NCC"
            value={formatCurrency(kpiTotalOwed)}
            hint={`Tổng GTGT: ${formatCurrency(kpiTotalAmount)}`}
            danger={kpiTotalOwed > 0}
          />
        </div>
      )}

      {viewMode === "kanban" ? (
        <div className="p-4">
          <KanbanBoard
            columns={kanbanColumns}
            getItemId={(o) => o.id}
            onCardMove={handleCardMove}
            canDrop={(_id, from, to) => canTransitionPurchaseStatus(from, to)}
            emptyMessage="Không có phiếu"
            renderCard={(order) => (
              <div className="space-y-1">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-medium text-primary text-xs">
                    {order.code}
                  </span>
                  <span className="text-[10px] text-muted-foreground">
                    {formatDate(order.date)}
                  </span>
                </div>
                <div className="text-sm font-medium truncate">
                  {order.supplierName}
                </div>
                {order.orderCode && (
                  <div className="text-xs text-muted-foreground truncate">
                    DH: {order.orderCode}
                  </div>
                )}
                <div className="flex items-center justify-between pt-1 border-t mt-1">
                  <span className="text-xs text-muted-foreground">
                    Cần trả
                  </span>
                  <span className="text-xs font-semibold">
                    {formatCurrency(order.amountOwed)}
                  </span>
                </div>
              </div>
            )}
          />
        </div>
      ) : (
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
                { header: "Mã nhập hàng", key: "code", width: 15 },
                { header: "Mã đặt hàng nhập", key: "orderCode", width: 15 },
                {
                  header: "Thời gian",
                  key: "date",
                  width: 18,
                  format: (v: string) => formatDate(v),
                },
                { header: "Mã NCC", key: "supplierCode", width: 12 },
                { header: "Nhà cung cấp", key: "supplierName", width: 25 },
                {
                  header: "Cần trả NCC",
                  key: "amountOwed",
                  width: 15,
                  format: (v: number) => v,
                },
                {
                  header: "Trạng thái",
                  key: "status",
                  width: 15,
                  format: (v: PurchaseOrderStatus) =>
                    STATUS_META[v]?.label ?? v,
                },
              ];
              exportToExcel(selectedRows, cols, "nhap-hang-da-chon");
              toast({
                title: "Đã xuất Excel",
                description: `${selectedRows.length} phiếu nhập`,
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
                  buildGoodsReceiptPrintData(row),
                  "In phiếu nhập",
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
                  title: "Không có phiếu nào có thể hủy",
                  description:
                    "Chỉ hủy được phiếu chưa hoàn thành / chưa hủy",
                  variant: "info",
                });
                return;
              }
              if (
                !window.confirm(
                  `Hủy ${cancellable.length} phiếu nhập? Thao tác này không thể hoàn tác.`,
                )
              )
                return;
              try {
                await Promise.all(
                  cancellable.map((r) =>
                    updatePurchaseOrderStatus(r.id, "cancelled"),
                  ),
                );
                toast({
                  title: `Đã hủy ${cancellable.length} phiếu`,
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
          amountOwed: formatCurrency(totalAmountOwed),
        }}
        expandedRow={expandedRow}
        onExpandedRowChange={setExpandedRow}
        renderDetail={renderDetail}
        getRowId={(row) => row.id}
        rowActions={(row) => {
          // Sprint UX-1 Stage 4: standardized transaction row actions
          const workflowActions: Array<{ label: string; icon?: React.ReactNode; onClick: () => void }> = [];
          if (row.status === "draft") {
            workflowActions.push({
              label: "Xác nhận đặt hàng",
              icon: <Icon name="arrow_forward" size={16} />,
              onClick: () => handleAdvanceStatus(row, "ordered"),
            });
          } else if (row.status === "ordered") {
            workflowActions.push({
              label: "Nhập một phần",
              icon: <Icon name="arrow_forward" size={16} />,
              onClick: () => handleAdvanceStatus(row, "partial"),
            });
            workflowActions.push({
              label: "Hoàn thành nhập",
              icon: <Icon name="arrow_forward" size={16} />,
              onClick: () => handleAdvanceStatus(row, "completed"),
            });
            workflowActions.push({
              label: "Đóng đơn (không nhận)",
              icon: <Icon name="block" size={16} />,
              onClick: () => {
                setCloseShortTarget(row);
                setCloseShortReason("");
              },
            });
          } else if (row.status === "partial") {
            workflowActions.push({
              label: "Hoàn thành nhập",
              icon: <Icon name="arrow_forward" size={16} />,
              onClick: () => handleAdvanceStatus(row, "completed"),
            });
            workflowActions.push({
              label: "Đóng đơn còn thiếu",
              icon: <Icon name="block" size={16} />,
              onClick: () => {
                setCloseShortTarget(row);
                setCloseShortReason("");
              },
            });
          }

          return buildTransactionRowActions({
            row,
            kind: "goods_receipt",
            permissions: txPerms,
            // Phase 1.5 (CEO 01/06/2026): cho sửa cả draft + ordered. Dialog
            // sẽ tự khoá items/qty khi status='ordered' (chỉ sửa paid+note).
            onEdit:
              row.status === "draft" || row.status === "ordered"
                ? () => {
                    setEditingPO({
                      id: row.id,
                      code: row.code,
                      supplierId: row.supplierId,
                      supplierName: row.supplierName,
                      total: row.total,
                      taxAmount: row.taxAmount,
                      paid: row.paid,
                      status: row.status,
                    });
                    setCreateOpen(true);
                  }
                : undefined,
            onPrint: () =>
              printWithPicker(buildGoodsReceiptPrintData(row), "In phiếu nhập"),
            workflowActions,
            // Trả hàng nhập (redirect)
            onReturn: () => {
              toast({
                variant: "info",
                title: "Chuyển đến trang trả hàng nhập",
                description: "Tạo phiếu trả cho phiếu nhập " + row.code,
              });
              router.push("/hang-hoa/tra-hang-nhap");
            },
            // Trả nợ NCC — chỉ amountOwed > 0
            onPayment:
              row.amountOwed > 0 ? () => setPayingItem(row) : undefined,
            // Audit log shortcut
            onAuditLog: () => setAuditDialogTarget(row),
            // Hủy — chỉ chưa completed/cancelled
            onCancel:
              row.status !== "completed" && row.status !== "cancelled"
                ? () => handleAdvanceStatus(row, "cancelled")
                : undefined,
          });
        }}
      />
      )}
    </ListPageLayout>

    <CreatePurchaseOrderDialog
      open={createOpen}
      onOpenChange={(open) => {
        setCreateOpen(open);
        if (!open) setEditingPO(null);
      }}
      onSuccess={fetchData}
      editingPO={editingPO}
    />

    {payingItem && (
      <RecordPaymentDialog
        open={!!payingItem}
        onOpenChange={(open) => { if (!open) setPayingItem(null); }}
        onSuccess={fetchData}
        type="purchase_order"
        referenceId={payingItem.id}
        referenceCode={payingItem.code}
        counterpartyName={payingItem.supplierName}
        currentDebt={payingItem.amountOwed}
      />
    )}

    <PartialReceiveDialog
      open={!!partialReceiveOrder}
      onOpenChange={(open) => {
        if (!open) setPartialReceiveOrder(null);
      }}
      orderId={partialReceiveOrder?.id ?? null}
      orderCode={partialReceiveOrder?.code ?? ""}
      onSuccess={() => {
        setPartialReceiveOrder(null);
        fetchData();
      }}
    />

    {printerDialog}

    {/* Sprint UX-1 Stage 4: Audit log shortcut từ row action */}
    {auditDialogTarget && (
      <AuditLogDialog
        entityType="purchase_order"
        entityId={auditDialogTarget.id}
        entityCode={auditDialogTarget.code}
        onClose={() => setAuditDialogTarget(null)}
      />
    )}

    {/* Day 2 16/05: Đóng đơn còn thiếu */}
    <Dialog
      open={!!closeShortTarget}
      onOpenChange={(o) => {
        if (!o) {
          setCloseShortTarget(null);
          setCloseShortReason("");
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="block" size={16} />
            Đóng đơn nhập còn thiếu
          </DialogTitle>
          <DialogDescription>
            Thao tác sẽ chuyển đơn sang trạng thái <b>Hoàn thành</b> kèm marker{" "}
            <code>closed_short=true</code>. Số lượng đã nhận vẫn giữ nguyên trong kho.
            Không hoàn được — báo cáo sẽ phân biệt &quot;nhận đủ&quot; vs &quot;đóng còn
            thiếu&quot;.
          </DialogDescription>
        </DialogHeader>

        {closeShortTarget && (
          <div className="space-y-3">
            <div className="rounded-lg bg-surface-container-low p-3 text-sm">
              <div className="font-semibold">{closeShortTarget.code}</div>
              <div className="text-muted-foreground text-xs mt-1">
                NCC: {closeShortTarget.supplierName} •{" "}
                {STATUS_META[closeShortTarget.status as PurchaseOrderStatus]?.label}
              </div>
              <div className="mt-2 font-bold text-base tabular-nums text-primary">
                {formatCurrency(closeShortTarget.total)}
              </div>
            </div>

            <div>
              <label className="text-sm font-medium block mb-1">
                Lý do đóng đơn <span className="text-status-error">*</span>
              </label>
              <Textarea
                value={closeShortReason}
                onChange={(e) => setCloseShortReason(e.target.value)}
                placeholder="VD: NCC hết hàng, đã đổi NCC khác, đơn nhỏ không đáng nhận tiếp..."
                rows={3}
                className="resize-none"
              />
              <div className="text-[11px] text-muted-foreground mt-1">
                Tối thiểu 5 ký tự. Ghi vào audit log để báo cáo loss/short receipt.
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              setCloseShortTarget(null);
              setCloseShortReason("");
            }}
            disabled={closingShort}
          >
            Đóng
          </Button>
          <Button
            onClick={handleConfirmCloseShort}
            disabled={closingShort || closeShortReason.trim().length < 5}
          >
            {closingShort ? (
              <>
                <Icon name="progress_activity" size={14} className="animate-spin mr-1" />
                Đang đóng...
              </>
            ) : (
              <>
                <Icon name="block" size={14} className="mr-1" />
                Xác nhận đóng
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
