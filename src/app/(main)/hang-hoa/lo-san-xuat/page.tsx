"use client";

/**
 * Lô sản xuất — Production Lots listing page
 * Shows all product lots from production or purchase with status, qty, expiry.
 */

import { useEffect, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable } from "@/components/shared/data-table";
import {
  FilterSidebar,
  FilterGroup,
  SelectFilter,
} from "@/components/shared/filter-sidebar";
import { Badge } from "@/components/ui/badge";
import { useToast, useBranchFilter } from "@/lib/contexts";
import { formatDate } from "@/lib/format";
import { getAllProductLots } from "@/lib/services";
import type { ProductLot } from "@/lib/types";
import { Icon } from "@/components/ui/icon";

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

const statusMap: Record<string, { label: string; variant: "default" | "secondary" | "destructive" }> = {
  active: { label: "Đang dùng", variant: "default" },
  depleted: { label: "Đã hết", variant: "secondary" },
  expired: { label: "Hết hạn", variant: "destructive" },
};

export default function LoSanXuatPage() {
  const { toast } = useToast();
  const { activeBranchId } = useBranchFilter();
  const [data, setData] = useState<LotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");

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
            <Icon name="factory" size={12} className="text-purple-500" />
          ) : (
            <Icon name="shopping_cart" size={12} className="text-green-500" />
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
      cell: ({ row }) => <span className="text-xs tabular-nums">{row.original.initialQty}</span>,
    },
    {
      accessorKey: "currentQty",
      header: "SL hiện tại",
      size: 140,
      cell: ({ row }) => {
        const pct = row.original.initialQty > 0 ? (row.original.currentQty / row.original.initialQty) * 100 : 0;
        return (
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold tabular-nums">{row.original.currentQty}</span>
            <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
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
              <Icon name="warning" className={`h-3 w-3 ${isExpired ? "text-red-500" : "text-amber-500"}`} />
            )}
            <span className={`text-xs ${isExpired ? "text-red-600 font-bold" : isNearExpiry ? "text-amber-600" : "text-muted-foreground"}`}>
              {formatDate(row.original.expiryDate)}
            </span>
          </div>
        );
      },
    },
    {
      accessorKey: "status",
      header: "Trạng thái",
      size: 100,
      cell: ({ row }) => {
        const s = statusMap[row.original.status ?? "active"] ?? statusMap.active;
        return (
          <Badge
            variant={s.variant}
            className={
              s.variant === "default" ? "bg-green-100 text-green-700 border-green-200"
              : s.variant === "destructive" ? "bg-red-100 text-red-700 border-red-200"
              : undefined
            }
          >
            {s.label}
          </Badge>
        );
      },
    },
  ];

  return (
    <ListPageLayout
      sidebar={
        <FilterSidebar>
          <FilterGroup label="Trạng thái">
            <SelectFilter options={statusOptions} value={statusFilter} onChange={setStatusFilter} />
          </FilterGroup>
          <FilterGroup label="Nguồn">
            <SelectFilter options={sourceOptions} value={sourceFilter} onChange={setSourceFilter} />
          </FilterGroup>
        </FilterSidebar>
      }
    >
      <PageHeader
        title="Lô sản xuất"
        searchPlaceholder="Tìm theo số lô, tên sản phẩm..."
        searchValue={search}
        onSearchChange={setSearch}
      />

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 px-4 pt-4">
        <div className="bg-white rounded-lg border p-3">
          <div className="text-2xl font-bold text-primary">{data.length}</div>
          <div className="text-xs text-muted-foreground">Tổng lô</div>
        </div>
        <div className="bg-white rounded-lg border p-3">
          <div className="text-2xl font-bold text-green-600">{activeLots}</div>
          <div className="text-xs text-muted-foreground">Đang hoạt động</div>
        </div>
        <div className="bg-white rounded-lg border p-3">
          <div className="text-2xl font-bold text-foreground">{totalQty.toLocaleString("vi-VN")}</div>
          <div className="text-xs text-muted-foreground">Tổng SL hiện tại</div>
        </div>
        {expiredCount > 0 && (
          <div className="bg-red-50 rounded-lg border border-red-200 p-3">
            <div className="text-2xl font-bold text-red-600">{expiredCount}</div>
            <div className="text-xs text-red-500">Đã hết hạn</div>
          </div>
        )}
        {nearExpiryCount > 0 && (
          <div className="bg-amber-50 rounded-lg border border-amber-200 p-3">
            <div className="text-2xl font-bold text-amber-600">{nearExpiryCount}</div>
            <div className="text-xs text-amber-500">Sắp hết hạn (30 ngày)</div>
          </div>
        )}
      </div>

      <DataTable columns={columns} data={data} loading={loading} />
    </ListPageLayout>
  );
}
