"use client";

/**
 * Báo cáo Đối chiếu ca làm việc — CEO 05/06/2026.
 *
 * Mục đích:
 *   CEO/Admin/Manager xem ai đối chiếu ca nào, variance bao nhiêu, lý
 *   do gì. Thay thế "block UI self-reconcile" bằng "công cụ giám sát"
 *   theo nguyên tắc tin tưởng + audit trail (CEO chốt 05/06).
 *
 * Cờ tự động:
 *   - "Tự": reconciled_by === cashier_id (tự đối chiếu)
 *   - "Lớn": |variance| > 5% expectedCash (chênh lệch lớn)
 *   - "Quên": auto_marked_pending_at != null (cashier quên đóng ca)
 *
 * Phân quyền:
 *   - shifts.reconcile_any → xem mọi chi nhánh
 *   - shifts.reconcile_own_branch → xem chi nhánh mình
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/lib/contexts/toast-context";
import { useAuth } from "@/lib/contexts";
import { usePermissions } from "@/lib/permissions";
import {
  getReconciledShifts,
  type ReconciledShiftRow,
  type ReconciledShiftFilter,
} from "@/lib/services/supabase/shifts";
import { getBranches } from "@/lib/services/supabase/branches";
import type { Branch } from "@/lib/types";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { KpiCard } from "../_components";

/* ─── Helpers ─── */

