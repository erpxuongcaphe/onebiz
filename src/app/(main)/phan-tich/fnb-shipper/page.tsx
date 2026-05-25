"use client";

/**
 * Báo cáo Shipper FnB (CEO 21/05/2026 — migration 00108)
 *
 * Đo hiệu suất nhân viên quán đi giao đơn:
 *   - KPI: tổng đơn giao / phí giao thu được / số shipper hoạt động
 *   - Bảng top shipper: số đơn / doanh thu / phí thu hộ / avg time
 *   - Drill-down: click 1 shipper → list đơn của họ + giao xong chưa
 */

import { useEffect, useState, useCallback } from "react";
import { KpiCard, ChartCard } from "../_components";
import { ReportPageHeader } from "@/components/shared/report";
import { useReportState } from "@/lib/hooks/use-report-state";
import { useBranchFilter, useAuth, useToast } from "@/lib/contexts";
import {
  formatCurrency,
  formatNumber,
} from "@/lib/format";
import {
  getDeliveryStaffPerformance,
  getOrdersByDeliveryStaff,
} from "@/lib/services";
import type {
  DeliveryStaffPerformance,
  ShipperOrderRow,
} from "@/lib/services/supabase/fnb-analytics";
import {
  exportReportToExcel,
  buildReportTitleRows,
  type ExcelSheet,
} from "@/lib/utils/excel-export";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

