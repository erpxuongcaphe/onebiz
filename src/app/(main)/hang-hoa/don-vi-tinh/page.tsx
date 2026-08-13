"use client";

/**
 * Đơn vị tính — quản lý + cleanup tên đơn vị tính.
 *
 * CEO chốt scope: cho phép Đổi tên / Gộp đơn vị (case khác như "Kg" vs "kg")
 * để clean data lộn xộn từ nhân viên gõ tay.
 *
 * Plus: dialog tạo SP có warning case-insensitive duplicate (xem
 * create-product-dialog.tsx) để PREVENT duplicate from the start.
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/lib/contexts";
import { getAllUnits, renameUnit, mergeUnits } from "@/lib/services";
import { Icon } from "@/components/ui/icon";

interface UnitRow {
  unit: string;
  productCount: number;
}

type UnitHealthFilter = "all" | "duplicate" | "clean";
type UnitUsageFilter = "all" | "used" | "unused";

const HEALTH_OPTIONS = [
  { label: "Tất cả", value: "all" },
  { label: "Có khả năng trùng", value: "duplicate" },
  { label: "Không trùng tên", value: "clean" },
];

const USAGE_OPTIONS = [
  { label: "Tất cả", value: "all" },
  { label: "Đang được sử dụng", value: "used" },
  { label: "Chưa được sử dụng", value: "unused" },
];

export default function DonViTinhPage() {
  const { toast } = useToast();
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterOpen, setFilterOpen] = useState(false);
  const [healthFilter, setHealthFilter] = useState<UnitHealthFilter>("all");
  const [usageFilter, setUsageFilter] = useState<UnitUsageFilter>("all");

  // Rename dialog state
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameSource, setRenameSource] = useState<string>("");
  const [renameTarget, setRenameTarget] = useState<string>("");
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameError, setRenameError] = useState("");

  // Merge dialog state
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeSource, setMergeSource] = useState<string>("");
  const [mergeTarget, setMergeTarget] = useState<string>("");
  const [mergeSaving, setMergeSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const list = await getAllUnits();
      setUnits(list);
    } catch (err) {
      toast({
        variant: "error",
        title: "Lỗi tải đơn vị tính",
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Detect potential duplicates (case-insensitive groups)
  const duplicateGroups = useMemo(() => {
    const groups = new Map<string, string[]>();
    for (const u of units) {
      const key = u.unit.toLowerCase();
      const list = groups.get(key) ?? [];
      list.push(u.unit);
      groups.set(key, list);
    }
    return Array.from(groups.entries()).filter(([, list]) => list.length > 1);
  }, [units]);

  const duplicateNames = useMemo(
    () => new Set(duplicateGroups.map(([key]) => key)),
    [duplicateGroups],
  );

  const filtered = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return units.filter((unit) => {
      if (
        normalizedSearch &&
        !unit.unit.toLowerCase().includes(normalizedSearch)
      ) {
        return false;
      }
      const hasDuplicate = duplicateNames.has(unit.unit.toLowerCase());
      if (healthFilter === "duplicate" && !hasDuplicate) return false;
      if (healthFilter === "clean" && hasDuplicate) return false;
      if (usageFilter === "used" && unit.productCount <= 0) return false;
      if (usageFilter === "unused" && unit.productCount > 0) return false;
      return true;
    });
  }, [duplicateNames, healthFilter, search, units, usageFilter]);

  const activeFilters = useMemo(() => {
    const filters = [];
    if (healthFilter !== "all") {
      filters.push({
        key: "health",
        label: "Chuẩn hóa",
        value:
          HEALTH_OPTIONS.find((option) => option.value === healthFilter)
            ?.label ?? healthFilter,
        onClear: () => setHealthFilter("all"),
      });
    }
    if (usageFilter !== "all") {
      filters.push({
        key: "usage",
        label: "Sử dụng",
        value:
          USAGE_OPTIONS.find((option) => option.value === usageFilter)?.label ??
          usageFilter,
        onClear: () => setUsageFilter("all"),
      });
    }
    return filters;
  }, [healthFilter, usageFilter]);

  const clearFilters = useCallback(() => {
    setHealthFilter("all");
    setUsageFilter("all");
  }, []);
  const emptyState =
    search.trim() || activeFilters.length > 0 ? "no-results" : "no-data";

  // ─────────── Handlers ───────────
  function openRename(unit: string) {
    setRenameSource(unit);
    setRenameTarget(unit);
    setRenameError("");
    setRenameOpen(true);
  }

  async function handleRename() {
    const newName = renameTarget.trim();
    if (!newName) {
      setRenameError("Tên mới không được rỗng");
      return;
    }
    if (newName === renameSource) {
      setRenameError("Tên mới giống tên cũ");
      return;
    }
    // Check existing — nếu newName đã tồn tại trong list, đề nghị Gộp thay vì Đổi tên
    const exists = units.some(
      (u) =>
        u.unit !== renameSource &&
        u.unit.toLowerCase() === newName.toLowerCase(),
    );
    if (exists) {
      setRenameError(
        `"${newName}" đã tồn tại. Dùng chức năng "Gộp" để hợp nhất 2 đơn vị.`,
      );
      return;
    }

    setRenameSaving(true);
    try {
      const { affectedRows } = await renameUnit(renameSource, newName);
      toast({
        variant: "success",
        title: "Đổi tên thành công",
        description: `Đã đổi "${renameSource}" → "${newName}" trên ${affectedRows} sản phẩm.`,
      });
      setRenameOpen(false);
      await fetchData();
    } catch (err) {
      toast({
        variant: "error",
        title: "Đổi tên thất bại",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
      });
    } finally {
      setRenameSaving(false);
    }
  }

  function openMerge(unit: string) {
    setMergeSource(unit);
    setMergeTarget("");
    setMergeOpen(true);
  }

  async function handleMerge() {
    if (!mergeTarget || mergeTarget === mergeSource) {
      toast({
        variant: "warning",
        title: "Chọn đơn vị đích",
        description: "Phải chọn đơn vị khác để gộp vào.",
      });
      return;
    }
    setMergeSaving(true);
    try {
      const { affectedRows } = await mergeUnits(mergeSource, mergeTarget);
      toast({
        variant: "success",
        title: "Gộp thành công",
        description: `Đã chuyển ${affectedRows} sản phẩm từ "${mergeSource}" sang "${mergeTarget}".`,
      });
      setMergeOpen(false);
      await fetchData();
    } catch (err) {
      toast({
        variant: "error",
        title: "Gộp thất bại",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
      });
    } finally {
      setMergeSaving(false);
    }
  }

  // ─────────── Columns ───────────
  const columns: ColumnDef<UnitRow>[] = [
    {
      accessorKey: "unit",
      header: "Đơn vị tính",
      size: 220,
      cell: ({ row }) => {
        const unit = row.original.unit;
        const lower = unit.toLowerCase();
        const hasDup = duplicateGroups.some(([key]) => key === lower);
        return (
          <div className="flex items-center gap-2">
            <Icon
              name="straighten"
              size={14}
              className="text-primary shrink-0"
            />
            <span className="font-semibold text-foreground">{unit}</span>
            {hasDup && (
              <Badge
                variant="destructive"
                className="text-[10px] px-2 py-0 h-4"
                title="Có đơn vị khác cùng tên (khác chữ hoa/thường)"
              >
                Trùng
              </Badge>
            )}
          </div>
        );
      },
    },
    {
      accessorKey: "productCount",
      header: "Số sản phẩm dùng",
      size: 140,
      cell: ({ row }) => (
        <Badge variant="secondary" className="font-mono">
          {row.original.productCount}
        </Badge>
      ),
    },
    {
      id: "actions",
      header: "Thao tác",
      size: 200,
      enableSorting: false,
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              openRename(row.original.unit);
            }}
          >
            <Icon name="edit" size={14} className="mr-1" />
            Đổi tên
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              openMerge(row.original.unit);
            }}
            disabled={units.length < 2}
          >
            <Icon name="call_merge" size={14} className="mr-1" />
            Gộp với...
          </Button>
        </div>
      ),
    },
  ];

  return (
    <ListPageLayout sidebar={null}>
      <PageHeader
        title="Đơn vị tính"
        density="compact"
        searchPlaceholder="Tìm đơn vị..."
        searchValue={search}
        onSearchChange={setSearch}
      />

      <div
        className="flex min-h-11 items-center gap-1 overflow-x-auto border-b bg-background px-3 py-1 no-scrollbar"
        role="region"
        aria-label="Chỉ số và công cụ đơn vị tính"
      >
        <ListMetric
          icon={<Icon name="straighten" size={16} />}
          label="Đơn vị tính"
          value={units.length.toString()}
          hint={`${filtered.length} đang hiển thị`}
          loading={loading}
        />
        <ListMetric
          icon={<Icon name="layers" size={16} />}
          label="Lần dùng"
          value={units.reduce((s, u) => s + u.productCount, 0).toString()}
          loading={loading}
        />
        <ListMetric
          icon={<Icon name="warning" size={16} />}
          label="Có khả năng trùng"
          value={duplicateGroups.length.toString()}
          tone={duplicateGroups.length > 0 ? "danger" : "default"}
          loading={loading}
        />
        <ListMetric
          icon={<Icon name="inventory_2" size={16} />}
          label="Chưa sử dụng"
          value={units
            .filter((unit) => unit.productCount <= 0)
            .length.toString()}
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

      {/* Banner: cảnh báo khi có duplicate */}
      {duplicateGroups.length > 0 && (
        <div className="mx-3 mt-2 flex items-start gap-2 rounded-md border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-xs">
          <Icon
            name="warning"
            size={16}
            className="shrink-0 mt-0.5 text-status-warning"
          />
          <div>
            <p className="font-medium text-foreground">
              Phát hiện {duplicateGroups.length} đơn vị có thể trùng (khác chữ
              hoa/thường)
            </p>
            <p className="mt-0.5 text-muted-foreground">
              VD:{" "}
              {duplicateGroups
                .slice(0, 3)
                .map(([, list]) => list.join(" / "))
                .join("; ")}
              . Dùng nút <strong>Gộp với...</strong> để hợp nhất.
            </p>
          </div>
        </div>
      )}

      <div className="border-b px-3 py-1.5 text-xs text-muted-foreground">
        Đổi tên để sửa cách viết; gộp để hợp nhất các đơn vị trùng trên sản
        phẩm.
      </div>

      <div className="min-h-0 flex-1 px-3 pb-3 pt-2">
        <DataTable
          columns={columns}
          data={filtered}
          loading={loading}
          emptyState={emptyState}
          emptyTitle={
            emptyState === "no-results"
              ? "Không tìm thấy đơn vị tính"
              : "Chưa có đơn vị tính"
          }
          emptyDescription={
            emptyState === "no-results"
              ? "Thử thay đổi tình trạng chuẩn hóa, tình trạng sử dụng hoặc nội dung tìm kiếm."
              : "Đơn vị tính sẽ tự xuất hiện khi được sử dụng trên sản phẩm."
          }
          emptyIcon="straighten"
          getRowId={(row) => row.unit}
        />
      </div>

      <FilterPanel
        open={filterOpen}
        onOpenChange={setFilterOpen}
        activeCount={activeFilters.length}
        onClearAll={clearFilters}
        title="Bộ lọc đơn vị tính"
      >
        <FilterGroup
          label="Tình trạng chuẩn hóa"
          activeHint={
            healthFilter === "all"
              ? undefined
              : HEALTH_OPTIONS.find((option) => option.value === healthFilter)
                  ?.label
          }
        >
          <RadioFilter
            name="unit-health"
            options={HEALTH_OPTIONS}
            value={healthFilter}
            onChange={(value) => setHealthFilter(value as UnitHealthFilter)}
          />
        </FilterGroup>
        <FilterGroup
          label="Tình trạng sử dụng"
          activeHint={
            usageFilter === "all"
              ? undefined
              : USAGE_OPTIONS.find((option) => option.value === usageFilter)
                  ?.label
          }
        >
          <RadioFilter
            name="unit-usage"
            options={USAGE_OPTIONS}
            value={usageFilter}
            onChange={(value) => setUsageFilter(value as UnitUsageFilter)}
          />
        </FilterGroup>
      </FilterPanel>

      {/* ───────── Rename Dialog ───────── */}
      <Dialog
        open={renameOpen}
        onOpenChange={(o) => {
          if (renameSaving) return;
          setRenameOpen(o);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Đổi tên đơn vị tính</DialogTitle>
            <DialogDescription>
              Tất cả sản phẩm đang dùng{" "}
              <strong className="text-foreground">{renameSource}</strong> sẽ
              được cập nhật sang tên mới.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-2">
            <label className="text-sm font-medium">
              Tên mới <span className="text-destructive">*</span>
            </label>
            <Input
              value={renameTarget}
              onChange={(e) => {
                setRenameTarget(e.target.value);
                setRenameError("");
              }}
              autoFocus
              placeholder="VD: kg, hộp, chai..."
              aria-invalid={!!renameError}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleRename();
              }}
            />
            {renameError && (
              <p className="text-xs text-destructive">{renameError}</p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              disabled={renameSaving}
              onClick={() => setRenameOpen(false)}
            >
              Huỷ
            </Button>
            <Button onClick={handleRename} disabled={renameSaving}>
              {renameSaving && (
                <Icon
                  name="progress_activity"
                  size={16}
                  className="mr-2 animate-spin"
                />
              )}
              Đổi tên
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ───────── Merge Dialog ───────── */}
      <Dialog
        open={mergeOpen}
        onOpenChange={(o) => {
          if (mergeSaving) return;
          setMergeOpen(o);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Gộp đơn vị tính</DialogTitle>
            <DialogDescription>
              Chuyển tất cả sản phẩm đang dùng{" "}
              <strong className="text-foreground">{mergeSource}</strong> sang
              đơn vị khác. Sau khi gộp, "{mergeSource}" sẽ biến mất khỏi danh
              sách.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-2">
            <label className="text-sm font-medium">
              Gộp vào đơn vị <span className="text-destructive">*</span>
            </label>
            <Select
              value={mergeTarget || null}
              onValueChange={(v) => setMergeTarget(v ?? "")}
              items={units
                .filter((u) => u.unit !== mergeSource)
                .map((u) => ({
                  value: u.unit,
                  label: `${u.unit} (${u.productCount} SP)`,
                }))}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Chọn đơn vị đích..." />
              </SelectTrigger>
              <SelectContent>
                {units
                  .filter((u) => u.unit !== mergeSource)
                  .map((u) => (
                    <SelectItem key={u.unit} value={u.unit}>
                      {u.unit} ({u.productCount} SP)
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              disabled={mergeSaving}
              onClick={() => setMergeOpen(false)}
            >
              Huỷ
            </Button>
            <Button onClick={handleMerge} disabled={mergeSaving}>
              {mergeSaving && (
                <Icon
                  name="progress_activity"
                  size={16}
                  className="mr-2 animate-spin"
                />
              )}
              Gộp
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ListPageLayout>
  );
}
