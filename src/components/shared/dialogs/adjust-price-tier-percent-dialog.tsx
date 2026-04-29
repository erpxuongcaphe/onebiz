"use client";

// AdjustPriceTierPercentDialog — bulk apply % giảm/tăng so với giá niêm yết
// để gen items vào tier.
//
// CEO use case: "Bảng giá đại lý = giảm 10% so với giá niêm yết". Thay vì
// nhập từng giá, CEO nhập 1 lần -10%, hệ thống tự gen items với
// price = sellPrice * 0.9 cho các SP được chọn.

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

interface AdjustPriceTierPercentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tierId: string;
  tierName: string;
  tierScope?: "retail" | "fnb" | "both";
  onSuccess?: () => void;
}

type CategoryOption = {
  label: string;
  value: string;
  code?: string;
  count: number;
};

// Round helper — làm tròn 1000 cho giá VND đẹp.
function roundPrice(value: number): number {
  if (value < 1000) return Math.round(value);
  return Math.round(value / 1000) * 1000;
}

export function AdjustPriceTierPercentDialog({
  open,
  onOpenChange,
  tierId,
  tierName,
  tierScope = "both",
  onSuccess,
}: AdjustPriceTierPercentDialogProps) {
  const { toast } = useToast();

  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [scope, setScope] = useState<"all" | "category">("all");
  const [categoryId, setCategoryId] = useState("");
  // % giảm (âm) hoặc tăng (dương). VD -10 = giảm 10%
  const [percentText, setPercentText] = useState("-10");
  const [products, setProducts] = useState<Product[]>([]);
  const [loadingProducts, setLoadingProducts] = useState(false);
  const [saving, setSaving] = useState(false);

  // Load categories khi mở
  useEffect(() => {
    if (!open) return;
    getProductCategoriesAsync("sku").then((cats) =>
      setCategories(cats as CategoryOption[]),
    );
    setScope("all");
    setCategoryId("");
    setPercentText("-10");
    setProducts([]);
  }, [open]);

  // Load products khi đổi scope/category — preview tính toán
  useEffect(() => {
    if (!open) return;
    if (scope === "category" && !categoryId) {
      setProducts([]);
      return;
    }
    let cancelled = false;
    setLoadingProducts(true);

    const filters: Record<string, string> = { productType: "sku" };
    if (scope === "category" && categoryId) {
      filters.category = categoryId;
    }
    if (tierScope === "fnb") filters.channel = "fnb";
    else if (tierScope === "retail") filters.channel = "retail";

    getProducts({
      page: 0,
      pageSize: 500, // limit phòng tránh quá lớn
      sortBy: "name",
      sortOrder: "asc",
      filters,
    })
      .then((result) => {
        if (!cancelled) setProducts(result.data);
      })
      .finally(() => {
        if (!cancelled) setLoadingProducts(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, scope, categoryId, tierScope]);

  const percent = Number(percentText) || 0;
  const factor = 1 + percent / 100;

  // Compute final prices preview
  const items = useMemo(() => {
    return products
      .filter((p) => p.sellPrice > 0) // chỉ tính SP có giá niêm yết hợp lệ
      .map((p) => ({
        product: p,
        newPrice: roundPrice(p.sellPrice * factor),
      }));
  }, [products, factor]);

  const previewLimit = 8; // chỉ hiện 8 SP đầu để dialog gọn

  async function handleApply() {
    if (items.length === 0) {
      toast({
        variant: "warning",
        title: "Không có sản phẩm",
        description: "Phạm vi đã chọn không có SP với giá niêm yết hợp lệ.",
      });
      return;
    }
    if (Math.abs(percent) < 0.01) {
      toast({
        variant: "warning",
        title: "Hệ số 0%",
        description: "Hãy nhập % giảm/tăng khác 0.",
      });
      return;
    }

    setSaving(true);
    try {
      const { insertedCount } = await bulkAddPriceTierItems({
        priceTierId: tierId,
        items: items.map((it) => ({
          productId: it.product.id,
          price: it.newPrice,
          minQty: 1,
        })),
      });
      const sign = percent < 0 ? "giảm" : "tăng";
      toast({
        variant: "success",
        title: "Đã áp dụng",
        description: `${insertedCount} SP áp giá ${sign} ${Math.abs(percent)}% so với giá niêm yết.`,
      });
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      toast({
        variant: "error",
        title: "Lỗi áp dụng",
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
          <DialogTitle>Điều chỉnh giá theo %</DialogTitle>
          <DialogDescription>
            Bảng giá: <strong>{tierName}</strong>. Tự động gen giá =
            giá-niêm-yết × hệ số. Số âm = giảm, dương = tăng. Áp dụng cho tất
            cả SKU hoặc nhóm cụ thể.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Phạm vi áp dụng */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Phạm vi áp dụng</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                {
                  value: "all" as const,
                  icon: "select_all",
                  title: "Tất cả SP",
                  desc: "Mọi SKU trong tier scope",
                },
                {
                  value: "category" as const,
                  icon: "category",
                  title: "Theo nhóm",
                  desc: "Chỉ 1 nhóm hàng",
                },
              ].map((opt) => {
                const active = scope === opt.value;
                return (
                  <button
                    type="button"
                    key={opt.value}
                    onClick={() => setScope(opt.value)}
                    className={`flex flex-col items-start gap-1 rounded-lg border p-3 text-left transition-colors ${
                      active
                        ? "border-primary bg-primary-fixed/40 ring-1 ring-primary"
                        : "border-input hover:border-muted-foreground/40 hover:bg-muted/40"
                    }`}
                  >
                    <div className="flex items-center gap-1.5">
                      <Icon
                        name={opt.icon}
                        size={16}
                        className={
                          active ? "text-primary" : "text-muted-foreground"
                        }
                      />
                      <span
                        className={`text-sm font-medium ${
                          active ? "text-primary" : "text-foreground"
                        }`}
                      >
                        {opt.title}
                      </span>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {opt.desc}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Chọn nhóm nếu scope=category */}
          {scope === "category" && (
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
                  <SelectValue placeholder="Chọn nhóm hàng">
                    {(v) => {
                      const m = categories.find((c) => c.value === v);
                      if (m) return m.code ? `${m.code} — ${m.label}` : m.label;
                      return "Chọn nhóm hàng";
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
          )}

          {/* % adjustment */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              % so với giá niêm yết{" "}
              <span className="text-destructive">*</span>
            </label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                step="0.5"
                value={percentText}
                onChange={(e) => setPercentText(e.target.value)}
                className="max-w-[140px]"
                placeholder="VD: -10"
              />
              <span className="text-sm text-muted-foreground">%</span>
              <span className="text-xs text-muted-foreground ml-auto">
                {percent < 0
                  ? `Giảm ${Math.abs(percent)}% (× ${factor.toFixed(2)})`
                  : percent > 0
                    ? `Tăng ${percent}% (× ${factor.toFixed(2)})`
                    : "Giữ nguyên giá niêm yết"}
              </span>
            </div>
          </div>

          {/* Preview */}
          {items.length > 0 && (
            <div className="rounded-lg border bg-muted/20">
              <div className="px-3 py-2 border-b flex items-center justify-between">
                <span className="text-xs font-medium">
                  Xem trước {Math.min(items.length, previewLimit)}/{items.length} SP
                </span>
                {loadingProducts && (
                  <Icon
                    name="progress_activity"
                    size={12}
                    className="animate-spin text-muted-foreground"
                  />
                )}
              </div>
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground">
                  <tr>
                    <th className="text-left px-3 py-1.5 font-medium">
                      Sản phẩm
                    </th>
                    <th className="text-right px-3 py-1.5 font-medium">
                      Giá NY
                    </th>
                    <th className="text-right px-3 py-1.5 font-medium">
                      Giá tier
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.slice(0, previewLimit).map((it) => (
                    <tr key={it.product.id}>
                      <td className="px-3 py-1.5 truncate max-w-[280px]">
                        {it.product.name}
                      </td>
                      <td className="px-3 py-1.5 text-right text-muted-foreground">
                        {formatCurrency(it.product.sellPrice)}
                      </td>
                      <td
                        className={`px-3 py-1.5 text-right font-medium ${
                          it.newPrice < it.product.sellPrice
                            ? "text-status-success"
                            : it.newPrice > it.product.sellPrice
                              ? "text-status-warning"
                              : ""
                        }`}
                      >
                        {formatCurrency(it.newPrice)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {items.length > previewLimit && (
                <div className="px-3 py-1.5 text-xs text-muted-foreground border-t">
                  ...và {items.length - previewLimit} SP khác cũng được áp dụng.
                </div>
              )}
            </div>
          )}

          {scope === "category" && categoryId && items.length === 0 && !loadingProducts && (
            <p className="text-xs text-muted-foreground italic">
              Nhóm này chưa có SP với giá niêm yết hợp lệ.
            </p>
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
            onClick={handleApply}
            disabled={
              saving ||
              items.length === 0 ||
              Math.abs(percent) < 0.01 ||
              (scope === "category" && !categoryId)
            }
          >
            {saving && (
              <Icon
                name="progress_activity"
                size={16}
                className="mr-2 animate-spin"
              />
            )}
            Áp dụng cho {items.length} SP
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
