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
import { Search, Loader2, X } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { useToast } from "@/lib/contexts";
import { getClient } from "@/lib/services/supabase/base";
import type { Database } from "@/lib/supabase/types";

type StockMovementInsert = Database["public"]["Tables"]["stock_movements"]["Insert"];

interface CreateDisposalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

interface ProductResult {
  id: string;
  code: string;
  name: string;
  unit: string;
  stock: number;
  cost_price: number;
}

interface DisposalItem {
  product_id: string;
  product_name: string;
  product_code: string;
  unit: string;
  stock: number;
  cost_price: number;
  quantity: number;
}

function generateDisposalCode() {
  const num = Math.floor(Math.random() * 99999) + 1;
  return `XH${String(num).padStart(5, "0")}`;
}

export function CreateDisposalDialog({
  open,
  onOpenChange,
  onSuccess,
}: CreateDisposalDialogProps) {
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [showProductDropdown, setShowProductDropdown] = useState(false);
  const [filteredProducts, setFilteredProducts] = useState<ProductResult[]>([]);
  const [items, setItems] = useState<DisposalItem[]>([]);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setCode(generateDisposalCode());
      setProductSearch("");
      setShowProductDropdown(false);
      setFilteredProducts([]);
      setItems([]);
      setReason("");
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
        .select("id, code, name, unit, stock, cost_price")
        .or(`name.ilike.%${productSearch}%,code.ilike.%${productSearch}%`)
        .eq("is_active", true)
        .limit(8);
      setFilteredProducts((data ?? []).map(p => ({
        id: p.id,
        code: p.code,
        name: p.name,
        unit: p.unit,
        stock: p.stock,
        cost_price: p.cost_price,
      })));
    }, 300);
    return () => clearTimeout(timer);
  }, [productSearch]);

  function addProduct(product: ProductResult) {
    if (items.some(i => i.product_id === product.id)) return;
    setItems([...items, {
      product_id: product.id,
      product_name: product.name,
      product_code: product.code,
      unit: product.unit,
      stock: product.stock,
      cost_price: product.cost_price,
      quantity: 1,
    }]);
    setProductSearch("");
    setShowProductDropdown(false);
  }

  function removeItem(productId: string) {
    setItems(items.filter(i => i.product_id !== productId));
  }

  function updateQuantity(productId: string, qty: number) {
    setItems(items.map(i =>
      i.product_id === productId
        ? { ...i, quantity: Math.max(1, qty) }
        : i
    ));
  }

  const totalValue = items.reduce((sum, i) => sum + i.quantity * i.cost_price, 0);

  function validate(): boolean {
    const newErrors: Record<string, string> = {};
    if (items.length === 0) newErrors.items = "Vui lòng chọn ít nhất một sản phẩm";
    if (!reason.trim()) newErrors.reason = "Vui lòng nhập lý do xuất hủy";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    try {
      const supabase = getClient();
      const { data: { user } } = await supabase.auth.getUser();

      const movements = items.map(item => ({
        tenant_id: "",
        branch_id: "",
        product_id: item.product_id,
        type: "out" as const,
        quantity: item.quantity,
        reference_type: "disposal",
        note: `${code} - Xuất hủy${reason ? ` - ${reason}` : ""}${notes ? ` - ${notes}` : ""}`,
        created_by: user?.id ?? "",
      } satisfies StockMovementInsert));

      const { error: insertErr } = await supabase
        .from("stock_movements")
        .insert(movements);

      if (insertErr) throw new Error(insertErr.message);

      onOpenChange(false);
      toast({
        title: "Tạo phiếu xuất hủy thành công",
        description: `Đã tạo phiếu xuất hủy ${code}`,
        variant: "success",
      });
      onSuccess?.();
    } catch (err) {
      toast({
        title: "Lỗi tạo phiếu xuất hủy",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Tạo phiếu xuất hủy</DialogTitle>
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
              Thêm sản phẩm <span className="text-destructive">*</span>
            </label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
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
                        onClick={() => addProduct(p)}
                      >
                        <span className="font-medium">{p.name}</span>
                        <span className="text-muted-foreground">{p.code} - Tồn: {p.stock}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            {errors.items && (
              <p className="text-xs text-destructive">{errors.items}</p>
            )}
          </div>

          {/* Selected items */}
          {items.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Sản phẩm xuất hủy</label>
              <div className="rounded-lg border overflow-hidden">
                <div className="grid grid-cols-[1fr_70px_100px_100px_36px] gap-2 px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground">
                  <span>Sản phẩm</span>
                  <span className="text-center">Tồn kho</span>
                  <span className="text-center">SL hủy</span>
                  <span className="text-right">Giá vốn</span>
                  <span />
                </div>
                {items.map((item) => (
                  <div
                    key={item.product_id}
                    className="grid grid-cols-[1fr_70px_100px_100px_36px] gap-2 items-center px-3 py-2 border-t"
                  >
                    <span className="text-sm truncate">{item.product_name}</span>
                    <span className="text-sm text-center text-muted-foreground">{item.stock}</span>
                    <Input
                      type="number"
                      min={1}
                      value={item.quantity}
                      onChange={(e) => updateQuantity(item.product_id, Number(e.target.value) || 1)}
                      className="h-7 text-center px-1"
                    />
                    <span className="text-sm text-right">{formatCurrency(item.cost_price)}</span>
                    <button
                      type="button"
                      onClick={() => removeItem(item.product_id)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Total */}
          {items.length > 0 && (
            <div className="space-y-3 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium">Tổng giá trị hủy</span>
                <span className="text-lg font-semibold text-primary">
                  {formatCurrency(totalValue)}
                </span>
              </div>
            </div>
          )}

          {/* Reason */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Lý do xuất hủy <span className="text-destructive">*</span>
            </label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Nhập lý do xuất hủy"
              aria-invalid={!!errors.reason}
            />
            {errors.reason && (
              <p className="text-xs text-destructive">{errors.reason}</p>
            )}
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Ghi chú</label>
            <textarea
              className="flex min-h-[50px] w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ghi chú phiếu xuất hủy"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Tạo phiếu xuất hủy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
