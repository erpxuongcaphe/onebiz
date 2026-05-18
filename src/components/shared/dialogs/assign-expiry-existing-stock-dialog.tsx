"use client";

/**
 * Dialog "Gắn HSD cho tồn cũ" — BULK TABLE INLINE (CEO 18/05/2026, Cách B)
 *
 * Khi setup data từ phần mềm cũ qua, 270 NVL có tồn nhưng không có HSD.
 * UX bulk:
 *   1. Chọn chi nhánh + filter (nhóm / NCC / "chỉ chưa có lot")
 *   2. List load ra SP có tồn > 0 ở chi nhánh
 *   3. User tick chọn nhiều dòng, mỗi dòng nhập HSD + Lô inline
 *   4. Apply-bulk: nhập HSD chung + prefix lô → "Áp dụng tất cả dòng đã tick"
 *   5. Submit → 1 RPC tạo nhiều lots atomic, server validate per item
 *
 * Backend: migration 00104 + 2 RPC:
 *   - get_products_with_branch_stock (load list + earliest lot expiry)
 *   - bulk_create_adjustment_lots_atomic (tạo lots + audit log)
 */

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { useToast } from "@/lib/contexts";
import { useAuth } from "@/lib/contexts/auth-context";
import { Icon } from "@/components/ui/icon";
import {
  getProductsWithBranchStock,
  bulkCreateAdjustmentLots,
  getCategoriesByScope,
  getSuppliers,
  type ProductWithBranchStock,
  type BulkAdjustmentLotItem,
  type BulkAdjustmentLotsResult,
} from "@/lib/services";
import type { ProductCategory, Supplier } from "@/lib/types";

