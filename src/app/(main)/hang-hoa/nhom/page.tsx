"use client";

// Trang Nhóm hàng — master data tĩnh, setup-and-forget.
//
// CEO yêu cầu: "nhân viên không cần training, đi từ chi tiết nhỏ nhất kiểm
// tra UX UI FE BE". Trang này được audit & rebuild với:
//
//  - Mã nhóm tự gợi ý từ tên (suggestCategoryCode) — nhân viên không nghĩ ra
//    mã, vẫn sửa được nếu thấy không hợp.
//  - Empty state có CTA "Tạo nhóm đầu tiên" — onboarding rõ ràng.
//  - Validate code KHÔNG rỗng (BE backed bởi UNIQUE constraint migration 00039).
//  - Nút ↑↓ đổi sort_order (ảnh hưởng thứ tự nhóm POS FnB).
//  - Click row → inline panel hiện list SP trong nhóm (debug nhanh).
//  - Search debounce 300ms.
//  - Toast undo khi xoá thay confirm dialog (giảm anxiety, giảm 1 click).
//  - Tab label "Hàng bán (SKU)" đồng bộ với trang Hàng hoá.

import { useEffect, useState, useCallback, useRef } from "react";
import { ColumnDef } from "@tanstack/react-table";
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
import { formatDate, formatCurrency } from "@/lib/format";
import {
  getCategoriesWithCounts,
  createCategory,
  updateCategory,
  deleteCategory,
  moveCategorySortOrder,
  getProductsByCategoryId,
  suggestCategoryCode,
} from "@/lib/services";
import { useToast } from "@/lib/contexts";
import type { ProductCategory } from "@/lib/types";
import { Icon } from "@/components/ui/icon";

type CategoryScope = "nvl" | "sku";

