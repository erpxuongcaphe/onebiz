"use client";

/**
 * Lô sản xuất — Production Lots listing page
 * Shows all product lots from production or purchase with status, qty, expiry.
 */

import { useEffect, useState, useCallback } from "react";
import dynamic from "next/dynamic";
import { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable } from "@/components/shared/data-table";
import {
  FilterPanel,
  FilterGroup,
  SelectFilter,
} from "@/components/shared/filter-sidebar";
import { FilterChips, type ListFilterChip } from "@/components/shared/filter-chips";
import { ListMetric } from "@/components/shared/list-metric";
import { Button } from "@/components/ui/button";
import { useToast, useBranchFilter } from "@/lib/contexts";
import { formatDate, formatNumber } from "@/lib/format";
import { getAllProductLots } from "@/lib/services";
import type { ProductLot } from "@/lib/types";
import { Icon } from "@/components/ui/icon";
import { AuditLogDialog } from "@/components/shared/audit-log-dialog";
import { buildTransactionRowActions } from "@/components/shared/transaction-row-actions";
import { useTxRowPermissions } from "@/lib/permissions";

// PERF (CEO 23/05/2026): Lazy-load AssignExpiryDialog (818 dòng + 1 đống
// service deps). Chỉ load khi user click "Gắn HSD cho tồn cũ".
const AssignExpiryDialog = dynamic(
  () =>
    import(
      "@/components/shared/dialogs/assign-expiry-existing-stock-dialog"
    ).then((m) => m.AssignExpiryDialog),
  { ssr: false },
);

type LotRow = ProductLot & { productName: string; productCode: string };

const statusOptions = [
  { label: "Tất cả", value: "all" },
  { label: "Đang hoạt động", value: "active" },
  { label: "Đã hết", value: "depleted" },
  { label: "Hết hạn", value: "expired" },
];

const sourceOptions = [
  { label: "Tất cả", value: "all" },
  { label: "Sản xuất", value: "production" },
  { label: "Mua hàng", value: "purchase" },
];

const statusMap: Record<
  string,
  { label: string; tone: "success" | "neutral" | "error" }
> = {
  active: { label: "Đang dùng", tone: "success" },
  depleted: { label: "Đã hết", tone: "neutral" },
  expired: { label: "Hết hạn", tone: "error" },
};

const STATUS_TONE_CLASS: Record<"success" | "neutral" | "error", string> = {
  success: "bg-status-success/10 text-status-success",
  neutral: "bg-surface-container-high text-muted-foreground",
  error: "bg-status-error/10 text-status-error",
};

const STATUS_DOT_CLASS: Record<"success" | "neutral" | "error", string> = {
  success: "bg-status-success",
  neutral: "bg-muted-foreground",
  error: "bg-status-error",
};

