"use client";

/**
 * Báo cáo Tiêu hao NVL theo chi nhánh (Phase 2 — Sprint BOM-CONSUME, CEO 18/05/2026)
 *
 * Trả lời câu hỏi:
 *   - Mỗi quán FnB tháng này dùng bao nhiêu kg cà phê / lít sữa / gói đường?
 *   - Tổng cost NVL tiêu hao = bao nhiêu?
 *   - Quán nào tiêu hao NVL cao bất thường?
 *
 * Data: stock_movements với reference_type = 'bom_consume' (do RPC
 * consume_bom_for_sale ghi mỗi lần bán SKU có BOM).
 */

import { useEffect, useState, useCallback } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { useToast, useBranchFilter } from "@/lib/contexts";
import { Icon } from "@/components/ui/icon";
import { formatCurrency, formatNumber } from "@/lib/format";
import { SummaryCard } from "@/components/shared/summary-card";
import {
  getNvlConsumptionByBranch,
  type NvlConsumptionRow,
} from "@/lib/services";

function formatYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default function TieuHaoNvlPage() {
  const { toast } = useToast();
  const { activeBranchId } = useBranchFilter();

  // Default: tháng hiện tại
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [fromDate, setFromDate] = useState(formatYmd(monthStart));
  const [toDate, setToDate] = useState(formatYmd(now));

  const [rows, setRows] = useState<NvlConsumptionRow[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getNvlConsumptionByBranch({
        fromDate,
        toDate,
        branchId: activeBranchId,
      });
      setRows(data);
    } catch (err) {
      toast({
        variant: "error",
        title: "Không tải được báo cáo",
        description: err instanceof Error ? err.message : "Lỗi không xác định",
      });
    } finally {
      setLoading(false);
    }
  }, [fromDate, toDate, activeBranchId, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const totalQty = rows.reduce((s, r) => s + r.totalQty, 0);
  const totalCost = rows.reduce((s, r) => s + r.totalCost, 0);
  const uniqueBranches = new Set(rows.map((r) => r.branchId)).size;
  const uniqueMaterials = new Set(rows.map((r) => r.materialId)).size;

  return (
    <>
      <PageHeader
        title="Tiêu hao NVL theo chi nhánh"
        subtitle="NVL bị trừ tự động khi POS bán SKU có BOM"
      />

      <div className="px-4 pb-8 space-y-4">
        {/* Date filter */}
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-sm text-on-surface-variant">Khoảng thời gian:</span>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
          />
          <span className="text-sm">→</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="h-9 rounded-lg border border-input bg-background px-3 text-sm"
          />
        </div>

        {/* KPI */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <SummaryCard
            icon={<Icon name="receipt_long" size={16} />}
            label="Số lượt tiêu hao"
            value={loading ? "—" : formatNumber(rows.reduce((s, r) => s + r.movementCount, 0))}
          />
          <SummaryCard
            icon={<Icon name="science" size={16} />}
            label="Loại NVL"
            value={loading ? "—" : formatNumber(uniqueMaterials)}
          />
          <SummaryCard
            icon={<Icon name="storefront" size={16} />}
            label="Chi nhánh"
            value={loading ? "—" : formatNumber(uniqueBranches)}
          />
          <SummaryCard
            icon={<Icon name="payments" size={16} />}
            label="Tổng giá trị NVL tiêu hao"
            value={loading ? "—" : formatCurrency(totalCost)}
            highlight
          />
        </div>

        {/* Table */}
        <div className="rounded-lg border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-container-low text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Chi nhánh</th>
                <th className="text-left px-4 py-3 font-semibold">Mã NVL</th>
                <th className="text-left px-4 py-3 font-semibold">Tên NVL</th>
                <th className="text-right px-4 py-3 font-semibold">Số lượng</th>
                <th className="text-left px-4 py-3 font-semibold">ĐVT</th>
                <th className="text-right px-4 py-3 font-semibold">Số lần</th>
                <th className="text-right px-4 py-3 font-semibold">Thành tiền</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={7} className="text-center py-8 text-muted-foreground">
                    Đang tải...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={7} className="text-center py-12 text-muted-foreground">
                    <Icon name="info" size={32} className="mx-auto mb-2 opacity-40" />
                    <p className="text-sm">Chưa có dữ liệu tiêu hao NVL trong khoảng này.</p>
                    <p className="text-xs mt-1">
                      Báo cáo này lấy từ stock_movements type=&apos;bom_consume&apos;. Khi POS bán SKU
                      có BOM, server tự ghi log tiêu hao.
                    </p>
                  </td>
                </tr>
              ) : (
                rows.map((r, idx) => (
                  <tr key={`${r.branchId}-${r.materialId}-${idx}`} className="border-t border-border hover:bg-surface-container-low/50">
                    <td className="px-4 py-2">{r.branchName}</td>
                    <td className="px-4 py-2 text-primary font-medium">{r.materialCode}</td>
                    <td className="px-4 py-2">{r.materialName}</td>
                    <td className="px-4 py-2 text-right font-medium">{formatNumber(r.totalQty)}</td>
                    <td className="px-4 py-2 text-muted-foreground">{r.unit}</td>
                    <td className="px-4 py-2 text-right text-muted-foreground">{r.movementCount}</td>
                    <td className="px-4 py-2 text-right font-medium">{formatCurrency(r.totalCost)}</td>
                  </tr>
                ))
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="border-t-2 border-border bg-surface-container-low/30">
                <tr>
                  <td colSpan={6} className="px-4 py-3 text-right font-semibold">
                    Tổng cộng:
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-primary">
                    {formatCurrency(totalCost)}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </>
  );
}
