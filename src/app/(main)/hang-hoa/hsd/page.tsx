"use client";

import { useEffect, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable } from "@/components/shared/data-table";
import { ListMetric } from "@/components/shared/list-metric";
import { FilterChips, type ListFilterChip } from "@/components/shared/filter-chips";
import {
  FilterPanel,
  FilterGroup,
} from "@/components/shared/filter-sidebar";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/lib/contexts";
import { getExpiringLots } from "@/lib/services";
import { formatDate, formatNumber } from "@/lib/format";
import type { ExpiringLot } from "@/lib/types";
import { Icon } from "@/components/ui/icon";

export default function HSDPage() {
  const { toast } = useToast();
  const [data, setData] = useState<ExpiringLot[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [thresholdDays, setThresholdDays] = useState(30);
  const [search, setSearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);

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
  const filterChips: ListFilterChip[] = thresholdDays === 30 ? [] : [{
    key: "threshold",
    label: "Ngưỡng cảnh báo",
    value: `${thresholdDays} ngày`,
    onClear: () => setThresholdDays(30),
  }];

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
        <span className="font-medium">{formatNumber(row.original.currentQty)}</span>
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
    <ListPageLayout sidebar={null}>
      <PageHeader
        title="Hạn sử dụng (HSD)"
        density="compact"
        searchPlaceholder="Theo số lô, sản phẩm..."
        searchValue={search}
        onSearchChange={setSearch}
      />

      <DataTable
          columns={columns}
          data={filtered}
          loading={loading}
          total={filtered.length}
          density="compact"
          columnToggle
          toolbarMetrics={<><ListMetric icon={<Icon name="event" size={15} />} label="Lô cần chú ý" value={formatNumber(total)} hint={`Theo ngưỡng ${thresholdDays} ngày`} tone="primary" /><ListMetric icon={<Icon name={expiredCount > 0 ? "warning" : "verified"} size={15} />} label="Đã hết hạn" value={formatNumber(expiredCount)} tone={expiredCount > 0 ? "danger" : "default"} /><ListMetric icon={<Icon name="schedule" size={15} />} label={`Sắp hết (${thresholdDays} ngày)`} value={formatNumber(expiringCount)} /></>}
          toolbarActions={<Button type="button" variant="outline" size="sm" className="relative h-8 gap-1.5 px-2 text-xs pointer-coarse:min-h-11" onClick={() => setFilterOpen(true)}><Icon name="filter_alt" size={15} /><span className="hidden sm:inline">Bộ lọc</span>{filterChips.length > 0 && <span className="min-w-4 rounded-full bg-primary px-1 text-xs font-bold text-primary-foreground">{filterChips.length}</span>}</Button>}
          toolbarFooter={<FilterChips filters={filterChips} />}
          emptyTitle={`Không có lô sắp hết hạn trong ${thresholdDays} ngày tới`}
          emptyDescription="Thử tăng ngưỡng cảnh báo hoặc thay đổi nội dung tìm kiếm."
          emptyIcon="event"
          pageIndex={0}
          pageSize={50}
          pageCount={1}
          onPageChange={() => {}}
          onPageSizeChange={() => {}}
          getRowId={(row) => row.lotId}
        />

      <FilterPanel open={filterOpen} onOpenChange={setFilterOpen} activeCount={filterChips.length} onClearAll={() => setThresholdDays(30)} title="Bộ lọc hạn sử dụng">
        <FilterGroup label="Ngưỡng cảnh báo (ngày)" activeHint={`${thresholdDays} ngày`}>
          <Input type="number" value={thresholdDays} onChange={(event) => setThresholdDays(Number(event.target.value) || 30)} min={1} max={365} />
          <p className="mt-2 text-xs text-muted-foreground">Hiển thị các lô sắp hết hạn trong vòng N ngày.</p>
        </FilterGroup>
      </FilterPanel>
    </ListPageLayout>
  );
}