function formatDuration(seconds: number): string {
  if (seconds <= 0) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 1) return `${s}s`;
  if (m < 60) return `${m}p${s > 0 ? ` ${s}s` : ""}`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}p`;
}

const TIER_LABEL: Record<string, string> = {
  near: "Gần",
  mid: "Vừa",
  far: "Xa",
  custom: "Tự nhập",
};

export default function FnbShipperReportPage() {
  const { activeBranchId, isReady } = useBranchFilter();
  const { branches } = useAuth();
  const { toast } = useToast();
  const { preset, range, setPreset, setCustomRange, viewMode, setViewMode } =
    useReportState({ defaultPreset: "thisMonth", defaultViewMode: "table" });
  const [loading, setLoading] = useState(true);
  const [shippers, setShippers] = useState<DeliveryStaffPerformance[]>([]);
  const [selectedStaffId, setSelectedStaffId] = useState<string | null>(null);
  const [drillOrders, setDrillOrders] = useState<ShipperOrderRow[]>([]);
  const [drillLoading, setDrillLoading] = useState(false);

  const branchLabel = activeBranchId
    ? branches.find((b) => b.id === activeBranchId)?.name ?? "Chi nhánh đang chọn"
    : "Tất cả chi nhánh";

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const list = await getDeliveryStaffPerformance(activeBranchId, range);
      setShippers(list);
      // Reset drill khi đổi filter
      if (
        selectedStaffId &&
        !list.find((s) => s.staffId === selectedStaffId)
      ) {
        setSelectedStaffId(null);
        setDrillOrders([]);
      }
    } catch (err) {
      console.error("Failed to fetch shipper data:", err);
      toast({
        title: "Lỗi tải báo cáo",
        description: err instanceof Error ? err.message : "",
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeBranchId, range, toast]);

  useEffect(() => {
    if (!isReady) return;
    void fetchData();
  }, [fetchData, isReady]);

  const handleDrillStaff = async (staffId: string) => {
    if (selectedStaffId === staffId) {
      setSelectedStaffId(null);
      setDrillOrders([]);
      return;
    }
    setSelectedStaffId(staffId);
    setDrillLoading(true);
    try {
      const orders = await getOrdersByDeliveryStaff(staffId, activeBranchId, range);
      setDrillOrders(orders);
    } catch (err) {
      toast({
        title: "Lỗi tải danh sách đơn",
        description: err instanceof Error ? err.message : "",
        variant: "error",
      });
    } finally {
      setDrillLoading(false);
    }
  };

  // Totals
  const totalOrders = shippers.reduce((s, sh) => s + sh.totalOrders, 0);
  const totalRevenue = shippers.reduce((s, sh) => s + sh.totalRevenue, 0);
  const totalDeliveryFee = shippers.reduce((s, sh) => s + sh.totalDeliveryFee, 0);
  const activeShippers = shippers.length;

  const handleExportView = useCallback(() => {
    try {
      const title = buildReportTitleRows({
        title: "BÁO CÁO SHIPPER FNB",
        range,
        branchName: branchLabel,
        generatedAt: new Date(),
      });
      const sheet: ExcelSheet = {
        name: "Shipper",
        titleRows: title,
        columns: [
          { label: "Hạng", key: "rank", width: 6 },
          { label: "Nhân viên giao", key: "staffName", width: 28 },
          { label: "Số đơn", key: "totalOrders", width: 10, format: "number" },
          { label: "Doanh thu HĐ (VND)", key: "totalRevenue", width: 18, format: "currency" },
          { label: "Phí giao thu (VND)", key: "totalDeliveryFee", width: 18, format: "currency" },
          { label: "Avg thời gian (giây)", key: "avgDeliverySeconds", width: 16, format: "number" },
          { label: "Đơn đã giao xong", key: "completedCount", width: 16, format: "number" },
        ],
        rows: shippers.map((s, i) => ({
          rank: i + 1,
          staffName: s.staffName,
          totalOrders: s.totalOrders,
          totalRevenue: s.totalRevenue,
          totalDeliveryFee: s.totalDeliveryFee,
          avgDeliverySeconds: s.avgDeliverySeconds,
          completedCount: s.completedCount,
        })),
        footer: {
          rank: "",
          staffName: "TỔNG",
          totalOrders,
          totalRevenue,
          totalDeliveryFee,
          avgDeliverySeconds: "",
          completedCount: shippers.reduce((s, sh) => s + sh.completedCount, 0),
        },
      };
      exportReportToExcel({
        kind: "fnb-shipper",
        mode: "view",
        range,
        branchName: branchLabel,
        sheets: [sheet],
      });
      toast({ title: "Đã xuất Excel", variant: "success" });
    } catch (err) {
      toast({
        title: "Lỗi xuất Excel",
        description: err instanceof Error ? err.message : "",
        variant: "error",
      });
    }
  }, [shippers, range, branchLabel, totalOrders, totalRevenue, totalDeliveryFee, toast]);

  const reportHeader = (
    <ReportPageHeader
      title="Hiệu suất shipper"
      subtitle="Nhân viên quán đi giao — đo số đơn, doanh thu, thời gian giao"
      preset={preset}
      range={range}
      onPresetChange={setPreset}
      onCustomRangeChange={setCustomRange}
      viewMode={viewMode}
      onViewModeChange={setViewMode}
      onExportView={handleExportView}
      onExportFull={handleExportView}
      exportDisabled={loading || shippers.length === 0}
    />
  );

  if (loading) {
    return (
      <div className="flex flex-col h-[calc(100vh-64px)]">
        {reportHeader}
        <div className="flex-1 flex items-center justify-center">
          <Icon
            name="progress_activity"
            className="size-8 animate-spin text-muted-foreground"
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] overflow-y-auto">
      {reportHeader}

      <div className="flex-1 p-4 md:p-6 space-y-4">
        {/* KPI cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <KpiCard
            label="Tổng đơn giao"
            value={formatNumber(totalOrders)}
            icon="local_shipping"
            bg="bg-primary-fixed"
            iconColor="text-primary"
            valueColor="text-primary"
            change={`${activeShippers} shipper hoạt động`}
            positive
          />
          <KpiCard
            label="Doanh thu các đơn giao"
            value={formatCurrency(totalRevenue)}
            icon="payments"
            bg="bg-status-success/10"
            iconColor="text-status-success"
            valueColor="text-status-success"
          />
          <KpiCard
            label="Phí giao thu hộ quán"
            value={formatCurrency(totalDeliveryFee)}
            icon="receipt_long"
            bg="bg-status-warning/10"
            iconColor="text-status-warning"
            valueColor="text-status-warning"
            change={
              totalOrders > 0
                ? `TB ${formatCurrency(Math.round(totalDeliveryFee / totalOrders))}/đơn`
                : undefined
            }
            positive
          />
          <KpiCard
            label="Số shipper"
            value={String(activeShippers)}
            icon="badge"
            bg="bg-status-info/10"
            iconColor="text-status-info"
            valueColor="text-status-info"
            change={
              activeShippers > 0
                ? `TB ${formatNumber(Math.round(totalOrders / activeShippers))} đơn/shipper`
                : undefined
            }
            positive
          />
        </div>

        {/* Bảng shipper */}
        <ChartCard
          title="Bảng xếp hạng shipper"
          subtitle="Click vào shipper để xem danh sách đơn của họ"
        >
          {shippers.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              Chưa có shipper nào giao đơn trong kỳ này. Đảm bảo nhân viên đã được
              gán shipper khi tạo đơn delivery (POS FnB).
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-muted-foreground">
                    <th className="text-left py-2 pr-3 font-medium w-10">#</th>
                    <th className="text-left py-2 pr-3 font-medium">Nhân viên</th>
                    <th className="text-right py-2 pr-3 font-medium">Số đơn</th>
                    <th className="text-right py-2 pr-3 font-medium">Doanh thu HĐ</th>
                    <th className="text-right py-2 pr-3 font-medium">Phí giao thu</th>
                    <th className="text-right py-2 pr-3 font-medium">Avg thời gian</th>
                    <th className="text-right py-2 font-medium">Đã giao</th>
                  </tr>
                </thead>
                <tbody>
                  {shippers.map((s, i) => {
                    const isActive = selectedStaffId === s.staffId;
                    const completedPct =
                      s.totalOrders > 0
                        ? Math.round((s.completedCount / s.totalOrders) * 100)
                        : 0;
                    return (
                      <tr
                        key={s.staffId}
                        onClick={() => void handleDrillStaff(s.staffId)}
                        className={cn(
                          "border-b last:border-0 cursor-pointer transition-colors",
                          isActive
                            ? "bg-primary-fixed"
                            : "hover:bg-surface-container-low",
                        )}
                      >
                        <td className="py-2.5 pr-3">
                          <span
                            className={cn(
                              "inline-flex items-center justify-center size-6 rounded-full text-xs font-semibold",
                              i < 3
                                ? "bg-primary text-on-primary"
                                : "bg-surface-container text-muted-foreground",
                            )}
                          >
                            {i + 1}
                          </span>
                        </td>
                        <td className="py-2.5 pr-3 font-medium flex items-center gap-2">
                          <Icon
                            name={isActive ? "expand_more" : "chevron_right"}
                            size={16}
                            className="text-muted-foreground"
                          />
                          {s.staffName}
                        </td>
                        <td className="py-2.5 pr-3 text-right tabular-nums font-semibold">
                          {formatNumber(s.totalOrders)}
                        </td>
                        <td className="py-2.5 pr-3 text-right tabular-nums">
                          {formatCurrency(s.totalRevenue)}
                        </td>
                        <td className="py-2.5 pr-3 text-right tabular-nums text-status-warning">
                          {formatCurrency(s.totalDeliveryFee)}
                        </td>
                        <td className="py-2.5 pr-3 text-right tabular-nums text-muted-foreground">
                          {formatDuration(s.avgDeliverySeconds)}
                        </td>
                        <td className="py-2.5 text-right tabular-nums">
                          <span
                            className={cn(
                              "inline-flex items-center gap-1 text-xs",
                              completedPct >= 80
                                ? "text-status-success"
                                : completedPct >= 50
                                  ? "text-status-warning"
                                  : "text-muted-foreground",
                            )}
                          >
                            {s.completedCount}/{s.totalOrders}
                            <span className="opacity-60">({completedPct}%)</span>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="border-t-2 font-semibold">
                    <td className="py-3 pr-3"></td>
                    <td className="py-3 pr-3">Tổng cộng</td>
                    <td className="py-3 pr-3 text-right tabular-nums">
                      {formatNumber(totalOrders)}
                    </td>
                    <td className="py-3 pr-3 text-right text-primary tabular-nums">
                      {formatCurrency(totalRevenue)}
                    </td>
                    <td className="py-3 pr-3 text-right text-status-warning tabular-nums">
                      {formatCurrency(totalDeliveryFee)}
                    </td>
                    <td className="py-3 pr-3"></td>
                    <td className="py-3 text-right tabular-nums">
                      {shippers.reduce((s, sh) => s + sh.completedCount, 0)}/
                      {totalOrders}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </ChartCard>

        {/* DRILL-DOWN */}
        {selectedStaffId && (
          <ChartCard
            title={`Đơn của ${shippers.find((s) => s.staffId === selectedStaffId)?.staffName ?? ""}`}
            subtitle="Click 1 dòng khác phía trên để đổi shipper, hoặc click lại dòng này để đóng"
          >
            {drillLoading ? (
              <div className="py-8 flex items-center justify-center">
                <Icon
                  name="progress_activity"
                  className="size-6 animate-spin text-muted-foreground"
                />
              </div>
            ) : drillOrders.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                Shipper này chưa có đơn nào trong kỳ.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-muted-foreground">
                      <th className="text-left py-2 pr-3 font-medium">Mã đơn</th>
                      <th className="text-left py-2 pr-3 font-medium">HĐ</th>
                      <th className="text-left py-2 pr-3 font-medium">Khách</th>
                      <th className="text-right py-2 pr-3 font-medium">Tổng HĐ</th>
                      <th className="text-right py-2 pr-3 font-medium">Phí giao</th>
                      <th className="text-left py-2 pr-3 font-medium">Tier</th>
                      <th className="text-right py-2 pr-3 font-medium">Thời gian giao</th>
                      <th className="text-left py-2 font-medium">Trạng thái</th>
                    </tr>
                  </thead>
                  <tbody>
                    {drillOrders.map((o) => {
                      const completed = !!o.completedAt;
                      return (
                        <tr key={o.kitchenOrderId} className="border-b last:border-0">
                          <td className="py-2 pr-3 font-mono text-xs">
                            {o.orderNumber}
                          </td>
                          <td className="py-2 pr-3 font-mono text-xs text-primary">
                            {o.invoiceCode ?? "—"}
                          </td>
                          <td className="py-2 pr-3 truncate max-w-[200px]">
                            {o.customerName}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums font-medium">
                            {formatCurrency(o.total)}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums text-status-warning">
                            {formatCurrency(o.deliveryFee)}
                          </td>
                          <td className="py-2 pr-3 text-xs">
                            {o.deliveryTier
                              ? TIER_LABEL[o.deliveryTier] ?? o.deliveryTier
                              : "—"}
                          </td>
                          <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">
                            {o.durationSeconds !== null
                              ? formatDuration(o.durationSeconds)
                              : "—"}
                          </td>
                          <td className="py-2">
                            {completed ? (
                              <span className="inline-flex items-center gap-1 text-xs text-status-success">
                                <Icon name="check_circle" size={14} />
                                Đã giao
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                                <Icon name="schedule" size={14} />
                                Đang giao
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </ChartCard>
        )}
      </div>
    </div>
  );
}
