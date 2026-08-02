"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { PermissionPage } from "@/components/shared/permission-page";
import { useAuth } from "@/lib/contexts/auth-context";
import { useToast } from "@/lib/contexts/toast-context";
import { formatCurrency, formatDate } from "@/lib/format";
import { PERMISSIONS } from "@/lib/permissions";
import {
  getPosInvoiceIntegrityReport,
  type PosIntegrityIssueCode,
  type PosInvoiceIntegrityRow,
} from "@/lib/services/supabase/pos-integrity";

const ISSUE_LABELS: Record<PosIntegrityIssueCode, string> = {
  SUBTOTAL_VS_ITEMS: "Tạm tính lệch chi tiết",
  TOTAL_VS_FORMULA: "Tổng tiền lệch công thức",
  LINE_TOTAL_VS_ITEMS: "Thành tiền dòng bị lệch",
};

function toDateInput(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function initialFrom(): string {
  const value = new Date();
  value.setDate(value.getDate() - 7);
  return toDateInput(value);
}

export default function PosIntegrityPageGuarded() {
  return (
    <PermissionPage requires={PERMISSIONS.SYSTEM_VIEW_AUDIT}>
      <PosIntegrityPage />
    </PermissionPage>
  );
}

function PosIntegrityPage() {
  const { activeBranchId, currentBranch, branches } = useAuth();
  const { toast } = useToast();
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(() => toDateInput(new Date()));
  const [rows, setRows] = useState<PosInvoiceIntegrityRow[] | null>(null);
  const [checkedScopeLabel, setCheckedScopeLabel] = useState("");
  const [loading, setLoading] = useState(false);

  const branchNames = useMemo(
    () => new Map(branches.map((branch) => [branch.id, branch.name])),
    [branches],
  );
  const scopeLabel = currentBranch?.name ?? "Tất cả chi nhánh";

  const runCheck = async () => {
    if (!from || !to || from > to) {
      toast({
        title: "Khoảng ngày chưa hợp lệ",
        description: "Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.",
        variant: "warning",
      });
      return;
    }

    setLoading(true);
    try {
      const endExclusive = new Date(`${to}T00:00:00`);
      endExclusive.setDate(endExclusive.getDate() + 1);
      const result = await getPosInvoiceIntegrityReport({
        from: new Date(`${from}T00:00:00`).toISOString(),
        to: endExclusive.toISOString(),
        branchId: activeBranchId,
        limit: 500,
      });
      setRows(result);
      setCheckedScopeLabel(scopeLabel);
      toast({
        title: result.length === 0 ? "Dữ liệu POS khớp" : `Phát hiện ${result.length} hóa đơn cần kiểm tra`,
        description: "Kết quả chỉ đọc, hệ thống không tự sửa số liệu.",
        variant: result.length === 0 ? "success" : "warning",
      });
    } catch (error) {
      toast({
        title: "Không kiểm tra được dữ liệu POS",
        description: error instanceof Error ? error.message : "Vui lòng thử lại.",
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-2xl font-bold">Kiểm tra dữ liệu POS</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Đối chiếu tổng hóa đơn với từng dòng hàng. Chức năng này chỉ đọc dữ liệu.
          </p>
        </div>
        <Badge variant="outline" className="w-fit">
          <Icon name="store" size={15} className="mr-1" />
          {scopeLabel}
        </Badge>
      </div>

      <div className="flex flex-wrap items-end gap-3 border-y bg-surface-container-low/40 px-3 py-3">
        <label className="grid gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Từ ngày</span>
          <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="text-xs text-muted-foreground">Đến ngày</span>
          <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </label>
        <Button onClick={() => void runCheck()} disabled={loading}>
          <Icon name={loading ? "progress_activity" : "fact_check"} size={17} className={loading ? "mr-1 animate-spin" : "mr-1"} />
          {loading ? "Đang kiểm tra" : "Kiểm tra ngay"}
        </Button>
      </div>

      {rows !== null && rows.length === 0 && (
        <Card className="border-status-success/40">
          <CardContent className="flex items-center gap-3 py-5">
            <Icon name="check_circle" className="text-status-success" />
            <div>
              <p className="font-semibold">Không phát hiện chênh lệch</p>
              <p className="text-sm text-muted-foreground">Tổng tiền và chi tiết hàng hóa đang khớp tại {checkedScopeLabel}.</p>
            </div>
          </CardContent>
        </Card>
      )}

      {rows && rows.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Hóa đơn cần đối chiếu ({rows.length}) · {checkedScopeLabel}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1050px] text-sm">
                <thead className="border-y bg-surface-container-low text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-4 py-2">Mã hóa đơn</th>
                    <th className="px-3 py-2">Thời gian</th>
                    <th className="px-3 py-2">Chi nhánh</th>
                    <th className="px-3 py-2 text-right">Tạm tính hóa đơn</th>
                    <th className="px-3 py-2 text-right">Tạm tính chi tiết</th>
                    <th className="px-3 py-2 text-right">Tổng hóa đơn</th>
                    <th className="px-3 py-2 text-right">Tổng theo công thức</th>
                    <th className="px-4 py-2">Nội dung cần kiểm tra</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.invoiceId} className="border-b align-top hover:bg-surface-container-low/50">
                      <td className="px-4 py-3 font-semibold">{row.invoiceCode}</td>
                      <td className="whitespace-nowrap px-3 py-3">{formatDate(row.createdAt)}</td>
                      <td className="px-3 py-3">{branchNames.get(row.branchId) ?? "Không xác định"}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatCurrency(row.invoiceSubtotal)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatCurrency(row.detailSubtotal)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatCurrency(row.invoiceTotal)}</td>
                      <td className="px-3 py-3 text-right tabular-nums">{formatCurrency(row.formulaTotal)}</td>
                      <td className="px-4 py-3">
                        <div className="flex max-w-xs flex-wrap gap-1">
                          {row.issueCodes.map((code) => (
                            <Badge key={code} variant="outline" className="border-status-warning/50 text-status-warning">
                              {ISSUE_LABELS[code] ?? code}
                            </Badge>
                          ))}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Lệch lớn nhất: {formatCurrency(row.largestDifference)}
                        </p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

