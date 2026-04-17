"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Factory,
  Clock,
  Boxes,
  TrendingUp
} from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { KpiCard, ChartCard } from "@/app/(main)/phan-tich/_components";
import { useBranchFilter, useAuth } from "@/lib/contexts";
import { formatCurrency, formatNumber } from "@/lib/format";
import {
  getProductionKpis,
  getNvlStock,
  getProductionTrend,
  getTopOutputProducts,
} from "@/lib/services";
import type {
  ProductionKpis,
  NvlStockRow,
  ProductionTrend,
  TopOutputProduct,
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
// Custom tooltip
// ────────────────────────────────────────────

function TrendTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-background p-3 shadow-md text-xs">
      <p className="font-semibold text-gray-700 mb-1">{label}</p>
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

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [k, n, t, p] = await Promise.all([
        getProductionKpis(activeBranchId),
        getNvlStock({ branchId: activeBranchId }),
        getProductionTrend(6, activeBranchId),
        getTopOutputProducts(8, activeBranchId),
      ]);
      setKpis(k);
      setNvl(n);
      setTrend(t);
      setTopProducts(p);
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

      {/* KPI Row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label={`${labels.orderLabel} tháng này`}
          value={String(kpis?.ordersThisMonth ?? 0)}
          change={`${kpis?.completedThisMonth ?? 0} hoàn thành`}
          positive
          icon={Factory}
          bg="bg-blue-50"
          iconColor="text-blue-600"
          valueColor="text-blue-700"
        />
        <KpiCard
          label="Đang thực hiện"
          value={String(kpis?.activeOrders ?? 0)}
          change={`${labels.ordersLabel}`}
          positive
          icon={Clock}
          bg="bg-amber-50"
          iconColor="text-amber-600"
          valueColor="text-amber-700"
        />
        <KpiCard
          label="Tỷ lệ hoàn thành"
          value={`${kpis?.yieldRate ?? 0}%`}
          change={`SL: ${formatNumber(kpis?.totalOutputQty ?? 0)}`}
          positive={(kpis?.yieldRate ?? 0) >= 90}
          icon={TrendingUp}
          bg="bg-green-50"
          iconColor="text-green-600"
          valueColor="text-green-700"
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
          icon={Boxes}
          bg="bg-purple-50"
          iconColor="text-purple-600"
          valueColor="text-purple-700"
        />
      </div>

      {/* Lot alerts */}
      {((kpis?.expiredLots ?? 0) > 0 || (kpis?.expiringLots ?? 0) > 0) && (
        <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-amber-50 border border-amber-200">
          <Icon name="warning" className="text-amber-600 shrink-0" />
          <div className="text-sm">
            {(kpis?.expiredLots ?? 0) > 0 && (
              <span className="text-red-600 font-medium mr-3">
                {kpis?.expiredLots} lô đã hết hạn
              </span>
            )}
            {(kpis?.expiringLots ?? 0) > 0 && (
              <span className="text-amber-700">
                {kpis?.expiringLots} lô sắp hết hạn (30 ngày)
              </span>
            )}
          </div>
          <Link href="/hang-hoa/hsd" className="ml-auto">
            <Button variant="outline" size="sm">
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
              <Bar dataKey="planned" name="Kế hoạch" fill="#93c5fd" radius={[4, 4, 0, 0]} />
              <Bar dataKey="completed" name="Hoàn thành" fill="#3b82f6" radius={[4, 4, 0, 0]} />
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
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left p-2 font-medium">Nguyên liệu</th>
                <th className="text-left p-2 font-medium">Chi nhánh</th>
                <th className="text-right p-2 font-medium">Tồn kho</th>
                <th className="text-right p-2 font-medium">Tối thiểu</th>
                <th className="text-right p-2 font-medium">Giá trị</th>
                <th className="text-center p-2 font-medium">Trạng thái</th>
              </tr>
            </thead>
            <tbody>
              {(lowStockNvl.length > 0 ? lowStockNvl : nvl.slice(0, 15)).map((r, i) => (
                <tr key={i} className="border-t hover:bg-muted/20">
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
                      <Badge variant="destructive" className="text-xs">Hết hàng</Badge>
                    ) : r.isLow ? (
                      <Badge variant="outline" className="text-xs border-amber-300 text-amber-700 bg-amber-50">
                        Sắp hết
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs text-green-700 border-green-300 bg-green-50">
                        Đủ
                      </Badge>
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
