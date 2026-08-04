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

import { useEffect, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { SummaryCard } from "@/components/shared/summary-card";
import { formatCurrency, formatNumber } from "@/lib/format";
import { exportToCsv } from "@/lib/utils/export";
import {
  getDeliveryPartnersWithStats,
  deactivateDeliveryPartner,
  type DeliveryPartnerWithStats,
  type DeliveryPartnerStats,
} from "@/lib/services/supabase/shipping";
import { CreateDeliveryPartnerDialog, ConfirmDialog } from "@/components/shared/dialogs";
import { useToast } from "@/lib/contexts";
import { Icon } from "@/components/ui/icon";
import type { DeliveryPartner } from "@/lib/types";

const EMPTY_STATS: DeliveryPartnerStats = {
  activeOrders: 0,
  deliveredOrders: 0,
  failedOrders: 0,
  codHolding: 0,
  feeCollected: 0,
};

export default function DoiTacGiaoHangPage() {
  const { toast } = useToast();

  const [partners, setPartners] = useState<DeliveryPartnerWithStats[]>([]);
  const [unassigned, setUnassigned] = useState<DeliveryPartnerStats>(EMPTY_STATS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<DeliveryPartner | null>(null);
  const [deactivating, setDeactivating] = useState<DeliveryPartnerWithStats | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const result = await getDeliveryPartnersWithStats({
        page: 0,
        pageSize: 100,
        search,
      });
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
  }, [search, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const totalActive = partners.reduce((sum, p) => sum + p.stats.activeOrders, 0);
  const totalCod = partners.reduce((sum, p) => sum + p.stats.codHolding, 0);
  const totalFee = partners.reduce((sum, p) => sum + p.stats.feeCollected, 0);
  const unassignedTotal = unassigned.activeOrders + unassigned.deliveredOrders;

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
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <PageHeader
        title="Đối tác giao hàng"
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
              partners.map((p) => ({
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

      <div className="grid grid-cols-1 gap-3 px-4 pt-4 md:grid-cols-4">
        <SummaryCard
          label="Đối tác"
          value={formatNumber(partners.length)}
          icon="local_shipping"
          loading={loading}
        />
        <SummaryCard
          label="Đơn đang giao"
          value={formatNumber(totalActive)}
          icon="pending"
          loading={loading}
        />
        <SummaryCard
          label="COD đối tác đang giữ"
          value={formatCurrency(totalCod)}
          icon="payments"
          tone={totalCod > 0 ? "error" : "default"}
          hint="tiền của mình đối tác đang cầm"
          loading={loading}
        />
        <SummaryCard
          label="Phí giao đã thu"
          value={formatCurrency(totalFee)}
          icon="account_balance_wallet"
          hint="trên các đơn đã giao"
          loading={loading}
        />
      </div>

      <div className="flex-1 min-h-0 px-4 pb-4 pt-3">
        <DataTable
          columns={columns}
          data={partners}
          loading={loading}
          total={partners.length}
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
    </div>
  );
}