function todayIso(offsetDays = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function isSelfReconcile(r: ReconciledShiftRow): boolean {
  return !!r.reconciledById && r.reconciledById === r.cashierId;
}

function isBigVariance(r: ReconciledShiftRow): boolean {
  return r.expectedCash > 0 && Math.abs(r.variance) / r.expectedCash > 0.05;
}

/** Simple CSV download — KHÔNG phụ thuộc xlsx lib (giữ payload nhẹ).
 *  CEO có thể mở bằng Excel hoặc Google Sheets. */
function downloadCSV(filename: string, rows: ReconciledShiftRow[]): void {
  const header = [
    "Đóng lúc",
    "Chi nhánh",
    "Thu ngân",
    "Người đối chiếu",
    "Số đơn",
    "Doanh thu",
    "Tiền mặt dự kiến",
    "Tiền mặt thực",
    "Chênh lệch",
    "Tự đối chiếu",
    "Quên đóng ca",
    "Lý do",
    "Ghi chú",
  ];
  const escape = (v: string | number): string => {
    const s = String(v ?? "");
    if (/[",\n;]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push(
      [
        escape(formatDateTime(r.closedAt)),
        escape(r.branchName),
        escape(r.cashierName),
        escape(r.reconciledByName ?? ""),
        r.totalOrders,
        r.totalSales,
        r.expectedCash,
        r.actualCash,
        r.variance,
        isSelfReconcile(r) ? "Có" : "",
        r.wasAutoMarkedPending ? "Có" : "",
        escape(r.reason ?? ""),
        escape(r.note ?? ""),
      ].join(","),
    );
  }
  // BOM + CRLF cho Excel mở đúng tiếng Việt UTF-8
  const blob = new Blob(["﻿" + lines.join("\r\n")], {
    type: "text/csv;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ─── Page ─── */

export default function ReconciledShiftReportPage() {
  const { toast } = useToast();
  const { user } = useAuth();
  const { hasPermission } = usePermissions();

  const canViewAny = hasPermission("shifts.reconcile_any");
  const canViewOwn = hasPermission("shifts.reconcile_own_branch");
  const canView = canViewAny || canViewOwn;

  // Filters
  const [branchId, setBranchId] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState<string>(todayIso(-30));
  const [dateTo, setDateTo] = useState<string>(todayIso());
  const [type, setType] = useState<NonNullable<ReconciledShiftFilter["type"]>>("all");
  const [search, setSearch] = useState("");

  const [branches, setBranches] = useState<Branch[]>([]);
  const [rows, setRows] = useState<ReconciledShiftRow[]>([]);
  const [loading, setLoading] = useState(false);

  // Load branches (scope theo permission)
  useEffect(() => {
    if (!canView) return;
    getBranches()
      .then((bs) => {
        if (!canViewAny && user?.branchId) {
          setBranches(bs.filter((b) => b.id === user.branchId));
          setBranchId(user.branchId);
        } else {
          setBranches(bs);
        }
      })
      .catch((err: unknown) => {
        console.error("[doi-chieu-ca] load branches failed:", err);
        toast({
          title: "Không tải được danh sách chi nhánh",
          description: err instanceof Error ? err.message : "Reload trang",
          variant: "error",
        });
      });
  }, [canView, canViewAny, user?.branchId, toast]);

  const fetchData = useCallback(async () => {
    if (!canView) return;
    setLoading(true);
    try {
      const data = await getReconciledShifts({
        branchId: branchId !== "all" ? branchId : undefined,
        dateFrom: dateFrom ? `${dateFrom}T00:00:00.000Z` : undefined,
        dateTo: dateTo ? `${dateTo}T23:59:59.999Z` : undefined,
        type,
      });
      setRows(data);
    } catch (err) {
      console.error("[doi-chieu-ca] fetch failed:", err);
      toast({
        title: "Không tải được báo cáo đối chiếu ca",
        description: err instanceof Error ? err.message : "Lỗi không xác định",
        variant: "error",
      });
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [canView, branchId, dateFrom, dateTo, type, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Filter search client-side
  const filteredRows = useMemo(() => {
    if (!search.trim()) return rows;
    const s = search.toLowerCase();
    return rows.filter(
      (r) =>
        r.cashierName.toLowerCase().includes(s) ||
        (r.reconciledByName ?? "").toLowerCase().includes(s) ||
        r.branchName.toLowerCase().includes(s) ||
        (r.reason ?? "").toLowerCase().includes(s),
    );
  }, [rows, search]);

  // KPI
  const kpi = useMemo(() => {
    const total = filteredRows.length;
    const selfCount = filteredRows.filter(isSelfReconcile).length;
    const bigVarianceCount = filteredRows.filter(isBigVariance).length;
    const totalSurplus = filteredRows
      .filter((r) => r.variance > 0)
      .reduce((s, r) => s + r.variance, 0);
    const totalShortage = filteredRows
      .filter((r) => r.variance < 0)
      .reduce((s, r) => s + Math.abs(r.variance), 0);
    return {
      total,
      selfCount,
      selfPct: total > 0 ? Math.round((selfCount / total) * 100) : 0,
      bigVarianceCount,
      totalSurplus,
      totalShortage,
    };
  }, [filteredRows]);

  const handleExport = () => {
    if (filteredRows.length === 0) {
      toast({
        title: "Không có dữ liệu để xuất",
        variant: "warning",
      });
      return;
    }
    downloadCSV(`doi-chieu-ca-${dateFrom}_${dateTo}.csv`, filteredRows);
    toast({
      title: "Đã xuất CSV",
      description: `${filteredRows.length} dòng — mở bằng Excel hoặc Google Sheets`,
      variant: "success",
    });
  };

  if (!canView) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-status-error/40 bg-status-error/10 p-4 text-sm">
          <div className="flex items-start gap-2">
            <Icon name="block" className="text-status-error mt-0.5" />
            <div>
              <p className="font-semibold text-status-error">
                Bạn không có quyền xem báo cáo đối chiếu ca
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Cần quyền &quot;Đối chiếu ca mọi chi nhánh&quot; (Admin) hoặc
                &quot;Đối chiếu ca chi nhánh mình&quot; (Quản lý). Liên hệ chủ
                shop để cấp quyền.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            Đối chiếu ca làm việc
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Theo dõi ca đã chốt: tự đối chiếu vs chiếu hộ, chênh lệch, lý do.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleExport}
          disabled={loading || filteredRows.length === 0}
        >
          <Icon name="download" size={16} className="mr-1" />
          Xuất CSV
        </Button>
      </div>

      {/* Filters */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2 bg-surface-container-low rounded-xl p-3">
        <div className="col-span-2 md:col-span-1">
          <label className="text-xs text-muted-foreground">Chi nhánh</label>
          <Select value={branchId} onValueChange={(v) => v && setBranchId(v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="max-h-72 overflow-y-auto">
              {canViewAny && (
                <SelectItem value="all">Tất cả chi nhánh</SelectItem>
              )}
              {branches.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Từ ngày</label>
          <Input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Đến ngày</label>
          <Input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Loại</label>
          <Select
            value={type}
            onValueChange={(v) =>
              v &&
              setType(v as NonNullable<ReconciledShiftFilter["type"]>)
            }
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tất cả</SelectItem>
              <SelectItem value="self">Tự đối chiếu</SelectItem>
              <SelectItem value="cross">Chiếu hộ</SelectItem>
              <SelectItem value="big_variance">
                Chênh lệch lớn (&gt; 5%)
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-2 md:col-span-1">
          <label className="text-xs text-muted-foreground">Tìm kiếm</label>
          <Input
            placeholder="Tên thu ngân, lý do..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Tổng ca đã đối chiếu"
          value={kpi.total.toString()}
          icon="fact_check"
          bg="bg-primary/10"
          iconColor="text-primary"
          valueColor="text-foreground"
        />
        <KpiCard
          label="Tự đối chiếu"
          value={`${kpi.selfCount} (${kpi.selfPct}%)`}
          icon="person"
          bg="bg-status-warning/10"
          iconColor="text-status-warning"
          valueColor="text-status-warning"
        />
        <KpiCard
          label="Tổng thừa quỹ"
          value={`+${formatCurrency(kpi.totalSurplus)}đ`}
          icon="add_circle"
          bg="bg-status-success/10"
          iconColor="text-status-success"
          valueColor="text-status-success"
        />
        <KpiCard
          label="Tổng thiếu quỹ"
          value={`−${formatCurrency(kpi.totalShortage)}đ`}
          icon="remove_circle"
          bg="bg-status-error/10"
          iconColor="text-status-error"
          valueColor="text-status-error"
        />
      </div>

      {/* Table */}
      <div className="bg-surface-container-lowest rounded-xl ambient-shadow overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
            <Icon name="progress_activity" className="animate-spin mr-2" />
            Đang tải dữ liệu...
          </div>
        ) : filteredRows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-sm text-muted-foreground">
            <Icon name="inbox" size={32} className="mb-2 opacity-40" />
            Không có ca nào đã đối chiếu trong khoảng thời gian này
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-container-low text-xs font-semibold uppercase text-muted-foreground">
                  <th className="px-3 py-2 text-left">Đóng lúc</th>
                  <th className="px-3 py-2 text-left">Chi nhánh</th>
                  <th className="px-3 py-2 text-left">Thu ngân</th>
                  <th className="px-3 py-2 text-left">Người đối chiếu</th>
                  <th className="px-3 py-2 text-right">Số đơn</th>
                  <th className="px-3 py-2 text-right">Doanh thu</th>
                  <th className="px-3 py-2 text-right">Dự kiến</th>
                  <th className="px-3 py-2 text-right">Thực tế</th>
                  <th className="px-3 py-2 text-right">Chênh lệch</th>
                  <th className="px-3 py-2 text-center">Cờ</th>
                  <th className="px-3 py-2 text-left">Lý do</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((r) => {
                  const self = isSelfReconcile(r);
                  const big = isBigVariance(r);
                  return (
                    <tr
                      key={r.id}
                      className="border-t border-border hover:bg-surface-container-low/50"
                    >
                      <td className="px-3 py-2 whitespace-nowrap">
                        {formatDateTime(r.closedAt)}
                      </td>
                      <td className="px-3 py-2">{r.branchName}</td>
                      <td className="px-3 py-2">{r.cashierName}</td>
                      <td className="px-3 py-2">
                        {r.reconciledByName ?? (
                          <span className="text-muted-foreground italic">
                            (chốt trực tiếp)
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {r.totalOrders}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(r.totalSales)}đ
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(r.expectedCash)}đ
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {formatCurrency(r.actualCash)}đ
                      </td>
                      <td
                        className={cn(
                          "px-3 py-2 text-right tabular-nums font-medium",
                          r.variance === 0
                            ? "text-status-success"
                            : r.variance > 0
                              ? "text-status-warning"
                              : "text-status-error",
                        )}
                      >
                        {r.variance > 0 && "+"}
                        {formatCurrency(r.variance)}đ
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1 justify-center flex-wrap">
                          {self && (
                            <span
                              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-status-warning/10 text-status-warning text-[10px] font-medium"
                              title="Người đối chiếu trùng thu ngân — tự đối chiếu"
                            >
                              <Icon name="person" size={12} />
                              Tự
                            </span>
                          )}
                          {big && (
                            <span
                              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-status-error/10 text-status-error text-[10px] font-medium"
                              title="Chênh lệch > 5% so với dự kiến"
                            >
                              <Icon name="warning" size={12} />
                              Lớn
                            </span>
                          )}
                          {r.wasAutoMarkedPending && (
                            <span
                              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-primary/10 text-primary text-[10px] font-medium"
                              title="Ca bị auto-mark pending (cashier quên đóng)"
                            >
                              <Icon name="schedule" size={12} />
                              Quên
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-muted-foreground max-w-xs">
                        <div className="line-clamp-2">{r.reason ?? "—"}</div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
