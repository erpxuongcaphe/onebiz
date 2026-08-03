
"use client";

/**
 * CÃ´ng ná»£ â€” 3 tabs:
 *   - KhÃ¡ch hÃ ng cÃ²n ná»£ (debt > 0)
 *   - NhÃ  cung cáº¥p cÃ²n ná»£
 *   - PhÃ¢n tÃ­ch tuá»•i ná»£ (Aging Report) â€” Sprint 7
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
      () => reject(new Error("Dá»¯ liá»‡u pháº£n há»“i quÃ¡ cháº­m. Vui lÃ²ng thá»­ láº¡i.")),
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

  // KPI summary â€” fetch tá»•ng cáº£ 2 (KH + NCC) báº¥t ká»ƒ Ä‘ang á»Ÿ tab nÃ o.
  // TrÆ°á»›c Ä‘Ã¢y tá»•ng tÃ­nh tá»« customers/suppliers state â€” nhÆ°ng state chá»‰
  // cÃ³ data cá»§a tab hiá»‡n táº¡i â†’ KPI tab khÃ´ng pháº£i hiá»ƒn thá»‹ 0 (sai).
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

  // CEO 03/06/2026 â€” Sprint 3 (CÃ´ng ná»£ C1+C2): Settle debt dialog per-row.
  // Má»—i KH + má»—i NCC cÃ³ nÃºt "Thanh toÃ¡n" â†’ má»Ÿ dialog auto-allocate FIFO.
  const [settleTarget, setSettleTarget] = useState<{
    mode: "customer" | "supplier";
    partyId: string;
    partyName: string;
    estimatedDebt: number;
  } | null>(null);
  // CEO 06/06/2026 â€” sau khi anh bÃ¡o "chÆ°a xem Ä‘Æ°á»£c chi tiáº¿t Ä‘Æ¡n ná»£":
  // dialog read-only xem list HD/PO cá»§a KH/NCC Ä‘ang ná»£.
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
      // LuÃ´n fetch tá»•ng KPI (cáº£ KH + NCC) song song vá»›i data tab.
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
        title: "Lá»—i táº£i cÃ´ng ná»£",
        description: err instanceof Error ? err.message : "Vui lÃ²ng thá»­ láº¡i",
        variant: "error",
      });
      if (mode === "aging") {
        setAgingError(
          err instanceof Error ? err.message : "KhÃ´ng thá»ƒ táº£i phÃ¢n tÃ­ch tuá»•i ná»£",
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

  // KPI dÃ¹ng totals tá»« DB (chÃ­nh xÃ¡c má»i mode) thay vÃ¬ reduce client state.
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
      header: "MÃ£ KH",
      size: 130,
      cell: ({ row }) => (
        <span className="font-mono text-primary">{row.original.code}</span>
      ),
    },
    {
      accessorKey: "name",
      header: "KhÃ¡ch hÃ ng",
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
      header: "CÃ´ng ná»£ hiá»‡n táº¡i",
      size: 160,
      cell: ({ row }) => (
        <span className="font-semibold text-destructive">
          {formatCurrency(row.original.currentDebt ?? 0)}
        </span>
      ),
    },
    {
      accessorKey: "totalSales",
      header: "Tá»•ng Ä‘Ã£ mua",
      size: 160,
      cell: ({ row }) => formatCurrency(row.original.totalSales ?? 0),
    },
    {
      accessorKey: "groupName",
      header: "NhÃ³m",
      size: 140,
      cell: ({ row }) => row.original.groupName ?? "â€”",
    },
    // CEO 03/06 â€” CÃ´ng ná»£ C1: nÃºt "Thanh toÃ¡n". CEO 06/06 â€” thÃªm "Xem chi tiáº¿t"
    // (anh bÃ¡o: "chÆ°a xem Ä‘Æ°á»£c chi tiáº¿t cÃ´ng ná»£ lÃ  khÃ¡ch Ä‘Ã³ Ä‘ang ná»£ Ä‘Æ¡n gÃ¬").
    {
      id: "debt_actions",
      header: "Thao tÃ¡c",
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
              title="Xem chi tiáº¿t HÄ Ä‘ang ná»£"
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
              <span className="text-[11px] text-muted-foreground italic">Ä‘Ã£ tráº£ Ä‘á»§</span>
            )}
          </div>
        );
      },
    },
  ];

  const supplierColumns: ColumnDef<Supplier, unknown>[] = [
    {
      accessorKey: "code",
      header: "MÃ£ NCC",
      size: 130,
      cell: ({ row }) => (
        <span className="font-mono text-primary">{row.original.code}</span>
      ),
    },
    {
      accessorKey: "name",
      header: "NhÃ  cung cáº¥p",
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
      header: "Cáº§n tráº£ NCC",
      size: 160,
      cell: ({ row }) => (
        <span className="font-semibold text-status-warning">
          {formatCurrency(row.original.currentDebt ?? 0)}
        </span>
      ),
    },
    {
      accessorKey: "totalPurchases",
      header: "Tá»•ng Ä‘Ã£ nháº­p",
      size: 160,
      cell: ({ row }) => formatCurrency(row.original.totalPurchases ?? 0),
    },
    // CEO 03/06 â€” Tráº£ ná»£ NCC. CEO 06/06 â€” thÃªm "Xem chi tiáº¿t PO Ä‘ang ná»£".
    {
      id: "debt_actions",
      header: "Thao tÃ¡c",
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
              title="Xem chi tiáº¿t PO Ä‘ang ná»£"
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
                Tráº£
              </Button>
            ) : (
              <span className="text-[11px] text-muted-foreground italic">Ä‘Ã£ tráº£ Ä‘á»§</span>
            )}
          </div>
        );
      },
    },
  ];

  const debtorColumns: ColumnDef<DebtorDetail, unknown>[] = [
    {
      accessorKey: "code",
      header: "MÃ£",
      size: 120,
      cell: ({ row }) => (
        <span className="font-mono text-primary text-xs">
          {row.original.code}
        </span>
      ),
    },
    {
      accessorKey: "name",
      header: "TÃªn",
      size: 220,
      cell: ({ row }) => (
        <span className="font-medium text-sm">{row.original.name}</span>
      ),
    },
    {
      accessorKey: "debt",
      header: "CÃ´ng ná»£",
      size: 140,
      cell: ({ row }) => (
        <span className="font-semibold text-destructive">
          {formatCurrency(row.original.debt)}
        </span>
      ),
    },
    {
      accessorKey: "ageDays",
      header: "Tuá»•i ná»£",
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
          <span className={`font-medium text-sm ${color}`}>{days} ngÃ y</span>
        );
      },
    },
    {
      accessorKey: "bucket",
      header: "NhÃ³m",
      size: 110,
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground">
          {row.original.bucket}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <PageHeader
        title="CÃ´ng ná»£"
        searchPlaceholder={
          mode === "customer"
            ? "Theo mÃ£, tÃªn KH, SÄT..."
            : mode === "supplier"
              ? "Theo mÃ£, tÃªn NCC..."
              : "TÃ¬m kiáº¿m..."
        }
        searchValue={search}
        onSearchChange={setSearch}
        actions={[
          {
            label: "Táº£i máº«u cÃ´ng ná»£ Ä‘áº§u ká»³",
            icon: <Icon name="description" size={16} />,
            variant: "ghost",
            onClick: () => downloadTemplate(debtOpeningExcelSchema),
          },
          {
            label: "Nháº­p cÃ´ng ná»£ Ä‘áº§u ká»³",
            icon: <Icon name="upload" size={16} />,
            onClick: () => setImportOpen(true),
          },
        ]}
        onExport={mode !== "aging" ? {
          excel: () => {
            // Xuáº¥t theo schema "CÃ´ng ná»£ Ä‘áº§u ká»³" â†’ import láº¡i khÃ´ng máº¥t field
            const today = new Date();
            const rows: DebtOpeningImportRow[] =
              mode === "customer"
                ? customers
                    .filter((c) => c.currentDebt !== 0)
                    .map((c) => ({
                      partyType: "customer",
                      partyCode: c.code,
                      partyName: c.name,
                      openingDebt: c.currentDebt,
                      openingDate: today,
                    }))
                : suppliers
                    .filter((s) => s.currentDebt !== 0)
                    .map((s) => ({
                      partyType: "supplier",
                      partyCode: s.code,
                      partyName: s.name,
                      openingDebt: s.currentDebt,
                      openingDate: today,
                    }));
            exportToExcelFromSchema(rows, debtOpeningExcelSchema);
          },
          csv: () => {
            if (mode === "customer") {
              const cols = [
                { header: "MÃ£ KH", key: "code", width: 15 },
                { header: "TÃªn KH", key: "name", width: 25 },
                { header: "SÄT", key: "phone", width: 15 },
                { header: "CÃ´ng ná»£", key: "currentDebt", width: 18, format: (v: number) => v },
                { header: "Tá»•ng mua", key: "totalSales", width: 18, format: (v: number) => v },
              ];
              exportToCsv(customers, cols, "cong-no-khach-hang");
            } else {
              const cols = [
                { header: "MÃ£ NCC", key: "code", width: 15 },
                { header: "TÃªn NCC", key: "name", width: 25 },
                { header: "Cáº§n tráº£ NCC", key: "currentDebt", width: 18, format: (v: number) => v },
                { header: "Tá»•ng nháº­p", key: "totalPurchases", width: 18, format: (v: number) => v },
              ];
              exportToCsv(suppliers, cols, "cong-no-nha-cung-cap");
            }
          },
        } : undefined}
      />

      <div className="mx-4 mt-3 flex items-center gap-2 rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
        <Icon name="location_on" size={15} />
        <span>
          Pháº¡m vi sá»‘ liá»‡u:{" "}
          <strong className="text-foreground">{branchLabel}</strong>
        </span>
      </div>
      {/* Summary â€” luÃ´n show tá»•ng cáº£ KH + NCC báº¥t ká»ƒ tab nÃ o */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 px-4 pt-4">
        <SummaryCard
          icon={<Icon name="trending_up" size={16} className="text-status-success" />}
          label="KhÃ¡ch hÃ ng Ä‘ang ná»£"
          count={customerDebtCount}
          value={formatCurrency(totalCustomerDebt)}
          tone="success"
        />
        <SummaryCard
          icon={<Icon name="trending_down" size={16} className="text-status-warning" />}
          label="Pháº£i tráº£ NCC"
          count={supplierDebtCount}
          value={formatCurrency(totalSupplierDebt)}
          tone="warning"
        />
      </div>

      <Tabs
        value={mode}
        onValueChange={(v) => setMode(v as Mode)}
        className="px-4 pt-4 flex-1 flex flex-col min-h-0"
      >
        <TabsList className="grid w-full grid-cols-3 sm:flex sm:w-fit">
          <TabsTrigger value="customer" className="min-w-0 gap-1 px-2 sm:gap-2 sm:px-3">
            <Icon name="group" size={16} className="shrink-0" />
            <span className="sm:hidden">Pháº£i thu</span>
            <span className="hidden sm:inline">KH cÃ²n ná»£ ({customerDebtCount})</span>
          </TabsTrigger>
          <TabsTrigger value="supplier" className="min-w-0 gap-1 px-2 sm:gap-2 sm:px-3">
            <Icon name="local_shipping" size={16} className="shrink-0" />
            <span className="sm:hidden">Pháº£i tráº£</span>
            <span className="hidden sm:inline">NCC ({supplierDebtCount})</span>
          </TabsTrigger>
          <TabsTrigger value="aging" className="min-w-0 gap-1 px-2 sm:gap-2 sm:px-3">
            <Icon name="bar_chart" size={16} className="shrink-0" />
            <span className="sm:hidden">Tuá»•i ná»£</span>
            <span className="hidden sm:inline">PhÃ¢n tÃ­ch tuá»•i ná»£</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="customer" className="flex-1 min-h-0">
          <DataTable
            columns={customerColumns}
            data={customers}
            loading={loading}
            total={customers.length}
            pageIndex={0}
            pageSize={50}
            pageCount={1}
            onPageChange={() => {}}
            onPageSizeChange={() => {}}
            getRowId={(r) => r.id}
            rowActions={(row) =>
              buildTransactionRowActions({
                row,
                // Master KH â€” gáº¯n kind invoice (gáº§n nháº¥t, vÃ¬ debt tá»« invoice).
                kind: "invoice",
                onAuditLog: () =>
                  setAuditDialogTarget({
                    type: "customer",
                    id: row.id,
                    code: row.code,
                  }),
              })
            }
          />
        </TabsContent>

        <TabsContent value="supplier" className="flex-1 min-h-0">
          <DataTable
            columns={supplierColumns}
            data={suppliers}
            loading={loading}
            total={suppliers.length}
            pageIndex={0}
            pageSize={50}
            pageCount={1}
            onPageChange={() => {}}
            onPageSizeChange={() => {}}
            getRowId={(r) => r.id}
            rowActions={(row) =>
              buildTransactionRowActions({
                row,
                kind: "purchase_order",
                onAuditLog: () =>
                  setAuditDialogTarget({
                    type: "supplier",
                    id: row.id,
                    code: row.code,
                  }),
              })
            }
          />
        </TabsContent>

        <TabsContent value="aging" className="flex-1 min-h-0 overflow-auto pb-4">
          {agingLoading ? (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
              Äang táº£i phÃ¢n tÃ­ch...
            </div>
          ) : agingError ? (
            <div className="flex h-40 flex-col items-center justify-center gap-3 rounded-md border border-dashed text-center">
              <div>
                <p className="text-sm font-medium">KhÃ´ng táº£i Ä‘Æ°á»£c phÃ¢n tÃ­ch tuá»•i ná»£</p>
                <p className="mt-1 text-xs text-muted-foreground">{agingError}</p>
              </div>
              <Button size="sm" variant="outline" onClick={fetchData}>
                <Icon name="refresh" size={15} />
                Thá»­ láº¡i
              </Button>
            </div>
          ) : !aging ? (
            <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">
              ChÆ°a cÃ³ dá»¯ liá»‡u tuá»•i ná»£
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
              <section className="min-w-0 overflow-hidden rounded-md border bg-background">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Icon name="trending_up" size={16} className="text-status-success" />
                      <h3 className="text-sm font-semibold">Pháº£i thu khÃ¡ch hÃ ng</h3>
                    </div>
                    <p className="mt-1 text-xl font-bold text-status-success">
                      {formatCurrency(aging.totalCustomerDebt)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {aging.customersWithDebt} khÃ¡ch hÃ ng cÃ²n ná»£
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() =>
                      exportToCsv(
                        receivableDebtors,
                        [
                          { header: "MÃ£ KH", key: "code", width: 14 },
                          { header: "TÃªn khÃ¡ch hÃ ng", key: "name", width: 28 },
                          { header: "SÄT", key: "phone", width: 16 },
                          { header: "Pháº£i thu", key: "debt", width: 18 },
                          { header: "Tuá»•i ná»£ (ngÃ y)", key: "ageDays", width: 16 },
                          { header: "NhÃ³m tuá»•i ná»£", key: "bucket", width: 16 },
                        ],
                        "tuoi-no-phai-thu",
                      )
                    }
                  >
                    <Icon name="download" size={15} />
                    Xuáº¥t pháº£i thu
                  </Button>
                </div>

                <div className="grid grid-cols-1 border-b sm:grid-cols-2">
                  {aging.buckets.map((bucket, idx) => (
                    <div
                      key={`receivable-${bucket.range}`}
                      className="flex items-center justify-between gap-3 border-b px-4 py-2.5 sm:odd:border-r sm:[&:nth-last-child(-n+2)]:border-b-0"
                    >
                      <div>
                        <p className={`text-xs font-semibold ${BUCKET_TEXT_COLORS[idx]}`}>
                          {bucket.range}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {bucket.customerCount} khÃ¡ch hÃ ng
                        </p>
                      </div>
                      <span className="text-sm font-semibold tabular-nums">
                        {formatCurrency(bucket.customerAmount)}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="p-3">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                    KhÃ¡ch hÃ ng cáº§n thu
                  </p>
                  <DataTable
                    columns={debtorColumns}
                    data={receivableDebtors}
                    loading={false}
                    total={receivableDebtors.length}
                    pageIndex={0}
                    pageSize={20}
                    pageCount={1}
                    onPageChange={() => {}}
                    onPageSizeChange={() => {}}
                    getRowId={(row) => `customer-${row.id}`}
                  />
                </div>
              </section>

              <section className="min-w-0 overflow-hidden rounded-md border bg-background">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b px-4 py-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <Icon name="trending_down" size={16} className="text-status-warning" />
                      <h3 className="text-sm font-semibold">Pháº£i tráº£ nhÃ  cung cáº¥p</h3>
                    </div>
                    <p className="mt-1 text-xl font-bold text-status-warning">
                      {formatCurrency(aging.totalSupplierDebt)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {aging.suppliersWithDebt} nhÃ  cung cáº¥p cÃ²n ná»£
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() =>
                      exportToCsv(
                        payableDebtors,
                        [
                          { header: "MÃ£ NCC", key: "code", width: 14 },
                          { header: "TÃªn nhÃ  cung cáº¥p", key: "name", width: 28 },
                          { header: "SÄT", key: "phone", width: 16 },
                          { header: "Pháº£i tráº£", key: "debt", width: 18 },
                          { header: "Tuá»•i ná»£ (ngÃ y)", key: "ageDays", width: 16 },
                          { header: "NhÃ³m tuá»•i ná»£", key: "bucket", width: 16 },
                        ],
                        "tuoi-no-phai-tra",
                      )
                    }
                  >
                    <Icon name="download" size={15} />
                    Xuáº¥t pháº£i tráº£
                  </Button>
                </div>

                <div className="grid grid-cols-1 border-b sm:grid-cols-2">
                  {aging.buckets.map((bucket, idx) => (
                    <div
                      key={`payable-${bucket.range}`}
                      className="flex items-center justify-between gap-3 border-b px-4 py-2.5 sm:odd:border-r sm:[&:nth-last-child(-n+2)]:border-b-0"
                    >
                      <div>
                        <p className={`text-xs font-semibold ${BUCKET_TEXT_COLORS[idx]}`}>
                          {bucket.range}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {bucket.supplierCount} nhÃ  cung cáº¥p
                        </p>
                      </div>
                      <span className="text-sm font-semibold tabular-nums">
                        {formatCurrency(bucket.supplierAmount)}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="p-3">
                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                    NhÃ  cung cáº¥p cáº§n tráº£
                  </p>
                  <DataTable
                    columns={debtorColumns}
                    data={payableDebtors}
                    loading={false}
                    total={payableDebtors.length}
                    pageIndex={0}
                    pageSize={20}
                    pageCount={1}
                    onPageChange={() => {}}
                    onPageSizeChange={() => {}}
                    getRowId={(row) => `supplier-${row.id}`}
                  />
                </div>
              </section>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <ImportExcelDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        schema={debtOpeningExcelSchema}
        onCommit={bulkImportDebtOpening}
        onFinished={() => {
          fetchData();
          toast({
            title: "Nháº­p cÃ´ng ná»£ Ä‘áº§u ká»³ hoÃ n táº¥t",
            description:
              "Sá»‘ dÆ° Ä‘áº§u ká»³ Ä‘Ã£ Ä‘Æ°á»£c cáº­p nháº­t cho khÃ¡ch hÃ ng/nhÃ  cung cáº¥p táº¡i chi nhÃ¡nh Ä‘ang chá»n.",
            variant: "success",
          });
        }}
      />

      {auditDialogTarget && (
        <AuditLogDialog
          entityType={auditDialogTarget.type}
          entityId={auditDialogTarget.id}
          entityCode={auditDialogTarget.code}
          onClose={() => setAuditDialogTarget(null)}
        />
      )}

      {/* CEO 03/06/2026 â€” Sprint 3 (CÃ´ng ná»£ C1+C2): Dialog Thanh toÃ¡n per-row.
          Sau khi pay xong â†’ refetch tá»•ng + list cho KPI vÃ  báº£ng cáº­p nháº­t. */}
      {settleTarget && (
        <SettleDebtDialog
          open={!!settleTarget}
          onOpenChange={(o) => !o && setSettleTarget(null)}
          mode={settleTarget.mode}
          partyId={settleTarget.partyId}
          partyName={settleTarget.partyName}
          estimatedDebt={settleTarget.estimatedDebt}
          onSuccess={() => {
            setSettleTarget(null);
            fetchData();
          }}
        />
      )}

      {/* CEO 06/06/2026: dialog "Xem chi tiáº¿t cÃ´ng ná»£" read-only */}
      {detailTarget && (
        <DebtDetailDialog
          open={!!detailTarget}
          onOpenChange={(o) => !o && setDetailTarget(null)}
          mode={detailTarget.mode}
          partyId={detailTarget.partyId}
          partyName={detailTarget.partyName}
          partyCode={detailTarget.partyCode}
          estimatedDebt={detailTarget.estimatedDebt}
        />
      )}
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  count,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  value: string;
  tone: "success" | "warning";
}) {
  const accent =
    tone === "success"
      ? "border-status-success/25 bg-status-success/10"
      : "border-status-warning/25 bg-status-warning/10";
  return (
    <div className={`border rounded-lg p-3 ${accent}`}>
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
        {icon}
        <span>{label}</span>
        <span className="ml-auto text-xs font-medium">{count} Ä‘á»‘i tÆ°á»£ng</span>
      </div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}

