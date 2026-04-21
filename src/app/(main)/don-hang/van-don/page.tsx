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
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/shared/dialogs/confirm-dialog";
import { formatCurrency, formatDate } from "@/lib/format";
import { exportToExcel, exportToCsv } from "@/lib/utils/export";
import {
  getShippingOrders,
  getShippingStatuses,
  getPartnerOptionsAsync,
  updateShippingOrderStatus,
  getNextShippingStatuses,
  SHIPPING_STATUS_LABEL,
} from "@/lib/services";
import { getAuditLogsByEntity, type AuditLogEntry } from "@/lib/services/supabase/audit";
import { CreateShippingOrderDialog } from "@/components/shared/dialogs";
import type { ShippingOrder, ShippingStatus } from "@/lib/types";
import { useBranchFilter, useToast } from "@/lib/contexts";
import { Icon } from "@/components/ui/icon";

// --- Status config ---

const statusMap: Record<
  ShippingStatus,
  { label: string; variant: "default" | "secondary" | "outline" | "destructive" }
> = {
  pending: { label: "Chờ lấy hàng", variant: "secondary" },
  picked_up: { label: "Đã lấy hàng", variant: "outline" },
  in_transit: { label: "Đang giao", variant: "outline" },
  delivered: { label: "Đã giao", variant: "default" },
  returned: { label: "Đã hoàn", variant: "destructive" },
  cancelled: { label: "Đã hủy", variant: "destructive" },
};

