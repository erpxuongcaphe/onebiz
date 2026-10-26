"use client";

/**
 * Đối tác giao hàng — quản lý đơn vị vận chuyển bên ngoài (Grab, Ahamove,
 * shipper riêng…) và ĐỐI CHIẾU TIỀN với họ.
 *
 * 04/08/2026 — dựng lại. Bản trước bị commit cbfb870 thay bằng redirect, mà
 * file còn lại cũng redirect ngược nên hai bên đá vòng nhau ⇒ menu chết hẳn
 * ⇒ không ai tạo được đối tác ⇒ mọi vận đơn không gán được ai giao ⇒ 24 vận
 * đơn nằm mãi ở "Chờ lấy hàng".
 *
 * Bản cũ cũng không dùng được vì "Tổng đơn hàng", "Nợ cần trả", "Tổng phí"
 * đều hardcode 0 và bộ lọc là UI giả (nhóm ĐTGH express/economy/local không
 * có cột trong DB). Bản này bỏ lọc giả, lấy SỐ THẬT gộp từ vận đơn:
 *
 *   · Đang giao      — đối tác đang cầm bao nhiêu đơn của mình
 *   · COD đang giữ   — TIỀN của mình đối tác đang cầm (quan trọng nhất)
 *   · Phí giao đã thu — phí thu của khách trên các đơn đối tác đã giao
 *   · Hoàn/Huỷ       — chất lượng giao
 *
 * Shipment fees are customer charges, not carrier expenses or cash receipts.
 * Settlement state and missing-source states must remain explicit.
 */

import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { ColumnDef, type SortingState } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { ListMetric } from "@/components/shared/list-metric";
import { FilterChips } from "@/components/shared/filter-chips";
import {
  FilterGroup,
  FilterPanel,
  RadioFilter,
} from "@/components/shared/filter-sidebar";
import { formatCurrency, formatNumber } from "@/lib/format";
import { exportToCsv } from "@/lib/utils/export";
import {
  getDeliveryPartnersWithStats,
  deactivateDeliveryPartner,
  type DeliveryPartnerWithStats,
  type DeliveryPartnerStats,
} from "@/lib/services/supabase/shipping";
import {
  CreateDeliveryPartnerDialog,
  ConfirmDialog,
  SettleCodDialog,
} from "@/components/shared/dialogs";
import { useBranchFilter, useToast } from "@/lib/contexts";
import { useAuth } from "@/lib/contexts/auth-context";
import { Icon } from "@/components/ui/icon";
import type { DeliveryPartner } from "@/lib/types";

const EMPTY_STATS: DeliveryPartnerStats = {
  activeOrders: 0,
  deliveredOrders: 0,
  failedOrders: 0,
  codHolding: 0,
  feeCollected: 0,
};
const EMPTY_PARTNERS: DeliveryPartnerWithStats[] = [];

type PartnerStatusFilter = "all" | "active" | "inactive";
type PartnerActivityFilter = "all" | "active_orders" | "holding_cod" | "delivered" | "failed";

const STATUS_OPTIONS = [
  { label: "Tất cả", value: "all" },
  { label: "Đang hoạt động", value: "active" },
  { label: "Ngừng hoạt động", value: "inactive" },
];

const ACTIVITY_OPTIONS = [
  { label: "Tất cả", value: "all" },
  { label: "Có đơn đang giao", value: "active_orders" },
  { label: "Đang giữ COD", value: "holding_cod" },
  { label: "Đã giao thành công", value: "delivered" },
  { label: "Có đơn hoàn / hủy", value: "failed" },
];

