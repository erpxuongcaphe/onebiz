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
 * ⚠️ CHƯA có "công nợ phải trả đối tác": bảng chỉ có MỘT cột `shipping_fee`
 * (phí THU CỦA KHÁCH), chưa tách phí TRẢ ĐỐI TÁC, và chưa có cột đánh dấu đã
 * đối soát. Nên trang này chỉ nêu đúng phần đo được, không suy diễn thành nợ.
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
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
import { Icon } from "@/components/ui/icon";
import type { DeliveryPartner } from "@/lib/types";

const EMPTY_STATS: DeliveryPartnerStats = {
  activeOrders: 0,
  deliveredOrders: 0,
  failedOrders: 0,
  codHolding: 0,
  feeCollected: 0,
};

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

  const [partners, setPartners] = useState<DeliveryPartnerWithStats[]>([]);
  const [unassigned, setUnassigned] = useState<DeliveryPartnerStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<PartnerStatusFilter>("all");
  const [activityFilter, setActivityFilter] = useState<PartnerActivityFilter>("all");

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<DeliveryPartner | null>(null);
  const [deactivating, setDeactivating] = useState<DeliveryPartnerWithStats | null>(null);
  const [settling, setSettling] = useState<DeliveryPartnerWithStats | null>(null);

  const fetchData = useCallback(async () => {
    if (!isReady) return;
    setLoading(true);
    setLoadError(null);
    try {
      const result = await getDeliveryPartnersWithStats({
        page: 0,
        pageSize: 100,
        search,
      }, { branchId: activeBranchId });
      setPartners(result.data);
      setUnassigned(result.unassigned);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Không tải được danh sách đối tác giao hàng";
      setLoadError(message);
      toast({ title: "Lỗi tải dữ liệu", description: message, variant: "error" });
    } finally {
      setLoading(false);
    }
  }, [activeBranchId, isReady, search, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const totalActive = partners.reduce((sum, p) => sum + p.stats.activeOrders, 0);
  const totalCod = partners.reduce((sum, p) => sum + p.stats.codHolding, 0);
  const totalFee = partners.reduce((sum, p) => sum + p.stats.feeCollected, 0);
  const unassignedTotal = unassigned.activeOrders + unassigned.deliveredOrders;

  const filteredPartners = useMemo(() => partners.filter((partner) => {
    if (statusFilter !== "all" && partner.status !== statusFilter) return false;
    if (activityFilter === "active_orders") return partner.stats.activeOrders > 0;
    if (activityFilter === "holding_cod") return partner.stats.codHolding > 0;
    if (activityFilter === "delivered") return partner.stats.deliveredOrders > 0;
    if (activityFilter === "failed") return partner.stats.failedOrders > 0;
    return true;
  }), [activityFilter, partners, statusFilter]);

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
      header: "Đã giao",
      size: 100,
      cell: ({ row }) => formatNumber(row.original.stats.deliveredOrders),
    },
    {
      id: "failedOrders",
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
      header: "COD đối tác đang giữ",
      size: 180,
      cell: ({ row }) => {
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
      header: "Phí giao đã thu",
      size: 160,
      cell: ({ row }) => {
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
          {row.original.stats.codHolding > 0 && (
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
        onSearchChange={setSearch}
        actions={[
          {
            label: "Thêm đối tác",
            icon: <Icon name="add" size={16} />,
            onClick: () => setCreateOpen(true),
          },
        ]}
        onExport={{
          csv: () => {
            exportToCsv(
              filteredPartners.map((p) => ({
                code: p.code,
                name: p.name,
                phone: p.phone,
                activeOrders: p.stats.activeOrders,
                deliveredOrders: p.stats.deliveredOrders,
                failedOrders: p.stats.failedOrders,
                codHolding: p.stats.codHolding,
                feeCollected: p.stats.feeCollected,
                statusName: p.statusName,
              })),
              [
                { header: "Mã", key: "code", width: 12 },
                { header: "Tên đối tác", key: "name", width: 25 },
                { header: "Điện thoại", key: "phone", width: 15 },
                { header: "Đang giao", key: "activeOrders", width: 12 },
                { header: "Đã giao", key: "deliveredOrders", width: 12 },
                { header: "Hoàn/Huỷ", key: "failedOrders", width: 12 },
                { header: "COD đang giữ", key: "codHolding", width: 18 },
                { header: "Phí giao đã thu", key: "feeCollected", width: 18 },
                { header: "Trạng thái", key: "statusName", width: 18 },
              ],
              "doi-tac-giao-hang",
            );
          },
        }}
      />

      <div
        className="flex min-h-11 items-center gap-1 overflow-x-auto border-b bg-background px-3 py-1 no-scrollbar"
        role="region"
        aria-label="Chỉ số và công cụ đối tác giao hàng"
      >
        <ListMetric
          label="Đối tác"
          value={formatNumber(partners.length)}
          hint={`${filteredPartners.length} đang hiển thị`}
          icon={<Icon name="local_shipping" size={16} />}
          loading={loading}
        />
        <ListMetric
          label="Đơn đang giao"
          value={formatNumber(totalActive)}
          icon={<Icon name="pending" size={16} />}
          loading={loading}
        />
        <ListMetric
          label="COD đang giữ"
          value={formatCurrency(totalCod)}
          hint="chưa đối soát"
          icon={<Icon name="payments" size={16} />}
          loading={loading}
          tone={totalCod > 0 ? "danger" : "default"}
        />
        <ListMetric
          label="Phí giao đã thu"
          value={formatCurrency(totalFee)}
          icon={<Icon name="account_balance_wallet" size={16} />}
          loading={loading}
        />
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
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
              <span className="rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
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

      {loadError && (
        <div className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
          <span className="text-sm text-destructive">{loadError}</span>
          <Button size="sm" variant="outline" onClick={fetchData}>
            <Icon name="refresh" size={15} />
            Thử lại
          </Button>
        </div>
      )}

      {/* Vận đơn chưa gán đối tác — không biết ai đang giao, không đối soát được tiền */}
      {!loading && unassignedTotal > 0 && (
        <div className="mx-4 mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-status-warning/40 bg-status-warning/5 px-3 py-2">
          <Icon name="warning" size={16} className="shrink-0 text-status-warning" />
          <span className="text-sm">
            <strong>{formatNumber(unassignedTotal)} vận đơn</strong> chưa gán đối tác giao
            hàng — không biết ai đang giao và không đối chiếu được tiền thu hộ.
          </span>
          <a
            href="/don-hang/van-don"
            className="text-sm font-medium text-primary underline-offset-2 hover:underline"
          >
            Xem vận đơn
          </a>
        </div>
      )}

      <div className="flex-1 min-h-0 px-3 pb-3 pt-2">
        <DataTable
          columns={columns}
          data={filteredPartners}
          loading={loading}
          total={filteredPartners.length}
          pageIndex={0}
          pageSize={100}
          pageCount={1}
          emptyIcon="local_shipping"
          emptyTitle="Chưa có đối tác giao hàng"
          emptyDescription={
            'Bấm "Thêm đối tác" để khai báo đơn vị vận chuyển (Grab, Ahamove, shipper riêng…). ' +
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
            onChange={(value) => setStatusFilter(value as PartnerStatusFilter)}
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
            onChange={(value) => setActivityFilter(value as PartnerActivityFilter)}
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

      {settling && (
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

      {deactivating && (
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
