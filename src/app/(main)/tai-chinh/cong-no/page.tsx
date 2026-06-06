"use client";

/**
 * Công nợ — 3 tabs:
 *   - Khách hàng còn nợ (debt > 0)
 *   - Nhà cung cấp còn nợ
 *   - Phân tích tuổi nợ (Aging Report) — Sprint 7
 */

import { useEffect, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/lib/contexts";
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

const BUCKET_COLORS = [
  "border-status-success/25 bg-status-success/10",
  "border-status-warning/25 bg-status-warning/10",
  "border-status-warning/25 bg-status-warning/10",
  "border-status-error/25 bg-status-error/10",
];

const BUCKET_TEXT_COLORS = [
  "text-status-success",
  "text-status-warning",
  "text-status-warning",
  "text-status-error",
];

export default function CongNoPage() {
  const { toast } = useToast();
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
    setLoading(true);
    try {
      // Luôn fetch tổng KPI (cả KH + NCC) song song với data tab.
      const totalsPromise = getDebtTotals().catch(() => ({
        customerDebtTotal: 0,
        customerCount: 0,
        supplierDebtTotal: 0,
        supplierCount: 0,
      }));

      if (mode === "customer") {
        const [result, totals] = await Promise.all([
          getCustomers({
            page: 0,
            pageSize: 200,
            search,
            filters: { debt: "has_debt" },
          }),
          totalsPromise,
        ]);
        setCustomers(result.data);
        setDebtTotals(totals);
      } else if (mode === "supplier") {
        const [result, totals] = await Promise.all([
          getSuppliers({
            page: 0,
            pageSize: 200,
            search,
            filters: { debt: "has_debt" },
          }),
          totalsPromise,
        ]);
        setSuppliers(result.data);
        setDebtTotals(totals);
      } else if (mode === "aging") {
        setAgingLoading(true);
        const [agingRes, debtorsRes, totals] = await Promise.all([
          getDebtAging(),
          getTopDebtors(20),
          totalsPromise,
        ]);
        setAging(agingRes);
        setTopDebtors(debtorsRes);
        setDebtTotals(totals);
        setAgingLoading(false);
      }
    } catch (err) {
      toast({
        title: "Lỗi tải công nợ",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [mode, search, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // KPI dùng totals từ DB (chính xác mọi mode) thay vì reduce client state.
  const totalCustomerDebt = debtTotals.customerDebtTotal;
  const totalSupplierDebt = debtTotals.supplierDebtTotal;
  const customerDebtCount = debtTotals.customerCount;
  const supplierDebtCount = debtTotals.supplierCount;

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
      id: "actions",
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
      id: "actions",
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
      accessorKey: "type",
      header: "Loại",
      size: 80,
      cell: ({ row }) => (
        <Badge
          variant="secondary"
          className={
            row.original.type === "customer"
              ? "bg-primary-fixed text-primary"
              : "bg-status-warning/10 text-status-warning"
          }
        >
          {row.original.type === "customer" ? "KH" : "NCC"}
        </Badge>
      ),
    },
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
        <span className="text-xs text-muted-foreground">
          {row.original.bucket}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col h-[calc(100vh-64px)]">
      <PageHeader
        title="Công nợ"
        searchPlaceholder={
          mode === "customer"
            ? "Theo mã, tên KH, SĐT..."
            : mode === "supplier"
              ? "Theo mã, tên NCC..."
              : "Tìm kiếm..."
        }
        searchValue={search}
        onSearchChange={setSearch}
        actions={[
          {
            label: "Tải mẫu công nợ đầu kỳ",
            icon: <Icon name="description" size={16} />,
            variant: "ghost",
            onClick: () => downloadTemplate(debtOpeningExcelSchema),
          },
          {
            label: "Nhập công nợ đầu kỳ",
            icon: <Icon name="upload" size={16} />,
            onClick: () => setImportOpen(true),
          },
        ]}
        onExport={mode !== "aging" ? {
          excel: () => {
            // Xuất theo schema "Công nợ đầu kỳ" → import lại không mất field
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
                { header: "Mã KH", key: "code", width: 15 },
                { header: "Tên KH", key: "name", width: 25 },
                { header: "SĐT", key: "phone", width: 15 },
                { header: "Công nợ", key: "currentDebt", width: 18, format: (v: number) => v },
                { header: "Tổng mua", key: "totalSales", width: 18, format: (v: number) => v },
              ];
              exportToCsv(customers, cols, "cong-no-khach-hang");
            } else {
              const cols = [
                { header: "Mã NCC", key: "code", width: 15 },
                { header: "Tên NCC", key: "name", width: 25 },
                { header: "Cần trả NCC", key: "currentDebt", width: 18, format: (v: number) => v },
                { header: "Tổng nhập", key: "totalPurchases", width: 18, format: (v: number) => v },
              ];
              exportToCsv(suppliers, cols, "cong-no-nha-cung-cap");
            }
          },
        } : undefined}
      />

      {/* Summary — luôn show tổng cả KH + NCC bất kể tab nào */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 px-4 pt-4">
        <SummaryCard
          icon={<Icon name="trending_up" size={16} className="text-status-success" />}
          label="Khách hàng đang nợ"
          count={customerDebtCount}
          value={formatCurrency(totalCustomerDebt)}
          tone="success"
        />
        <SummaryCard
          icon={<Icon name="trending_down" size={16} className="text-status-warning" />}
          label="Phải trả NCC"
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
        <TabsList>
          <TabsTrigger value="customer" className="gap-2">
            <Icon name="group" size={16} />
            KH còn nợ ({customerDebtCount})
          </TabsTrigger>
          <TabsTrigger value="supplier" className="gap-2">
            <Icon name="local_shipping" size={16} />
            NCC ({supplierDebtCount})
          </TabsTrigger>
          <TabsTrigger value="aging" className="gap-2">
            <Icon name="bar_chart" size={16} />
            Phân tích tuổi nợ
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
                // Master KH — gắn kind invoice (gần nhất, vì debt từ invoice).
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

        <TabsContent value="aging" className="flex-1 min-h-0 space-y-4 overflow-auto pb-4">
          {agingLoading || !aging ? (
            <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
              Đang tải phân tích...
            </div>
          ) : (
            <>
              {/* Aging summary row */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <Card className="border-primary-fixed bg-primary-fixed/50">
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground">Tổng công nợ</p>
                    <p className="text-xl font-bold text-primary">
                      {formatCurrency(aging.totalDebt)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {aging.customersWithDebt} KH + {aging.suppliersWithDebt} NCC
                    </p>
                  </CardContent>
                </Card>
                <Card className="border-status-success/25 bg-status-success/10">
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground">KH đang nợ</p>
                    <p className="text-xl font-bold text-status-success">
                      {formatCurrency(aging.totalCustomerDebt)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {aging.customersWithDebt} khách hàng
                    </p>
                  </CardContent>
                </Card>
                <Card className="border-status-warning/25 bg-status-warning/10">
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground">Phải trả NCC</p>
                    <p className="text-xl font-bold text-status-warning">
                      {formatCurrency(aging.totalSupplierDebt)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      {aging.suppliersWithDebt} nhà cung cấp
                    </p>
                  </CardContent>
                </Card>
              </div>

              {/* Aging buckets */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Icon name="bar_chart" size={16} />
                    Phân tích theo tuổi nợ
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                    {aging.buckets.map((bucket, idx) => (
                      <div
                        key={bucket.range}
                        className={`border rounded-lg p-3 ${BUCKET_COLORS[idx]}`}
                      >
                        <div className="flex items-center gap-2 mb-2">
                          {idx >= 2 && (
                            <Icon name="warning"
                              className={`h-3.5 w-3.5 ${BUCKET_TEXT_COLORS[idx]}`}
                            />
                          )}
                          <span
                            className={`text-xs font-semibold ${BUCKET_TEXT_COLORS[idx]}`}
                          >
                            {bucket.label}
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mb-1">
                          {bucket.range}
                        </p>
                        <p
                          className={`text-lg font-bold ${BUCKET_TEXT_COLORS[idx]}`}
                        >
                          {formatCurrency(bucket.totalAmount)}
                        </p>
                        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                          <span>KH: {bucket.customerCount} ({formatCurrency(bucket.customerAmount)})</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          <span>NCC: {bucket.supplierCount} ({formatCurrency(bucket.supplierAmount)})</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>

              {/* Top debtors table */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">
                    Top đối tượng nợ cao nhất
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <DataTable
                    columns={debtorColumns}
                    data={topDebtors}
                    loading={false}
                    total={topDebtors.length}
                    pageIndex={0}
                    pageSize={50}
                    pageCount={1}
                    onPageChange={() => {}}
                    onPageSizeChange={() => {}}
                    getRowId={(r) => r.id}
                  />
                </CardContent>
              </Card>
            </>
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
            title: "Nhập công nợ đầu kỳ hoàn tất",
            description:
              "Số dư nợ đầu kỳ đã được cập nhật cho các đối tượng KH/NCC.",
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

      {/* CEO 03/06/2026 — Sprint 3 (Công nợ C1+C2): Dialog Thanh toán per-row.
          Sau khi pay xong → refetch tổng + list cho KPI và bảng cập nhật. */}
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

      {/* CEO 06/06/2026: dialog "Xem chi tiết công nợ" read-only */}
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
        <span className="ml-auto text-xs font-medium">{count} đối tượng</span>
      </div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
