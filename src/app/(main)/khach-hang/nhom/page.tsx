"use client";

// Nhóm khách hàng — CRUD bằng dialog đơn giản
// Dữ liệu lấy từ bảng categories với scope='customer'

import { useEffect, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Plus, Pencil, Trash2, Users } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/lib/contexts";
import {
  getCategoriesByScope,
  createCategory,
  updateCategory,
  deleteCategory,
} from "@/lib/services";
import type { ProductCategory } from "@/lib/types";

export default function NhomKhachHangPage() {
  const { toast } = useToast();
  const [data, setData] = useState<ProductCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ProductCategory | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getCategoriesByScope("customer");
      setData(result);
    } catch (err) {
      toast({
        title: "Lỗi tải nhóm KH",
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

  const filtered = data.filter((g) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      g.name.toLowerCase().includes(q) ||
      (g.code ?? "").toLowerCase().includes(q)
    );
  });

  async function handleDelete(group: ProductCategory) {
    if (
      !confirm(
        `Xóa nhóm "${group.name}"? Khách hàng thuộc nhóm này sẽ bị bỏ liên kết.`
      )
    )
      return;
    try {
      await deleteCategory(group.id);
      toast({ title: "Đã xóa nhóm", variant: "success" });
      fetchData();
    } catch (err) {
      toast({
        title: "Lỗi xóa",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    }
  }

  const columns: ColumnDef<ProductCategory, unknown>[] = [
    {
      accessorKey: "code",
      header: "Mã nhóm",
      size: 150,
      cell: ({ row }) => (
        <span className="font-mono text-primary font-medium">
          {row.original.code ?? "—"}
        </span>
      ),
    },
    {
      accessorKey: "name",
      header: "Tên nhóm",
      size: 320,
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Users className="h-4 w-4 text-muted-foreground" />
          <span className="font-medium">{row.original.name}</span>
        </div>
      ),
    },
    {
      accessorKey: "sortOrder",
      header: "Thứ tự",
      size: 100,
      cell: ({ row }) => row.original.sortOrder ?? 0,
    },
  ];

  return (
    <>
      <div className="flex flex-col h-[calc(100vh-48px)]">
        <PageHeader
          title="Nhóm khách hàng"
          searchPlaceholder="Theo mã, tên nhóm..."
          searchValue={search}
          onSearchChange={setSearch}
          actions={[
            {
              label: "Thêm nhóm",
              icon: <Plus className="h-4 w-4" />,
              variant: "default",
              onClick: () => {
                setEditing(null);
                setDialogOpen(true);
              },
            },
          ]}
        />

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
          getRowId={(r) => r.id}
          rowActions={(row) => [
            {
              label: "Sửa",
              icon: <Pencil className="h-4 w-4" />,
              onClick: () => {
                setEditing(row);
                setDialogOpen(true);
              },
            },
            {
              label: "Xóa",
              icon: <Trash2 className="h-4 w-4" />,
              onClick: () => handleDelete(row),
              variant: "destructive",
              separator: true,
            },
          ]}
        />
      </div>

      <CustomerGroupDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        onSuccess={fetchData}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  Dialog                                                             */
/* ------------------------------------------------------------------ */

function CustomerGroupDialog({
  open,
  onOpenChange,
  editing,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: ProductCategory | null;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [sortOrder, setSortOrder] = useState("0");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setCode(editing?.code ?? "");
    setSortOrder(String(editing?.sortOrder ?? 0));
  }, [open, editing]);

  async function handleSave() {
    if (!name.trim()) {
      toast({ title: "Vui lòng nhập tên nhóm", variant: "error" });
      return;
    }
    if (!editing && !/^[A-Z]{3}$/.test(code.trim())) {
      toast({
        title: "Mã nhóm phải gồm 3 chữ cái IN HOA",
        description: "VD: KSI, KLE, VLA",
        variant: "error",
      });
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        await updateCategory(editing.id, {
          name: name.trim(),
          code: code.trim() || undefined,
          sortOrder: Number(sortOrder) || 0,
        });
        toast({ title: "Đã cập nhật nhóm", variant: "success" });
      } else {
        await createCategory({
          name: name.trim(),
          code: code.trim(),
          scope: "customer",
          sortOrder: Number(sortOrder) || 0,
        });
        toast({ title: "Đã thêm nhóm", variant: "success" });
      }
      onSuccess();
      onOpenChange(false);
    } catch (err) {
      toast({
        title: editing ? "Lỗi cập nhật" : "Lỗi thêm nhóm",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Sửa nhóm khách hàng" : "Thêm nhóm khách hàng"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Mã nhóm (3 chữ cái) *</label>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              placeholder="VD: KSI, KLE, VLA"
              maxLength={3}
              disabled={!!editing}
            />
            {!editing && (
              <p className="text-xs text-muted-foreground">
                Mã sẽ dùng để sinh mã KH theo format KHA-[mã]-001
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Tên nhóm *</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="VD: Khách sỉ, Khách lẻ, Khách vãng lai"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Thứ tự hiển thị</label>
            <Input
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Đang lưu..." : editing ? "Cập nhật" : "Thêm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
