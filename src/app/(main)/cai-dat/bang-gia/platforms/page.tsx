"use client";

/**
 * Bulk matrix editor — Giá bán theo nguồn đơn (CEO 13/05/2026, Fabi/iPos).
 *
 * UI tổng quát để owner setup giá hàng loạt cho nhiều SP × 4 nền tảng giao
 * đồ ăn. Cùng share data với tab "Giá theo nền tảng" trong product detail —
 * cả 2 đều đọc/ghi bảng product_platform_prices.
 *
 * Features:
 *   - Filter category + search SP
 *   - Matrix N rows × 5 cols (Tại quán + 4 platform)
 *   - Cell input giá tuyệt đối (Direct readonly = sell_price)
 *   - Quick action: nhập số tiền cụ thể → áp cho tất cả SP filter hiện tại
 *     (vd "+1.000đ cho Shopee Food" → tất cả SP shopee_food = direct + 1000)
 *   - Detect dirty cells (chỉ save row thay đổi)
 *   - Save bulk qua RPC upsert_product_platform_prices
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/lib/contexts";
import { cn } from "@/lib/utils";
import { formatCurrency, formatNumber } from "@/lib/format";
import {
  getProductsWithPlatformPrices,
  upsertPlatformPrices,
  deletePlatformPriceTargets,
  type ProductWithPlatformPrices,
} from "@/lib/services/supabase/platform-prices";
import { getProductCategoriesAsync } from "@/lib/services/supabase/products";
import type { DeliveryPlatform } from "@/lib/types/fnb";
import { PERMISSIONS } from "@/lib/permissions/constants";
import { usePermissions } from "@/lib/permissions/use-permission";

const OVERRIDE_PLATFORMS: { code: DeliveryPlatform; label: string; icon: string; color: string }[] = [
  { code: "shopee_food", label: "Shopee Food", icon: "shopping_bag", color: "text-orange-600" },
  { code: "grab_food", label: "Grab Food", icon: "delivery_dining", color: "text-green-600" },
  { code: "gojek", label: "Gojek", icon: "moped", color: "text-emerald-600" },
  { code: "be", label: "Be", icon: "two_wheeler", color: "text-yellow-600" },
];

/** edits[targetKey][platform] = string number ("" = không override) */
type EditsMap = Record<string, Partial<Record<DeliveryPlatform, string>>>;

interface PlatformPriceTarget {
  key: string;
  productId: string;
  variantId?: string;
  label: string;
  code: string;
  categoryName: string | null;
  basePrice: number;
  prices: Partial<Record<DeliveryPlatform, number>>;
  isVariant: boolean;
}

