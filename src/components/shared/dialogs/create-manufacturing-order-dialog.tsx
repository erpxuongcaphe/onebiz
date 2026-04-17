"use client";

import { useState, useEffect, useRef } from "react";
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
import { useToast } from "@/lib/contexts";
import { getClient } from "@/lib/services/supabase/base";
import {
  applyManualStockMovement,
  nextEntityCode,
} from "@/lib/services/supabase/stock-adjustments";
import { Icon } from "@/components/ui/icon";

interface CreateManufacturingOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

interface ProductResult {
  id: string;
  code: string;
  name: string;
  unit: string;
}

// Placeholder shown in the dialog header before save. Real code is generated
// via `next_code('manufacturing')` at save time.
//
// NOTE: This dialog records an ad-hoc "+stock" event for a finished SKU and
// does NOT consume BOM materials. The full BOM-driven production flow lives
// in the production_orders module (see `complete_production_order` RPC).
const PENDING_CODE_PLACEHOLDER = "SX —";

export function CreateManufacturingOrderDialog({
  open,
  onOpenChange,
  onSuccess,
}: CreateManufacturingOrderDialogProps) {
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [showProductDropdown, setShowProductDropdown] = useState(false);
  const [filteredProducts, setFilteredProducts] = useState<ProductResult[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<ProductResult | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const saveLockRef = useRef(false);

  useEffect(() => {
    if (open) {
      setCode(PENDING_CODE_PLACEHOLDER);
      setProductSearch("");
      setShowProductDropdown(false);
      setFilteredProducts([]);
      setSelectedProduct(null);
      setQuantity(1);
      setNotes("");
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
        .select("id, code, name, unit")
        .or(`name.ilike.%${productSearch}%,code.ilike.%${productSearch}%`)
        .eq("is_active", true)
        .limit(8);
      setFilteredProducts((data ?? []).map(p => ({
        id: p.id,
        code: p.code,
        name: p.name,
        unit: p.unit,
      })));
    }, 300);
    return () => clearTimeout(timer);
  }, [productSearch]);

  function validate(): boolean {
    const newErrors: Record<string, string> = {};
    if (!selectedProduct) newErrors.product = "Vui lòng chọn sản phẩm sản xuất";
    if (quantity < 1) newErrors.quantity = "Số lượng phải lớn hơn 0";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSave() {
    if (saveLockRef.current) return;
    if (!validate()) return;
    saveLockRef.current = true;
    setSaving(true);
    try {
      const realCode = await nextEntityCode("manufacturing");
      setCode(realCode);

      await applyManualStockMovement([
        {
          productId: selectedProduct!.id,
          quantity,
          type: "in",
          referenceType: "manufacturing",
          note: `${realCode} - Sản xuất ${selectedProduct!.name} x${quantity}${notes ? ` - ${notes}` : ""}`,
        },
      ]);

      onOpenChange(false);
      toast({
        title: "Tạo phiếu sản xuất thành công",
        description: `Đã tạo phiếu sản xuất ${realCode}`,
        variant: "success",
      });
      onSuccess?.();
    } catch (err) {
      toast({
        title: "Lỗi tạo phiếu sản xuất",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      saveLockRef.current = false;
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Tạo phiếu sản xuất</DialogTitle>
          <DialogDescription>
            Mã phiếu: {code}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Code */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Mã phiếu</label>
            <div className="flex h-9 w-full rounded-lg border border-input bg-muted/50 px-2.5 py-2 text-sm">
              {code}
            </div>
          </div>

          {/* Product search */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Sản phẩm sản xuất <span className="text-destructive">*</span>
            </label>
            <div className="relative">
              <Icon name="search" size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={productSearch}
                onChange={(e) => {
                  setProductSearch(e.target.value);
                  setShowProductDropdown(true);
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
                        onClick={() => {
                          setSelectedProduct(p);
                          setProductSearch(p.name);
                          setShowProductDropdown(false);
                        }}
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

          {/* Selected product info */}
          {selectedProduct && (
            <div className="rounded-lg border p-3 bg-muted/30 text-sm">
              <span className="text-muted-foreground">Sản phẩm: </span>
              <span className="font-medium">{selectedProduct.name}</span>
              <span className="text-muted-foreground ml-2">({selectedProduct.code})</span>
              <span className="text-muted-foreground ml-2">- ĐVT: {selectedProduct.unit}</span>
            </div>
          )}

          {/* Quantity */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Số lượng sản xuất <span className="text-destructive">*</span>
            </label>
            <Input
              type="number"
              min={1}
              value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
              placeholder="Nhập số lượng"
              aria-invalid={!!errors.quantity}
            />
            {errors.quantity && (
              <p className="text-xs text-destructive">{errors.quantity}</p>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Ghi chú</label>
            <textarea
              className="flex min-h-[50px] w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ghi chú phiếu sản xuất"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Icon name="progress_activity" size={16} className="mr-2 animate-spin" />}
            Tạo phiếu sản xuất
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
