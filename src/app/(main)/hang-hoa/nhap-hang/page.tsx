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
  DetailInfoGrid,
  DetailItemsTable,
  AuditHistoryTab,
} from "@/components/shared/inline-detail-panel";
import type { DetailTab } from "@/components/shared/inline-detail-panel";
import { useToast, useBranchFilter } from "@/lib/contexts";
import { usePrintWithPicker } from "@/lib/hooks/use-print-with-picker";
import { buildGoodsReceiptPrintData } from "@/lib/print-templates";
import { formatCurrency, formatDate, formatUser } from "@/lib/format";
import { exportToExcel, exportToCsv } from "@/lib/utils/export";
import {
  getPurchaseOrders,
  getPurchaseOrderStatuses,
  getPurchaseOrderStatusMeta,
  updatePurchaseOrderStatus,
  canTransitionPurchaseStatus,
  getPurchaseOrderItems,
  getPaymentHistory,
  type PurchaseOrderItemRow,
} from "@/lib/services";
import type { PurchaseOrder, PurchaseOrderStatus } from "@/lib/types";
import { CreatePurchaseOrderDialog } from "@/components/shared/dialogs";
import { RecordPaymentDialog } from "@/components/shared/dialogs/record-payment-dialog";
import { PartialReceiveDialog } from "@/components/shared/dialogs/partial-receive-dialog";
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
        <Icon name="progress_activity" size={18} className="animate-spin" />
        Đang tải lịch sử thanh toán...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-status-error gap-2">
        <Icon name="error" size={18} />
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
  const totalRemaining = items.reduce((s, i) => s + i.remaining, 0);
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
                  Người tạo: <strong>{formatUser(undefined, order.createdBy)}</strong>
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
              <div className="flex items-center justify-between">
                <div className="text-xs text-muted-foreground">
                  {items.length} mặt hàng · Đã nhập {items.filter((i) => i.receivedQuantity > 0).length} / {items.length}
                </div>
                {canPartialReceive && (
                  <Button size="sm" variant="outline" onClick={onRequestPartialReceive}>
                    <Icon name="call_received" size={14} />
                    <span className="ml-1">Nhập một phần</span>
                  </Button>
                )}
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
                          {received} / {total} {unit}
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
  const [data, setData] = useState<PurchaseOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingPO, setEditingPO] = useState<{ id: string; code: string; supplierId: string; supplierName: string; note?: string } | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("list");
  const [payingItem, setPayingItem] = useState<PurchaseOrder | null>(null);
  const [partialReceiveOrder, setPartialReceiveOrder] = useState<PurchaseOrder | null>(null);

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
        format: (v: PurchaseOrderStatus) => STATUS_META[v]?.label ?? v,
      },
    ];
    if (type === "excel") exportToExcel(data, exportColumns, "danh-sach-nhap-hang");
    else exportToCsv(data, exportColumns, "danh-sach-nhap-hang");
  };

  /* ---- Inline detail renderer ---- */
  const renderDetail = (order: PurchaseOrder, onClose: () => void) => (
    <PurchaseOrderDetail
      order={order}
      onClose={onClose}
      onRequestPartialReceive={() => setPartialReceiveOrder(order)}
      onEdit={
        order.status === "draft"
          ? () => {
              setEditingPO({
                id: order.id,
                code: order.code,
                supplierId: order.supplierId,
                supplierName: order.supplierName,
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
            label="Đang nhận (partial)"
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
        summaryRow={{
          amountOwed: formatCurrency(totalAmountOwed),
        }}
        expandedRow={expandedRow}
        onExpandedRowChange={setExpandedRow}
        renderDetail={renderDetail}
        getRowId={(row) => row.id}
        rowActions={(row) => {
          const actions = [];
          // Advance to next valid status
          if (row.status === "draft") {
            actions.push({
              label: "Sửa",
              icon: <Icon name="edit" size={16} />,
              onClick: () => {
                setEditingPO({
                  id: row.id,
                  code: row.code,
                  supplierId: row.supplierId,
                  supplierName: row.supplierName,
                });
                setCreateOpen(true);
              },
            });
            actions.push({
              label: "Xác nhận đặt hàng",
              icon: <Icon name="arrow_forward" size={16} />,
              onClick: () => handleAdvanceStatus(row, "ordered"),
            });
          } else if (row.status === "ordered") {
            actions.push({
              label: "Nhập một phần",
              icon: <Icon name="arrow_forward" size={16} />,
              onClick: () => handleAdvanceStatus(row, "partial"),
            });
            actions.push({
              label: "Hoàn thành nhập",
              icon: <Icon name="arrow_forward" size={16} />,
              onClick: () => handleAdvanceStatus(row, "completed"),
            });
          } else if (row.status === "partial") {
            actions.push({
              label: "Hoàn thành nhập",
              icon: <Icon name="arrow_forward" size={16} />,
              onClick: () => handleAdvanceStatus(row, "completed"),
            });
          }
          actions.push({
            label: "In phiếu",
            icon: <Icon name="print" size={16} />,
            onClick: () => printWithPicker(buildGoodsReceiptPrintData(row), "In phiếu nhập"),
          });
          actions.push({
            label: "Trả hàng nhập",
            icon: <Icon name="undo" size={16} />,
            onClick: () => {
              toast({ variant: "info", title: "Chuyển đến trang trả hàng nhập", description: "Tạo phiếu trả cho phiếu nhập " + row.code });
              router.push("/hang-hoa/tra-hang-nhap");
            },
          });
          if (row.amountOwed > 0) {
            actions.push({
              label: "Trả nợ NCC",
              icon: <Icon name="payments" size={16} />,
              onClick: () => setPayingItem(row),
            });
          }
          if (row.status !== "completed" && row.status !== "cancelled") {
            actions.push({
              label: "Hủy",
              icon: <Icon name="cancel" size={16} />,
              onClick: () => handleAdvanceStatus(row, "cancelled"),
              variant: "destructive" as const,
              separator: true,
            });
          }
          return actions;
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
    </>
  );
}