export default function DoiTacGiaoHangPage() {
  const { toast } = useToast();
  const { activeBranchId, branchLabel, isReady } = useBranchFilter();
  const { user, tenant, hasPermission } = useAuth();
  const canSettle = hasPermission("finance.create_transaction");

  const [loadedPartners, setPartners] = useState<DeliveryPartnerWithStats[]>([]);
  const [loadedUnassigned, setUnassigned] = useState<DeliveryPartnerStats>(EMPTY_STATS);
  const [settlementTracking, setSettlementTracking] = useState(true);
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<PartnerStatusFilter>("all");
  const [activityFilter, setActivityFilter] = useState<PartnerActivityFilter>("all");
  const [sorting, setSorting] = useState<SortingState>([{ id: "name", desc: false }]);
  const [pageIndex, setPageIndex] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const scopeKey = JSON.stringify([tenant?.id, user?.id, activeBranchId, isReady]);
  const scopeRef = useRef(scopeKey);
  scopeRef.current = scopeKey;
  const requestRef = useRef(0);
  const busy = loading || loadedScope !== scopeKey || !isReady;
  const partners = busy || loadError ? EMPTY_PARTNERS : loadedPartners;
  const unassigned = busy || loadError ? EMPTY_STATS : loadedUnassigned;

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<DeliveryPartner | null>(null);
  const [deactivating, setDeactivating] = useState<DeliveryPartnerWithStats | null>(null);
  const [settling, setSettling] = useState<DeliveryPartnerWithStats | null>(null);

  const fetchData = useCallback(async () => {
    if (!isReady) return;
    const request = ++requestRef.current;
    const current = () => request === requestRef.current && scopeRef.current === scopeKey;
    setLoading(true);
    setLoadError(null);
    setSettling(null);
    setEditing(null);
    setDeactivating(null);
    try {
      const result = await getDeliveryPartnersWithStats({
        page: 0,
        pageSize: 100,
        fetchAll: true,
      }, { branchId: activeBranchId });
      if (!current()) return;
      setPartners(result.data);
      setUnassigned(result.unassigned);
      setSettlementTracking(result.settlementTracking);
      setLoadedScope(scopeKey);
    } catch (err) {
      if (!current()) return;
      const message =
        err instanceof Error ? err.message : "Không tải được danh sách đối tác giao hàng";
      setLoadError(message);
      setPartners([]);
      setUnassigned(EMPTY_STATS);
      setLoadedScope(scopeKey);
      toast({ title: "Lỗi tải dữ liệu", description: message, variant: "error" });
    } finally {
      if (current()) setLoading(false);
    }
  }, [activeBranchId, isReady, scopeKey, toast]);

  useEffect(() => {
    fetchData();
    return () => { requestRef.current += 1; };
  }, [fetchData]);
  const unassignedTotal = unassigned.activeOrders + unassigned.deliveredOrders;

  const filteredPartners = useMemo(() => partners.filter((partner) => {
    if (search.trim() && !partner.name.toLocaleLowerCase("vi").includes(search.trim().toLocaleLowerCase("vi"))) return false;
    if (statusFilter !== "all" && partner.status !== statusFilter) return false;
    if (activityFilter === "active_orders") return partner.stats.activeOrders > 0;
    if (activityFilter === "holding_cod") return partner.stats.codHolding > 0;
    if (activityFilter === "delivered") return partner.stats.deliveredOrders > 0;
    if (activityFilter === "failed") return partner.stats.failedOrders > 0;
    return true;
  }).sort((a, b) => {
    for (const sort of sorting) {
      const value = (partner: DeliveryPartnerWithStats): string | number => {
        switch (sort.id) {
          case "activeOrders": return partner.stats.activeOrders;
          case "deliveredOrders": return partner.stats.deliveredOrders;
          case "failedOrders": return partner.stats.failedOrders;
          case "codHolding": return partner.stats.codHolding;
          case "feeCollected": return partner.stats.feeCollected;
          case "code": return partner.code ?? "";
          case "status": return partner.statusName;
          default: return partner.name;
        }
      };
      const left = value(a), right = value(b);
      const comparison = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), "vi", { numeric: true });
      if (comparison) return sort.desc ? -comparison : comparison;
    }
    return a.id.localeCompare(b.id);
  }), [activityFilter, partners, statusFilter, sorting, search]);
  const includeUnassigned = !search.trim() && statusFilter === "all" && activityFilter === "all";
  const totalActive = filteredPartners.reduce((sum, p) => sum + p.stats.activeOrders, includeUnassigned ? unassigned.activeOrders : 0);
  const totalCod = filteredPartners.reduce((sum, p) => sum + p.stats.codHolding, includeUnassigned ? unassigned.codHolding : 0);
  const totalFee = filteredPartners.reduce((sum, p) => sum + p.stats.feeCollected, includeUnassigned ? unassigned.feeCollected : 0);
  const pageCount = Math.max(1, Math.ceil(filteredPartners.length / pageSize));
  const currentPage = Math.min(pageIndex, pageCount - 1);

  const activeFilters = useMemo(() => {
    const filters = [];
    if (statusFilter !== "all") {
      filters.push({
        key: "status",
        label: "Trạng thái",
        value: STATUS_OPTIONS.find((option) => option.value === statusFilter)?.label ?? statusFilter,
        onClear: () => setStatusFilter("all"),
      });
    }
    if (activityFilter !== "all") {
      filters.push({
        key: "activity",
        label: "Hoạt động",
        value: ACTIVITY_OPTIONS.find((option) => option.value === activityFilter)?.label ?? activityFilter,
        onClear: () => setActivityFilter("all"),
      });
    }
    return filters;
  }, [activityFilter, statusFilter]);

  const clearFilters = useCallback(() => {
    setStatusFilter("all");
    setActivityFilter("all");
    setPageIndex(0);
  }, []);

  const columns: ColumnDef<DeliveryPartnerWithStats, unknown>[] = [
    {
      accessorKey: "code",
      header: "Mã",
      size: 110,
      cell: ({ row }) => (
        <span className="font-mono text-xs text-muted-foreground">
          {row.original.code || "—"}
        </span>
      ),
    },
    {
      accessorKey: "name",
      header: "Đối tác",
      size: 220,
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{row.original.name}</div>
          {row.original.phone && (
            <div className="text-xs text-muted-foreground">{row.original.phone}</div>
          )}
        </div>
      ),
    },
    {
      id: "activeOrders",
      accessorFn: (row) => row.stats.activeOrders,
      header: "Đang giao",
      size: 110,
      cell: ({ row }) => {
        const n = row.original.stats.activeOrders;
        return n > 0 ? (
          <span className="font-semibold">{formatNumber(n)} đơn</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        );
      },
    },
    {
      id: "deliveredOrders",
      accessorFn: (row) => row.stats.deliveredOrders,
      header: "Đã giao",
      size: 100,
      cell: ({ row }) => formatNumber(row.original.stats.deliveredOrders),
    },
    {
      id: "failedOrders",
      accessorFn: (row) => row.stats.failedOrders,
      header: "Hoàn / Huỷ",
      size: 110,
      cell: ({ row }) => {
        const n = row.original.stats.failedOrders;
        return n > 0 ? (
          <span className="text-status-warning">{formatNumber(n)}</span>
        ) : (
          <span className="text-muted-foreground">0</span>
        );
      },
    },
    {
      id: "codHolding",
      accessorFn: (row) => row.stats.codHolding,
      header: "COD đối tác đang giữ",
      size: 180,
      cell: ({ row }) => {
        if (!settlementTracking) return "Chưa đủ nguồn";
        const v = row.original.stats.codHolding;
        return v > 0 ? (
          <span className="font-semibold text-destructive">{formatCurrency(v)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        );
      },
    },
    {
      id: "feeCollected",
      accessorFn: (row) => row.stats.feeCollected,
      header: "Phí giao chờ đối soát",
      size: 160,
      cell: ({ row }) => {
        if (!settlementTracking) return "Chưa đủ nguồn";
        const v = row.original.stats.feeCollected;
        return v > 0 ? (
          <span className="text-status-warning">{formatCurrency(v)}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        );
      },
    },
    {
      accessorKey: "status",
      header: "Trạng thái",
      size: 140,
      cell: ({ row }) => (
        <Badge variant={row.original.status === "active" ? "default" : "secondary"}>
          {row.original.statusName}
        </Badge>
      ),
    },
    {
      id: "partner_actions",
      header: "Thao tác",
      size: 180,
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex items-center gap-1.5">
          {/* Đối tác đang giữ COD → nút đối soát ngay tại chỗ nhìn thấy tiền */}
          {canSettle && settlementTracking && row.original.stats.codHolding > 0 && (
            <Button
              size="sm"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => setSettling(row.original)}
            >
              <Icon name="account_balance_wallet" size={14} />
              Đối soát
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => setEditing(row.original)}
          >
            <Icon name="edit" size={14} />
            Sửa
          </Button>
          {row.original.status === "active" && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => setDeactivating(row.original)}
            >
              <Icon name="block" size={14} />
              Ngừng
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <ListPageLayout sidebar={null}>
      <PageHeader
        title="Đối tác giao hàng"
        density="compact"
        searchPlaceholder="Theo tên đối tác..."
        searchValue={search}
        onSearchChange={(value) => { setSearch(value); setPageIndex(0); }}
        actions={[
          {
            label: "Thêm đối tác",
            icon: <Icon name="add" size={16} />,
            onClick: () => setCreateOpen(true),
          },
        ]}
        onExport={busy || loadError ? undefined : {
          csv: () => {
            if (scopeRef.current !== scopeKey || busy || loadError) return;
            exportToCsv(
              [...filteredPartners.map((p) => ({
                code: p.code,
                name: p.name,
                phone: p.phone,
                activeOrders: p.stats.activeOrders,
                deliveredOrders: p.stats.deliveredOrders,
                failedOrders: p.stats.failedOrders,
                codHolding: settlementTracking ? p.stats.codHolding : "",
                feeCollected: settlementTracking ? p.stats.feeCollected : "",
                statusName: p.statusName,
                branch: branchLabel,
              })), ...(includeUnassigned && unassignedTotal + unassigned.failedOrders > 0 ? [{
                code: "", name: "Chưa gán đối tác", phone: "", activeOrders: unassigned.activeOrders,
                deliveredOrders: unassigned.deliveredOrders, failedOrders: unassigned.failedOrders,
                codHolding: settlementTracking ? unassigned.codHolding : "",
                feeCollected: settlementTracking ? unassigned.feeCollected : "", statusName: "Chưa gán", branch: branchLabel,
              }] : [])],
              [
                { header: "Mã", key: "code", width: 12 },
                { header: "Tên đối tác", key: "name", width: 25 },
                { header: "Điện thoại", key: "phone", width: 15 },
                { header: "Đang giao", key: "activeOrders", width: 12 },
                { header: "Đã giao", key: "deliveredOrders", width: 12 },
                { header: "Hoàn/Huỷ", key: "failedOrders", width: 12 },
                { header: "COD đang giữ", key: "codHolding", width: 18 },
                { header: "Phí giao chờ đối soát", key: "feeCollected", width: 18 },
                { header: "Trạng thái", key: "statusName", width: 18 },
                { header: "Phạm vi chi nhánh", key: "branch", width: 25 },
              ],
              "doi-tac-giao-hang",
            );
          },
        }}
      />

      <div
        className="grid grid-cols-2 gap-1 border-b bg-background px-3 py-1 md:flex md:min-h-11 md:items-center md:overflow-x-auto"
        role="region"
        aria-label="Chỉ số và công cụ đối tác giao hàng"
      >
        <ListMetric
          label="Đối tác"
          value={loadError ? "Không tải được" : formatNumber(filteredPartners.length)}
          hint={`${filteredPartners.length} đang hiển thị`}
          icon={<Icon name="local_shipping" size={16} />}
          loading={busy}
        />
        <ListMetric
          label="Đơn đang giao"
          value={loadError ? "Không tải được" : formatNumber(totalActive)}
          hint={includeUnassigned ? "gồm chưa gán đối tác" : "theo bộ lọc"}
          icon={<Icon name="pending" size={16} />}
          loading={busy}
        />
        <ListMetric
          label="COD đang giữ"
          value={loadError ? "Không tải được" : settlementTracking ? formatCurrency(totalCod) : "Chưa đủ nguồn"}
          hint="chưa đối soát"
          icon={<Icon name="payments" size={16} />}
          loading={busy}
          tone={totalCod > 0 ? "danger" : "default"}
        />
        <ListMetric
          label="Phí giao chờ đối soát"
          value={loadError ? "Không tải được" : settlementTracking ? formatCurrency(totalFee) : "Chưa đủ nguồn"}
          icon={<Icon name="account_balance_wallet" size={16} />}
          loading={busy}
        />
        <div className="col-span-2 flex shrink-0 items-center justify-end gap-1.5 md:ml-auto">
          <span
            className="hidden max-w-48 truncate text-xs text-muted-foreground lg:inline"
            title={`Phạm vi vận đơn: ${branchLabel}`}
          >
            <Icon name="location_on" size={14} className="mr-1 inline" />
            Phạm vi vận đơn: {branchLabel}
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={() => setFilterOpen(true)}
            aria-label={`Mở bộ lọc, ${activeFilters.length} điều kiện`}
          >
            <Icon name="filter_alt" size={15} />
            Bộ lọc
            {activeFilters.length > 0 && (
              <span className="rounded-full bg-primary px-1.5 text-xs font-bold text-primary-foreground">
                {activeFilters.length}
              </span>
            )}
          </Button>
        </div>
      </div>

      <FilterChips
        filters={activeFilters}
        onClearAll={activeFilters.length > 1 ? clearFilters : undefined}
      />

      {loadError && loadedScope === scopeKey && (
        <div role="alert" className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
          <span className="text-sm text-destructive">{loadError}</span>
          <Button size="sm" variant="outline" onClick={fetchData}>
            <Icon name="refresh" size={15} />
            Thử lại
          </Button>
        </div>
      )}

      {/* Vận đơn chưa gán đối tác — không biết ai đang giao, không đối soát được tiền */}
      {!busy && !loadError && unassignedTotal > 0 && (
        <div className="mx-4 mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-status-warning/40 bg-status-warning/5 px-3 py-2">
          <Icon name="warning" size={16} className="shrink-0 text-status-warning" />
          <span className="text-sm">
            <strong>{formatNumber(unassignedTotal)} vận đơn</strong> chưa gán đối tác giao
            hàng — không biết ai đang giao và không đối chiếu được tiền thu hộ.
          </span>
          <a
            href={`/don-hang/van-don${activeBranchId ? `?branch=${encodeURIComponent(activeBranchId)}` : "?branch=all"}`}
            className="text-sm font-medium text-primary underline-offset-2 hover:underline"
          >
            Xem vận đơn
          </a>
        </div>
      )}

      <div className="flex-1 min-h-0 px-3 pb-3 pt-2">
        <DataTable
          columns={columns}
          data={filteredPartners.slice(currentPage * pageSize, (currentPage + 1) * pageSize)}
          loading={busy}
          total={filteredPartners.length}
          pageIndex={currentPage}
          pageSize={pageSize}
          pageCount={pageCount}
          onPageChange={setPageIndex}
          onPageSizeChange={(size) => { setPageSize(size); setPageIndex(0); }}
          sorting={sorting}
          onSortingChange={(updater) => { setSorting(updater); setPageIndex(0); }}
          emptyIcon="local_shipping"
          emptyTitle={loadError ? "Không tải được đối tác" : search || activeFilters.length ? "Không tìm thấy đối tác" : "Chưa có đối tác giao hàng"}
          emptyDescription={
            loadError ? "Vui lòng thử tải lại." : search || activeFilters.length ? "Không có đối tác khớp bộ lọc." : 'Bấm "Thêm đối tác" để khai báo đơn vị vận chuyển (Grab, Ahamove, shipper riêng…). ' +
            "Có đối tác thì mới gán được vận đơn và đối chiếu tiền thu hộ."
          }
        />
      </div>

      <FilterPanel
        open={filterOpen}
        onOpenChange={setFilterOpen}
        activeCount={activeFilters.length}
        onClearAll={clearFilters}
        title="Bộ lọc đối tác giao hàng"
      >
        <FilterGroup
          label="Trạng thái đối tác"
          activeHint={statusFilter === "all" ? undefined : STATUS_OPTIONS.find((option) => option.value === statusFilter)?.label}
        >
          <RadioFilter
            name="delivery-partner-status"
            options={STATUS_OPTIONS}
            value={statusFilter}
            onChange={(value) => { setStatusFilter(value as PartnerStatusFilter); setPageIndex(0); }}
          />
        </FilterGroup>
        <FilterGroup
          label="Tình hình vận chuyển"
          activeHint={activityFilter === "all" ? undefined : ACTIVITY_OPTIONS.find((option) => option.value === activityFilter)?.label}
        >
          <RadioFilter
            name="delivery-partner-activity"
            options={ACTIVITY_OPTIONS}
            value={activityFilter}
            onChange={(value) => { setActivityFilter(value as PartnerActivityFilter); setPageIndex(0); }}
          />
        </FilterGroup>
      </FilterPanel>

      <CreateDeliveryPartnerDialog
        open={createOpen || !!editing}
        onOpenChange={(open) => {
          if (!open) {
            setCreateOpen(false);
            setEditing(null);
          }
        }}
        initialData={editing ?? undefined}
        onSuccess={() => {
          setCreateOpen(false);
          setEditing(null);
          fetchData();
        }}
      />

      {!busy && !loadError && canSettle && settling && (
        <SettleCodDialog
          open
          onOpenChange={(open) => !open && setSettling(null)}
          partnerId={settling.id}
          partnerName={settling.name}
          branchId={activeBranchId}
          onSuccess={() => {
            setSettling(null);
            fetchData();
          }}
        />
      )}

      {!busy && !loadError && deactivating && (
        <ConfirmDialog
          open
          onOpenChange={(open) => !open && setDeactivating(null)}
          title="Ngừng hoạt động đối tác?"
          description={
            deactivating.stats.activeOrders > 0
              ? `${deactivating.name} đang giao ${formatNumber(deactivating.stats.activeOrders)} đơn. ` +
                "Ngừng hoạt động chỉ ẩn khỏi danh sách chọn khi tạo vận đơn mới — các đơn đang giao vẫn giữ nguyên."
              : `${deactivating.name} sẽ không còn xuất hiện khi tạo vận đơn mới. Dữ liệu cũ giữ nguyên.`
          }
          confirmLabel="Ngừng hoạt động"
          onConfirm={async () => {
            try {
              await deactivateDeliveryPartner(deactivating.id);
              toast({ title: "Đã ngừng hoạt động đối tác", variant: "success" });
              setDeactivating(null);
              fetchData();
            } catch (err) {
              toast({
                title: "Không ngừng được đối tác",
                description: err instanceof Error ? err.message : "Lỗi không xác định",
                variant: "error",
              });
            }
          }}
        />
      )}
    </ListPageLayout>
  );
}
