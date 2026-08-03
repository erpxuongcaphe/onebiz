"use client";

/**
 * Công nợ — 3 tabs:
 *   - Khách hàng còn nợ (debt > 0)
 *   - Nhà cung cấp còn nợ
 *   - Phân tích tuổi nợ (Aging Report) — Sprint 7
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { useBranchFilter, useToast } from "@/lib/contexts";
import { formatCurrency } from "@/lib/format";
import { exportToCsv } from "@/lib/utils/export";
import { exportToExcelFromSchema } from "@/lib/excel";
import type { DebtOpeningImportRow } from "@/lib/excel/schemas";
import { getCustomers, getSuppliers } from "@/lib/services";
import { getDebtAging, getTopDebtors, getDebtTotals } from "@/lib/services/supabase/debt";
import type { Customer, Supplier } from "@/lib/types";
import type { DebtAgingReport, DebtorDetail } from "@/lib/services/supabase/debt";
import { Icon } from "@/components/ui/icon";
import { Button } from "@/components/ui/button";
import { ImportExcelDialog } from "@/components/shared/dialogs/import-excel-dialog";
import { AuditLogDialog } from "@/components/shared/audit-log-dialog";
import { SettleDebtDialog } from "@/components/shared/dialogs/settle-debt-dialog";
import { DebtDetailDialog } from "@/components/shared/dialogs/debt-detail-dialog";
import { buildTransactionRowActions } from "@/components/shared/transaction-row-actions";
import { downloadTemplate } from "@/lib/excel";
import { debtOpeningExcelSchema } from "@/lib/excel/schemas";
import { bulkImportDebtOpening } from "@/lib/services/supabase/excel-import";

type Mode = "customer" | "supplier" | "aging";

const BUCKET_TEXT_COLORS = [
  "text-status-success",
  "text-status-warning",
  "text-status-warning",
  "text-status-error",
];

const REPORT_LOAD_TIMEOUT_MS = 15_000;

async function withReportTimeout<T>(promise: Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error("Dữ liệu phản hồi quá chậm. Vui lòng thử lại.")),
      REPORT_LOAD_TIMEOUT_MS,
    );
  });

  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export default function CongNoPage() {
  const { toast } = useToast();
  const { activeBranchId, branchLabel, isReady } = useBranchFilter();
  const [mode, setMode] = useState<Mode>("customer");
  const [search, setSearch] = useState("");

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);

  // KPI summary — fetch tổng cả 2 (KH + NCC) bất kể đang ở tab nào.
  // Trước đây tổng tính từ customers/suppliers state — nhưng state chỉ
  // có data của tab hiện tại → KPI tab không phải hiển thị 0 (sai).
  const [debtTotals, setDebtTotals] = useState({
    customerDebtTotal: 0,
    customerCount: 0,
    supplierDebtTotal: 0,
    supplierCount: 0,
  });

  // Aging data
  const [aging, setAging] = useState<DebtAgingReport | null>(null);
  const [topDebtors, setTopDebtors] = useState<DebtorDetail[]>([]);
  const [agingLoading, setAgingLoading] = useState(false);
  const [agingError, setAgingError] = useState<string | null>(null);

  // Import opening debt
  const [importOpen, setImportOpen] = useState(false);

  // Sprint UX-1 Stage 4: Audit log shortcut (master KH/NCC)
  const [auditDialogTarget, setAuditDialogTarget] = useState<{
    type: "customer" | "supplier";
    id: string;
    code: string;
  } | null>(null);

  // CEO 03/06/2026 — Sprint 3 (Công nợ C1+C2): Settle debt dialog per-row.
  // Mỗi KH + mỗi NCC có nút "Thanh toán" → mở dialog auto-allocate FIFO.
  const [settleTarget, setSettleTarget] = useState<{
    mode: "customer" | "supplier";
    partyId: string;
    partyName: string;
    estimatedDebt: number;
  } | null>(null);
  // CEO 06/06/2026 — sau khi anh báo "chưa xem được chi tiết đơn nợ":
  // dialog read-only xem list HD/PO của KH/NCC đang nợ.
  const [detailTarget, setDetailTarget] = useState<{
    mode: "customer" | "supplier";
    partyId: string;
    partyName: string;
    partyCode?: string;
    estimatedDebt: number;
  } | null>(null);

  const fetchData = useCallback(async () => {
    if (!isReady) return;
    setLoading(true);
    try {
      // Luôn fetch tổng KPI (cả KH + NCC) song song với data tab.
      const totalsPromise = getDebtTotals(activeBranchId);

      if (mode === "customer") {
        const [result, totals] = await withReportTimeout(Promise.all([
          getCustomers({
            page: 0,
            pageSize: 200,
            search,
            filters: { debt: "has_debt" },
          }),
          totalsPromise,
        ]));
        setCustomers(result.data);
        setDebtTotals(totals);
      } else if (mode === "supplier") {
        const [result, totals] = await withReportTimeout(Promise.all([
          getSuppliers({
            page: 0,
            pageSize: 200,
            search,
            filters: { debt: "has_debt" },
          }),
          totalsPromise,
        ]));
        setSuppliers(result.data);
        setDebtTotals(totals);
      } else if (mode === "aging") {
        setAgingLoading(true);
        setAgingError(null);
        const [agingRes, debtorsRes, totals] = await withReportTimeout(Promise.all([
          getDebtAging(activeBranchId),
          getTopDebtors(20, activeBranchId),
          totalsPromise,
        ]));
        setAging(agingRes);
        setTopDebtors(debtorsRes);
        setDebtTotals(totals);
      }
    } catch (err) {
      toast({
        title: "Lỗi tải công nợ",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
      if (mode === "aging") {
        setAgingError(
          err instanceof Error ? err.message : "Không thể tải phân tích tuổi nợ",
        );
      }
    } finally {
      setAgingLoading(false);
      setLoading(false);
    }
  }, [activeBranchId, isReady, mode, search, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // KPI dùng totals từ DB (chính xác mọi mode) thay vì reduce client state.
  const totalCustomerDebt = debtTotals.customerDebtTotal;
  const totalSupplierDebt = debtTotals.supplierDebtTotal;
  const customerDebtCount = debtTotals.customerCount;
  const supplierDebtCount = debtTotals.supplierCount;

  const { receivableDebtors, payableDebtors } = useMemo(() => {
    const keyword = search.trim().toLocaleLowerCase("vi");
    const matches = (row: DebtorDetail) =>
      !keyword ||
      row.code.toLocaleLowerCase("vi").includes(keyword) ||
      row.name.toLocaleLowerCase("vi").includes(keyword) ||
      (row.phone ?? "").includes(keyword);

    return {
      receivableDebtors: topDebtors.filter(
        (row) => row.type === "customer" && matches(row),
      ),
      payableDebtors: topDebtors.filter(
        (row) => row.type === "supplier" && matches(row),
      ),
    };
  }, [search, topDebtors]);

  const customerColumns: ColumnDef<Customer, unknown>[] = [
    {
      accessorKey: "code",
      header: "Mã KH",
      size: 130,
      cell: ({ row }) => (
        <span className="font-mono text-primary">{row.original.code}</span>
      ),
    },
    {
      accessorKey: "name",
      header: "Khách hàng",
      size: 280,
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.name}</div>
          {row.original.phone && (
            <div className="text-xs text-muted-foreground">
              {row.original.phone}
            </div>
          )}
        </div>
      ),
    },
    {
      accessorKey: "currentDebt",
      header: "Công nợ hiện tại",
      size: 160,
      cell: ({ row }) => (
        <span className="font-semibold text-destructive">
          {formatCurrency(row.original.currentDebt ?? 0)}
        </span>
      ),
    },
    {
      accessorKey: "totalSales",
      header: "Tổng đã mua",
      size: 160,
      cell: ({ row }) => formatCurrency(row.original.totalSales ?? 0),
    },
    {
      accessorKey: "groupName",
      header: "Nhóm",
      size: 140,
      cell: ({ row }) => row.original.groupName ?? "—",
    },
    // CEO 03/06 — Công nợ C1: nút "Thanh toán". CEO 06/06 — thêm "Xem chi tiết"
    // (anh báo: "chưa xem được chi tiết công nợ là khách đó đang nợ đơn gì").
    {
      id: "debt_actions",
      header: "Thao tác",
      size: 220,
      enableSorting: false,
      cell: ({ row }) => {
        const debt = row.original.currentDebt ?? 0;
        return (
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs gap-1"
              onClick={() =>
                setDetailTarget({
                  mode: "customer",
                  partyId: row.original.id,
                  partyName: row.original.name,
                  partyCode: row.original.code,
                  estimatedDebt: debt,
                })
              }
              title="Xem chi tiết HĐ đang nợ"
            >
              <Icon name="visibility" size={14} />
              Xem
            </Button>
            {debt > 0 ? (
              <Button
                size="sm"
                variant="default"
                className="h-7 px-2 text-xs gap-1"
                onClick={() =>
                  setSettleTarget({
                    mode: "customer",
                    partyId: row.original.id,
                    partyName: row.original.name,
                    estimatedDebt: debt,
                  })
                }
              >
                <Icon name="payments" size={14} />
                Thu
              </Button>
            ) : (
              <span className="text-[11px] text-muted-foreground italic">đã trả đủ</span>
            )}
          </div>
        );
      },
    },
  ];

  const supplierColumns: ColumnDef<Supplier, unknown>[] = [
    {
      accessorKey: "code",
      header: "Mã NCC",
      size: 130,
      cell: ({ row }) => (
        <span className="font-mono text-primary">{row.original.code}</span>
      ),
    },
    {
      accessorKey: "name",
      header: "Nhà cung cấp",
      size: 280,
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.name}</div>
          {row.original.phone && (
            <div className="text-xs text-muted-foreground">
              {row.original.phone}
            </div>
          )}
        </div>
      ),
    },
    {
      accessorKey: "currentDebt",
      header: "Cần trả NCC",
      size: 160,
      cell: ({ row }) => (
        <span className="font-semibold text-status-warning">
          {formatCurrency(row.original.currentDebt ?? 0)}
        </span>
      ),
    },
    {
      accessorKey: "totalPurchases",
      header: "Tổng đã nhập",
      size: 160,
      cell: ({ row }) => formatCurrency(row.original.totalPurchases ?? 0),
    },
    // CEO 03/06 — Trả nợ NCC. CEO 06/06 — thêm "Xem chi tiết PO đang nợ".
    {
      id: "debt_actions",
      header: "Thao tác",
      size: 220,
      enableSorting: false,
      cell: ({ row }) => {
        const debt = row.original.currentDebt ?? 0;
        return (
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-2 text-xs gap-1"
              onClick={() =>
                setDetailTarget({
                  mode: "supplier",
                  partyId: row.original.id,
                  partyName: row.original.name,
                  partyCode: row.original.code,
                  estimatedDebt: debt,
                })
              }
              title="Xem chi tiết PO đang nợ"
            >
              <Icon name="visibility" size={14} />
              Xem
            </Button>
            {debt > 0 ? (
              <Button
                size="sm"
                variant="default"
                className="h-7 px-2 text-xs gap-1 bg-status-warning hover:bg-status-warning/90"
                onClick={() =>
                  setSettleTarget({
                    mode: "supplier",
                    partyId: row.original.id,
                    partyName: row.original.name,
                    estimatedDebt: debt,
                  })
                }
              >
                <Icon name="account_balance_wallet" size={14} />
                Trả
              </Button>
            ) : (
              <span className="text-[11px] text-muted-foreground italic">đã trả đủ</span>
            )}
          </div>
        );
      },
    },
  ];

  const debtorColumns: ColumnDef<DebtorDetail, unknown>[] = [
    {
      accessorKey: "code",
      header: "Mã",
      size: 120,
      cell: ({ row }) => (
        <span className="font-mono text-primary text-xs">
          {row.original.code}
        </span>
      ),
    },
    {
      accessorKey: "name",
      header: "Tên",
      size: 220,
      cell: ({ row }) => (
        <span className="font-medium text-sm">{row.original.name}</span>
      ),
    },
    {
      accessorKey: "debt",
      header: "Công nợ",
      size: 140,
      cell: ({ row }) => (
        <span className="font-semibold text-destructive">
          {formatCurrency(row.original.debt)}
        </span>
      ),
    },
    {
      accessorKey: "ageDays",
      header: "Tuổi nợ",
      size: 100,
      cell: ({ row }) => {
        const days = row.original.ageDays;
        const color =
          days > 90
            ? "text-status-error"
            : days > 60
              ? "text-status-warning"
              : days > 30
                ? "text-status-warning"
                : "text-status-success";
        return (
          <span className={`font-medium text-sm ${color}`}>{days} ngày</span>
        );
      },
    },
    {
      accessorKey: "bucket",
      header: "Nhóm",
      size: 110,
      cell: ({ row }) => (
        <span