const statusOptions = getShippingStatuses();

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
  onStatusChanged,
}: {
  order: ShippingOrder;
  onClose: () => void;
  onStatusChanged: () => void;
}) {
  const status = statusMap[order.status];
  const nextStatuses = getNextShippingStatuses(order.status);
  const [busy, setBusy] = useState(false);
  const [logs, setLogs] = useState<AuditLogEntry[] | null>(null);
  const [logsLoading, setLogsLoading] = useState(true);
  const { toast } = useToast();

  // Các transition terminal (delivered/returned/cancelled) là IRREVERSIBLE — cần confirm.
  // Transition "on-the-way" (picked_up/in_transit) cũng confirm để tránh bấm nhầm vào UI cầm tay.
  const [pendingNext, setPendingNext] = useState<ShippingStatus | null>(null);

  const loadLogs = useCallback(async () => {
    setLogsLoading(true);
    try {
      const entries = await getAuditLogsByEntity("shipping_order", order.id, 50);
      setLogs(entries);
    } finally {
      setLogsLoading(false);
    }
  }, [order.id]);

  useEffect(() => {
    loadLogs();
  }, [loadLogs]);

  const executeTransition = async (next: ShippingStatus) => {
    if (busy) return;
    setBusy(true);
    try {
      await updateShippingOrderStatus(order.id, next);
      toast({
        title: "Đã cập nhật trạng thái",
        description: `${order.code}: ${SHIPPING_STATUS_LABEL[order.status]} → ${SHIPPING_STATUS_LABEL[next]}`,
        variant: "success",
      });
      setPendingNext(null);
      await loadLogs();
      onStatusChanged();
    } catch (err) {
      toast({
        title: "Không thể cập nhật",
        description: err instanceof Error ? err.message : String(err),
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  const isTerminal = (s: ShippingStatus) =>
    s === "delivered" || s === "returned" || s === "cancelled";

  const transitionDialogProps = (next: ShippingStatus) => {
    const fromLabel = SHIPPING_STATUS_LABEL[order.status];
    const toLabel = SHIPPING_STATUS_LABEL[next];
    if (next === "delivered") {
      return {
        title: "Xác nhận đã giao hàng?",
        description: `Vận đơn ${order.code}: ${fromLabel} → ${toLabel}. Trạng thái sẽ được khoá — không thể chỉnh sửa sau khi xác nhận. Tiếp tục?`,
        confirmLabel: "Đã giao",
        variant: "default" as const,
      };
    }
    if (next === "returned") {
      return {
        title: "Đánh dấu hoàn hàng?",
        description: `Vận đơn ${order.code}: ${fromLabel} → ${toLabel}. Hàng đã rời kho, cần xử lý nhập lại kho thủ công. Tiếp tục?`,
        confirmLabel: "Đã hoàn",
        variant: "destructive" as const,
      };
    }
    if (next === "cancelled") {
      return {
        title: "Huỷ vận đơn?",
        description: `Vận đơn ${order.code}: ${fromLabel} → ${toLabel}. Thao tác không thể hoàn tác.`,
        confirmLabel: "Huỷ vận đơn",
        variant: "destructive" as const,
      };
    }
    return {
      title: "Đổi trạng thái vận đơn?",
      description: `Vận đơn ${order.code}: ${fromLabel} → ${toLabel}.`,
      confirmLabel: toLabel,
      variant: "default" as const,
    };
  };

  return (
    <InlineDetailPanel open onClose={onClose}>
      <div className="flex items-start justify-between gap-3 pb-2">
        <DetailHeader
          title={`Vận đơn ${order.code}`}
          code={order.invoiceCode}
          status={{ label: status.label, variant: status.variant }}
          subtitle={order.deliveryPartner}
        />
        {nextStatuses.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              disabled={busy}
              className="inline-flex items-center gap-1 h-8 px-3 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed shrink-0 outline-none"
            >
              <Icon name="sync_alt" size={14} />
              Đổi trạng thái
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {nextStatuses.map((s) => (
                <DropdownMenuItem
                  key={s}
                  onSelect={() => {
                    // Terminal → luôn confirm. Non-terminal (picked_up / in_transit)
                    // cũng confirm để tránh bấm nhầm trên tablet / touch-UI.
                    if (isTerminal(s) || s === "picked_up" || s === "in_transit") {
                      setPendingNext(s);
                    } else {
                      executeTransition(s);
                    }
                  }}
                  className="cursor-pointer"
                >
                  <Icon
                    name={
                      s === "delivered"
                        ? "check_circle"
                        : s === "cancelled" || s === "returned"
                          ? "cancel"
                          : "local_shipping"
                    }
                    size={14}
                    className="mr-2"
                  />
                  {SHIPPING_STATUS_LABEL[s]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {pendingNext && (
        <ConfirmDialog
          open
          onOpenChange={(o) => {
            if (!o) setPendingNext(null);
          }}
          {...transitionDialogProps(pendingNext)}
          cancelLabel="Đóng"
          loading={busy}
          onConfirm={() => executeTransition(pendingNext)}
        />
      )}
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
                  { label: "Đối tác giao hàng", value: order.deliveryPartner },
                  { label: "Khách hàng", value: order.customerName },
                  { label: "Phí giao", value: formatCurrency(order.fee) },
                  { label: "COD", value: formatCurrency(order.cod) },
                ]}
              />
            ),
          },
          {
            id: "delivery_history",
            label: "Lịch sử giao hàng",
            content: (
              <div className="py-2">
                {logsLoading ? (
                  <div className="text-sm text-muted-foreground py-4 text-center">
                    Đang tải lịch sử…
                  </div>
                ) : !logs || logs.length === 0 ? (
                  <div className="text-sm text-muted-foreground py-4 text-center">
                    Chưa có lịch sử thay đổi trạng thái
                  </div>
                ) : (
                  <ol className="space-y-3">
                    {logs.map((entry) => {
                      const old = entry.oldData as { status?: string } | null;
                      const nw = entry.newData as {
                        status?: string;
                        note?: string | null;
                      } | null;
                      const fromLabel = old?.status
                        ? SHIPPING_STATUS_LABEL[old.status as ShippingStatus] ??
                          old.status
                        : null;
                      const toLabel = nw?.status
                        ? SHIPPING_STATUS_LABEL[nw.status as ShippingStatus] ??
                          nw.status
                        : null;
                      return (
                        <li
                          key={entry.id}
                          className="flex gap-3 items-start border-l-2 border-primary/40 pl-3 py-1"
                        >
                          <div className="flex-1 text-sm">
                            <div className="font-medium text-foreground">
                              {fromLabel && toLabel
                                ? `${fromLabel} → ${toLabel}`
                                : entry.actionLabel}
                            </div>
                            <div className="text-xs text-muted-foreground">
                              {entry.userName} · {formatDate(entry.createdAt)}
                            </div>
                            {nw?.note && (
                              <div className="text-xs italic text-muted-foreground mt-0.5">
                                Ghi chú: {nw.note}
                              </div>
                            )}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                )}
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
  const [partnerOptions, setPartnerOptions] = useState<
    Array<{ value: string; label: string }>
  >([{ value: "all", label: "Tất cả" }]);

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

  // Load partner options (async) — đồng bộ với ĐTGH đang active trong DB
  useEffect(() => {
    getPartnerOptionsAsync()
      .then(setPartnerOptions)
      .catch(() => {
        /* keep fallback */
      });
  }, []);

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
        row.original.status === "delivered"
          ? formatDate(row.original.updatedAt ?? row.original.createdAt)
          : "—",
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
          <ShippingOrderDetail
            order={order}
            onClose={onClose}
            onStatusChanged={fetchData}
          />
        )}
        getRowId={(row) => row.id}
      />
    </ListPageLayout>
  );
}
