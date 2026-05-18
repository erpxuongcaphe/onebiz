"use client";

/**
 * Báo cáo COGS thực theo BOM (Phase 2 — Sprint BOM-CONSUME, CEO 18/05/2026)
 *
 * Trả lời câu hỏi:
 *   - COGS thực của từng hoá đơn = bao nhiêu (tính từ BOM × cost_price NVL)?
 *   - Margin thực = revenue - cogs_real
 *   - SKU nào margin âm? (giá bán < chi phí NVL thực)
 *
 * Khác với báo cáo COGS cũ (dùng `products.cost_price` của SKU bán) — báo cáo
 * này tính từng NVL trong BOM nhân cost của chúng → chính xác hơn nhiều.
 */

import { useEffect, useState, useCallback } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { useToast, useBranchFilter } from "@/lib/contexts";
import { Icon } from "@/components/ui/icon";
import { formatCurrency, formatNumber } from "@/lib/format";
import { SummaryCard } from "@/components/shared/summary-card";
import { getCogsByBom, type CogsByBomRow } from "@/lib/services";

function formatYmd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function CogsTheoBomPage() {
  const { toast } = useToast();
  const { activeBranchId } = useBranchFilter();

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [fromDate, setFromDate] = useState(formatYmd(monthStart));
  const [toDate, setToDate] = useState(formatYmd(now));

  const [rows, setRows] = useState<CogsByBomRow[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getCogsByBom({ fromDate, toDate, branchId: activeBranchId });
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

  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalCogs = rows.reduce((s, r) => s + r.cogsReal, 0);
  const totalMargin = totalRevenue - totalCogs;
  const marginPercent = totalRevenue > 0 ? (totalMargin / totalRevenue) * 100 : 0;

  // SKU margin âm (giá bán < cost BOM)
  const negativeMargin = rows.filter((r) => r.margin < 0);

  return (
    <>
      <PageHeader
        title="COGS thực theo BOM"
        subtitle="Chi phí giá vốn tính từ NVL trong công thức (chính xác hơn COGS theo cost_price SKU)"
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
            icon={<Icon name="trending_up" size={16} />}
            label="Doanh thu (SKU có BOM)"
            value={loading ? "—" : formatCurrency(totalRevenue)}
            highlight
          />
          <SummaryCard
            icon={<Icon name="payments" size={16} />}
            label="COGS thực theo BOM"
            value={loading ? "—" : formatCurrency(totalCogs)}
          />
          <SummaryCard
            icon={<Icon name="account_balance" size={16} />}
            label={`Margin (${marginPercent.toFixed(1)}%)`}
            value={loading ? "—" : formatCurrency(totalMargin)}
            danger={totalMargin < 0}
          />
          <SummaryCard
            icon={<Icon name="warning" size={16} />}
            label="SKU margin âm"
            value={loading ? "—" : formatNumber(negativeMargin.length)}
            danger={negativeMargin.length > 0}
          />
        </div>

        {/* Table */}
        <div className="rounded-lg border border-border bg-card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-container-low text-xs uppercase text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Hoá đơn</th>
                <th className="text-left px-4 py-3 font-semibold">Thời gian</th>
                <th className="text-left px-4 py-3 font-semibold">Chi nhánh</th>
                <th className="text-left px-4 py-3 font-semibold">SKU</th>
                <th className="text-right px-4 py-3 font-semibold">SL</th>
                <th className="text-right px-4 py-3 font-semibold">Doanh thu</th>
                <th className="text-right px-4 py-3 font-semibold">COGS thực</th>
                <th className="text-right px-4 py-3 font-semibold">Margin</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-muted-foreground">
                    Đang tải...
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-12 text-muted-foreground">
                    <Icon name="info" size={32} className="mx-auto mb-2 opacity-40" />
                    <p className="text-sm">Chưa có dữ liệu COGS thực theo BOM.</p>
                    <p className="text-xs mt-1">
                      Báo cáo này chỉ tính SKU có has_bom=true và đã setup BOM active.
                    </p>
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr
                    key={`${r.invoiceId}-${r.productId}`}
                    className={
                      "border-t border-border hover:bg-surface-container-low/50 " +
                      (r.margin < 0 ? "bg-status-danger/5" : "")
                    }
                  >
                    <td className="px-4 py-2 font-medium text-primary">{r.invoiceCode}</td>
                    <td className="px-4 py-2 text-xs text-muted-foreground">{formatDateTime(r.invoiceDate)}</td>
                    <td className="px-4 py-2">{r.branchName}</td>
                    <td className="px-4 py-2">
                      <div>{r.productName}</div>
                      <div className="text-xs text-muted-foreground">{r.productCode}</div>
                    </td>
                    <td className="px-4 py-2 text-right">{formatNumber(r.qtySold)}</td>
                    <td className="px-4 py-2 text-right font-medium">{formatCurrency(r.revenue)}</td>
                    <td className="px-4 py-2 text-right">{formatCurrency(r.cogsReal)}</td>
                    <td
                      className={
                        "px-4 py-2 text-right font-semibold " +
                        (r.margin < 0 ? "text-status-danger" : "text-status-success")
                      }
                    >
                      {formatCurrency(r.margin)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="border-t-2 border-border bg-surface-container-low/30">
                <tr>
                  <td colSpan={5} className="px-4 py-3 text-right font-semibold">
                    Tổng cộng:
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-primary">
                    {formatCurrency(totalRevenue)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">
                    {formatCurrency(totalCogs)}
                  </td>
                  <td
                    className={
                      "px-4 py-3 text-right font-semibold " +
                      (totalMargin < 0 ? "text-status-danger" : "text-status-success")
                    }
                  >
                    {formatCurrency(totalMargin)}
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
