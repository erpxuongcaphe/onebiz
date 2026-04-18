"use client";

import { useState, useEffect, useCallback } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { KpiCard, ChartCard } from "@/app/(main)/phan-tich/_components";
import { useBranchFilter } from "@/lib/contexts";
import { formatCurrency, formatNumber } from "@/lib/format";
import {
  getProductionKpis,
  getNvlStock,
  getProductionTrend,
  getTopOutputProducts,
  getActiveProductionOrders,
} from "@/lib/services";
import type {
  ProductionKpis,
  NvlStockRow,
  ProductionTrend,
  TopOutputProduct,
  ActiveProductionOrder,
} from "@/lib/services";
import Link from "next/link";
import { Icon } from "@/components/ui/icon";

// ────────────────────────────────────────────
// Dynamic labels based on branch type
// ────────────────────────────────────────────

function useProductionLabels() {
  const { currentBranch } = useBranchFilter();
  const branchType = (currentBranch as any)?.branchType ?? "factory";

  if (branchType === "store") {
    return {
      title: "Chế biến",
      orderLabel: "Lệnh chế biến",
      ordersLabel: "lệnh chế biến",
      outputLabel: "Thành phẩm chế biến",
      nvlLabel: "Nguyên liệu",
      trendTitle: "Xu hướng chế biến",
    };
  }
  if (branchType === "warehouse") {
    return {
      title: "Sản xuất đơn giản",
      orderLabel: "Lệnh sản xuất",
      ordersLabel: "lệnh sản xuất",
      outputLabel: "Thành phẩm",
      nvlLabel: "Nguyên vật liệu",
      trendTitle: "Xu hướng sản xuất",
    };
  }
  // factory
  return {
    title: "Sản xuất",
    orderLabel: "Lệnh sản xuất",
    ordersLabel: "lệnh sản xuất",
    outputLabel: "Thành phẩm",
    nvlLabel: "Nguyên vật liệu",
    trendTitle: "Xu hướng sản xuất",
  };
}

// ────────────────────────────────────────────
// Active order row (widget item)
// ────────────────────────────────────────────

const PROD_STATUS_META: Record<
  string,
  { label: string; bg: string; text: string; dot: string }
> = {
  planned: {
    label: "Lên kế hoạch",
    bg: "bg-surface-container",
    text: "text-on-surface-variant",
    dot: "bg-on-surface-variant",
  },
  material_check: {
    label: "Kiểm NVL",
    bg: "bg-status-info/10",
    text: "text-status-info",
    dot: "bg-status-info",
  },
  in_production: {
    label: "Đang chạy",
    bg: "bg-primary-fixed",
    text: "text-primary",
    dot: "bg-primary",
  },
  quality_check: {
    label: "Kiểm chất lượng",
    bg: "bg-status-warning/10",
    text: "text-status-warning",
    dot: "bg-status-warning",
  },
};