interface AssignExpiryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Badge số ngày còn lại đến HSD — 5 mức màu. */
function ExpiryBadge({ dateStr }: { dateStr?: string | null }) {
  if (!dateStr) return null;
  const expiry = new Date(dateStr + "T00:00:00");
  if (isNaN(expiry.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.round(
    (expiry.getTime() - today.getTime()) / 86400000,
  );

  if (diffDays < 0) {
    return (
      <span className="inline-flex items-center rounded bg-status-danger/15 text-status-danger border border-status-danger/30 px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap">
        ⚠ Quá hạn {Math.abs(diffDays)}d
      </span>
    );
  }
  if (diffDays === 0) {
    return (
      <span className="inline-flex items-center rounded bg-status-danger/15 text-status-danger border border-status-danger/30 px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap">
        ⚠ HÔM NAY
      </span>
    );
  }
  if (diffDays <= 7) {
    return (
      <span className="inline-flex items-center rounded bg-status-danger/15 text-status-danger border border-status-danger/30 px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap">
        ⚠ {diffDays}d
      </span>
    );
  }
  if (diffDays <= 30) {
    return (
      <span className="inline-flex items-center rounded bg-status-warning/15 text-status-warning border border-status-warning/30 px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap">
        {diffDays}d
      </span>
    );
  }
  if (diffDays <= 90) {
    return (
      <span className="inline-flex items-center rounded bg-status-warning/10 text-status-warning border border-status-warning/20 px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap">
        {diffDays}d
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap">
      {diffDays}d
    </span>
  );
}

interface RowState {
  checked: boolean;
  qty: string;
  expiry: string;
  lot: string;
}

export function AssignExpiryDialog({
  open,
  onOpenChange,
}: AssignExpiryDialogProps) {
  const { toast } = useToast();
  const { branches } = useAuth();

  // Filters
  const [branchId, setBranchId] = useState<string>("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [supplierId, setSupplierId] = useState<string>("");
  const [onlyWithoutLots, setOnlyWithoutLots] = useState<boolean>(true);
  const [searchText, setSearchText] = useState<string>("");

  // Data
  const [categories, setCategories] = useState<ProductCategory[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [products, setProducts] = useState<ProductWithBranchStock[]>([]);
  const [loadingList, setLoadingList] = useState(false);

  // Per-row state — keyed by productId
  const [rows, setRows] = useState<Record<string, RowState>>({});

  // Bulk apply
  const [bulkExpiry, setBulkExpiry] = useState<string>("");
  const [bulkLotPrefix, setBulkLotPrefix] = useState<string>("");
  const [defaultNote, setDefaultNote] = useState<string>(
    "Khai báo HSD cho tồn cũ chuyển từ phần mềm cũ",
  );

  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<BulkAdjustmentLotsResult | null>(null);

  // Default branch: warehouse > đầu tiên
  useEffect(() => {
    if (!open) return;
    if (branchId) return;
    const defaultBranch =
      branches.find((b) => b.branchType === "warehouse") ??
      branches.find((b) => b.isDefault) ??
      branches[0];
    if (defaultBranch) setBranchId(defaultBranch.id);
  }, [open, branches, branchId]);

  // Load categories + suppliers lần đầu mở
  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const [cats, sups] = await Promise.all([
          getCategoriesByScope("nvl"),
          getSuppliers({ page: 0, pageSize: 200, filters: {} }),
        ]);
        setCategories(cats);
        setSuppliers(sups.data);
      } catch (err) {
        console.error("[AssignExpiry] load filters", err);
      }
    })();
  }, [open]);

  // Load list khi branch / filter / "only without lots" đổi
  useEffect(() => {
    if (!open || !branchId) return;
    let cancelled = false;
    (async () => {
      setLoadingList(true);
      setResult(null);
      try {
        const rows = await getProductsWithBranchStock(branchId, {
          categoryId: categoryId || null,
          supplierId: supplierId || null,
          onlyWithoutLots,
        });
        if (cancelled) return;
        setProducts(rows);
        // Khởi tạo per-row state: default qty = branchStock (toàn bộ)
        const init: Record<string, RowState> = {};
        for (const p of rows) {
          init[p.productId] = {
            checked: false,
            qty: String(p.branchStock),
            expiry: "",
            lot: "",
          };
        }
        setRows(init);
      } catch (err) {
        console.error("[AssignExpiry] load products", err);
        toast({
          variant: "error",
          title: "Không tải được danh sách",
          description: (err as Error).message ?? "Lỗi không xác định",
        });
        setProducts([]);
        setRows({});
      } finally {
        if (!cancelled) setLoadingList(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, branchId, categoryId, supplierId, onlyWithoutLots]);

  // Reset khi close
  useEffect(() => {
    if (!open) {
      setCategoryId("");
      setSupplierId("");
      setSearchText("");
      setBulkExpiry("");
      setBulkLotPrefix("");
      setProducts([]);
      setRows({});
      setResult(null);
    }
  }, [open]);

  const filteredProducts = useMemo(() => {
    if (!searchText.trim()) return products;
    const q = searchText.trim().toLowerCase();
    return products.filter(
      (p) =>
        p.productCode.toLowerCase().includes(q) ||
        p.productName.toLowerCase().includes(q),
    );
  }, [products, searchText]);

  const selectedCount = useMemo(() => {
    return filteredProducts.filter((p) => rows[p.productId]?.checked).length;
  }, [filteredProducts, rows]);

  const allChecked = useMemo(() => {
    return (
      filteredProducts.length > 0 &&
      filteredProducts.every((p) => rows[p.productId]?.checked)
    );
  }, [filteredProducts, rows]);

  function toggleRow(productId: string, checked: boolean) {
    setRows((r) => ({
      ...r,
      [productId]: { ...r[productId], checked },
    }));
  }

  function toggleAll(checked: boolean) {
    setRows((r) => {
      const next = { ...r };
      for (const p of filteredProducts) {
        next[p.productId] = { ...next[p.productId], checked };
      }
      return next;
    });
  }

  function updateRow(productId: string, patch: Partial<RowState>) {
    setRows((r) => ({
      ...r,
      [productId]: { ...r[productId], ...patch },
    }));
  }

  /** Áp HSD chung + lot prefix vào TẤT CẢ dòng đã tick. */
  function applyBulkToChecked() {
    if (!bulkExpiry) {
      toast({
        variant: "warning",
        title: "Chưa nhập HSD chung",
        description: "Nhập HSD ở thanh áp dụng trước khi bấm.",
      });
      return;
    }
    let applied = 0;
    setRows((r) => {
      const next = { ...r };
      for (const p of filteredProducts) {
        if (!next[p.productId]?.checked) continue;
        const lotAuto =
          bulkLotPrefix && bulkLotPrefix.trim()
            ? `${bulkLotPrefix.trim()}-${p.productCode}`
            : next[p.productId]?.lot ?? "";
        next[p.productId] = {
          ...next[p.productId],
          expiry: bulkExpiry,
          lot: lotAuto,
        };
        applied += 1;
      }
      return next;
    });
    toast({
      variant: "success",
      title: `Đã áp HSD cho ${applied} dòng`,
      description: bulkLotPrefix
        ? `HSD: ${bulkExpiry}, Số lô = ${bulkLotPrefix.trim()}-<mã SP>`
        : `HSD: ${bulkExpiry}`,
    });
  }

  function buildPayload(): BulkAdjustmentLotItem[] {
    const items: BulkAdjustmentLotItem[] = [];
    for (const p of filteredProducts) {
      const r = rows[p.productId];
      if (!r?.checked) continue;
      const qty = Number(r.qty);
      if (!r.expiry || qty <= 0) continue;
      items.push({
        productId: p.productId,
        branchId,
        qty,
        expiryDate: r.expiry,
        lotNumber: r.lot.trim() || undefined,
        note: defaultNote || undefined,
      });
    }
    return items;
  }

  const validItems = useMemo(buildPayload, [filteredProducts, rows, branchId, defaultNote]);

  async function handleSave() {
    if (validItems.length === 0) {
      toast({
        variant: "warning",
        title: "Chưa có dòng hợp lệ",
        description: "Tick chọn SP + nhập HSD + số lượng > 0.",
      });
      return;
    }
    setSaving(true);
    setResult(null);
    try {
      const res = await bulkCreateAdjustmentLots(validItems, defaultNote);
      setResult(res);
      if (res.created > 0) {
        toast({
          variant: "success",
          title: `Đã gắn HSD cho ${res.created}/${res.total} SP`,
          description:
            res.failedCount > 0
              ? `Lỗi ${res.failedCount} dòng — xem chi tiết bên dưới.`
              : "Tất cả đều thành công.",
          duration: 8000,
        });
        // Reload list để các dòng vừa tạo bị filter ra (nếu bật onlyWithoutLots)
        if (onlyWithoutLots) {
          const fresh = await getProductsWithBranchStock(branchId, {
            categoryId: categoryId || null,
            supplierId: supplierId || null,
            onlyWithoutLots,
          });
          setProducts(fresh);
          const init: Record<string, RowState> = {};
          for (const p of fresh) {
            init[p.productId] = {
              checked: false,
              qty: String(p.branchStock),
              expiry: "",
              lot: "",
            };
          }
          setRows(init);
        }
      } else {
        toast({
          variant: "error",
          title: `Không tạo được lot nào (${res.failedCount} dòng lỗi)`,
          description: "Xem chi tiết bên dưới để sửa.",
          duration: 10000,
        });
      }
    } catch (err) {
      console.error("[AssignExpiry] save", err);
      toast({
        variant: "error",
        title: "Lỗi server",
        description: (err as Error).message ?? "Không xác định",
      });
    } finally {
      setSaving(false);
    }
  }

  const failedById = useMemo(() => {
    const m = new Map<string, string>();
    for (const f of result?.failed ?? []) {
      m.set(f.product_id, f.reason);
    }
    return m;
  }, [result]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-6xl max-h-[92vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="event" size={20} className="text-primary" />
            Gắn HSD cho tồn cũ — bulk
            <span className="ml-2 inline-flex items-center rounded-full bg-primary/15 text-primary border border-primary/30 px-2 py-0.5 text-[10px] font-semibold uppercase">
              Owner / admin
            </span>
          </DialogTitle>
          <DialogDescription>
            Khai báo HSD cho lượng tồn đã có sẵn (chuyển từ phần mềm cũ). Tick
            nhiều dòng, nhập HSD/Lô riêng hoặc dùng &quot;Áp dụng chung&quot;.
            Server validate qty không vượt tồn + audit log đầy đủ.
          </DialogDescription>
        </DialogHeader>

        {/* Filter row */}
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 px-1 py-2 border-b">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Chi nhánh *
            </label>
            <Select
              value={branchId || null}
              onValueChange={(v) => setBranchId(v ?? "")}
              items={branches.map((b) => ({
                value: b.id,
                label: `${b.name} (${b.branchType})`,
              }))}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Chọn chi nhánh">
                  {(v) => {
                    const m = branches.find((b) => b.id === v);
                    return m ? m.name : "Chọn chi nhánh";
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}{" "}
                    <span className="text-[10px] text-muted-foreground">
                      ({b.branchType})
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Nhóm hàng
            </label>
            <Select
              value={categoryId || null}
              onValueChange={(v) => setCategoryId(v ?? "")}
              items={[{ value: "", label: "Tất cả" }, ...categories.map((c) => ({
                value: c.id,
                label: c.name,
              }))]}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Tất cả">
                  {(v) => {
                    if (!v) return "Tất cả";
                    const m = categories.find((c) => c.id === v);
                    return m?.name ?? "Tất cả";
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Tất cả</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Nhà cung cấp
            </label>
            <Select
              value={supplierId || null}
              onValueChange={(v) => setSupplierId(v ?? "")}
              items={[{ value: "", label: "Tất cả" }, ...suppliers.map((s) => ({
                value: s.id,
                label: s.name,
              }))]}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Tất cả">
                  {(v) => {
                    if (!v) return "Tất cả";
                    const m = suppliers.find((s) => s.id === v);
                    return m?.name ?? "Tất cả";
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">Tất cả</SelectItem>
                {suppliers.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Tìm mã / tên
            </label>
            <Input
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="VD: NVL-001 hoặc Cà phê..."
            />
          </div>
        </div>

        {/* Toggle + Bulk apply row */}
        <div className="flex flex-wrap items-end gap-3 px-1 py-3 border-b bg-muted/30 rounded-md">
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <Checkbox
              checked={onlyWithoutLots}
              onCheckedChange={(v) => setOnlyWithoutLots(Boolean(v))}
            />
            <span>Chỉ hiện SP <b>chưa có lot</b></span>
          </label>
          <div className="h-6 w-px bg-border" />
          <div className="space-y-0.5">
            <label className="text-[10px] font-medium text-muted-foreground uppercase">
              HSD chung
            </label>
            <Input
              type="date"
              value={bulkExpiry}
              onChange={(e) => setBulkExpiry(e.target.value)}
              className="w-40"
            />
          </div>
          <div className="space-y-0.5">
            <label className="text-[10px] font-medium text-muted-foreground uppercase">
              Số lô prefix (auto)
            </label>
            <Input
              value={bulkLotPrefix}
              onChange={(e) => setBulkLotPrefix(e.target.value)}
              placeholder="VD: LOT-CUOSAN-2026"
              className="w-48"
            />
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={applyBulkToChecked}
            disabled={selectedCount === 0 || !bulkExpiry}
            className="gap-1"
          >
            <Icon name="auto_fix_high" size={14} />
            Áp dụng cho {selectedCount} dòng đã tick
          </Button>
        </div>

        {/* Note */}
        <div className="px-1 py-2 border-b">
          <label className="text-xs font-medium text-muted-foreground">
            Lý do khai báo (audit log)
          </label>
          <Input
            value={defaultNote}
            onChange={(e) => setDefaultNote(e.target.value)}
            placeholder="VD: Setup từ KiotViet — tháng 5/2026"
            className="mt-1"
          />
        </div>

        {/* Table */}
        <div className="flex-1 overflow-auto border rounded-md">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 sticky top-0 z-10">
              <tr className="text-xs uppercase text-muted-foreground">
                <th className="p-2 w-8 text-left">
                  <Checkbox
                    checked={allChecked}
                    onCheckedChange={(v) => toggleAll(Boolean(v))}
                  />
                </th>
                <th className="p-2 text-left w-28">Mã</th>
                <th className="p-2 text-left">Tên NVL</th>
                <th className="p-2 text-right w-24">Tồn</th>
                <th className="p-2 text-center w-32">Đã có lot</th>
                <th className="p-2 text-left w-32">SL gắn HSD</th>
                <th className="p-2 text-left w-40">HSD *</th>
                <th className="p-2 text-left w-48">Số lô (auto)</th>
              </tr>
            </thead>
            <tbody>
              {loadingList && (
                <tr>
                  <td
                    colSpan={8}
                    className="p-8 text-center text-muted-foreground"
                  >
                    <Icon
                      name="progress_activity"
                      size={20}
                      className="inline-block mr-2 animate-spin"
                    />
                    Đang tải danh sách...
                  </td>
                </tr>
              )}
              {!loadingList && filteredProducts.length === 0 && (
                <tr>
                  <td
                    colSpan={8}
                    className="p-8 text-center text-muted-foreground text-xs"
                  >
                    Không có SP nào phù hợp filter
                    {onlyWithoutLots && " (đang lọc 'chưa có lot')"}.
                  </td>
                </tr>
              )}
              {!loadingList &&
                filteredProducts.map((p) => {
                  const r = rows[p.productId];
                  if (!r) return null;
                  const failedReason = failedById.get(p.productId);
                  return (
                    <tr
                      key={p.productId}
                      className={
                        r.checked
                          ? "bg-primary/5 border-b"
                          : "border-b hover:bg-muted/30"
                      }
                    >
                      <td className="p-2">
                        <Checkbox
                          checked={r.checked}
                          onCheckedChange={(v) =>
                            toggleRow(p.productId, Boolean(v))
                          }
                        />
                      </td>
                      <td className="p-2 font-mono text-xs">{p.productCode}</td>
                      <td className="p-2">
                        <div className="font-medium">{p.productName}</div>
                        {p.categoryName && (
                          <div className="text-[10px] text-muted-foreground">
                            {p.categoryName}
                          </div>
                        )}
                        {failedReason && (
                          <div className="text-[10px] text-status-danger mt-0.5 flex items-center gap-1">
                            <Icon name="error" size={11} />
                            {failedReason}
                          </div>
                        )}
                      </td>
                      <td className="p-2 text-right whitespace-nowrap">
                        <b>{p.branchStock}</b>{" "}
                        <span className="text-[10px] text-muted-foreground">
                          {p.stockUnit}
                        </span>
                      </td>
                      <td className="p-2 text-center">
                        {p.totalLotsActive > 0 ? (
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="text-[10px] text-muted-foreground">
                              {p.totalLotsActive} lot
                            </span>
                            <ExpiryBadge dateStr={p.earliestLotExpiry} />
                          </div>
                        ) : (
                          <span className="text-[10px] text-muted-foreground">
                            —
                          </span>
                        )}
                      </td>
                      <td className="p-2">
                        <Input
                          type="number"
                          value={r.qty}
                          onChange={(e) =>
                            updateRow(p.productId, { qty: e.target.value })
                          }
                          step="0.01"
                          min="0"
                          className="h-8 text-xs"
                          disabled={!r.checked}
                        />
                      </td>
                      <td className="p-2">
                        <div className="flex items-center gap-1.5">
                          <Input
                            type="date"
                            value={r.expiry}
                            onChange={(e) =>
                              updateRow(p.productId, { expiry: e.target.value })
                            }
                            className="h-8 text-xs flex-1"
                            disabled={!r.checked}
                          />
                          <ExpiryBadge dateStr={r.expiry} />
                        </div>
                      </td>
                      <td className="p-2">
                        <Input
                          value={r.lot}
                          onChange={(e) =>
                            updateRow(p.productId, { lot: e.target.value })
                          }
                          placeholder={`LOT-CUOSAN-${p.productCode}`}
                          className="h-8 text-xs font-mono"
                          disabled={!r.checked}
                        />
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>

        {/* Result summary */}
        {result && (
          <div
            className={`p-3 rounded-md border text-xs ${
              result.failedCount > 0
                ? "bg-status-warning/10 border-status-warning/30"
                : "bg-status-success/10 border-status-success/30"
            }`}
          >
            <div className="font-semibold mb-1 flex items-center gap-1">
              <Icon
                name={result.failedCount > 0 ? "warning" : "task_alt"}
                size={14}
              />
              Kết quả: tạo {result.created}/{result.total} lot, lỗi{" "}
              {result.failedCount}
            </div>
            {result.failedCount > 0 && (
              <p className="text-muted-foreground">
                Các dòng lỗi đã được đánh dấu đỏ trong bảng. Sửa rồi bấm Lưu lại.
              </p>
            )}
          </div>
        )}

        <DialogFooter className="flex items-center justify-between gap-2 pt-3 border-t">
          <div className="text-xs text-muted-foreground flex-1">
            Đã tick: <b className="text-foreground">{selectedCount}</b> SP — Hợp
            lệ (có HSD + qty &gt; 0):{" "}
            <b className="text-foreground">{validItems.length}</b>
          </div>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Đóng
          </Button>
          <Button
            onClick={handleSave}
            disabled={validItems.length === 0 || saving}
          >
            {saving ? (
              <>
                <Icon
                  name="progress_activity"
                  size={14}
                  className="mr-1.5 animate-spin"
                />
                Đang lưu {validItems.length} lot...
              </>
            ) : (
              <>
                <Icon name="event_available" size={14} className="mr-1.5" />
                Lưu HSD cho {validItems.length} SP
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
