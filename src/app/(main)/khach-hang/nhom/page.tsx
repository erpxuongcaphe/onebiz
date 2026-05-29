"use client";

// Nhóm khách hàng — CRUD bảng customer_groups (CEO 29/05/2026).
// Đây là bảng THẬT mà khách hàng link tới + POS đọc chiết khấu mặc định.
// (Trước đây trang này sửa nhầm bảng categories scope=customer — bảng rỗng.)

import { useEffect, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
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
import { NumericInput } from "@/components/ui/numeric-input";
import { useToast } from "@/lib/contexts";
import {
  getCustomerGroupsFull,
  createCustomerGroup,
  updateCustomerGroup,
  deleteCustomerGroup,
  type CustomerGroupFull,
} from "@/lib/services";
import { Icon } from "@/components/ui/icon";

export default function NhomKhachHangPage() {
  const { toast } = useToast();
  const [data, setData] = useState<CustomerGroupFull[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerGroupFull | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const result = await getCustomerGroupsFull();
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
    return g.name.toLowerCase().includes(search.toLowerCase());
  });

  async function handleDelete(group: CustomerGroupFull) {
    if (
      !confirm(
        `Xóa nhóm "${group.name}"? Khách hàng thuộc nhóm này sẽ bị bỏ liên kết.`,
      )
    )
      return;
    try {
      await deleteCustomerGroup(group.id);
      toast({ title: "Đã xóa nhóm", variant: "success" });
      fetchData();
    } catch (err) {
      toast({
        title: "Lỗi xóa",
        description:
          err instanceof Error
            ? err.message
            : "Có thể còn khách hàng thuộc nhóm này. Vui lòng chuyển khách sang nhóm khác trước.",
        variant: "error",
      });
    }
  }

  const columns: ColumnDef<CustomerGroupFull, unknown>[] = [
    {
      accessorKey: "name",
      header: "Tên nhóm",
      size: 320,
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Icon name="group" size={16} className="text-muted-foreground" />
          <span className="font-medium">{row.original.name}</span>
        </div>
      ),
    },
    {
      accessorKey: "discountPercent",
      header: "Chiết khấu mặc định",
      size: 180,
      cell: ({ row }) => {
        const pct = row.original.discountPercent;
        return pct > 0 ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-status-success/10 px-2.5 py-0.5 text-sm font-semibold text-status-success">
            <Icon name="sell" size={14} />
            {pct}%
          </span>
        ) : (
          <span className="text-sm text-muted-foreground">Không giảm</span>
        );
      },
    },
    {
      accessorKey: "note",
      header: "Ghi chú",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground">{row.original.note ?? "—"}</span>
      ),
    },
  ];

  return (
    <>
      <div className="flex flex-col h-[calc(100vh-64px)]">
        <PageHeader
          title="Nhóm khách hàng"
          searchPlaceholder="Theo tên nhóm..."
          searchValue={search}
          onSearchChange={setSearch}
          actions={[
            {
              label: "Thêm nhóm",
              icon: <Icon name="add" size={16} />,
              variant: "default",
              onClick: () => {
                setEditing(null);
                setDialogOpen(true);
              },
            },
          ]}
        />

        <div className="px-4 pt-3">
          <p className="text-xs text-muted-foreground">
            Chiết khấu mặc định sẽ tự áp khi bán cho khách thuộc nhóm (nhân viên vẫn sửa tay được trên POS).
          </p>
        </div>

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
              icon: <Icon name="edit" size={16} />,
              onClick: () => {
                setEditing(row);
                setDialogOpen(true);
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
  editing: CustomerGroupFull | null;
  onSuccess: () => void;
}) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [discountPercent, setDiscountPercent] = useState(0);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(editing?.name ?? "");
    setDiscountPercent(editing?.discountPercent ?? 0);
    setNote(editing?.note ?? "");
  }, [open, editing]);

  async function handleSave() {
    if (!name.trim()) {
      toast({ title: "Vui lòng nhập tên nhóm", variant: "error" });
      return;
    }
    if (discountPercent < 0 || discountPercent > 100) {
      toast({ title: "Chiết khấu phải từ 0 đến 100%", variant: "error" });
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        await updateCustomerGroup(editing.id, {
          name: name.trim(),
          discountPercent,
          note: note.trim(),
        });
        toast({ title: "Đã cập nhật nhóm", variant: "success" });
      } else {
        await createCustomerGroup({
          name: name.trim(),
          discountPercent,
          note: note.trim() || undefined,
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
          <div className="space-y-2">
            <label className="text-sm font-medium">Tên nhóm *</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="VD: Khách sỉ, Khách lẻ, Khách doanh nghiệp"
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Chiết khấu mặc định (%)</label>
            <NumericInput
              value={discountPercent}
              onChange={(v) => setDiscountPercent(Math.min(100, Math.max(0, v ?? 0)))}
              min={0}
              max={100}
              decimals={2}
            />
            <p className="text-xs text-muted-foreground">
              Tự giảm % này khi bán cho khách thuộc nhóm. Để 0 nếu không giảm.
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Ghi chú</label>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Tùy chọn"
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
