"use client";

import { useState, useEffect } from "react";
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
import { formatCurrency } from "@/lib/format";
import { useToast } from "@/lib/contexts";
import { getClient } from "@/lib/services/supabase/base";
import { Icon } from "@/components/ui/icon";

interface CreatePriceBookDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

interface ProductResult {
  id: string;
  code: string;
  name: string;
  unit: string;
  sell_price: number;
  cost_price: number;
}

export function CreatePriceBookDialog({
  open,
  onOpenChange,
  onSuccess,
}: CreatePriceBookDialogProps) {
  const { toast } = useToast();
  const [productSearch, setProductSearch] = useState("");
  const [showProductDropdown, setShowProductDropdown] = useState(false);
  const [filteredProducts, setFilteredProducts] = useState<ProductResult[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<ProductResult | null>(null);
  const [newSellPrice, setNewSellPrice] = useState("");
  const [newCostPrice, setNewCostPrice] = useState("");
  const [effectiveDate, setEffectiveDate] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setProductSearch("");
      setShowProductDropdown(false);
      setFilteredProducts([]);
      setSelectedProduct(null);
      setNewSellPrice("");
      setNewCostPrice("");
      setEffectiveDate(new Date().toISOString().split("T")[0]);
      setErrors({});
      setSaving(false);
    }
  }, [open]);

  // Live search products
  useEffect(() => {
    if (!productSearch || productSearch.length < 1) { setFilteredProducts([]); return; }
    const timer = setTimeout(async () => {
      const supabase = getClient();
      const { data } = await supabase
        .from("products")
        .select("id, code, name, unit, sell_price, cost_price")
        .or(`name.ilike.%${productSearch}%,code.ilike.%${productSearch}%`)
        .eq("is_active", true)
        .limit(8);
      setFilteredProducts((data ?? []).map(p => ({
        id: p.id,
        code: p.code,
        name: p.name,
        unit: p.unit,
        sell_price: p.sell_price,
        cost_price: p.cost_price,
      })));
    }, 300);
    return () => clearTimeout(timer);
  }, [productSearch]);

  function selectProduct(product: ProductResult) {
    setSelectedProduct(product);
    setProductSearch(product.name);
    setShowProductDropdown(false);
    setNewSellPrice(String(product.sell_price));
    setNewCostPrice(String(product.cost_price));
  }

  function validate(): boolean {
    const newErrors: Record<string, string> = {};
    if (!selectedProduct) newErrors.product = "Vui lòng chọn sản phẩm";
    const sellPrice = Number(newSellPrice);
    if (!newSellPrice || isNaN(sellPrice) || sellPrice < 0) {
      newErrors.sellPrice = "Vui lòng nhập giá bán hợp lệ";
    }
    const costPrice = Number(newCostPrice);
    if (newCostPrice && (isNaN(costPrice) || costPrice < 0)) {
      newErrors.costPrice = "Giá vốn không hợp lệ";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    try {
      const supabase = getClient();

      const updateData: Record<string, number> = {
        sell_price: Number(newSellPrice),
      };
      if (newCostPrice) {
        updateData.cost_price = Number(newCostPrice);
      }

      const { error: updateErr } = await supabase
        .from("products")
        .update(updateData)
        .eq("id", selectedProduct!.id);

      if (updateErr) throw new Error(updateErr.message);

      onOpenChange(false);
      toast({
        title: "Cập nhật giá thành công",
        description: `Đã cập nhật giá cho ${selectedProduct!.name}`,
        variant: "success",
      });
      onSuccess?.();
    } catch (err) {
      toast({
        title: "Lỗi cập nhật giá",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Thiết lập giá sản phẩm</DialogTitle>
          <DialogDescription>
            Cập nhật giá bán và giá vốn cho sản phẩm
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Product search */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Sản phẩm <span className="text-destructive">*</span>
            </label>
            <div className="relative">
              <Icon name="search" size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={productSearch}
                onChange={(e) => {
                  setProductSearch(e.target.value);
                  setShowProductDropdown(true);
                  setSelectedProduct(null);
                }}
                onFocus={() => setShowProductDropdown(true)}
                onBlur={() => setTimeout(() => setShowProductDropdown(false), 200)}
                placeholder="Tìm sản phẩm theo tên hoặc mã..."
                className="pl-8"
                aria-invalid={!!errors.product}
              />
              {showProductDropdown && productSearch && (
                <div className="absolute z-10 mt-1 w-full rounded-lg border bg-popover shadow-md max-h-40 overflow-y-auto">
                  {filteredProducts.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      Không tìm thấy sản phẩm
                    </div>
                  ) : (
                    filteredProducts.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-accent cursor-pointer"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => selectProduct(p)}
                      >
                        <span className="font-medium">{p.name}</span>
                        <span className="text-muted-foreground">{p.code}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            {errors.product && (
              <p className="text-xs text-destructive">{errors.product}</p>
            )}
          </div>

          {/* Current prices */}
          {selectedProduct && (
            <div className="rounded-lg border p-3 bg-muted/30 text-sm space-y-1">
              <div>
                <span className="text-muted-foreground">Sản phẩm: </span>
                <span className="font-medium">{selectedProduct.name}</span>
                <span className="text-muted-foreground ml-2">({selectedProduct.code})</span>
              </div>
              <div>
                <span className="text-muted-foreground">Giá bán hiện tại: </span>
                <span className="font-medium">{formatCurrency(selectedProduct.sell_price)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Giá vốn hiện tại: </span>
                <span className="font-medium">{formatCurrency(selectedProduct.cost_price)}</span>
              </div>
            </div>
          )}

          {/* New sell price */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Giá bán mới <span className="text-destructive">*</span>
            </label>
            <Input
              type="number"
              min={0}
              value={newSellPrice}
              onChange={(e) => setNewSellPrice(e.target.value)}
              placeholder="Nhập giá bán mới"
              aria-invalid={!!errors.sellPrice}
            />
            {errors.sellPrice && (
              <p className="text-xs text-destructive">{errors.sellPrice}</p>
            )}
          </div>

          {/* New cost price */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Giá vốn mới</label>
            <Input
              type="number"
              min={0}
              value={newCostPrice}
              onChange={(e) => setNewCostPrice(e.target.value)}
              placeholder="Nhập giá vốn mới"
              aria-invalid={!!errors.costPrice}
            />
            {errors.costPrice && (
              <p className="text-xs text-destructive">{errors.costPrice}</p>
            )}
          </div>

          {/* Effective date */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Ngày áp dụng</label>
            <Input
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Icon name="progress_activity" size={16} className="mr-2 animate-spin" />}
            Cập nhật giá
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
