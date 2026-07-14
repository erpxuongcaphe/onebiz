"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { ChartCard } from "../../phan-tich/_components";
import { ReportPageHeader } from "@/components/shared/report";
import { useReportState } from "@/lib/hooks/use-report-state";
import { useBranchFilter, useToast } from "@/lib/contexts";
import { formatCurrency, formatNumber } from "@/lib/format";
import { getPurchaseForecast } from "@/lib/services";
import type { PurchaseForecastResult } from "@/lib/services";
import {
  exportReportToExcel,
  buildReportTitleRows,
  type ExcelSheet,
} from "@/lib/utils/excel-export";
import { Icon } from "@/components/ui/icon";

export default function DuKienMuaHangPage() {
  const { preset, range, setPreset, setCustomRange, viewMode, setViewMode } =
    useReportState({ defaultPreset: "thisMonth", forceTable: true });
  const { activeBranchId, currentBranch } = useBranchFilter();
  const { toast } = useToast();

  const [data, setData] = useState<PurchaseForecastResult | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const res = await getPurchaseForecast(
        { dateFrom: range.from, dateTo: range.to },
        activeBranchId,
      );
      setData(res);
    } catch (err) {
      toast({
        title: "Không tải được dự kiến mua hàng",
        description: err instanceof Error ? err.message : "Lỗi",
        variant: "error",
      });
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [range.from, range.to, activeBranchId, toast]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const branchLabel = currentBranch?.name ?? "Tất cả chi nhánh";

  // Gộp SKU theo chi nhánh (tab 1)
  const skuByBranch = useMemo(() => {
    const groups = new Map<
      string,
      { branchName: string; rows: PurchaseForecastResult["skuRows"] }
    >();
    for (const r of data?.skuRows ?? []) {
      const key = r.branchId ?? "null";
      const g = groups.get(key) ?? { branchName: r.branchName, rows: [] };
      g.rows.push(r);
      groups.set(key, g);
    }
    return [...groups.values()];
  }, [data]);

  const handleExport = useCallback(() => {
    if (!data) return;
    const title = buildReportTitleRows({
      title: "DỰ KIẾN MUA HÀNG",
      range,
      branchName: branchLabel,
      generatedAt: new Date(),
    });
    const sheets: ExcelSheet[] = [
      {
        name: "Dự kiến mua NVL",
        titleRows: [
          "DỰ KIẾN MUA NGUYÊN VẬT LIỆU",
          ...title.slice(1),
          `Tồn lấy tại: ${data.khoTongName ?? "Kho Tổng"} · Số đơn tính: ${data.orderCount}`,
        ],
        columns: [
          { label: "Mã NVL", key: "code", width: 16 },
          { label: "Tên", key: "name", width: 34 },
          { label: "ĐVT", key: "unit", width: 8 },
          { label: "SL cần", key: "req", width: 12, format: "number" },
          { label: "Tồn Kho Tổng", key: "stock", width: 14, format: "number" },
          { label: "Cần mua", key: "buy", width: 12, format: "number" },
          { label: "Đơn giá", key: "cost", width: 12, format: "currency" },
          { label: "Thành tiền", key: "amount", width: 16, format: "currency" },
        ],
        rows: data.materials.map((m) => ({
          code: m.code,
          name: m.name,
          unit: m.unit,
          req: m.required,
          stock: m.stockKhoTong,
          buy: m.toBuy,
          cost: m.unitCost,
          amount: m.amount,
        })),
        footer: { code: "TỔNG", amount: data.totalToBuyAmount },
      },
      {
        name: "Đặt hàng theo chi nhánh",
        titleRows: ["ĐẶT HÀNG THEO CHI NHÁNH (SKU)", ...title.slice(1)],
        columns: [
          { label: "Chi nhánh", key: "branch", width: 24 },
          { label: "Mã hàng", key: "code", width: 16 },
          { label: "Tên hàng", key: "name", width: 34 },
          { label: "ĐVT", key: "unit", width: 8 },
          { label: "SL đặt", key: "qty", width: 12, format: "number" },
          { label: "Giá trị", key: "amount", width: 16, format: "currency" },
        ],
        rows: (data.skuRows ?? []).map((r) => ({
          branch: r.branchName,
          code: r.code,
          name: r.name,
          unit: r.unit,
          qty: r.quantity,
          amount: r.amount,
        })),
      },
    ];
    exportReportToExcel({
      kind: "du-kien-mua-hang",
      mode: "full",
      range,
      branchName: branchLabel,
      sheets,
    });
  }, [data, range, branchLabel]);

  return (
    <div className="space-y-4">
      <ReportPageHeader
        title="Dự kiến mua hàng"
        subtitle="Từ đơn đặt hàng chưa hoàn tất → nổ công thức → nguyên vật liệu cần chuẩn bị / mua"
        preset={preset}
        range={range}
        onPresetChange={setPreset}
        onCustomRangeChange={setCustomRange}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onExportFull={handleExport}
        exportDisabled={loading || !data}
      />

      {/* Ghi chú nguồn số liệu */}
      <div className="rounded-lg border border-primary/25 bg-primary/5 px-4 py-2.5 text-sm text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1">
        <span className="flex items-center gap-1.5">
          <Icon name="inventory_2" size={16} className="text-primary" />
          Tồn lấy tại: <strong className="text-foreground">{data?.khoTongName ?? "Kho Tổng"}</strong>
        </span>
        <span>· Đơn đặt hàng chưa hoàn tất: <strong className="text-foreground">{data?.orderCount ?? 0}</strong></span>
        <span>· Đơn giá = giá vốn</span>
      </div>

      {/* ① Dự kiến mua NVL */}
      <ChartCard
        title="Dự kiến mua nguyên vật liệu"
        subtitle={`${data?.materials.length ?? 0} loại NVL · Tổng cần mua: ${formatCurrency(data?.totalToBuyAmount ?? 0)}`}
      >
        {loading ? (
          <div className="py-12 text-center text-sm text-muted-foreground">Đang tính...</div>
        ) : !data || data.materials.length === 0 ? (
          <div className="py-12 text-center text-sm text-muted-foreground">
            Không có đơn đặt hàng chưa hoàn tất trong khoảng thời gian này (hoặc SKU chưa có công thức).
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-2 pr-3 font-medium">Mã NVL</th>
                  <th className="text-left py-2 pr-3 font-medium">Tên</th>
                  <th className="text-left py-2 pr-3 font-medium">ĐVT</th>
                  <th className="text-right py-2 pr-3 font-medium">SL cần</th>
                  <th className="text-right py-2 pr-3 font-medium">Tồn Kho Tổng</th>
                  <th className="text-right py-2 pr-3 font-medium">Cần mua</th>
                  <th className="text-right py-2 pr-3 font-medium">Đơn giá</th>
                  <th className="text-right py-2 font-medium">Thành tiền</th>
                </tr>
              </thead>
              <tbody>
                {data.materials.map((m) => (
                  <tr
                    key={m.materialId}
                    className={m.toBuy > 0 ? "border-b last:border-0 bg-status-warning/5" : "border-b last:border-0"}
                  >
                    <td className="py-2 pr-3 font-mono text-xs font-medium text-primary">{m.code}</td>
                    <td className="py-2 pr-3">{m.name}</td>
                    <td className="py-2 pr-3 text-muted-foreground">{m.unit}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{formatNumber(m.required)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{formatNumber(m.stockKhoTong)}</td>
                    <td className={"py-2 pr-3 text-right tabular-nums font-semibold " + (m.toBuy > 0 ? "text-status-warning" : "text-status-success")}>
                      {formatNumber(m.toBuy)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-muted-foreground">{formatCurrency(m.unitCost)}</td>
                    <td className="py-2 text-right tabular-nums font-medium">{formatCurrency(m.amount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-bold border-t-2">
                  <td className="py-2 pr-3" colSpan={7}>TỔNG TIỀN CẦN MUA</td>
                  <td className="py-2 text-right tabular-nums text-primary">{formatCurrency(data.totalToBuyAmount)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </ChartCard>

      {/* ② Đặt hàng theo chi nhánh */}
      <ChartCard title="Đặt hàng theo chi nhánh" subtitle="Chi tiết SKU đã đặt trong các đơn (nguồn của dự kiến trên)">
        {loading ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Đang tải...</div>
        ) : skuByBranch.length === 0 ? (
          <div className="py-10 text-center text-sm text-muted-foreground">Chưa có đơn đặt hàng phù hợp</div>
        ) : (
          <div className="space-y-5">
            {skuByBranch.map((g) => (
              <div key={g.branchName}>
                <div className="text-sm font-semibold text-primary mb-1.5 flex items-center gap-1.5">
                  <Icon name="store" size={15} /> {g.branchName}
                  <span className="text-xs font-normal text-muted-foreground">({g.rows.length} mặt hàng)</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-muted-foreground">
                        <th className="text-left py-1.5 pr-3 font-medium">Mã hàng</th>
                        <th className="text-left py-1.5 pr-3 font-medium">Tên hàng</th>
                        <th className="text-left py-1.5 pr-3 font-medium">ĐVT</th>
                        <th className="text-right py-1.5 pr-3 font-medium">SL đặt</th>
                        <th className="text-right py-1.5 font-medium">Giá trị</th>
                      </tr>
                    </thead>
                    <tbody>
                      {g.rows.map((r) => (
                        <tr key={r.branchName + r.productId} className="border-b last:border-0">
                          <td className="py-1.5 pr-3 font-mono text-xs text-primary">{r.code}</td>
                          <td className="py-1.5 pr-3">{r.name}</td>
                          <td className="py-1.5 pr-3 text-muted-foreground">{r.unit}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{formatNumber(r.quantity)}</td>
                          <td className="py-1.5 text-right tabular-nums">{formatCurrency(r.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </ChartCard>
    </div>
  );
}