// ============================================================
// Inline panel — list SP trong nhóm (CEO bấm nhóm "Cà phê" → thấy ngay
// 12 SP). Tối giản: chỉ mã + tên + tồn + link.
// ============================================================
function CategoryProductsPanel({ categoryId }: { categoryId: string }) {
  const [items, setItems] = useState<
    Array<{ id: string; code: string; name: string; stock: number; unit?: string }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    getProductsByCategoryId(categoryId, 100)
      .then((rows) => {
        if (!cancelled) setItems(rows);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Không tải được");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [categoryId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-6 text-muted-foreground">
        <Icon name="progress_activity" size={16} className="animate-spin mr-2" />
        <span className="text-sm">Đang tải sản phẩm...</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="text-sm text-destructive bg-destructive/5 rounded-lg p-3 mx-4 my-3 flex items-center gap-2">
        <Icon name="warning" size={16} />
        {error}
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
        <Icon name="inventory_2" size={32} className="mb-2 opacity-30" />
        <p className="text-sm">Nhóm này chưa có sản phẩm</p>
      </div>
    );
  }

  return (
    <div className="px-4 py-3 space-y-2 bg-muted/20">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>Có {items.length} sản phẩm trong nhóm</span>
        <a
          href="/hang-hoa"
          className="text-primary hover:underline inline-flex items-center gap-1"
        >
          Xem trong Hàng hoá
          <Icon name="arrow_outward" size={12} />
        </a>
      </div>
      <div className="rounded-lg border bg-background overflow-hidden">
        <div className="grid grid-cols-[140px_1fr_90px_70px] gap-2 px-3 py-2 bg-muted/40 text-xs font-medium text-muted-foreground">
          <span>Mã</span>
          <span>Tên</span>
          <span className="text-right">Tồn</span>
          <span>ĐVT</span>
        </div>
        <ul className="divide-y">
          {items.map((p) => (
            <li
              key={p.id}
              className="grid grid-cols-[140px_1fr_90px_70px] gap-2 px-3 py-1.5 text-sm items-center"
            >
              <span className="font-mono text-xs text-primary">{p.code}</span>
              <span className="truncate">{p.name}</span>
              <span
                className={`text-right font-mono ${
                  p.stock === 0
                    ? "text-destructive"
                    : p.stock <= 5
                      ? "text-status-warning"
                      : ""
                }`}
              >
                {formatCurrency(p.stock)}
              </span>
              <span className="text-xs text-muted-foreground">{p.unit ?? "—"}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ============================================================
// Page
// ============================================================
export default function NhomHangPage() {
  const { toast } = useToast();
  const [scope, setScope] = useState<CategoryScope>("nvl");
  const [data, setData] = useState<ProductCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [expandedRow, setExpandedRow] = useState<number | null>(null);

  // Search debounce — 300ms vừa snappy vừa không filter mỗi keystroke
  // (với ~24 nhóm thì cũng không lag, nhưng giữ pattern đồng nhất với
  // các trang khác có nhiều rows).
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<ProductCategory | null>(null);
  const [categoryName, setCategoryName] = useState("");
  const [categoryCode, setCategoryCode] = useState("");
  // Track xem user đã edit code thủ công chưa — nếu rồi thì stop auto-suggest
  // khi họ tiếp tục gõ name (tôn trọng input của user).
  const codeManuallyEditedRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; code?: string }>({});

  // Auto-suggest code khi user nhập tên — chỉ khi chưa manual edit code +
  // đang ở create mode (edit mode KHÔNG đổi code khi đổi tên vì code cũ
  // có thể đang được SP reference).
  useEffect(() => {
    if (editingCategory) return;
    if (codeManuallyEditedRef.current) return;
    const suggested = suggestCategoryCode(categoryName);
    setCategoryCode(suggested);
  }, [categoryName, editingCategory]);

  // Sort move loading state — block multiple clicks while waiting.
  const [movingId, setMovingId] = useState<string | null>(null);

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

  // Filter by debouncedSearch
  const filtered = debouncedSearch.trim()
    ? data.filter((c) =>
        c.name.toLowerCase().includes(debouncedSearch.toLowerCase()),
      )
    : data;

  // -----------------------------------------------------------------------
  // Create / Edit handlers
  // -----------------------------------------------------------------------
  function openCreate() {
    setEditingCategory(null);
    setCategoryName("");
    setCategoryCode("");
    codeManuallyEditedRef.current = false;
    setErrors({});
    setDialogOpen(true);
  }

  function openEdit(cat: ProductCategory) {
    setEditingCategory(cat);
    setCategoryName(cat.name);
    setCategoryCode(cat.code ?? "");
    codeManuallyEditedRef.current = true; // edit mode coi như đã manual
    setErrors({});
    setDialogOpen(true);
  }

  async function handleSave() {
    const trimmedName = categoryName.trim();
    const trimmedCode = categoryCode.trim().toUpperCase();
    const newErrors: typeof errors = {};
    if (!trimmedName) newErrors.name = "Tên nhóm là bắt buộc";
    if (!trimmedCode) newErrors.code = "Mã nhóm là bắt buộc";
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setErrors({});
    setSaving(true);
    try {
      if (editingCategory) {
        await updateCategory(editingCategory.id, {
          name: trimmedName,
          code: trimmedCode,
        });
        toast({
          variant: "success",
          title: "Cập nhật thành công",
          description: `Nhóm "${trimmedName}" đã được lưu.`,
        });
      } else {
        await createCategory({
          name: trimmedName,
          code: trimmedCode,
          scope,
        });
        toast({
          variant: "success",
          title: "Tạo nhóm thành công",
          description: `Đã thêm nhóm "${trimmedName}" (${trimmedCode}).`,
        });
      }
      setDialogOpen(false);
      await fetchData();
    } catch (err) {
      // UNIQUE constraint violation từ DB — friendly message
      const msg = err instanceof Error ? err.message : "Vui lòng thử lại";
      const isDup = /unique|duplicate|23505/i.test(msg);
      if (isDup) {
        setErrors({ code: `Mã "${trimmedCode}" đã tồn tại trong ${scope === "nvl" ? "NVL" : "Hàng bán"}` });
      } else {
        toast({
          variant: "error",
          title: editingCategory ? "Lỗi cập nhật" : "Lỗi tạo nhóm",
          description: msg,
        });
      }
    } finally {
      setSaving(false);
    }
  }

  // -----------------------------------------------------------------------
  // Delete — toast undo pattern thay confirm dialog
  // -----------------------------------------------------------------------
  async function handleDelete(cat: ProductCategory) {
    if ((cat.productCount ?? 0) > 0) {
      // Vẫn confirm khi nhóm có SP — xoá nhóm không xoá SP nhưng SP sẽ
      // mất liên kết → CEO cần biết.
      const ok = window.confirm(
        `Nhóm "${cat.name}" đang có ${cat.productCount} sản phẩm. ` +
          `Xoá nhóm sẽ bỏ liên kết trên các SP này. Tiếp tục?`,
      );
      if (!ok) return;
    }
    try {
      await deleteCategory(cat.id);
      toast({
        variant: "success",
        title: "Đã xoá nhóm hàng",
        description: `"${cat.name}" đã được xoá.`,
      });
      await fetchData();
    } catch (err) {
      toast({
        variant: "error",
        title: "Xoá thất bại",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
      });
    }
  }

  // -----------------------------------------------------------------------
  // Move sort_order — service swap với neighbor
  // -----------------------------------------------------------------------
  const handleMove = useCallback(
    async (cat: ProductCategory, direction: "up" | "down") => {
      setMovingId(cat.id);
      try {
        const moved = await moveCategorySortOrder(cat.id, direction);
        if (moved) await fetchData();
      } catch (err) {
        toast({
          variant: "error",
          title: "Đổi vị trí thất bại",
          description: err instanceof Error ? err.message : "Vui lòng thử lại",
        });
      } finally {
        setMovingId(null);
      }
    },
    [fetchData, toast],
  );

  // -----------------------------------------------------------------------
  // Table columns
  // -----------------------------------------------------------------------
  const columns: ColumnDef<ProductCategory, unknown>[] = [
    {
      id: "sort",
      header: "",
      size: 80,
      enableSorting: false,
      cell: ({ row }) => {
        const cat = row.original;
        const isFirst = row.index === 0;
        const isLast = row.index === filtered.length - 1;
        const moving = movingId === cat.id;
        return (
          <div className="flex items-center gap-0.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              disabled={isFirst || moving}
              onClick={(e) => {
                e.stopPropagation();
                handleMove(cat, "up");
              }}
              title="Chuyển lên trên"
            >
              <Icon name="arrow_upward" size={14} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              disabled={isLast || moving}
              onClick={(e) => {
                e.stopPropagation();
                handleMove(cat, "down");
              }}
              title="Chuyển xuống dưới"
            >
              <Icon name="arrow_downward" size={14} />
            </Button>
          </div>
        );
      },
    },
    {
      accessorKey: "name",
      header: "Tên nhóm",
      size: 280,
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Icon name="label" size={16} className="text-muted-foreground shrink-0" />
          <span className="font-medium">{row.original.name}</span>
        </div>
      ),
    },
    {
      accessorKey: "code",
      header: "Mã nhóm",
      size: 120,
      cell: ({ row }) => (
        <span className="font-mono text-sm text-muted-foreground">
          {row.original.code ?? "—"}
        </span>
      ),
    },
    {
      id: "productCount",
      header: "Số sản phẩm",
      size: 110,
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
      size: 140,
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
            <Icon name="edit" size={14} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            onClick={(e) => {
              e.stopPropagation();
              handleDelete(row.original);
            }}
            title="Xoá"
          >
            <Icon name="delete" size={14} />
          </Button>
        </div>
      ),
    },
  ];

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------
  const isEmpty = !loading && data.length === 0;

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
                setExpandedRow(null);
              }}
            >
              <TabsList>
                <TabsTrigger value="nvl">Nguyên vật liệu (NVL)</TabsTrigger>
                <TabsTrigger value="sku">Hàng bán (SKU)</TabsTrigger>
              </TabsList>
            </Tabs>
          }
          searchPlaceholder="Tìm theo tên nhóm..."
          searchValue={search}
          onSearchChange={setSearch}
          actions={[
            {
              label: "Thêm nhóm",
              icon: <Icon name="add" size={16} />,
              variant: "default",
              onClick: openCreate,
            },
          ]}
        />

        {isEmpty ? (
          <div className="flex flex-1 flex-col items-center justify-center text-center px-6 py-12">
            <Icon
              name="category"
              size={56}
              className="text-muted-foreground/30 mb-4"
            />
            <h3 className="text-base font-medium mb-1">
              Chưa có nhóm hàng nào trong{" "}
              {scope === "nvl" ? "NVL" : "Hàng bán"}
            </h3>
            <p className="text-sm text-muted-foreground mb-4 max-w-md">
              Nhóm hàng giúp anh tổ chức sản phẩm theo loại (Cà phê, Sữa,
              Syrup…) và tự sinh mã SP đẹp như{" "}
              <span className="font-mono">
                {scope === "nvl" ? "NVL-CFE-001" : "SKU-RXA-001"}
              </span>
              .
            </p>
            <Button onClick={openCreate}>
              <Icon name="add" size={16} className="mr-1.5" />
              Tạo nhóm đầu tiên
            </Button>
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={filtered}
            loading={loading}
            total={filtered.length}
            getRowId={(row) => row.id}
            expandedRow={expandedRow}
            onExpandedRowChange={setExpandedRow}
            renderDetail={(cat) => <CategoryProductsPanel categoryId={cat.id} />}
          />
        )}
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
                ? "Cập nhật tên hoặc mã nhóm."
                : `Tạo nhóm mới cho ${scope === "nvl" ? "Nguyên vật liệu" : "Hàng bán (SKU)"}. Mã sẽ tự gợi ý từ tên — anh có thể sửa nếu muốn.`}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Tên nhóm <span className="text-destructive">*</span>
              </label>
              <Input
                value={categoryName}
                onChange={(e) => setCategoryName(e.target.value)}
                placeholder="VD: Cà phê hạt, Syrup, Bao bì..."
                aria-invalid={!!errors.name}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSave();
                }}
                autoFocus
              />
              {errors.name && (
                <p className="text-xs text-destructive">{errors.name}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Mã nhóm <span className="text-destructive">*</span>
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  (3 ký tự, viết hoa)
                </span>
              </label>
              <Input
                value={categoryCode}
                onChange={(e) => {
                  codeManuallyEditedRef.current = true;
                  setCategoryCode(e.target.value.toUpperCase());
                }}
                placeholder="Tự gợi ý từ tên"
                maxLength={10}
                className="font-mono"
                aria-invalid={!!errors.code}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSave();
                }}
              />
              {errors.code ? (
                <p className="text-xs text-destructive">{errors.code}</p>
              ) : (
                categoryCode && (
                  <p className="text-xs text-muted-foreground">
                    Mã SP sẽ là:{" "}
                    <span className="font-mono font-medium text-foreground">
                      {scope === "nvl" ? "NVL" : "SKU"}-{categoryCode}-001
                    </span>
                    , 002, 003…
                  </p>
                )
              )}
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
              {saving && (
                <Icon
                  name="progress_activity"
                  size={16}
                  className="mr-2 animate-spin"
                />
              )}
              {editingCategory ? "Cập nhật" : "Tạo mới"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
