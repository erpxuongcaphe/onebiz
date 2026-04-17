"use client";

// Pricing Engine page — Quản lý bảng giá B2B (price tiers)
// Real Supabase data via getPriceTiers + getPriceTierItems
// Inline detail panel hiển thị danh sách item của từng tier với add/edit/delete

import { useEffect, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import {
  InlineDetailPanel,
  DetailHeader,
} from "@/components/shared/inline-detail-panel";
import {
  PriceTierDialog,
  AddPriceTierItemDialog,
} from "@/components/shared/dialogs";
import { formatCurrency, formatDate } from "@/lib/format";
import { useToast } from "@/lib/contexts";
import {
  getPriceTiers,
  getPriceTierItems,
  deletePriceTier,
  deletePriceTierItem,
} from "@/lib/services";
import type { PriceTier, PriceTierItem } from "@/lib/types";
import { Icon } from "@/components/ui/icon";

// ---------------------------------------------------------------------------
// Inline detail — danh sách items của một tier
// ---------------------------------------------------------------------------

function PriceTierDetail({
  tier,
  onClose,
  onChange,
}: {
  tier: PriceTier;
  onClose: () => void;
  onChange: () => void;
}) {
  const { toast } = useToast();
  const [items, setItems] = useState<PriceTierItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getPriceTierItems(tier.id);
      setItems(data);
    } catch (err) {
      toast({
        title: "Lỗi tải sản phẩm",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [tier.id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleDeleteItem(itemId: string) {
    try {
      await deletePriceTierItem(itemId);
      toast({ title: "Đã xóa sản phẩm khỏi bảng giá", variant: "success" });
      await load();
      onChange();
    } catch (err) {
      toast({
        title: "Lỗi xóa",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    }
  }

  return (
    <InlineDetailPanel open onClose={onClose}>
      <div className="space-y-4 p-4">
        <DetailHeader
          title={tier.name}
          code={tier.code}
          subtitle={tier.description ?? "Không có mô tả"}
        />

        <div className="flex items-center justify-between border-b pb-2">
          <h3 className="text-sm font-semibold">
            Sản phẩm áp dụng ({items.length})
          </h3>
          <Button size="sm" onClick={() => setAddOpen(true)}>
            <Icon name="add" size={16} className="mr-1" />
            Thêm sản phẩm
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Icon name="progress_activity" size={16} className="animate-spin mr-2" />
            <span className="text-sm">Đang tải...</span>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
            <Icon name="inventory_2" size={40} className="mb-2 opacity-30" />
            <p className="text-sm">Chưa có sản phẩm nào trong bảng giá</p>
            <Button size="sm" variant="outline" className="mt-3" onClick={() => setAddOpen(true)}>
              <Icon name="add" size={16} className="mr-1" />
              Thêm sản phẩm đầu tiên
            </Button>
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/30">
                <tr>
                  <th className="text-left p-2 font-medium">Sản phẩm</th>
                  <th className="text-right p-2 font-medium">Giá riêng</th>
                  <th className="text-right p-2 font-medium">SL tối thiểu</th>
                  <th className="text-right p-2 font-medium w-12"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-t">
                    <td className="p-2">
                      <div className="font-medium">{item.productName ?? "—"}</div>
                      <div className="text-xs text-muted-foreground">
                        {item.productCode}
                      </div>
                    </td>
                    <td className="p-2 text-right font-medium">
                      {formatCurrency(item.price)}
                    </td>
                    <td className="p-2 text-right text-muted-foreground">
                      {item.minQty}
                    </td>
                    <td className="p-2 text-right">
                      <button
                        onClick={() => handleDeleteItem(item.id)}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                        title="Xóa"
                      >
                        <Icon name="delete" size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AddPriceTierItemDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        tierId={tier.id}
        tierName={tier.name}
        onSuccess={() => {
          load();
          onChange();
        }}
      />
    </InlineDetailPanel>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ThietLapGiaPage() {
  const { toast } = useToast();
  const [data, setData] = useState<PriceTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [editingTier, setEditingTier] = useState<PriceTier | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getPriceTiers();
      setData(result);
    } catch (err) {
      toast({
        title: "Lỗi tải bảng giá",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    setPage(0);
    setExpandedRow(null);
  }, [search]);

  const filtered = data.filter((t) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      t.name.toLowerCase().includes(q) ||
      t.code.toLowerCase().includes(q) ||
      (t.description ?? "").toLowerCase().includes(q)
    );
  });

  const pagedData = filtered.slice(page * pageSize, (page + 1) * pageSize);

  async function handleDelete(tier: PriceTier) {
    if (!confirm(`Xóa bảng giá "${tier.name}"?`)) return;
    try {
      await deletePriceTier(tier.id);
      toast({ title: "Đã xóa bảng giá", variant: "success" });
      fetchData();
    } catch (err) {
      toast({
        title: "Lỗi xóa",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    }
  }

  const columns: ColumnDef<PriceTier, unknown>[] = [
    {
      accessorKey: "code",
      header: "Mã",
      size: 130,
      cell: ({ row }) => (
        <span className="font-mono text-xs text-primary font-medium">
          {row.original.code}
        </span>
      ),
    },
    {
      accessorKey: "name",
      header: "Tên bảng giá",
      size: 240,
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.name}</div>
          {row.original.description && (
            <div className="text-xs text-muted-foreground truncate">
              {row.original.description}
            </div>
          )}
        </div>
      ),
    },
    {
      id: "itemCount",
      header: "SP áp dụng",
      size: 110,
      cell: ({ row }) => (
        <Badge variant="secondary" className="font-medium">
          {row.original.itemCount ?? 0}
        </Badge>
      ),
    },
    {
      accessorKey: "priority",
      header: "Ưu tiên",
      size: 90,
      cell: ({ row }) => (
        <span className="text-muted-foreground">{row.original.priority}</span>
      ),
    },
    {
      accessorKey: "createdAt",
      header: "Ngày tạo",
      size: 140,
      cell: ({ row }) => formatDate(row.original.createdAt),
    },
  ];

  return (
    <div className="h-[calc(100vh-64px)] flex flex-col">
      <PageHeader
        title="Bảng giá (Price Tiers)"
        searchPlaceholder="Theo tên hoặc mã bảng giá..."
        searchValue={search}
        onSearchChange={setSearch}
        actions={[
          {
            label: "Tạo bảng giá",
            icon: <Icon name="add" size={16} />,
            variant: "default",
            onClick: () => {
              setEditingTier(null);
              setCreateOpen(true);
            },
          },
        ]}
      />

      {!loading && filtered.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-muted-foreground">
          <Icon name="sell" size={48} className="mb-3 opacity-30" />
          <p className="text-sm">Chưa có bảng giá nào</p>
          <Button
            size="sm"
            className="mt-3"
            onClick={() => {
              setEditingTier(null);
              setCreateOpen(true);
            }}
          >
            <Icon name="add" size={16} className="mr-1" />
            Tạo bảng giá đầu tiên
          </Button>
        </div>
      ) : (
        <DataTable
          columns={columns}
          data={pagedData}
          loading={loading}
          total={filtered.length}
          pageIndex={page}
          pageSize={pageSize}
          pageCount={Math.ceil(filtered.length / pageSize)}
          onPageChange={setPage}
          onPageSizeChange={(size) => {
            setPageSize(size);
            setPage(0);
          }}
          expandedRow={expandedRow}
          onExpandedRowChange={setExpandedRow}
          getRowId={(row) => row.id}
          renderDetail={(tier, onClose) => (
            <PriceTierDetail
              tier={tier}
              onClose={onClose}
              onChange={fetchData}
            />
          )}
          rowActions={(row) => [
            {
              label: "Sửa",
              icon: <Icon name="edit" size={16} />,
              onClick: () => {
                setEditingTier(row);
                setCreateOpen(true);
              },
            },
            {
              label: "Xóa",
              icon: <Icon name="delete" size={16} />,
              onClick: () => handleDelete(row),
              variant: "destructive",
              separator: true,
            },
          ]}
        />
      )}

      <PriceTierDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        tier={editingTier}
        onSuccess={fetchData}
      />
    </div>
  );
}
