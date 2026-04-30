"use client";

import { useEffect, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable } from "@/components/shared/data-table";
import {
  FilterSidebar,
  FilterGroup,
} from "@/components/shared/filter-sidebar";
import { Input } from "@/components/ui/input";
import { useToast } from "@/lib/contexts";
import { getExpiringLots } from "@/lib/services";
import { formatDate, formatCurrency } from "@/lib/format";
import type { ExpiringLot } from "@/lib/types";
import { Icon } from "@/components/ui/icon";

export default function HSDPage() {
  const { toast } = useToast();
  const [data, setData] = useState<ExpiringLot[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [thresholdDays, setThresholdDays] = useState(30);
  const [search, setSearch] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getExpiringLots(thresholdDays);
      setData(result.lots);
      setTotal(result.total);
    } catch (err) {
      toast({
        title: "Lỗi tải HSD",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [thresholdDays, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filtered = data.filter((l) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      l.lotNumber?.toLowerCase().includes(q) ||
      l.productCode?.toLowerCase().includes(q) ||
      l.productName?.toLowerCase().includes(q)
    );
  });

  const expiredCount = data.filter((l) => l.isExpired).length;
  const expiringCount = data.length - expiredCount;

  const columns: ColumnDef<ExpiringLot, unknown>[] = [
    {
      accessorKey: "lotNumber",
      header: "Số lô",
      size: 180,
      cell: ({ row }) => (
        <span className="font-medium text-primary">{row.original.lotNumber}</span>
      ),
    },
    {
      id: "product",
      header: "Sản phẩm",
      size: 280,
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.productName}</div>
          <div className="text-xs text-muted-foreground">{row.original.productCode}</div>
        </div>
      ),
    },
    {
      accessorKey: "branchName",
      header: "Chi nhánh",
      size: 150,
    },
    {
      accessorKey: "currentQty",
      header: "Tồn lô",
      size: 120,
      cell: ({ row }) => (
        <span className="font-medium">{formatCurrency(row.original.currentQty)}</span>
      ),
    },
    {
      accessorKey: "expiryDate",
      header: "HSD",
      size: 130,
      cell: ({ row }) => formatDate(row.original.expiryDate),
    },
    {
      accessorKey: "daysRemaining",
      header: "Còn lại",
      size: 130,
      cell: ({ row }) => {
        const d = row.original.daysRemaining;
        if (row.original.isExpired) {
          return (
            <span className="inline-flex items-center gap-1 text-destructive font-medium">
              <Icon name="warning" size={14} />
              Hết hạn {Math.abs(d)} ngày
            </span>
          );
        }
        return (
          <span
            className={
              d <= 7
                ? "text-destructive font-medium"
                : d <= 30
                  ? "text-status-warning font-medium"
                  : ""
            }
          >
            {d} ngày
          </span>
        );
      },
    },
  ];

  return (
    <ListPageLayout
      sidebar={
        <FilterSidebar>
          <FilterGroup label="Ngưỡng cảnh báo (ngày)">
            <Input
              type="number"
              value={thresholdDays}
              onChange={(e) => setThresholdDays(Number(e.target.value) || 30)}
              min={1}
              max={365}
            />
            <p className="text-xs text-muted-foreground mt-2">
              Hiển thị các lô sắp hết hạn trong vòng N ngày
            </p>
          </FilterGroup>

        </FilterSidebar>
      }
    >
      <PageHeader
        title="Hạn sử dụng (HSD)"
        searchPlaceholder="Theo số lô, sản phẩm..."
        searchValue={search}
        onSearchChange={setSearch}
      />

      {/* KPI summary cards — đồng đều design với lo-san-xuat / lich-su-kho */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 px-4 pt-4">
        <div className="bg-surface-container-lowest rounded-xl border border-border p-3 ambient-shadow">
          <div className="flex items-center gap-2">
            <span className="inline-flex size-8 items-center justify-center rounded-lg bg-primary-fixed/15 text-primary">
              <Icon name="event" size={16} />
            </span>
            <div>
              <div className="text-2xl font-bold text-primary leading-tight">{total}</div>
              <div className="text-xs text-muted-foreground">Tổng lô cần chú ý</div>
            </div>
          </div>
        </div>
        <div
          className={`rounded-xl border p-3 ambient-shadow ${
            expiredCount > 0
              ? "bg-status-error/10 border-status-error/25"
              : "bg-surface-container-lowest border-border"
          }`}
        >
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex size-8 items-center justify-center rounded-lg ${
                expiredCount > 0
                  ? "bg-status-error/15 text-status-error"
                  : "bg-status-success/10 text-status-success"
              }`}
            >
              <Icon name={expiredCount > 0 ? "warning" : "verified"} size={16} />
            </span>
            <div>
              <div
                className={`text-2xl font-bold leading-tight ${
                  expiredCount > 0 ? "text-status-error" : "text-status-success"
                }`}
              >
                {expiredCount}
              </div>
              <div className="text-xs text-muted-foreground">Đã hết hạn</div>
            </div>
          </div>
        </div>
        <div
          className={`rounded-xl border p-3 ambient-shadow ${
            expiringCount > 0
              ? "bg-status-warning/10 border-status-warning/25"
              : "bg-surface-container-lowest border-border"
          }`}
        >
          <div className="flex items-center gap-2">
            <span
              className={`inline-flex size-8 items-center justify-center rounded-lg ${
                expiringCount > 0
                  ? "bg-status-warning/15 text-status-warning"
                  : "bg-surface-container-high text-foreground"
              }`}
            >
              <Icon name="schedule" size={16} />
            </span>
            <div>
              <div
                className={`text-2xl font-bold leading-tight ${
                  expiringCount > 0 ? "text-status-warning" : "text-foreground"
                }`}
              >
                {expiringCount}
              </div>
              <div className="text-xs text-muted-foreground">Sắp hết ({thresholdDays}d)</div>
            </div>
          </div>
        </div>
      </div>

      {!loading && filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Icon name="event" size={48} className="mb-3 opacity-30" />
          <p className="text-sm">Không có lô nào sắp hết hạn trong {thresholdDays} ngày tới</p>
          <Icon name="inventory_2" size={16} className="mt-1 opacity-0" />
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={filtered}
          loading={loading}
          total={filtered.length}
          pageIndex={0}
          pageSize={50}
          pageCount={1}
          onPageChange={() => {}}
          onPageSizeChange={() => {}}
          getRowId={(row) => row.lotId}
        />
      )}
    </ListPageLayout>
  );
}
