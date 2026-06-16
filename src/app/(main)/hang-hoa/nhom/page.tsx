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
import { useRevalidateOnFocus } from "@/lib/hooks/use-revalidate-on-focus";
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
  getCategoriesWithChannelBreakdown,
  type CategoryWithChannelBreakdown,
  createCategory,
  updateCategory,
  deleteCategory,
  moveCategorySortOrder,
  getProductsByCategoryId,
  suggestCategoryCode,
  previewProductCodeFromGroup,
} from "@/lib/services";
import { useToast } from "@/lib/contexts";
import type { ProductCategory } from "@/lib/types";
import { Icon } from "@/components/ui/icon";
// Day 22/05/2026 (CEO V3): Excel import/export categories
import { ImportExcelDialog } from "@/components/shared/dialogs/import-excel-dialog";
import { downloadTemplate, exportToExcelFromSchema } from "@/lib/excel";
import { categoriesExcelSchema } from "@/lib/excel/schemas";
import { bulkImportCategories } from "@/lib/services/supabase/excel-import";
import { getAllCategories } from "@/lib/services";
// CEO 01/06/2026 — Sprint 2.2c: gán modifier groups cho cả nhóm SP FnB
import {
  listModifierGroups,
  listCategoryModifierLinks,
  setCategoryModifierGroups,
  type ModifierGroup,
} from "@/lib/services/supabase/modifier-groups";

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
          <Icon name="arrow_outward" size={14} />
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
              className="grid grid-cols-[140px_1fr_90px_70px] gap-2 px-3 py-2 text-sm items-center"
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
  // Day 20/05/2026 (CEO Fix #3): track channel breakdown cho SKU categories
  // để badge auto + filter — KHÔNG đụng naming convention CEO tự quyết.
  const [channelBreakdown, setChannelBreakdown] = useState<
    Map<string, { retail: number; fnb: number }>
  >(new Map());
  const [channelFilter, setChannelFilter] = useState<"all" | "fnb" | "retail">(
    "all",
  );
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
  // Day 22/05/2026 (CEO V1): channel cho category scope='sku'. Mặc định 'fnb'
  // (vì chuỗi coffee chain anh chủ yếu FnB). Edit mode prefill từ DB.
  const [categoryChannel, setCategoryChannel] = useState<"fnb" | "retail">("fnb");
  // Track xem user đã edit code thủ công chưa — nếu rồi thì stop auto-suggest
  // khi họ tiếp tục gõ name (tôn trọng input của user).
  const codeManuallyEditedRef = useRef(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<{
    name?: string;
    code?: string;
    channel?: string;
  }>({});

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

  // Day 22/05/2026 (CEO V3): Import Excel dialog state
  const [importOpen, setImportOpen] = useState(false);

  // CEO 01/06/2026 — Sprint 2.2c: Modifier groups picker cho category FnB.
  // Load list available + selected khi dialog mở. Save khi handleSave.
  const [availableModifierGroups, setAvailableModifierGroups] = useState<
    ModifierGroup[]
  >([]);
  const [selectedModifierGroupIds, setSelectedModifierGroupIds] = useState<
    Set<string>
  >(new Set());
  const [loadingModifiers, setLoadingModifiers] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // Day 20/05/2026 (CEO Fix #3): SKU dùng breakdown để có badge channel
      if (scope === "sku") {
        const cats: CategoryWithChannelBreakdown[] =
          await getCategoriesWithChannelBreakdown();
        const map = new Map<string, { retail: number; fnb: number }>();
        for (const c of cats) {
          map.set(c.id, { retail: c.retailCount, fnb: c.fnbCount });
        }
        setChannelBreakdown(map);
        setData(cats);
      } else {
        const cats = await getCategoriesWithCounts(scope);
        setChannelBreakdown(new Map());
        setData(cats);
      }
    } catch {
      toast({ variant: "error", title: "Lỗi tải nhóm hàng" });
    } finally {
      setLoading(false);
    }
  }, [scope, toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // CEO 23/05/2026: refetch khi tab visible/focus lại → fix bug F5 stale
  useRevalidateOnFocus(fetchData);

  // CEO 01/06/2026 — Sprint 2.2c: Load modifier groups + existing links khi
  // dialog mở cho category FnB. Pattern Toast: gán 1 lần ở nhóm → mọi SP
  // trong nhóm thừa kế.
  useEffect(() => {
    if (!dialogOpen || scope !== "sku" || categoryChannel !== "fnb") {
      setAvailableModifierGroups([]);
      setSelectedModifierGroupIds(new Set());
      return;
    }
    let cancelled = false;
    setLoadingModifiers(true);
    (async () => {
      try {
        const groups = await listModifierGroups();
        const fnbGroups = groups.filter(
          (g) => g.channel === "fnb" || g.channel === "all",
        );
        if (cancelled) return;
        setAvailableModifierGroups(fnbGroups);

        if (editingCategory) {
          const links = await listCategoryModifierLinks(editingCategory.id);
          if (cancelled) return;
          setSelectedModifierGroupIds(
            new Set(links.map((l) => l.modifierGroupId)),
          );
        } else {
          setSelectedModifierGroupIds(new Set());
        }
      } catch (err) {
        if (!cancelled) {
          console.warn("Load modifier groups failed:", err);
        }
      } finally {
        if (!cancelled) setLoadingModifiers(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dialogOpen, scope, categoryChannel, editingCategory]);

  function toggleModifierGroup(groupId: string) {
    setSelectedModifierGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  // Filter by debouncedSearch + channelFilter (Day 20/05/2026 CEO Fix #3)
  const filtered = data
    .filter((c) =>
      !debouncedSearch.trim()
        ? true
        : c.name.toLowerCase().includes(debouncedSearch.toLowerCase()),
    )
    .filter((c) => {
      if (scope !== "sku" || channelFilter === "all") return true;
      const slot = channelBreakdown.get(c.id);
      if (!slot) return false;
      return channelFilter === "fnb" ? slot.fnb > 0 : slot.retail > 0;
    });

  // -----------------------------------------------------------------------
  // Create / Edit handlers
  // -----------------------------------------------------------------------
  function openCreate() {
    setEditingCategory(null);
    setCategoryName("");
    setCategoryCode("");
    // Day 22/05/2026: default channel theo filter hiện tại — nếu user đang
    // xem tab "FnB" → mặc định fnb, ngược lại retail. UX hợp lý: thường
    // user tạo nhóm cùng channel với tab đang xem.
    setCategoryChannel(channelFilter === "retail" ? "retail" : "fnb");
    codeManuallyEditedRef.current = false;
    setErrors({});
    setDialogOpen(true);
  }

  function openEdit(cat: ProductCategory) {
    setEditingCategory(cat);
    setCategoryName(cat.name);
    setCategoryCode(cat.code ?? "");
    // Day 22/05/2026: prefill channel từ DB. Nếu DB null (legacy) → đoán
    // dựa trên productCount breakdown (FnB nếu fnb > retail).
    if (cat.channel) {
      setCategoryChannel(cat.channel);
    } else if (scope === "sku") {
      const slot = channelBreakdown.get(cat.id);
      setCategoryChannel(slot && slot.fnb > slot.retail ? "fnb" : "retail");
    }
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
      let savedCategoryId: string | null = null;
      if (editingCategory) {
        await updateCategory(editingCategory.id, {
          name: trimmedName,
          code: trimmedCode,
          // CEO 22/05/2026: cập nhật channel nếu là SKU
          ...(scope === "sku" ? { channel: categoryChannel } : {}),
        });
        savedCategoryId = editingCategory.id;
        toast({
          variant: "success",
          title: "Cập nhật thành công",
          description: `Nhóm "${trimmedName}" đã được lưu.`,
        });
      } else {
        const created = await createCategory({
          name: trimmedName,
          code: trimmedCode,
          scope,
          // CEO 22/05/2026: channel chỉ truyền khi scope=sku
          ...(scope === "sku" ? { channel: categoryChannel } : {}),
        });
        savedCategoryId = created.id;
        toast({
          variant: "success",
          title: "Tạo nhóm thành công",
          description: `Đã thêm nhóm "${trimmedName}" (${trimmedCode}).`,
        });
      }

      // CEO 01/06/2026 — Sprint 2.2c: Lưu modifier groups gán cho nhóm FnB.
      // Pattern Toast: gán 1 lần ở nhóm, mọi SP trong nhóm tự thừa kế.
      if (savedCategoryId && scope === "sku" && categoryChannel === "fnb") {
        try {
          await setCategoryModifierGroups(
            savedCategoryId,
            Array.from(selectedModifierGroupIds),
          );
        } catch (modErr) {
          console.warn("Save modifier groups failed:", modErr);
          toast({
            variant: "warning",
            title: "Đã lưu nhóm nhưng lỗi gán tuỳ chọn",
            description:
              modErr instanceof Error
                ? modErr.message
                : "Anh có thể sửa lại sau từ Tuỳ chọn món FnB.",
          });
        }
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
      size: 130,
      cell: ({ row }) => {
        const count = row.original.productCount ?? 0;
        if (count === 0) {
          // Day 20/05/2026 (CEO Fix #5): hint khi category chưa có SP
          // → CEO biết category này sẽ ẩn khỏi POS đến khi add SP.
          return (
            <span
              className="text-xs text-status-warning inline-flex items-center gap-1"
              title="Category chưa có sản phẩm → sẽ ẨN khỏi POS đến khi thêm SP đầu tiên"
            >
              <Icon name="warning" size={12} />
              0 — ẩn khỏi POS
            </span>
          );
        }
        return <span className="font-medium tabular-nums">{count}</span>;
      },
    },
    // Day 20/05/2026 (CEO Fix #3): badge auto channel cho SKU categories.
    // KHÔNG đụng naming convention — CEO tự đặt tên. Badge tự compute
    // từ products → biết category có SP retail/FnB/cả 2.
    ...(scope === "sku"
      ? [
          {
            id: "channelBadge",
            header: "Kênh áp dụng",
            size: 130,
            cell: ({ row }: { row: { original: ProductCategory } }) => {
              const slot = channelBreakdown.get(row.original.id);
              const hasRetail = (slot?.retail ?? 0) > 0;
              const hasFnb = (slot?.fnb ?? 0) > 0;
              if (!hasRetail && !hasFnb) {
                return (
                  <span className="text-xs text-muted-foreground/60">
                    Chưa có SP
                  </span>
                );
              }
              return (
                <div className="flex items-center gap-1.5">
                  {hasRetail && (
                    <span
                      className="inline-flex items-center rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 px-1.5 py-0.5 text-[10px] font-medium"
                      title={`${slot?.retail} SP retail`}
                    >
                      Retail
                    </span>
                  )}
                  {hasFnb && (
                    <span
                      className="inline-flex items-center rounded bg-orange-500/10 text-orange-700 dark:text-orange-300 border border-orange-500/30 px-1.5 py-0.5 text-[10px] font-medium"
                      title={`${slot?.fnb} SP FnB`}
                    >
                      FnB
                    </span>
                  )}
                </div>
              );
            },
          } as ColumnDef<ProductCategory, unknown>,
        ]
      : []),
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
            // Day 22/05/2026 (CEO V3): 3 nút Excel categories
            {
              label: "Tải mẫu",
              icon: <Icon name="description" size={16} />,
              variant: "ghost",
              onClick: () => downloadTemplate(categoriesExcelSchema),
            },
            {
              label: "Nhập Excel",
              icon: <Icon name="upload" size={16} />,
              variant: "ghost",
              onClick: () => setImportOpen(true),
            },
            {
              label: "Xuất file",
              icon: <Icon name="download" size={16} />,
              variant: "ghost",
              onClick: async () => {
                try {
                  const all = await getAllCategories();
                  // Filter chỉ scope nvl/sku (bỏ customer/supplier)
                  const rows = all
                    .filter((c) => c.scope === "nvl" || c.scope === "sku")
                    .map((c) => ({
                      scope: c.scope as "nvl" | "sku",
                      name: c.name,
                      code: c.code ?? "",
                      channel: c.channel,
                      sortOrder: c.sortOrder,
                    }));
                  exportToExcelFromSchema(rows, categoriesExcelSchema);
                } catch (err) {
                  toast({
                    variant: "error",
                    title: "Lỗi xuất file",
                    description: err instanceof Error ? err.message : "",
                  });
                }
              },
            },
          ]}
        />

        {/* Day 20/05/2026 (CEO Fix #3): chip filter "Kênh áp dụng" cho SKU
            categories. CEO biết ngay category nào dùng retail/FnB mà không
            cần ghi tay "(retail)/(FnB)" trong tên. */}
        {scope === "sku" && (
          <div className="flex flex-wrap items-center gap-2 px-4 pt-3 pb-1">
            <span className="text-xs text-muted-foreground mr-1">
              Kênh áp dụng:
            </span>
            {(
              [
                { v: "all", l: "Tất cả" },
                { v: "retail", l: "Retail" },
                { v: "fnb", l: "FnB" },
              ] as const
            ).map((tab) => {
              const isActive = channelFilter === tab.v;
              return (
                <button
                  key={tab.v}
                  type="button"
                  onClick={() => setChannelFilter(tab.v)}
                  className={
                    "inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-colors border " +
                    (isActive
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-surface-variant text-on-surface-variant border-border hover:bg-surface-container")
                  }
                >
                  {tab.l}
                </button>
              );
            })}
          </div>
        )}

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
              <Icon name="add" size={16} className="mr-1" />
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
            <div className="space-y-2">
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

            <div className="space-y-2">
              <label className="text-sm font-medium">
                Mã nhóm <span className="text-destructive">*</span>
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  (tự do, vd CAFE, BAO, SKU-TEST...)
                </span>
              </label>
              <Input
                value={categoryCode}
                onChange={(e) => {
                  codeManuallyEditedRef.current = true;
                  setCategoryCode(e.target.value.toUpperCase());
                }}
                placeholder="Tự gợi ý từ tên"
                maxLength={20}
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
                      {previewProductCodeFromGroup(
                        scope === "nvl" ? "NVL" : "SKU",
                        categoryCode,
                      )}
                    </span>
                    , 002, 003…
                  </p>
                )
              )}
            </div>

            {/* Day 22/05/2026 (CEO V1): Channel picker chỉ cho SKU. NVL
                không cần vì là nguyên liệu nội bộ. */}
            {scope === "sku" && (
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Kênh bán <span className="text-destructive">*</span>
                  <span className="ml-2 text-xs font-normal text-muted-foreground">
                    (SP trong nhóm này sẽ mặc định kênh này)
                  </span>
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setCategoryChannel("fnb")}
                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                      categoryChannel === "fnb"
                        ? "border-status-warning bg-status-warning/10 text-status-warning"
                        : "border-outline-variant bg-surface-container-lowest text-muted-foreground hover:bg-surface-container-low"
                    }`}
                  >
                    <Icon name="local_cafe" size={16} />
                    <span>FnB (pha chế tại quán)</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setCategoryChannel("retail")}
                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-colors ${
                      categoryChannel === "retail"
                        ? "border-status-info bg-status-info/10 text-status-info"
                        : "border-outline-variant bg-surface-container-lowest text-muted-foreground hover:bg-surface-container-low"
                    }`}
                  >
                    <Icon name="storefront" size={16} />
                    <span>Retail (bán lẻ đóng gói)</span>
                  </button>
                </div>
                {errors.channel && (
                  <p className="text-xs text-destructive">{errors.channel}</p>
                )}
              </div>
            )}

            {/* CEO 01/06/2026 — Sprint 2.2c: Tuỳ chọn mặc định cho nhóm SP FnB.
                Pattern Toast: gán 1 lần ở nhóm, mọi SP trong nhóm tự thừa kế.
                Chỉ hiện khi scope=sku + channel=fnb. */}
            {scope === "sku" && categoryChannel === "fnb" && (
              <div className="space-y-2 rounded-lg border bg-status-warning/5 p-3">
                <div className="flex items-start gap-2">
                  <Icon name="tune" size={16} className="text-status-warning shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <label className="text-sm font-medium">
                      Tuỳ chọn mặc định cho nhóm
                    </label>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Mọi SP trong nhóm này sẽ tự thừa kế các nhóm tuỳ chọn anh tick. SP riêng có thể override sau ở form sửa SP.
                    </p>
                  </div>
                </div>
                {loadingModifiers ? (
                  <p className="text-xs text-muted-foreground py-2">Đang tải...</p>
                ) : availableModifierGroups.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-2">
                    Chưa có nhóm tuỳ chọn nào. Vào{" "}
                    <a href="/hang-hoa/tuy-chon-fnb" target="_blank" className="text-primary underline">
                      Tuỳ chọn món FnB
                    </a>{" "}
                    để tạo (có nút "Tạo bộ tuỳ chọn mẫu" sinh sẵn 4 nhóm).
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-1.5 mt-2">
                    {availableModifierGroups.map((g) => {
                      const checked = selectedModifierGroupIds.has(g.id);
                      return (
                        <label
                          key={g.id}
                          className={`flex items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 text-sm cursor-pointer transition-colors ${
                            checked
                              ? "border-status-warning bg-status-warning/10"
                              : "border-border hover:bg-muted/50"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleModifierGroup(g.id)}
                            className="size-4"
                          />
                          <span className="truncate">{g.name}</span>
                          {g.optionCount !== undefined && g.optionCount > 0 && (
                            <span className="text-xs text-muted-foreground">
                              ({g.optionCount})
                            </span>
                          )}
                        </label>
                      );
                    })}
                  </div>
                )}
                {selectedModifierGroupIds.size > 0 && (
                  <p className="text-xs text-status-warning mt-1">
                    Đã chọn {selectedModifierGroupIds.size} nhóm — tất cả SP trong nhóm này sẽ tự thừa kế.
                  </p>
                )}
              </div>
            )}
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

      {/* Day 22/05/2026 (CEO V3): Excel import dialog cho categories */}
      <ImportExcelDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        schema={categoriesExcelSchema}
        onCommit={async (rows) => {
          const result = await bulkImportCategories(rows);
          // Refresh list sau khi import
          try {
            await fetchData();
          } catch {
            /* fail silent */
          }
          return result;
        }}
      />
    </>
  );
}
