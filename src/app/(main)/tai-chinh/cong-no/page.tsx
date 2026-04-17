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
import { exportToExcel, exportToCsv } from "@/lib/utils/export";
import { getCustomers, getSuppliers } from "@/lib/services";
import { getDebtAging, getTopDebtors } from "@/lib/services/supabase/debt";
import type { Customer, Supplier } from "@/lib/types";
import type { DebtAgingReport, DebtorDetail } from "@/lib/services/supabase/debt";
import { Icon } from "@/components/ui/icon";

type Mode = "customer" | "supplier" | "aging";

const BUCKET_COLORS = [
  "border-emerald-200 bg-emerald-50/50",
  "border-amber-200 bg-amber-50/50",
  "border-orange-200 bg-orange-50/50",
  "border-red-200 bg-red-50/50",
];

const BUCKET_TEXT_COLORS = [
  "text-emerald-700",
  "text-amber-700",
  "text-orange-700",
  "text-red-700",
];

export default function CongNoPage() {
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>("customer");
  const [search, setSearch] = useState("");

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);

  // Aging data
  const [aging, setAging] = useState<DebtAgingReport | null>(null);
  const [topDebtors, setTopDebtors] = useState<DebtorDetail[]>([]);
  const [agingLoading, setAgingLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      if (mode === "customer") {
        const result = await getCustomers({
          page: 0,
          pageSize: 200,
          search,
          filters: { debt: "has_debt" },
        });
        setCustomers(result.data);
      } else if (mode === "supplier") {
        const result = await getSuppliers({
          page: 0,
          pageSize: 200,
          search,
          filters: { debt: "has_debt" },
        });
        setSuppliers(result.data);
      } else if (mode === "aging") {
        setAgingLoading(true);
        const [agingRes, debtorsRes] = await Promise.all([
          getDebtAging(),
          getTopDebtors(20),
        ]);
        setAging(agingRes);
        setTopDebtors(debtorsRes);
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

  const totalCustomerDebt = customers.reduce(
    (s, c) => s + (c.currentDebt ?? 0),
    0
  );
  const totalSupplierDebt = suppliers.reduce(
    (s, p) => s + (p.currentDebt ?? 0),
    0
  );

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
        <span className="font-semibold text-amber-600">
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
              ? "bg-blue-100 text-blue-800"
              : "bg-amber-100 text-amber-800"
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
            ? "text-red-600"
            : days > 60
              ? "text-orange-600"
              : days > 30
                ? "text-amber-600"
                : "text-emerald-600";
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
    <div className="flex flex-col h-[calc(100vh-48px)]">
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
        onExport={mode !== "aging" ? {
          excel: () => {
            if (mode === "customer") {
              const cols = [
                { header: "Mã KH", key: "code", width: 15 },
                { header: "Tên KH", key: "name", width: 25 },
                { header: "SĐT", key: "phone", width: 15 },
                { header: "Công nợ", key: "currentDebt", width: 18, format: (v: number) => v },
                { header: "Tổng mua", key: "totalSales", width: 18, format: (v: number) => v },
                { header: "Nhóm", key: "groupName", width: 15 },
              ];
              exportToExcel(customers, cols, "cong-no-khach-hang");
            } else {
              const cols = [
                { header: "Mã NCC", key: "code", width: 15 },
                { header: "Tên NCC", key: "name", width: 25 },
                { header: "SĐT", key: "phone", width: 15 },
                { header: "Cần trả NCC", key: "currentDebt", width: 18, format: (v: number) => v },
                { header: "Tổng nhập", key: "totalPurchases", width: 18, format: (v: number) => v },
              ];
              exportToExcel(suppliers, cols, "cong-no-nha-cung-cap");
            }
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

      {/* Summary */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 px-4 pt-4">
        <SummaryCard
          icon={<Icon name="trending_up" size={16} className="text-emerald-600" />}
          label="Khách hàng đang nợ"
          count={customers.length}
          value={formatCurrency(totalCustomerDebt)}
          tone="success"
        />
        <SummaryCard
          icon={<Icon name="trending_down" size={16} className="text-amber-600" />}
          label="Phải trả NCC"
          count={suppliers.length}
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
            KH còn nợ ({customers.length})
          </TabsTrigger>
          <TabsTrigger value="supplier" className="gap-2">
            <Icon name="local_shipping" size={16} />
            NCC ({suppliers.length})
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
                <Card className="border-blue-200 bg-blue-50/50">
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground">Tổng công nợ</p>
                    <p className="text-xl font-bold text-blue-700">
                      {formatCurrency(aging.totalDebt)}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {aging.customersWithDebt} KH + {aging.suppliersWithDebt} NCC
                    </p>
                  </CardContent>
                </Card>
                <Card className="border-emerald-200 bg-emerald-50/50">
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground">KH đang nợ</p>
                    <p className="text-xl font-bold text-emerald-700">
                      {formatCurrency(aging.totalCustomerDebt)}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-1">
                      {aging.customersWithDebt} khách hàng
                    </p>
                  </CardContent>
                </Card>
                <Card className="border-amber-200 bg-amber-50/50">
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground">Phải trả NCC</p>
                    <p className="text-xl font-bold text-amber-700">
                      {formatCurrency(aging.totalSupplierDebt)}
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-1">
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
                        <div className="flex items-center gap-1.5 mb-2">
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
                        <div className="flex items-center gap-3 mt-2 text-[11px] text-muted-foreground">
                          <span>KH: {bucket.customerCount} ({formatCurrency(bucket.customerAmount)})</span>
                        </div>
                        <div className="text-[11px] text-muted-foreground">
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
      ? "border-emerald-200 bg-emerald-50/50"
      : "border-amber-200 bg-amber-50/50";
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
