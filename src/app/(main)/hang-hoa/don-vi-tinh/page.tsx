"use client";

/**
 * Đơn vị tính — Unit of Measure summary page
 * Shows all unique units used across products with counts.
 */

import { useEffect, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable } from "@/components/shared/data-table";
import { FilterSidebar, FilterGroup } from "@/components/shared/filter-sidebar";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/lib/contexts";
import { getProducts } from "@/lib/services";
import { Icon } from "@/components/ui/icon";

interface UnitSummary {
  unit: string;
  productCount: number;
  sampleProducts: string[];
}

export default function DonViTinhPage() {
  const { toast } = useToast();
  const [units, setUnits] = useState<UnitSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getProducts({
        page: 0,
        pageSize: 500,
        sortBy: "name",
        sortOrder: "asc",
        filters: {},
      });

      const unitMap = new Map<string, { count: number; samples: string[] }>();
      for (const p of result.data) {
        const productUnits = new Set<string>();
        if (p.unit) productUnits.add(p.unit);
        if (p.purchaseUnit) productUnits.add(p.purchaseUnit);
        if (p.sellUnit) productUnits.add(p.sellUnit);

        for (const u of productUnits) {
          const existing = unitMap.get(u) || { count: 0, samples: [] };
          existing.count++;
          if (existing.samples.length < 3) existing.samples.push(p.name);
          unitMap.set(u, existing);
        }
      }

      setUnits(
        Array.from(unitMap.entries())
          .map(([unit, info]) => ({
            unit,
            productCount: info.count,
            sampleProducts: info.samples,
          }))
          .sort((a, b) => b.productCount - a.productCount)
      );
    } catch {
      toast({ variant: "error", title: "Lỗi tải đơn vị tính" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const filtered = search
    ? units.filter((u) =>
        u.unit.toLowerCase().includes(search.toLowerCase()) ||
        u.sampleProducts.some((s) => s.toLowerCase().includes(search.toLowerCase()))
      )
    : units;

  const columns: ColumnDef<UnitSummary>[] = [
    {
      accessorKey: "unit",
      header: "Đơn vị tính",
      size: 200,
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Icon name="straighten" size={14} className="text-primary shrink-0" />
          <span className="font-semibold text-foreground">{row.original.unit}</span>
        </div>
      ),
    },
    {
      accessorKey: "productCount",
      header: "Số sản phẩm",
      size: 120,
      cell: ({ row }) => (
        <Badge variant="secondary" className="font-mono">
          {row.original.productCount}
        </Badge>
      ),
    },
    {
      id: "samples",
      header: "Sản phẩm mẫu",
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground truncate max-w-[300px] block">
          {row.original.sampleProducts.join(", ")}
          {row.original.productCount > 3 && ` ...+${row.original.productCount - 3}`}
        </span>
      ),
    },
  ];

  return (
    <ListPageLayout sidebar={<FilterSidebar><FilterGroup label="Bộ lọc"><span className="text-xs text-muted-foreground">Chưa có bộ lọc</span></FilterGroup></FilterSidebar>}>
      <PageHeader
        title="Đơn vị tính"
        searchPlaceholder="Tìm đơn vị tính..."
        searchValue={search}
        onSearchChange={setSearch}
      />

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 px-4 pt-4">
        <div className="bg-white rounded-lg border p-3">
          <div className="text-2xl font-bold text-primary">{units.length}</div>
          <div className="text-xs text-muted-foreground">Đơn vị tính</div>
        </div>
        <div className="bg-white rounded-lg border p-3">
          <div className="text-2xl font-bold text-foreground">
            {units.reduce((sum, u) => sum + u.productCount, 0)}
          </div>
          <div className="text-xs text-muted-foreground">Lần sử dụng</div>
        </div>
      </div>

      {/* Info */}
      <div className="mx-4 mt-3 flex items-start gap-2 p-3 bg-primary-fixed border border-primary-fixed rounded-lg text-xs text-primary">
        <Icon name="info" size={16} className="shrink-0 mt-0.5" />
        <div>
          <p className="font-medium">Đơn vị tính được quản lý tại từng sản phẩm</p>
          <p className="mt-0.5 text-primary">
            Mỗi sản phẩm có thể có 3 đơn vị: Mua hàng, Kho, Bán hàng.
            Quy đổi đơn vị được thiết lập trong chi tiết từng sản phẩm.
          </p>
        </div>
      </div>

      <DataTable columns={columns} data={filtered} loading={loading} />
    </ListPageLayout>
  );
}
