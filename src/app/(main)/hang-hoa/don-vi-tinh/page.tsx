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

import { useEffect, useState, useCallback } from "react";
import { ColumnDef } from "@tanstack/react-table";
import { PageHeader } from "@/components/shared/page-header";
import { DataTable } from "@/components/shared/data-table";
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
import { SummaryCard } from "@/components/shared/summary-card";

interface UnitRow {
  unit: string;
  productCount: number;
}

export default function DonViTinhPage() {
  const { toast } = useToast();
  const [units, setUnits] = useState<UnitRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

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

  // Filter
  const filtered = search.trim()
    ? units.filter((u) =>
        u.unit.toLowerCase().includes(search.toLowerCase().trim()),
      )
    : units;

  // Detect potential duplicates (case-insensitive groups)
  const duplicateGroups = (() => {
    const groups = new Map<string, string[]>();
    for (const u of units) {
      const key = u.unit.toLowerCase();
      const list = groups.get(key) ?? [];
      list.push(u.unit);
      groups.set(key, list);
    }
    return Array.from(groups.entries()).filter(([, list]) => list.length > 1);
  })();

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
      (u) => u.unit !== renameSource && u.unit.toLowerCase() === newName.toLowerCase(),
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
                className="text-[10px] px-1.5 py-0 h-4"
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
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={(e) => {
              e.stopPropagation();
              openRename(row.original.unit);
            }}
          >
            <Icon name="edit" size={12} className="mr-1" />
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
            <Icon name="call_merge" size={12} className="mr-1" />
            Gộp với...
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
      <PageHeader
        title="Đơn vị tính"
        searchPlaceholder="Tìm đơn vị..."
        searchValue={search}
        onSearchChange={setSearch}
      />

      {/* Summary cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 px-4 pt-3">
        <SummaryCard
          icon={<Icon name="straighten" size={16} />}
          label="Tổng đơn vị"
          value={units.length.toString()}
        />
        <SummaryCard
          icon={<Icon name="layers" size={16} />}
          label="Lần dùng"
          value={units.reduce((s, u) => s + u.productCount, 0).toString()}
        />
        <SummaryCard
          icon={<Icon name="warning" size={16} />}
          label="Có khả năng trùng"
          value={duplicateGroups.length.toString()}
          danger={duplicateGroups.length > 0}
        />
      </div>

      {/* Banner: cảnh báo khi có duplicate */}
      {duplicateGroups.length > 0 && (
        <div className="mx-4 mt-3 flex items-start gap-2 p-3 bg-status-warning/10 border border-status-warning/30 rounded-lg text-xs">
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

      {/* Banner info — chuẩn hoá về SummaryCard pattern */}
      <div className="mx-4 mt-3 flex items-start gap-2 p-3 bg-primary-fixed/40 border border-primary-fixed rounded-lg text-xs">
        <Icon name="info" size={16} className="shrink-0 mt-0.5 text-primary" />
        <div className="text-muted-foreground">
          <p className="font-medium text-foreground">Quản lý tên đơn vị tính</p>
          <p className="mt-0.5">
            Mỗi sản phẩm có 3 đơn vị (mua / kho / bán) — set khi tạo SP. Trang
            này dùng để <strong>đổi tên</strong> (sửa chính tả) hoặc{" "}
            <strong>gộp</strong> 2 đơn vị thành 1 (khi data lộn xộn).
          </p>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        loading={loading}
        getRowId={(row) => row.unit}
      />

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

          <div className="space-y-1.5 py-2">
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

          <div className="space-y-1.5 py-2">
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
    </div>
  );
}