function ActiveOrderRow({ order }: { order: ActiveProductionOrder }) {
  const meta = PROD_STATUS_META[order.status] ?? PROD_STATUS_META.planned;
  return (
    <Link
      href={`/hang-hoa/san-xuat?id=${order.id}`}
      className={`group block rounded-xl border p-3 bg-surface-container-lowest hover:bg-surface-container-low transition-colors press-scale-sm ${
        order.isOverdue ? "border-status-error/40" : "border-border"
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-semibold text-sm tabular-nums truncate">{order.code}</span>
          <span
            className={`inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full shrink-0 ${meta.bg} ${meta.text}`}
          >
            <span className={`size-1.5 rounded-full ${meta.dot}`} />
            {meta.label}
          </span>
        </div>
        {order.isOverdue && (
          <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-status-error/10 text-status-error shrink-0">
            <Icon name="schedule" size={10} />
            Quá hạn
          </span>
        )}
      </div>

      <div className="text-sm font-medium mb-0.5 truncate">{order.productName}</div>
      <div className="text-xs text-muted-foreground mb-2 truncate">
        {order.productCode} · {order.branchName}
      </div>

      <div className="space-y-1">
        <div className="relative h-1.5 rounded-full bg-surface-container overflow-hidden">
          <div
            className={`absolute inset-y-0 left-0 rounded-full transition-all ${
              order.isOverdue ? "bg-status-error" : "bg-primary"
            }`}
            style={{ width: `${Math.max(order.progressPct, 2)}%` }}
          />
        </div>
        <div className="flex items-center justify-between text-[11px] text-muted-foreground tabular-nums">
          <span>
            {formatNumber(order.completedQty)} / {formatNumber(order.plannedQty)} {order.unit}
          </span>
          <span className="font-semibold text-foreground">{order.progressPct}%</span>
        </div>
      </div>
    </Link>
  );
}

// ────────────────────────────────────────────
// Custom tooltip
// ────────────────────────────────────────────

function TrendTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border bg-surface-container-lowest p-3 ambient-shadow text-xs">
      <p className="font-semibold text-foreground mb-1">{label}</p>
      {payload.map((p: any, i: number) => (
        <p key={i} style={{ color: p.color }}>
          {p.name}: {formatNumber(p.value)}
        </p>
      ))}
    </div>
  );
}

// ────────────────────────────────────────────
// Page
// ────────────────────────────────────────────

export default function ProductionDashboardPage() {
  const { activeBranchId } = useBranchFilter();
  const labels = useProductionLabels();
  const [loading, setLoading] = useState(true);
  const [kpis, setKpis] = useState<ProductionKpis | null>(null);
  const [nvl, setNvl] = useState<NvlStockRow[]>([]);
  const [trend, setTrend] = useState<ProductionTrend[]>([]);
  const [topProducts, setTopProducts] = useState<TopOutputProduct[]>([]);
  const [activeOrders, setActiveOrders] = useState<ActiveProductionOrder[]>([]);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [k, n, t, p, a] = await Promise.all([
        getProductionKpis(activeBranchId),
        getNvlStock({ branchId: activeBranchId }),
        getProductionTrend(6, activeBranchId),
        getTopOutputProducts(8, activeBranchId),
        getActiveProductionOrders(activeBranchId, 8),
      ]);
      setKpis(k);
      setNvl(n);
      setTrend(t);
      setTopProducts(p);
      setActiveOrders(a);
    } catch (err) {
      console.error("Production dashboard error:", err);
    } finally {
      setLoading(false);
    }
  }, [activeBranchId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Icon name="progress_activity" size={32} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  const lowStockNvl = nvl.filter((r) => r.isLow || r.isOut);

  return (
    <div className="space-y-6">
      <PageHeader title={`Dashboard ${labels.title}`} />

      {/* KPI Row — Stitch: primary-fixed tint cho tile chính + semantic token cho status */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label={`${labels.orderLabel} tháng này`}
          value={String(kpis?.ordersThisMonth ?? 0)}
          change={`${kpis?.completedThisMonth ?? 0} hoàn thành`}
          positive
          icon="factory"
          bg="bg-primary-fixed"
          iconColor="text-primary"
          valueColor="text-primary"
        />
        <KpiCard
          label="Đang thực hiện"
          value={String(kpis?.activeOrders ?? 0)}
          change={`${labels.ordersLabel}`}
          positive
          icon="schedule"
          bg="bg-status-warning/10"
          iconColor="text-status-warning"
          valueColor="text-status-warning"
        />
        <KpiCard
          label="Tỷ lệ hoàn thành"
          value={`${kpis?.yieldRate ?? 0}%`}
          change={`SL: ${formatNumber(kpis?.totalOutputQty ?? 0)}`}
          positive={(kpis?.yieldRate ?? 0) >= 90}
          icon="trending_up"
          bg="bg-status-success/10"
          iconColor="text-status-success"
          valueColor="text-status-success"
        />
        <KpiCard
          label={`Giá trị ${labels.nvlLabel}`}
          value={formatCurrency(kpis?.nvlStockValue ?? 0)}
          change={
            (kpis?.nvlLowStockCount ?? 0) > 0
              ? `${kpis?.nvlLowStockCount} NVL dưới mức tối thiểu`
              : "Đủ tồn kho"
          }
          positive={(kpis?.nvlLowStockCount ?? 0) === 0}
          icon="inventory_2"
          bg="bg-status-info/10"
          iconColor="text-status-info"
          valueColor="text-status-info"
        />
      </div>

      {/* Lot alerts */}
      {((kpis?.expiredLots ?? 0) > 0 || (kpis?.expiringLots ?? 0) > 0) && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-status-warning/10 border border-status-warning/25 ambient-shadow">
          <span className="size-9 rounded-lg bg-status-warning/15 flex items-center justify-center shrink-0">
            <Icon name="warning" size={20} className="text-status-warning" />
          </span>
          <div className="text-sm flex-1 min-w-0">
            {(kpis?.expiredLots ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1 text-status-error font-semibold mr-3">
                <span className="size-1.5 rounded-full bg-status-error" />
                {kpis?.expiredLots} lô đã hết hạn
              </span>
            )}
            {(kpis?.expiringLots ?? 0) > 0 && (
              <span className="inline-flex items-center gap-1 text-status-warning font-medium">
                <span className="size-1.5 rounded-full bg-status-warning" />
                {kpis?.expiringLots} lô sắp hết hạn (30 ngày)
              </span>
            )}
          </div>
          <Link href="/hang-hoa/hsd" className="ml-auto shrink-0">
            <Button variant="outline" size="sm" className="rounded-full">
              Xem HSD <Icon name="arrow_forward" size={14} className="ml-1" />
            </Button>
          </Link>
        </div>
      )}

      {/* Charts row */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Trend chart */}
        <ChartCard title={labels.trendTitle} subtitle="6 tháng gần nhất">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" fontSize={12} />
              <YAxis fontSize={12} />
              <Tooltip content={<TrendTooltip />} />
              <Legend />
              {/* Stitch palette: primary tint (#9CB9FF) cho planned, primary (#004AC6) cho completed */}
              <Bar dataKey="planned" name="Kế hoạch" fill="#9CB9FF" radius={[6, 6, 0, 0]} />
              <Bar dataKey="completed" name="Hoàn thành" fill="#004AC6" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        {/* Top output products */}
        <ChartCard title={`Top ${labels.outputLabel}`} subtitle="Tháng này">
          {topProducts.length > 0 ? (
            <div className="space-y-2">
              {topProducts.map((p, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between py-2 px-1 border-b last:border-0"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-bold text-muted-foreground w-5">
                      #{i + 1}
                    </span>
                    <div>
                      <div className="text-sm font-medium">{p.productName}</div>
                      <div className="text-xs text-muted-foreground">{p.productCode}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold">{formatNumber(p.totalQty)}</div>
                    <div className="text-xs text-muted-foreground">{p.orderCount} lệnh</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center text-muted-foreground py-8">
              Chưa có thành phẩm tháng này
            </div>
          )}
        </ChartCard>
      </div>

      {/* Active production orders widget */}
      <ChartCard
        title={`${labels.orderLabel} đang chạy`}
        subtitle={
          activeOrders.length > 0
            ? `${activeOrders.length} lệnh · ${activeOrders.filter((o) => o.isOverdue).length} quá hạn`
            : "Không có lệnh nào đang chạy"
        }
        actions={
          <Link href="/hang-hoa/san-xuat">
            <Button variant="ghost" size="sm">
              Quản lý <Icon name="arrow_forward" size={14} className="ml-1" />
            </Button>
          </Link>
        }
      >
        {activeOrders.length > 0 ? (
          <div className="grid md:grid-cols-2 gap-3">
            {activeOrders.map((o) => (
              <ActiveOrderRow key={o.id} order={o} />
            ))}
          </div>
        ) : (
          <div className="text-center text-muted-foreground py-10 text-sm">
            <Icon
              name="check_circle"
              size={32}
              className="text-status-success/60 mx-auto mb-2"
            />
            Tất cả lệnh đã hoàn thành hoặc chưa có lệnh mới
          </div>
        )}
      </ChartCard>

      {/* NVL Stock Table */}
      <ChartCard
        title={`Tồn kho ${labels.nvlLabel}`}
        subtitle={`${nvl.length} nguyên liệu · ${lowStockNvl.length} cần nhập thêm`}
        actions={
          <Link href="/hang-hoa/ton-kho">
            <Button variant="ghost" size="sm">
              Xem tồn kho <Icon name="arrow_forward" size={14} className="ml-1" />
            </Button>
          </Link>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-container-low">
              <tr>
                <th className="text-left p-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Nguyên liệu</th>
                <th className="text-left p-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Chi nhánh</th>
                <th className="text-right p-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tồn kho</th>
                <th className="text-right p-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Tối thiểu</th>
                <th className="text-right p-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Giá trị</th>
                <th className="text-center p-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {(lowStockNvl.length > 0 ? lowStockNvl : nvl.slice(0, 15)).map((r, i) => (
                <tr key={i} className="border-t border-border hover:bg-surface-container-low">
                  <td className="p-2">
                    <div className="font-medium">{r.productName}</div>
                    <div className="text-xs text-muted-foreground">{r.productCode} · {r.unit}</div>
                  </td>
                  <td className="p-2 text-muted-foreground">{r.branchName}</td>
                  <td className="p-2 text-right font-medium">{formatNumber(r.quantity)}</td>
                  <td className="p-2 text-right text-muted-foreground">{formatNumber(r.minStock)}</td>
                  <td className="p-2 text-right">{formatCurrency(r.stockValue)}</td>
                  <td className="p-2 text-center">
                    {r.isOut ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-status-error/10 text-status-error">
                        <span className="size-1.5 rounded-full bg-status-error" />
                        Hết hàng
                      </span>
                    ) : r.isLow ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-status-warning/10 text-status-warning">
                        <span className="size-1.5 rounded-full bg-status-warning" />
                        Sắp hết
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full bg-status-success/10 text-status-success">
                        <span className="size-1.5 rounded-full bg-status-success" />
                        Đủ
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {nvl.length === 0 && (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-muted-foreground">
                    Không có nguyên liệu trong kho
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </ChartCard>

      {/* Quick links */}
      <div className="flex flex-wrap gap-3">
        <Link href="/hang-hoa/san-xuat">
          <Button variant="outline">
            <Icon name="factory" size={16} className="mr-2" /> {labels.orderLabel}
          </Button>
        </Link>
        <Link href="/hang-hoa/cong-thuc">
          <Button variant="outline">
            <Icon name="inventory_2" size={16} className="mr-2" /> Công thức (BOM)
          </Button>
        </Link>
        <Link href="/hang-hoa/lo-san-xuat">
          <Button variant="outline">
            <Icon name="inventory" size={16} className="mr-2" /> Lô sản phẩm
          </Button>
        </Link>
        <Link href="/hang-hoa/hsd">
          <Button variant="outline">
            <Icon name="warning" size={16} className="mr-2" /> Hạn sử dụng
          </Button>
        </Link>
      </div>
    </div>
  );
}
