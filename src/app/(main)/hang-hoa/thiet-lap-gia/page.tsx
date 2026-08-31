"use client";

// Pricing Engine page — Quản lý bảng giá B2B (price tiers)
// Real Supabase data via getPriceTiers + getPriceTierItems
// Inline detail panel hiển thị danh sách item của từng tier với add/edit/delete

import { useEffect, useState, useCallback, useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
import { ListPageLayout } from "@/components/shared/list-page-layout";
import { ListMetric } from "@/components/shared/list-metric";
import { FilterChips } from "@/components/shared/filter-chips";
import {
  FilterGroup,
  FilterPanel,
  RadioFilter,
} from "@/components/shared/filter-sidebar";
import {
  InlineDetailPanel,
  DetailHeader,
} from "@/components/shared/inline-detail-panel";
import {
  PriceTierDialog,
  AddPriceTierItemDialog,
  EditPriceTierItemDialog,
  BulkAddPriceTierItemsDialog,
  AdjustPriceTierPercentDialog,
} from "@/components/shared/dialogs";
import { ConfirmDialog } from "@/components/shared/dialogs/confirm-dialog";
import { formatCurrency, formatDate } from "@/lib/format";
import { useToast } from "@/lib/contexts";
import {
  getPriceTiers,
  getPriceTierItems,
  deletePriceTier,
  deletePriceTierItem,
  duplicatePriceTier,
} from "@/lib/services";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import type { PriceTier, PriceTierItem, PriceTierScope } from "@/lib/types";
import { Icon } from "@/components/ui/icon";
import { PriceTierBranchScope } from "@/components/shared/price-tier-branch-scope";
import { PERMISSIONS } from "@/lib/permissions/constants";
import { usePermissions } from "@/lib/permissions/use-permission";

type ScopeFilter = "all" | "retail" | "fnb";
type ItemFilter = "all" | "with-items" | "empty";
type PriorityFilter = "all" | "prioritized" | "normal";

const SCOPE_OPTIONS = [
  { label: "Tất cả", value: "all" },
  { label: "Bán lẻ / Sỉ", value: "retail" },
  { label: "Quán FnB", value: "fnb" },
];

const ITEM_OPTIONS = [
  { label: "Tất cả", value: "all" },
  { label: "Đã có sản phẩm", value: "with-items" },
  { label: "Chưa có sản phẩm", value: "empty" },
];

const PRIORITY_OPTIONS = [
  { label: "Tất cả", value: "all" },
  { label: "Có đặt ưu tiên", value: "prioritized" },
  { label: "Ưu tiên mặc định", value: "normal" },
];

const SCOPE_LABEL: Record<PriceTierScope, string> = {
  retail: "Bán lẻ / Sỉ",
  fnb: "Quán FnB",
  both: "Cả hai",
};

// ---------------------------------------------------------------------------
// Inline detail — danh sách items của một tier
// ---------------------------------------------------------------------------

function PriceTierDetail({
  tier,
  onClose,
  onChange,
  canManage,
}: {
  tier: PriceTier;
  onClose: () => void;
  onChange: () => void;
  canManage: boolean;
}) {
  const { toast } = useToast();
  const [items, setItems] = useState<PriceTierItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [bulkAddOpen, setBulkAddOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<PriceTierItem | null>(null);
  const [deletingItem, setDeletingItem] = useState<PriceTierItem | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

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

  async function handleDeleteItem() {
    if (!deletingItem) return;
    setDeleteBusy(true);
    try {
      await deletePriceTierItem(deletingItem.id);
      toast({ title: "Đã xoá sản phẩm khỏi bảng giá", variant: "success" });
      setDeletingItem(null);
      await load();
      onChange();
    } catch (err) {
      toast({
        title: "Lỗi xoá",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setDeleteBusy(false);
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

        <PriceTierBranchScope tier={tier} />

        <div className="flex items-center justify-between border-b pb-2 gap-2 flex-wrap">
          <h3 className="text-sm font-semibold">
            Sản phẩm áp dụng ({items.length})
          </h3>
          {canManage && <div className="flex items-center gap-2 flex-wrap">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAdjustOpen(true)}
              title="Áp dụng % giảm/tăng so với giá niêm yết"
            >
              <Icon name="percent" size={14} className="mr-1" />
              Theo %
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setBulkAddOpen(true)}
              title="Chọn nhóm hàng → nhập giá đồng loạt"
            >
              <Icon name="library_add" size={14} className="mr-1" />
              Hàng loạt
            </Button>
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Icon name="add" size={14} className="mr-1" />
              Thêm SP
            </Button>
          </div>}
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
            {canManage && <Button size="sm" variant="outline" className="mt-3" onClick={() => setAddOpen(true)}>
              <Icon name="add" size={16} className="mr-1" />
              Thêm sản phẩm đầu tiên
            </Button>}
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/30">
                <tr>
                  <th className="text-left p-2 font-medium">Sản phẩm</th>
                  <th className="text-right p-2 font-medium">Giá riêng</th>
                  <th className="text-right p-2 font-medium">SL tối thiểu</th>
                  {canManage && (
                    <th className="text-right p-2 font-medium w-12"></th>
                  )}
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
                    {canManage && <td className="p-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => setEditingItem(item)}
                          className="text-muted-foreground hover:text-foreground transition-colors p-1"
                          title="Sửa giá"
                        >
                          <Icon name="edit" size={14} />
                        </button>
                        <button
                          onClick={() => setDeletingItem(item)}
                          className="text-muted-foreground hover:text-destructive transition-colors p-1"
                          title="Xoá"
                        >
                          <Icon name="delete" size={14} />
                        </button>
                      </div>
                    </td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {canManage && <AddPriceTierItemDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        tierId={tier.id}
        tierName={tier.name}
        onSuccess={() => {
          load();
          onChange();
        }}
      />}

      {canManage && <EditPriceTierItemDialog
        open={editingItem !== null}
        onOpenChange={(o) => {
          if (!o) setEditingItem(null);
        }}
        item={editingItem}
        onSuccess={() => {
          load();
          onChange();
        }}
      />}

      {/* Sprint 3: Bulk add theo nhóm */}
      {canManage && <BulkAddPriceTierItemsDialog
        open={bulkAddOpen}
        onOpenChange={setBulkAddOpen}
        tierId={tier.id}
        tierName={tier.name}
        tierScope={tier.scope}
        onSuccess={() => {
          load();
          onChange();
        }}
      />}

      {/* Sprint 3: Adjust % so với giá niêm yết */}
      {canManage && <AdjustPriceTierPercentDialog
        open={adjustOpen}
        onOpenChange={setAdjustOpen}
        tierId={tier.id}
        tierName={tier.name}
        tierScope={tier.scope}
        onSuccess={() => {
          load();
          onChange();
        }}
      />}

      {canManage && <ConfirmDialog
        open={deletingItem !== null}
        onOpenChange={(o) => {
          if (!o) setDeletingItem(null);
        }}
        title="Xoá sản phẩm khỏi bảng giá?"
        description={
          deletingItem
            ? `Xoá "${deletingItem.productName ?? deletingItem.productCode}" khỏi bảng giá "${tier.name}". Sản phẩm sẽ quay về giá niêm yết. Thao tác không thể hoàn tác.`
            : ""
        }
        confirmLabel="Xoá"
        cancelLabel="Đóng"
        variant="destructive"
        loading={deleteBusy}
        onConfirm={handleDeleteItem}
      />}
    </InlineDetailPanel>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function ThietLapGiaPage() {
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canManagePrices = hasPermission(PERMISSIONS.PRODUCTS_MANAGE_PRICES);
  const [data, setData] = useState<PriceTier[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [editingTier, setEditingTier] = useState<PriceTier | null>(null);
  const [deletingTier, setDeletingTier] = useState<PriceTier | null>(null);
  const [deleteTierBusy, setDeleteTierBusy] = useState(false);

  // Tab filter theo channel — Q1 multi-channel
  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all");
  const [itemFilter, setItemFilter] = useState<ItemFilter>("all");
  const [priorityFilter, setPriorityFilter] =
    useState<PriorityFilter>("all");

  // Clone dialog state — Q3
  const [cloningTier, setCloningTier] = useState<PriceTier | null>(null);
  const [cloneName, setCloneName] = useState("");
  const [cloneCode, setCloneCode] = useState("");
  const [cloneBusy, setCloneBusy] = useState(false);
  const [cloneError, setCloneError] = useState("");

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
  }, [search, scopeFilter, itemFilter, priorityFilter]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.filter((t) => {
      // Bảng giá dùng chung xuất hiện ở cả hai kênh tương ứng.
      if (scopeFilter === "retail" && !["retail", "both"].includes(t.scope))
        return false;
      if (scopeFilter === "fnb" && !["fnb", "both"].includes(t.scope))
        return false;
      if (itemFilter === "with-items" && (t.itemCount ?? 0) <= 0) return false;
      if (itemFilter === "empty" && (t.itemCount ?? 0) > 0) return false;
      if (priorityFilter === "prioritized" && t.priority <= 0) return false;
      if (priorityFilter === "normal" && t.priority > 0) return false;

      return (
        !q ||
        t.name.toLowerCase().includes(q) ||
        t.code.toLowerCase().includes(q) ||
        (t.description ?? "").toLowerCase().includes(q)
      );
    });
  }, [data, itemFilter, priorityFilter, scopeFilter, search]);

  const pagedData = filtered.slice(page * pageSize, (page + 1) * pageSize);

  async function handleDelete() {
    if (!deletingTier) return;
    setDeleteTierBusy(true);
    try {
      await deletePriceTier(deletingTier.id);
      toast({ title: "Đã xoá bảng giá", variant: "success" });
      setDeletingTier(null);
      fetchData();
    } catch (err) {
      toast({
        title: "Lỗi xoá",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setDeleteTierBusy(false);
    }
  }

  // Clone tier — open dialog với prefill (gợi ý name/code mới)
  function openClone(tier: PriceTier) {
    setCloningTier(tier);
    setCloneName(`${tier.name} (sao chép)`);
    setCloneCode(`${tier.code}_2`);
    setCloneError("");
  }

  async function handleClone() {
    if (!cloningTier) return;
    const name = cloneName.trim();
    const code = cloneCode.trim();
    if (!name || !code) {
      setCloneError("Tên và mã không được rỗng");
      return;
    }
    setCloneBusy(true);
    try {
      const newTier = await duplicatePriceTier({
        sourceTierId: cloningTier.id,
        newName: name,
        newCode: code,
      });
      toast({
        title: "Nhân bản thành công",
        description: `Đã tạo "${newTier.name}" (${newTier.code}) với toàn bộ sản phẩm từ "${cloningTier.name}".`,
        variant: "success",
      });
      setCloningTier(null);
      fetchData();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Vui lòng thử lại";
      // Detect unique violation (duplicate code)
      const isDup = /unique|duplicate|23505/i.test(msg);
      if (isDup) {
        setCloneError(`Mã "${code}" đã tồn tại — chọn mã khác`);
      } else {
        toast({
          title: "Nhân bản thất bại",
          description: msg,
          variant: "error",
        });
      }
    } finally {
      setCloneBusy(false);
    }
  }

  // KPI calculations
  const totalItems = data.reduce((sum, t) => sum + (t.itemCount ?? 0), 0);
  const topPriorityTier =
    data.length > 0
      ? [...data].sort((a, b) => b.priority - a.priority)[0]
      : null;

  const activeFilters = useMemo(() => {
    const filters = [];
    if (scopeFilter !== "all") {
      filters.push({
        key: "scope",
        label: "Kênh áp dụng",
        value:
          SCOPE_OPTIONS.find((option) => option.value === scopeFilter)?.label ??
          scopeFilter,
        onClear: () => setScopeFilter("all"),
      });
    }
    if (itemFilter !== "all") {
      filters.push({
        key: "items",
        label: "Sản phẩm",
        value:
          ITEM_OPTIONS.find((option) => option.value === itemFilter)?.label ??
          itemFilter,
        onClear: () => setItemFilter("all"),
      });
    }
    if (priorityFilter !== "all") {
      filters.push({
        key: "priority",
        label: "Mức ưu tiên",
        value:
          PRIORITY_OPTIONS.find((option) => option.value === priorityFilter)
            ?.label ?? priorityFilter,
        onClear: () => setPriorityFilter("all"),
      });
    }
    return filters;
  }, [itemFilter, priorityFilter, scopeFilter]);

  function clearFilters() {
    setScopeFilter("all");
    setItemFilter("all");
    setPriorityFilter("all");
  }

  const emptyState =
    search.trim() || activeFilters.length > 0 ? "no-results" : "no-data";

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
      accessorKey: "scope",
      header: "Áp dụng",
      size: 130,
      cell: ({ row }) => {
        const s = row.original.scope;
        return (
          <Badge
            variant={s === "fnb" ? "default" : "secondary"}
            className="text-xs gap-1"
          >
            <Icon
              name={
                s === "retail"
                  ? "storefront"
                  : s === "fnb"
                    ? "local_cafe"
                    : "all_inclusive"
              }
              size={14}
            />
            {SCOPE_LABEL[s]}
          </Badge>
        );
      },
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
    <ListPageLayout sidebar={null}>
      <PageHeader
        title="Bảng giá"
        density="compact"
        searchPlaceholder="Tìm tên, mã hoặc mô tả bảng giá..."
        searchValue={search}
        onSearchChange={setSearch}
        actions={canManagePrices ? [
          {
            label: "Tạo bảng giá",
            icon: <Icon name="add" size={16} />,
            variant: "default",
            onClick: () => {
              setEditingTier(null);
              setCreateOpen(true);
            },
          },
        ] : []}
      />

      <div
        className="flex min-h-11 items-center gap-1 overflow-x-auto border-b bg-background px-3 py-1 no-scrollbar"
        role="region"
        aria-label="Chỉ số và công cụ bảng giá"
      >
        <ListMetric
          icon={<Icon name="sell" size={16} />}
          label="Bảng giá"
          value={data.length.toString()}
          hint={`${filtered.length} đang hiển thị`}
          loading={loading}
        />
        <ListMetric
          icon={<Icon name="inventory_2" size={16} />}
          label="Sản phẩm áp dụng"
          value={totalItems.toString()}
          loading={loading}
        />
        <ListMetric
          icon={<Icon name="star" size={16} />}
          label="Ưu tiên cao nhất"
          value={topPriorityTier ? topPriorityTier.priority.toString() : "—"}
          hint={topPriorityTier?.name}
          loading={loading}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="ml-auto h-8 shrink-0 gap-1.5"
          onClick={() => setFilterOpen(true)}
          aria-label={`Mở bộ lọc, ${activeFilters.length} điều kiện`}
        >
          <Icon name="filter_alt" size={15} />
          Bộ lọc
          {activeFilters.length > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
              {activeFilters.length}
            </span>
          )}
        </Button>
      </div>

      <FilterChips
        filters={activeFilters}
        onClearAll={activeFilters.length > 1 ? clearFilters : undefined}
      />

      <div className="min-h-0 flex-1 px-3 pb-3 pt-2">
        <DataTable
          columns={columns}
          data={pagedData}
          loading={loading}
          total={filtered.length}
          emptyState={emptyState}
          emptyTitle={
            emptyState === "no-results"
              ? "Không tìm thấy bảng giá"
              : "Chưa có bảng giá"
          }
          emptyDescription={
            emptyState === "no-results"
              ? "Thử thay đổi kênh áp dụng, tình trạng sản phẩm, mức ưu tiên hoặc nội dung tìm kiếm."
              : 'Bấm "Tạo bảng giá" để thiết lập chính sách giá đầu tiên.'
          }
          emptyIcon="sell"
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
              canManage={canManagePrices}
            />
          )}
          rowActions={(row) => canManagePrices ? [
              {
                label: "Sửa",
                icon: <Icon name="edit" size={16} />,
                onClick: () => {
                  setEditingTier(row);
                  setCreateOpen(true);
                },
              },
              {
                label: "Nhân bản",
                icon: <Icon name="content_copy" size={16} />,
                onClick: () => openClone(row),
              },
              {
                label: "Xoá",
                icon: <Icon name="delete" size={16} />,
                onClick: () => setDeletingTier(row),
                variant: "destructive",
                separator: true,
              },
          ] : []}
        />
      </div>

      <FilterPanel
        open={filterOpen}
        onOpenChange={setFilterOpen}
        activeCount={activeFilters.length}
        onClearAll={clearFilters}
        title="Bộ lọc bảng giá"
      >
        <FilterGroup label="Kênh áp dụng">
          <RadioFilter
            name="price-tier-scope"
            options={SCOPE_OPTIONS}
            value={scopeFilter}
            onChange={(value) => setScopeFilter(value as ScopeFilter)}
          />
        </FilterGroup>
        <FilterGroup label="Sản phẩm trong bảng giá">
          <RadioFilter
            name="price-tier-items"
            options={ITEM_OPTIONS}
            value={itemFilter}
            onChange={(value) => setItemFilter(value as ItemFilter)}
          />
        </FilterGroup>
        <FilterGroup label="Mức ưu tiên">
          <RadioFilter
            name="price-tier-priority"
            options={PRIORITY_OPTIONS}
            value={priorityFilter}
            onChange={(value) => setPriorityFilter(value as PriorityFilter)}
          />
        </FilterGroup>
      </FilterPanel>

      {canManagePrices && <PriceTierDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        tier={editingTier}
        onSuccess={fetchData}
      />}

      {canManagePrices && <ConfirmDialog
        open={deletingTier !== null}
        onOpenChange={(o) => {
          if (!o) setDeletingTier(null);
        }}
        title="Xoá bảng giá?"
        description={
          deletingTier
            ? `Xoá bảng giá "${deletingTier.name}" (${deletingTier.code}). Các sản phẩm trong bảng giá sẽ quay về giá niêm yết. Thao tác không thể hoàn tác.`
            : ""
        }
        confirmLabel="Xoá bảng giá"
        cancelLabel="Đóng"
        variant="destructive"
        loading={deleteTierBusy}
        onConfirm={handleDelete}
      />}

      {/* Clone dialog — Q3 */}
      {canManagePrices && <Dialog
        open={cloningTier !== null}
        onOpenChange={(o) => {
          if (cloneBusy) return;
          if (!o) setCloningTier(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Nhân bản bảng giá</DialogTitle>
            <DialogDescription>
              Tạo bảng giá mới với toàn bộ sản phẩm từ{" "}
              <strong className="text-foreground">{cloningTier?.name}</strong>{" "}
              ({cloningTier?.itemCount ?? 0} sản phẩm). Anh có thể chỉnh giá
              từng sản phẩm sau khi tạo.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-3 py-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Tên bảng giá mới <span className="text-destructive">*</span>
              </label>
              <Input
                value={cloneName}
                onChange={(e) => {
                  setCloneName(e.target.value);
                  setCloneError("");
                }}
                placeholder="VD: Giá quán Q4..."
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Mã bảng giá <span className="text-destructive">*</span>
              </label>
              <Input
                value={cloneCode}
                onChange={(e) => {
                  setCloneCode(e.target.value.toUpperCase());
                  setCloneError("");
                }}
                placeholder="VD: QUAN_Q4"
                className="font-mono"
                aria-invalid={!!cloneError}
              />
              {cloneError && (
                <p className="text-xs text-destructive">{cloneError}</p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              disabled={cloneBusy}
              onClick={() => setCloningTier(null)}
            >
              Huỷ
            </Button>
            <Button onClick={handleClone} disabled={cloneBusy}>
              {cloneBusy && (
                <Icon
                  name="progress_activity"
                  size={16}
                  className="mr-2 animate-spin"
                />
              )}
              Nhân bản
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>}
    </ListPageLayout>
  );
}
