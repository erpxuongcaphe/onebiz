"use client";

// BulkAddPriceTierItemsDialog — thêm nhiều SP vào bảng giá cùng 1 lúc.
//
// CEO use case: "80% SP cùng giá ở các quán" → chọn nhóm "Cà phê pha máy"
// → thấy 8 SP → nhập 1 giá đồng loạt → Lưu hết. Tránh phải Add từng SP.
//
// Plus: cho user override giá riêng từng SP (ví dụ Latte 55k nhưng Espresso 35k).

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
import {
  bulkAddPriceTierItems,
  getProducts,
  getProductCategoriesAsync,
} from "@/lib/services";
import { formatCurrency } from "@/lib/format";
import type { Product } from "@/lib/types";
import { Icon } from "@/components/ui/icon";

interface BulkAddPriceTierItemsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tierId: string;
  tierName: string;
  /**
   * Scope của tier — quyết định lấy SP từ channel nào:
   * - retail/both → SKU all (POS Retail bán cả FnB+retail SKU)
   * - fnb → SKU channel=fnb
   */
  tierScope?: "retail" | "fnb" | "both";
  onSuccess?: () => void;
}

type CategoryOption = {
  label: string;
  value: string;
  code?: string;
  count: number;
};

export function BulkAddPriceTierItemsDialog({
  open,
  onOpenChange,
  tierId,
  tierName,
  tierScope = "both",
  onSuccess,
}: BulkAddPriceTierItemsDialogProps) {
  const { toast } = useToast();

  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [categoryId, setCategoryId] = useState("");
  const [loadingCats, setLoadingCats] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);

  // Bulk price input — apply to all selected
  const [bulkPrice, setBulkPrice] = useState("");

  // Per-product overrides + selection
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [priceOverrides, setPriceOverrides] = useState<Record<string, string>>(
    {},
  );

  const [saving, setSaving] = useState(false);

  // Load categories khi mở dialog
  useEffect(() => {
    if (!open) return;
    setLoadingCats(true);
    // Tier scope retail/both → load SKU; FnB tương tự (SKU)
    getProductCategoriesAsync("sku")
      .then((cats) => setCategories(cats as CategoryOption[]))
      .finally(() => setLoadingCats(false));
    // Reset state khi mở
    setCategoryId("");
    setProducts([]);
    setBulkPrice("");
    setSelected(new Set());
    setPriceOverrides({});
  }, [open]);

  // Load products khi đổi category
  useEffect(() => {
    if (!open || !categoryId) {
      setProducts([]);
      return;
    }
    let cancelled = false;
    setLoadingProducts(true);
    setSelected(new Set());
    setPriceOverrides({});

    // Filter productType + channel theo tier scope
    const filters: Record<string, string> = {
      productType: "sku",
      category: categoryId,
    };
    if (tierScope === "fnb") filters.channel = "fnb";
    else if (tierScope === "retail") filters.channel = "retail";
    // scope "both" → không filter channel, lấy hết SKU

    getProducts({
      page: 0,
      pageSize: 100, // 1 nhóm thường <50 SP, 100 đủ
      sortBy: "name",
      sortOrder: "asc",
      filters,
    })
      .then((result) => {
        if (cancelled) return;
        setProducts(result.data);
        // Default: select tất cả SP trong nhóm (CEO use case 80% chung giá)
        setSelected(new Set(result.data.map((p) => p.id)));
      })
      .finally(() => {
        if (!cancelled) setLoadingProducts(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, categoryId, tierScope]);

  const selectedCount = selected.size;
  const selectedCategory = categories.find((c) => c.value === categoryId);

  // Compute giá final cho mỗi SP — override ưu tiên hơn bulkPrice
  const finalItems = useMemo(() => {
    return products
      .filter((p) => selected.has(p.id))
      .map((p) => {
        const override = priceOverrides[p.id];
        const effective = override?.trim()
          ? Number(override)
          : Number(bulkPrice || 0);
        return { product: p, price: effective };
      });
  }, [products, selected, priceOverrides, bulkPrice]);

  function toggleAll(checked: boolean) {
    if (checked) {
      setSelected(new Set(products.map((p) => p.id)));
    } else {
      setSelected(new Set());
    }
  }

  function toggleOne(productId: string, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(productId);
      else next.delete(productId);
      return next;
    });
  }

  async function handleSave() {
    if (selectedCount === 0) {
      toast({
        variant: "warning",
        title: "Chưa chọn sản phẩm",
        description: "Tick ít nhất 1 SP để thêm vào bảng giá.",
      });
      return;
    }

    // Validate giá: mỗi item phải có giá > 0 (từ bulkPrice hoặc override)
    const invalid = finalItems.find((it) => !it.price || it.price <= 0);
    if (invalid) {
      toast({
        variant: "error",
        title: "Giá không hợp lệ",
        description: `Sản phẩm "${invalid.product.name}" chưa có giá. Nhập giá đồng loạt hoặc giá riêng cho SP đó.`,
      });
      return;
    }

    setSaving(true);
    try {
      const { insertedCount } = await bulkAddPriceTierItems({
        priceTierId: tierId,
        items: finalItems.map((it) => ({
          productId: it.product.id,
          price: it.price,
          minQty: 1,
        })),
      });
      toast({
        variant: "success",
        title: "Đã thêm vào bảng giá",
        description: `Đã thêm/cập nhật ${insertedCount} sản phẩm vào "${tierName}".`,
      });
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      toast({
        variant: "error",
        title: "Lỗi thêm hàng loạt",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Thêm hàng loạt theo nhóm</DialogTitle>
          <DialogDescription>
            Bảng giá: <strong>{tierName}</strong>. Chọn nhóm hàng → tick SP →
            nhập giá đồng loạt. Có thể override giá riêng từng SP nếu cần.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Bước 1: Chọn nhóm */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Nhóm hàng <span className="text-destructive">*</span>
            </label>
            <Select
              value={categoryId || null}
              onValueChange={(v) => setCategoryId(v ?? "")}
              items={categories.map((cat) => ({
                value: cat.value,
                label: cat.code ? `${cat.code} — ${cat.label}` : cat.label,
              }))}
            >
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={loadingCats ? "Đang tải..." : "Chọn nhóm hàng"}
                >
                  {(v) => {
                    const m = categories.find((c) => c.value === v);
                    if (m) return m.code ? `${m.code} — ${m.label}` : m.label;
                    return loadingCats ? "Đang tải..." : "Chọn nhóm hàng";
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {categories.map((cat) => (
                  <SelectItem key={cat.value} value={cat.value}>
                    {cat.code ? `${cat.code} — ` : ""}
                    {cat.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Bước 2: Giá đồng loạt + check all */}
          {categoryId && (
            <div className="grid grid-cols-[1fr_auto] gap-3 items-end">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  Giá đồng loạt cho {selectedCount}/{products.length} SP đã chọn
                </label>
                <Input
                  type="number"
                  min={0}
                  value={bulkPrice}
                  onChange={(e) => setBulkPrice(e.target.value)}
                  placeholder="VD: 50000"
                />
                <p className="text-xs text-muted-foreground">
                  SP có giá riêng dưới sẽ ưu tiên — không bị ghi đè bởi giá
                  này.
                </p>
              </div>
              <div className="flex items-center gap-2 pb-2.5">
                <Checkbox
                  checked={
                    products.length > 0 && selectedCount === products.length
                  }
                  onCheckedChange={(c) => toggleAll(!!c)}
                />
                <span className="text-sm">Chọn hết</span>
              </div>
            </div>
          )}

          {/* Bước 3: Bảng SP */}
          {categoryId && (
            <div className="rounded-lg border overflow-hidden">
              {loadingProducts ? (
                <div className="flex items-center justify-center py-10 text-muted-foreground">
                  <Icon
                    name="progress_activity"
                    size={16}
                    className="animate-spin mr-2"
                  />
                  <span className="text-sm">Đang tải sản phẩm...</span>
                </div>
              ) : products.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
                  <Icon
                    name="inventory_2"
                    size={32}
                    className="mb-2 opacity-30"
                  />
                  <p className="text-sm">
                    Nhóm "{selectedCategory?.label}" chưa có sản phẩm
                  </p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-muted/30">
                    <tr>
                      <th className="text-left p-2 w-10"></th>
                      <th className="text-left p-2 font-medium">Sản phẩm</th>
                      <th className="text-right p-2 font-medium">Giá NY</th>
                      <th className="text-right p-2 font-medium w-32">
                        Giá riêng
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((p) => {
                      const isSelected = selected.has(p.id);
                      const override = priceOverrides[p.id];
                      const effectivePrice = override?.trim()
                        ? Number(override)
                        : Number(bulkPrice || 0);
                      return (
                        <tr
                          key={p.id}
                          className={`border-t ${isSelected ? "" : "opacity-50"}`}
                        >
                          <td className="p-2">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={(c) => toggleOne(p.id, !!c)}
                            />
                          </td>
                          <td className="p-2">
                            <div className="font-medium">{p.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {p.code}
                            </div>
                          </td>
                          <td className="p-2 text-right text-muted-foreground">
                            {formatCurrency(p.sellPrice)}
                          </td>
                          <td className="p-2">
                            <Input
                              type="number"
                              min={0}
                              value={override ?? ""}
                              onChange={(e) =>
                                setPriceOverrides((prev) => ({
                                  ...prev,
                                  [p.id]: e.target.value,
                                }))
                              }
                              placeholder={
                                bulkPrice
                                  ? `${formatCurrency(Number(bulkPrice))}`
                                  : "Để trống"
                              }
                              className="h-8 text-right text-sm"
                              disabled={!isSelected}
                            />
                            {isSelected &&
                              effectivePrice > 0 &&
                              effectivePrice !== p.sellPrice && (
                                <p
                                  className={`text-[10px] mt-0.5 text-right font-mono ${
                                    effectivePrice < p.sellPrice
                                      ? "text-status-success"
                                      : "text-status-warning"
                                  }`}
                                >
                                  {effectivePrice < p.sellPrice ? "-" : "+"}
                                  {(
                                    ((effectivePrice - p.sellPrice) /
                                      p.sellPrice) *
                                    100
                                  ).toFixed(1)}
                                  %
                                </p>
                              )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Huỷ
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || selectedCount === 0}
          >
            {saving && (
              <Icon
                name="progress_activity"
                size={16}
                className="mr-2 animate-spin"
              />
            )}
            Thêm {selectedCount} sản phẩm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