export default function PlatformPricesBulkEditorPage() {
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const canManage = hasPermission(PERMISSIONS.PRODUCTS_MANAGE_PRICES);
  const [products, setProducts] = useState<ProductWithPlatformPrices[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string>("");
  const [categories, setCategories] = useState<{ value: string; label: string }[]>([]);

  /** Edits state — chỉ những cell user vừa đổi. */
  const [edits, setEdits] = useState<EditsMap>({});

  // Quick action state
  const [quickPlatform, setQuickPlatform] = useState<DeliveryPlatform>("shopee_food");
  const [quickAmount, setQuickAmount] = useState<string>("");

  const targets = useMemo<PlatformPriceTarget[]>(
    () =>
      products.flatMap((product) => [
        {
          key: product.productId,
          productId: product.productId,
          label: product.productName,
          code: product.productCode,
          categoryName: product.categoryName,
          basePrice: product.basePrice,
          prices: product.prices,
          isVariant: false,
        },
        ...product.variants.map((variant) => ({
          key: `${product.productId}:${variant.variantId}`,
          productId: product.productId,
          variantId: variant.variantId,
          label: variant.variantName,
          code: product.productCode,
          categoryName: product.categoryName,
          basePrice: variant.basePrice,
          prices: variant.prices,
          isVariant: true,
        })),
      ]),
    [products],
  );
  const targetByKey = useMemo(
    () => new Map(targets.map((target) => [target.key, target])),
    [targets],
  );

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getProductsWithPlatformPrices({
        categoryId: categoryId || undefined,
        search: search || undefined,
        limit: 300,
      });
      setProducts(data);
      setEdits({}); // reset dirty state khi reload
    } catch (err) {
      toast({
        title: "Không tải được danh sách",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }, [categoryId, search, toast]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void (async () => {
      try {
        const cats = await getProductCategoriesAsync("sku", "fnb");
        setCategories(cats);
      } catch {
        // ignore
      }
    })();
  }, []);

  // Helpers: get/set cell value (edits ưu tiên, fallback original)
  const getCellValue = useCallback(
    (targetKey: string, platform: DeliveryPlatform): string => {
      const editVal = edits[targetKey]?.[platform];
      if (editVal !== undefined) return editVal;
      const original = targetByKey.get(targetKey)?.prices[platform];
      return original !== undefined ? String(original) : "";
    },
    [edits, targetByKey],
  );

  const setCellValue = useCallback(
    (targetKey: string, platform: DeliveryPlatform, value: string) => {
      const sanitized = value.replace(/[^\d]/g, "");
      setEdits((prev) => ({
        ...prev,
        [targetKey]: {
          ...prev[targetKey],
          [platform]: sanitized,
        },
      }));
    },
    [],
  );

  // Quick action: nhập số tiền tuyệt đối → áp `direct + amount` cho tất cả
  // SP filter hiện tại cho 1 platform.
  const handleQuickApply = () => {
    const amount = Number(quickAmount);
    if (!Number.isFinite(amount)) {
      toast({
        title: "Số tiền không hợp lệ",
        description: "Nhập số nguyên (vd 1000 = thêm 1.000đ vào giá niêm yết)",
        variant: "warning",
      });
      return;
    }
    const next: EditsMap = { ...edits };
    for (const target of targets) {
      const newPrice = target.basePrice + amount;
      if (newPrice < 0) continue;
      next[target.key] = {
        ...next[target.key],
        [quickPlatform]: String(newPrice),
      };
    }
    setEdits(next);
    toast({
      title: `Đã áp giá cho ${targets.length} dòng giá`,
      description: `${OVERRIDE_PLATFORMS.find((x) => x.code === quickPlatform)?.label}: giá niêm yết + ${formatCurrency(amount)} (chưa lưu)`,
      variant: "success",
    });
  };

  const handleClearPlatformAll = async () => {
    if (!confirm(`Xoá TẤT CẢ override ${OVERRIDE_PLATFORMS.find((x) => x.code === quickPlatform)?.label} cho ${targets.length} dòng sản phẩm/size đang hiện?`)) {
      return;
    }
    setSaving(true);
    try {
      await deletePlatformPriceTargets(
        targets.map((target) => ({
          productId: target.productId,
          variantId: target.variantId,
          platform: quickPlatform,
        })),
      );
      toast({
        title: "Đã xoá override",
        description: `${OVERRIDE_PLATFORMS.find((x) => x.code === quickPlatform)?.label}: dùng giá niêm yết`,
        variant: "success",
      });
      await load();
    } catch (err) {
      toast({
        title: "Xoá thất bại",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  // Save: diff edits vs original → upsert/delete bulk
  const dirtyCount = useMemo(() => {
    let count = 0;
    for (const pid of Object.keys(edits)) {
      const target = targetByKey.get(pid);
      if (!target) continue;
      for (const platform of OVERRIDE_PLATFORMS) {
        const newVal = edits[pid][platform.code];
        if (newVal === undefined) continue;
        const oldVal = target.prices[platform.code];
        const newNum = newVal.trim() !== "" ? Number(newVal) : null;
        if (newNum === null && oldVal === undefined) continue; // both empty
        if (newNum !== oldVal) count++;
      }
    }
    return count;
  }, [edits, targetByKey]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const toUpsert: { productId: string; variantId?: string; platform: DeliveryPlatform; overridePrice: number }[] = [];
      const toDelete: { productId: string; variantId?: string; platform: DeliveryPlatform }[] = [];

      for (const pid of Object.keys(edits)) {
        const target = targetByKey.get(pid);
        if (!target) continue;
        for (const platform of OVERRIDE_PLATFORMS) {
          const newVal = edits[pid][platform.code];
          if (newVal === undefined) continue;
          const oldVal = target.prices[platform.code];
          const newNum = newVal.trim() !== "" ? Number(newVal) : null;

          if (newNum !== null && newNum > 0) {
            if (oldVal !== newNum) {
              toUpsert.push({
                productId: target.productId,
                variantId: target.variantId,
                platform: platform.code,
                overridePrice: newNum,
              });
            }
          } else if (oldVal !== undefined) {
            // có override cũ, giờ xoá → batch delete
            toDelete.push({
              productId: target.productId,
              variantId: target.variantId,
              platform: platform.code,
            });
          }
        }
      }

      let upsertCount = 0;
      let deleteCount = 0;

      if (toUpsert.length > 0) {
        const r = await upsertPlatformPrices(toUpsert);
        upsertCount = r.count;
      }
      if (toDelete.length > 0) {
        const r = await deletePlatformPriceTargets(toDelete);
        deleteCount += r.deleted;
      }

      toast({
        title: "Đã lưu giá theo nền tảng",
        description: `${upsertCount} cập nhật · ${deleteCount} xoá`,
        variant: "success",
      });
      await load();
    } catch (err) {
      toast({
        title: "Lưu thất bại",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="p-4 sm:p-6 max-w-7xl mx-auto space-y-4">
      <PageHeader
        title="Giá bán theo nguồn đơn (FnB)"
        subtitle="Cà phê tại quán 25.000đ → Shopee Food 26.000đ. Để trống = dùng giá niêm yết. Setup hàng loạt cho nhiều SP × 4 nền tảng giao đồ ăn."
      />

      {!canManage && (
        <div className="flex items-center gap-2 border-b pb-3 text-sm text-muted-foreground">
          <Icon name="lock" size={16} />
          Bạn đang xem bảng giá. Cần quyền quản lý giá để thay đổi.
        </div>
      )}

      {/* Quick actions toolbar */}
      <div className="bg-surface border border-border rounded-xl p-3 space-y-3">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
          Thao tác nhanh — áp cho sản phẩm và size đang hiện ({targets.length})
        </h3>
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-muted-foreground">Nền tảng</label>
            <select
              value={quickPlatform}
              onChange={(e) => setQuickPlatform(e.target.value as DeliveryPlatform)}
              disabled={!canManage}
              className="text-sm px-2 py-1.5 rounded-md border border-border bg-surface h-9 min-w-[150px]"
            >
              {OVERRIDE_PLATFORMS.map((p) => (
                <option key={p.code} value={p.code}>{p.label}</option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-[11px] text-muted-foreground">
              Cộng thêm vào giá niêm yết (đ)
            </label>
            <Input
              type="text"
              inputMode="numeric"
              value={quickAmount ? formatNumber(Number(quickAmount)) : ""}
              onChange={(e) => setQuickAmount(e.target.value.replace(/[^\d]/g, ""))}
              disabled={!canManage}
              placeholder="vd 1000 (= +1.000đ)"
              className="h-9 max-w-[180px] font-mono tabular-nums"
            />
          </div>
          <Button
            size="sm"
            onClick={handleQuickApply}
            disabled={!canManage || !quickAmount || saving}
            className="h-9"
          >
            <Icon name="auto_fix_high" size={14} className="mr-1" />
            Áp giá cho tất cả ({targets.length} dòng)
          </Button>
          <div className="ml-auto">
            <Button
              variant="outline"
              size="sm"
              onClick={handleClearPlatformAll}
              disabled={!canManage || saving}
              className="h-9 text-status-error border-status-error/30 hover:bg-status-error/10"
            >
              <Icon name="delete_sweep" size={14} className="mr-1" />
              Xoá tất cả override {OVERRIDE_PLATFORMS.find((x) => x.code === quickPlatform)?.label}
            </Button>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted-foreground">Tìm sản phẩm</label>
          <Input
            placeholder="Tên / mã SP..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 max-w-[260px]"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-[11px] text-muted-foreground">Danh mục</label>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="text-sm px-2 py-1.5 rounded-md border border-border bg-surface h-9 min-w-[200px]"
          >
            <option value="">Tất cả danh mục</option>
            {categories.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading} className="h-9">
          <Icon name="refresh" size={14} className={cn("mr-1", loading && "animate-spin")} />
          Tải lại
        </Button>
        {dirtyCount > 0 && (
          <Badge variant="outline" className="ml-auto bg-status-warning/10 border-status-warning/30 text-status-warning">
            {dirtyCount} thay đổi chưa lưu
          </Badge>
        )}
      </div>

      {/* Matrix table */}
      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            <Icon name="progress_activity" size={24} className="inline-block animate-spin" />
            <div className="mt-3">Đang tải...</div>
          </div>
        ) : products.length === 0 ? (
          <div className="p-12 text-center text-sm text-muted-foreground">
            Không có sản phẩm FnB nào match filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-container-low border-b border-border sticky top-0">
                <tr className="text-left text-[11px] text-muted-foreground uppercase tracking-wider">
                  <th className="px-3 py-2 font-medium min-w-[200px]">Sản phẩm</th>
                  <th className="px-3 py-2 font-medium text-right min-w-[110px]">
                    🏠 Tại quán
                  </th>
                  {OVERRIDE_PLATFORMS.map((p) => (
                    <th key={p.code} className="px-3 py-2 font-medium text-right min-w-[140px]">
                      <span className={cn("inline-flex items-center gap-1", p.color)}>
                        <Icon name={p.icon} size={12} /> {p.label}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {targets.map((target) => (
                  <tr key={target.key} className={cn(
                    "hover:bg-surface-container-low transition-colors",
                    target.isVariant && "bg-muted/20",
                  )}>
                    <td className={cn("px-3 py-2", target.isVariant && "pl-8")}>
                      <div className={cn(
                        "font-medium text-[13px] truncate max-w-[300px]",
                        target.isVariant && "flex items-center gap-1.5",
                      )} title={target.label}>
                        {target.isVariant && <Icon name="subdirectory_arrow_right" size={14} className="text-muted-foreground" />}
                        {target.label}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {target.isVariant ? "Giá riêng theo size" : target.code}
                        {!target.isVariant && target.categoryName && <> · {target.categoryName}</>}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-[13px] tabular-nums text-muted-foreground">
                      {formatCurrency(target.basePrice)}
                    </td>
                    {OVERRIDE_PLATFORMS.map((platform) => {
                      const value = getCellValue(target.key, platform.code);
                      const numValue = value !== "" ? Number(value) : null;
                      const isOverride = numValue !== null && numValue !== target.basePrice;
                      const isDirty =
                        edits[target.key]?.[platform.code] !== undefined &&
                        (numValue ?? null) !== (target.prices[platform.code] ?? null);
                      return (
                        <td key={platform.code} className="px-2 py-1.5">
                          <Input
                            type="text"
                            inputMode="numeric"
                            value={value ? formatNumber(Number(value)) : ""}
                            onChange={(e) => setCellValue(target.key, platform.code, e.target.value)}
                            placeholder={formatCurrency(target.basePrice)}
                            disabled={!canManage || saving}
                            className={cn(
                              "h-8 text-right font-mono tabular-nums text-[12px]",
                              isOverride && "border-primary/50 bg-primary/5",
                              isDirty && "border-status-warning bg-status-warning/10",
                            )}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Save bar (sticky) */}
      {dirtyCount > 0 && (
        <div className="sticky bottom-4 flex justify-end gap-2 bg-surface border border-border rounded-xl p-3 shadow-lg">
          <Badge className="bg-status-warning/10 text-status-warning border-status-warning/30">
            {dirtyCount} thay đổi
          </Badge>
          <Button variant="outline" onClick={() => setEdits({})} disabled={saving}>
            Bỏ thay đổi
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Icon name="progress_activity" size={14} className="mr-1 animate-spin" />
                Đang lưu...
              </>
            ) : (
              <>
                <Icon name="save" size={14} className="mr-1" />
                Lưu {dirtyCount} thay đổi
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