export default function LoSanXuatPage() {
  const { toast } = useToast();
  const { activeBranchId } = useBranchFilter();
  const txPerms = useTxRowPermissions("production");
  const [data, setData] = useState<LotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [filterOpen, setFilterOpen] = useState(false);
  // Sprint UX-1 Stage 4: Audit log shortcut (master data lot)
  const [auditDialogTarget, setAuditDialogTarget] = useState<LotRow | null>(null);
  // Day 18/05/2026 (CEO): mockup dialog gắn HSD cho tồn cũ
  const [assignExpiryOpen, setAssignExpiryOpen] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      let lots = await getAllProductLots({
        search: search || undefined,
        status: statusFilter !== "all" ? statusFilter : undefined,
        sourceType: sourceFilter !== "all" ? sourceFilter : undefined,
      });
      // Client-side branch filter (getAllProductLots doesn't support branchId yet)
      if (activeBranchId) {
        lots = lots.filter((l) => l.branchId === activeBranchId);
      }
      setData(lots);
    } catch {
      toast({ variant: "error", title: "Lỗi tải danh sách lô" });
    } finally {
      setLoading(false);
    }
  }, [search, statusFilter, sourceFilter, activeBranchId, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const activeLots = data.filter((l) => l.status === "active").length;
  const totalQty = data.reduce((sum, l) => sum + (l.currentQty ?? 0), 0);

  // Expiry heatmap counts
  const now = Date.now();
  const expiredCount = data.filter(
    (l) => l.expiryDate && new Date(l.expiryDate).getTime() <= now && l.currentQty > 0,
  ).length;
  const nearExpiryCount = data.filter((l) => {
    if (!l.expiryDate || l.currentQty <= 0) return false;
    const days = (new Date(l.expiryDate).getTime() - now) / 86400000;
    return days > 0 && days <= 30;
  }).length;

  const filterChips: ListFilterChip[] = [];
  if (statusFilter !== "all") {
    filterChips.push({
      key: "status",
      label: "Trạng thái",
      value: statusOptions.find((option) => option.value === statusFilter)?.label ?? statusFilter,
      onClear: () => setStatusFilter("all"),
    });
  }
  if (sourceFilter !== "all") {
    filterChips.push({
      key: "source",
      label: "Nguồn",
      value: sourceOptions.find((option) => option.value === sourceFilter)?.label ?? sourceFilter,
      onClear: () => setSourceFilter("all"),
    });
  }

  const columns: ColumnDef<LotRow>[] = [
    {
      accessorKey: "lotNumber",
      header: "Số lô",
      size: 140,
      cell: ({ row }) => (
        <span className="font-mono text-xs font-semibold text-primary">
          {row.original.lotNumber}
        </span>
      ),
    },
    {
      accessorKey: "productName",
      header: "Sản phẩm",
      size: 240,
      cell: ({ row }) => (
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{row.original.productName}</p>
          <p className="text-[10px] text-muted-foreground font-mono">{row.original.productCode}</p>
        </div>
      ),
    },
    {
      id: "source",
      header: "Nguồn",
      size: 100,
      cell: ({ row }) => (
        <div className="flex items-center gap-1">
          {row.original.sourceType === "production" ? (
            <Icon name="factory" size={14} className="text-primary" />
          ) : (
            <Icon name="shopping_cart" size={14} className="text-status-success" />
          )}
          <span className="text-xs">
            {row.original.sourceType === "production" ? "Sản xuất" : "Mua hàng"}
          </span>
        </div>
      ),
    },
    {
      accessorKey: "branchName",
      header: "Chi nhánh",
      size: 120,
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">{row.original.branchName || "—"}</span>
      ),
    },
    {
      accessorKey: "initialQty",
      header: "SL ban đầu",
      size: 100,
      cell: ({ row }) => <span className="text-xs tabular-nums">{formatNumber(row.original.initialQty)}</span>,
    },
    {
      accessorKey: "currentQty",
      header: "SL hiện tại",
      size: 140,
      cell: ({ row }) => {
        const pct = row.original.initialQty > 0 ? (row.original.currentQty / row.original.initialQty) * 100 : 0;
        return (
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold tabular-nums">{formatNumber(row.original.currentQty)}</span>
            <div className="w-12 h-1.5 bg-surface-container-high rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full" style={{ width: `${Math.min(100, pct)}%` }} />
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "expiryDate",
      header: "Hạn sử dụng",
      size: 140,
      cell: ({ row }) => {
        if (!row.original.expiryDate) return <span className="text-xs text-muted-foreground">—</span>;
        const days = Math.ceil((new Date(row.original.expiryDate).getTime() - Date.now()) / 86400000);
        const isExpired = days < 0;
        const isNearExpiry = days >= 0 && days <= 30;
        return (
          <div className="flex items-center gap-1">
            {(isExpired || isNearExpiry) && (
              <Icon
                name="warning"
                size={14}
                className={isExpired ? "text-status-error" : "text-status-warning"}
              />
            )}
            <span
              className={`text-xs ${
                isExpired
                  ? "text-status-error font-bold"
                  : isNearExpiry
                    ? "text-status-warning"
                    : "text-muted-foreground"
              }`}
            >
              {formatDate(row.original.expiryDate)}
            </span>
          </div>
        );
      },
    },
    {
      accessorKey: "status",
      header: "Trạng thái",
      size: 110,
      cell: ({ row }) => {
        const s = statusMap[row.original.status ?? "active"] ?? statusMap.active;
        return (
          <span
            className={`inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full ${STATUS_TONE_CLASS[s.tone]}`}
          >
            <span className={`size-1.5 rounded-full ${STATUS_DOT_CLASS[s.tone]}`} />
            {s.label}
          </span>
        );
      },
    },
  ];

  return (
    <ListPageLayout sidebar={null}>
      <PageHeader
        title="Lô sản xuất"
        searchPlaceholder="Tìm theo số lô, tên sản phẩm..."
        searchValue={search}
        onSearchChange={setSearch}
        density="compact"
        actions={[
          {
            label: "Gắn HSD cho tồn cũ",
            icon: <Icon name="event" size={16} />,
            variant: "default",
            onClick: () => setAssignExpiryOpen(true),
          },
        ]}
      />

      <DataTable
        columns={columns}
        data={data}
        loading={loading}
        density="compact"
        columnToggle
        toolbarMetrics={
          <>
            <ListMetric label="Kết quả đang xem" value={formatNumber(data.length)} tone="primary" />
            <ListMetric label="Đang hoạt động" value={formatNumber(activeLots)} />
            <ListMetric label="Số lượng đang xem" value={formatNumber(totalQty)} />
            <ListMetric
              label={expiredCount > 0 ? "Đã hết hạn" : "Sắp hết hạn (30 ngày)"}
              value={formatNumber(expiredCount > 0 ? expiredCount : nearExpiryCount)}
              tone={expiredCount > 0 ? "danger" : "default"}
            />
          </>
        }
        toolbarActions={
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="relative h-8 gap-1.5 px-2 text-xs pointer-coarse:min-h-11"
            onClick={() => setFilterOpen(true)}
          >
            <Icon name="filter_alt" size={15} />
            <span className="hidden sm:inline">Bộ lọc</span>
            {filterChips.length > 0 && (
              <span className="min-w-4 rounded-full bg-primary px-1 text-xs font-bold text-primary-foreground">
                {filterChips.length}
              </span>
            )}
          </Button>
        }
        toolbarFooter={
          filterChips.length > 0 ? (
            <FilterChips
              filters={filterChips}
              onClearAll={() => {
                setStatusFilter("all");
                setSourceFilter("all");
              }}
            />
          ) : null
        }
        rowActions={(row) =>
          buildTransactionRowActions({
            row,
            // master data lot — gắn kind production (lots phát sinh từ SX/Mua)
            kind: "production",
            permissions: txPerms,
            onAuditLog: () => setAuditDialogTarget(row),
          })
        }
      />

      <FilterPanel
        open={filterOpen}
        onOpenChange={setFilterOpen}
        activeCount={filterChips.length}
        onClearAll={() => {
          setStatusFilter("all");
          setSourceFilter("all");
        }}
        title="Bộ lọc lô sản xuất"
      >
        <FilterGroup label="Trạng thái">
          <SelectFilter options={statusOptions} value={statusFilter} onChange={setStatusFilter} />
        </FilterGroup>
        <FilterGroup label="Nguồn">
          <SelectFilter options={sourceOptions} value={sourceFilter} onChange={setSourceFilter} />
        </FilterGroup>
      </FilterPanel>

      {auditDialogTarget && (
        <AuditLogDialog
          entityType="product_lot"
          entityId={auditDialogTarget.id}
          entityCode={auditDialogTarget.lotNumber}
          onClose={() => setAuditDialogTarget(null)}
        />
      )}

      {/* Day 18/05/2026 (CEO): Mockup dialog gắn HSD cho tồn cũ
          23/05/2026: onSaved={fetchData} để list lô refresh ngay sau khi
          dialog tạo lot thành công — không cần F5. */}
      <AssignExpiryDialog
        open={assignExpiryOpen}
        onOpenChange={setAssignExpiryOpen}
        onSaved={fetchData}
      />
    </ListPageLayout>
  );
}
