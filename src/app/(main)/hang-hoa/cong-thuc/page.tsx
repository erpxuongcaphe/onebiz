"use client";

import { useEffect, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Plus, Pencil, Trash2, FlaskConical } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { DataTable } from "@/components/shared/data-table";
import {
  FilterSidebar,
  FilterGroup,
} from "@/components/shared/filter-sidebar";
import { BOMEditorDialog } from "@/components/shared/dialogs";
import { Button } from "@/components/ui/button";
import { useToast } from "@/lib/contexts";
import { getAllBOMs, deleteBOM } from "@/lib/services";
import { formatDate } from "@/lib/format";
import type { BOM } from "@/lib/types";

export default function CongThucPage() {
  const { toast } = useToast();
  const [data, setData] = useState<BOM[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(15);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | undefined>(undefined);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const all = await getAllBOMs();
      setData(all);
    } catch (err) {
      toast({
        title: "Lỗi tải BOM",
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

  const filtered = data.filter((b) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      b.name?.toLowerCase().includes(q) ||
      b.code?.toLowerCase().includes(q) ||
      b.productName?.toLowerCase().includes(q) ||
      b.productCode?.toLowerCase().includes(q)
    );
  });

  const pagedData = filtered.slice(page * pageSize, (page + 1) * pageSize);

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Xóa công thức "${name}"?`)) return;
    try {
      await deleteBOM(id);
      toast({ title: "Đã xóa công thức", variant: "success" });
      fetchData();
    } catch (err) {
      toast({
        title: "Lỗi xóa",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    }
  }

  const columns: ColumnDef<BOM, unknown>[] = [
    {
      accessorKey: "name",
      header: "Tên công thức",
      size: 280,
      cell: ({ row }) => (
        <div>
          <div className="font-medium">{row.original.name}</div>
          {row.original.code && (
            <div className="text-xs text-muted-foreground">{row.original.code}</div>
          )}
        </div>
      ),
    },
    {
      id: "product",
      header: "SKU đầu ra",
      size: 280,
      cell: ({ row }) => (
        <div>
          <div className="text-primary font-medium">{row.original.productCode}</div>
          <div className="text-xs text-muted-foreground">{row.original.productName}</div>
        </div>
      ),
    },
    {
      id: "yield",
      header: "Sản lượng",
      size: 140,
      cell: ({ row }) => (
        <span>
          {row.original.yieldQty} {row.original.yieldUnit}
          <span className="text-xs text-muted-foreground">
            {" "}
            / batch {row.original.batchSize}
          </span>
        </span>
      ),
    },
    {
      accessorKey: "version",
      header: "Phiên bản",
      size: 90,
      cell: ({ row }) => `v${row.original.version}`,
    },
    {
      accessorKey: "createdAt",
      header: "Ngày tạo",
      size: 120,
      cell: ({ row }) => formatDate(row.original.createdAt),
    },
  ];

  return (
    <>
      <ListPageLayout
        sidebar={
          <FilterSidebar>
            <FilterGroup label="SKU đầu ra">
              <div className="text-xs text-muted-foreground py-2">
                (Sẽ thêm filter theo SKU)
              </div>
            </FilterGroup>
          </FilterSidebar>
        }
      >
        <PageHeader
          title="Công thức sản xuất (BOM)"
          searchPlaceholder="Theo tên công thức, SKU..."
          searchValue={search}
          onSearchChange={setSearch}
          actions={[
            {
              label: "Tạo công thức",
              icon: <Plus className="h-4 w-4" />,
              variant: "default",
              onClick: () => {
                setEditingId(undefined);
                setEditorOpen(true);
              },
            },
          ]}
        />

        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            Đang tải...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <FlaskConical className="h-12 w-12 mb-3 opacity-30" />
            <p className="text-sm">Chưa có công thức nào</p>
            <Button
              size="sm"
              className="mt-3"
              onClick={() => {
                setEditingId(undefined);
                setEditorOpen(true);
              }}
            >
              <Plus className="h-4 w-4 mr-1" />
              Tạo công thức đầu tiên
            </Button>
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={pagedData}
            loading={false}
            total={filtered.length}
            pageIndex={page}
            pageSize={pageSize}
            pageCount={Math.ceil(filtered.length / pageSize)}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(0);
            }}
            rowActions={(row) => [
              {
                label: "Sửa",
                icon: <Pencil className="h-4 w-4" />,
                onClick: () => {
                  setEditingId(row.id);
                  setEditorOpen(true);
                },
              },
              {
                label: "Xóa",
                icon: <Trash2 className="h-4 w-4" />,
                onClick: () => handleDelete(row.id, row.name),
                variant: "destructive",
                separator: true,
              },
            ]}
          />
        )}
      </ListPageLayout>

      <BOMEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        bomId={editingId}
        onSuccess={fetchData}
      />
    </>
  );
}
