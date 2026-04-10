"use client";

import { useEffect, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Plus, Pencil, Trash2, Tags, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDate } from "@/lib/format";
import {
  getCategoriesWithCounts,
  createCategory,
  updateCategory,
  deleteCategory,
} from "@/lib/services";
import { useToast } from "@/lib/contexts";
import type { ProductCategory } from "@/lib/types";

type CategoryScope = "nvl" | "sku";

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------
export default function NhomHangPage() {
  const { toast } = useToast();
  const [scope, setScope] = useState<CategoryScope>("nvl");
  const [data, setData] = useState<ProductCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<ProductCategory | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [categoryCode, setCategoryCode] = useState("");
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState("");

  // Delete confirm dialog
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deletingCategory, setDeletingCategory] = useState<ProductCategory | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const cats = await getCategoriesWithCounts(scope);
      setData(cats);
    } catch {
      toast({ variant: "error", title: "Lỗi tải nhóm hàng" });
    } finally {
      setLoading(false);
    }
  }, [scope, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Filter by search
  const filtered = search.trim()
    ? data.filter((c) => c.name.toLowerCase().includes(search.toLowerCase()))
    : data;

  // -----------------------------------------------------------------------
  // Create / Edit handlers
  // -----------------------------------------------------------------------
  function openCreate() {
    setEditingCategory(null);
    setCategoryName("");
    setCategoryCode("");
    setNameError("");
    setDialogOpen(true);
  }

  function openEdit(cat: ProductCategory) {
    setEditingCategory(cat);
    setCategoryName(cat.name);
    setCategoryCode(cat.code ?? "");
    setNameError("");
    setDialogOpen(true);
  }

  async function handleSave() {
    const trimmed = categoryName.trim();
    if (!trimmed) {
      setNameError("Tên nhóm hàng là bắt buộc");
      return;
    }
    setNameError("");
    setSaving(true);
    try {
      if (editingCategory) {
        await updateCategory(editingCategory.id, {
          name: trimmed,
          code: categoryCode.trim() || undefined,
        });
        toast({
          variant: "success",
          title: "Cập nhật thành công",
          description: `Nhóm "${trimmed}" đã được cập nhật.`,
        });
      } else {
        await createCategory({
          name: trimmed,
          code: categoryCode.trim() || trimmed.substring(0, 10).toUpperCase(),
          scope,
        });
        toast({
          variant: "success",
          title: "Tạo nhóm hàng thành công",
          description: `Đã thêm nhóm "${trimmed}".`,
        });
      }
      setDialogOpen(false);
      await fetchData();
    } catch (err) {
      toast({
        variant: "error",
        title: editingCategory ? "Lỗi cập nhật" : "Lỗi tạo nhóm hàng",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
      });
    } finally {
      setSaving(false);
    }
  }

  // -----------------------------------------------------------------------
  // Delete handler
  // -----------------------------------------------------------------------
  function openDelete(cat: ProductCategory) {
    setDeletingCategory(cat);
    setDeleteConfirmOpen(true);
  }

  async function handleDelete() {
    if (!deletingCategory) return;
    setDeleting(true);
    try {
      await deleteCategory(deletingCategory.id);
      toast({
        variant: "success",
        title: "Đã xoá nhóm hàng",
        description: `Nhóm "${deletingCategory.name}" đã được xoá.`,
      });
      setDeleteConfirmOpen(false);
      setDeletingCategory(null);
      await fetchData();
    } catch (err) {
      toast({
        variant: "error",
        title: "Xoá thất bại",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
      });
    } finally {
      setDeleting(false);
    }
  }

  // -----------------------------------------------------------------------
  // Table columns
  // -----------------------------------------------------------------------
  const columns: ColumnDef<ProductCategory, unknown>[] = [
    {
      accessorKey: "name",
      header: "Tên nhóm",
      size: 300,
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Tags className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="font-medium">{row.original.name}</span>
        </div>
      ),
    },
    {
      accessorKey: "code",
      header: "Mã nhóm",
      size: 140,
      cell: ({ row }) => (
        <span className="text-muted-foreground">
          {row.original.code ?? "—"}
        </span>
      ),
    },
    {
      id: "productCount",
      header: "Số sản phẩm",
      size: 120,
      cell: ({ row }) => {
        const count = row.original.productCount ?? 0;
        return (
          <span className={count > 0 ? "font-medium" : "text-muted-foreground"}>
            {count}
          </span>
        );
      },
    },
    {
      id: "createdAt",
      header: "Ngày tạo",
      size: 160,
      cell: ({ row }) =>
        row.original.createdAt ? formatDate(row.original.createdAt) : "—",
    },
    {
      id: "actions",
      header: "",
      size: 80,
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex items-center gap-1 justify-end">
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              openEdit(row.original);
            }}
            title="Sửa"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              openDelete(row.original);
            }}
            title="Xoá"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  return (
    <>
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <PageHeader
          title="Nhóm hàng"
          tabs={
            <Tabs
              value={scope}
              onValueChange={(v) => {
                setScope(v as CategoryScope);
                setSearch("");
              }}
            >
              <TabsList>
                <TabsTrigger value="nvl">Nguyên vật liệu</TabsTrigger>
                <TabsTrigger value="sku">Thành phẩm</TabsTrigger>
              </TabsList>
            </Tabs>
          }
          searchPlaceholder="Tìm theo tên nhóm..."
          searchValue={search}
          onSearchChange={setSearch}
          actions={[
            {
              label: "Thêm nhóm",
              icon: <Plus className="h-4 w-4" />,
              variant: "default",
              onClick: openCreate,
            },
          ]}
        />

        <DataTable
          columns={columns}
          data={filtered}
          loading={loading}
          total={filtered.length}
          getRowId={(row) => row.id}
        />
      </div>

      {/* ============================================================ */}
      {/* Create / Edit dialog                                         */}
      {/* ============================================================ */}
      <Dialog
        open={dialogOpen}
        onOpenChange={(o) => {
          if (saving) return;
          setDialogOpen(o);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingCategory ? "Sửa nhóm hàng" : "Thêm nhóm hàng mới"}
            </DialogTitle>
            <DialogDescription>
              {editingCategory
                ? "Cập nhật tên hoặc mã nhóm hàng."
                : `Tạo nhóm hàng mới cho ${scope === "nvl" ? "Nguyên vật liệu" : "Thành phẩm"}.`}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Tên nhóm hàng <span className="text-destructive">*</span>
              </label>
              <Input
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
                placeholder="VD: Bột, Đường, Gia vị..."
                aria-invalid={!!nameError}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSave();
                }}
                autoFocus
              />
              {nameError && (
                <p className="text-xs text-destructive">{nameError}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Mã nhóm</label>
              <Input
                value={categoryCode}
                onChange={(e) => setCategoryCode(e.target.value)}
                placeholder="Tự động nếu để trống"
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              disabled={saving}
              onClick={() => setDialogOpen(false)}
            >
              Huỷ
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingCategory ? "Cập nhật" : "Tạo mới"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ============================================================ */}
      {/* Delete confirm dialog                                        */}
      {/* ============================================================ */}
      <Dialog
        open={deleteConfirmOpen}
        onOpenChange={(o) => {
          if (deleting) return;
          setDeleteConfirmOpen(o);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Xoá nhóm hàng?</DialogTitle>
            <DialogDescription>
              {deletingCategory && (deletingCategory.productCount ?? 0) > 0 ? (
                <>
                  Nhóm <strong>&quot;{deletingCategory?.name}&quot;</strong> đang
                  có{" "}
                  <strong>
                    {deletingCategory?.productCount} sản phẩm
                  </strong>
                  . Xoá nhóm sẽ bỏ liên kết nhóm trên các sản phẩm này. Bạn
                  có chắc chắn muốn xoá?
                </>
              ) : (
                <>
                  Bạn có chắc chắn muốn xoá nhóm{" "}
                  <strong>&quot;{deletingCategory?.name}&quot;</strong>? Hành
                  động này không thể hoàn tác.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={deleting}
              onClick={() => setDeleteConfirmOpen(false)}
            >
              Huỷ
            </Button>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={handleDelete}
            >
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Xoá
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
