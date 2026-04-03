"use client";

import { useState, useEffect, useMemo } from "react";
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
import { Trash2, Search, Loader2 } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { useToast } from "@/lib/contexts";
import { getClient } from "@/lib/services/supabase/base";
import type { Database } from "@/lib/supabase/types";

type PurchaseOrderInsert = Database["public"]["Tables"]["purchase_orders"]["Insert"];
type PurchaseOrderItemInsert = Database["public"]["Tables"]["purchase_order_items"]["Insert"];

interface CreatePurchaseEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

interface LineItem {
  id: string;
  productName: string;
  quantity: number;
  price: number;
}

interface SearchProduct {
  id: string;
  name: string;
  price: number;
}

interface SearchSupplier {
  id: string;
  name: string;
  phone: string;
}

function generatePurchaseEntryCode() {
  const num = Math.floor(Math.random() * 99999) + 1;
  return `DHN${String(num).padStart(6, "0")}`;
}

export function CreatePurchaseEntryDialog({
  open,
  onOpenChange,
  onSuccess,
}: CreatePurchaseEntryDialogProps) {
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [supplierSearch, setSupplierSearch] = useState("");
  const [selectedSupplier, setSelectedSupplier] = useState<{ id: string; name: string } | null>(null);
  const [showSupplierDropdown, setShowSupplierDropdown] = useState(false);
  const [filteredSuppliers, setFilteredSuppliers] = useState<SearchSupplier[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [showProductDropdown, setShowProductDropdown] = useState(false);
  const [filteredProducts, setFilteredProducts] = useState<SearchProduct[]>([]);
  const [items, setItems] = useState<LineItem[]>([]);
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setCode(generatePurchaseEntryCode());
      setSupplierSearch("");
      setSelectedSupplier(null);
      setShowSupplierDropdown(false);
      setFilteredSuppliers([]);
      setProductSearch("");
      setShowProductDropdown(false);
      setFilteredProducts([]);
      setItems([]);
      setNotes("");
      setErrors({});
      setSaving(false);
    }
  }, [open]);

  // Live search suppliers
  useEffect(() => {
    if (!supplierSearch || supplierSearch.length < 1) { setFilteredSuppliers([]); return; }
    const timer = setTimeout(async () => {
      const supabase = getClient();
      const { data } = await supabase
        .from("suppliers")
        .select("id, name, phone")
        .or(`name.ilike.%${supplierSearch}%,phone.ilike.%${supplierSearch}%`)
        .eq("is_active", true)
        .limit(8);
      setFilteredSuppliers((data ?? []).map(s => ({ id: s.id, name: s.name, phone: s.phone ?? "" })));
    }, 300);
    return () => clearTimeout(timer);
  }, [supplierSearch]);

  // Live search products
  useEffect(() => {
    if (!productSearch || productSearch.length < 1) { setFilteredProducts([]); return; }
    const timer = setTimeout(async () => {
      const supabase = getClient();
      const { data } = await supabase
        .from("products")
        .select("id, name, cost_price")
        .or(`name.ilike.%${productSearch}%,code.ilike.%${productSearch}%`)
        .eq("is_active", true)
        .limit(10);
      setFilteredProducts((data ?? []).map(p => ({ id: p.id, name: p.name, price: p.cost_price })));
    }, 300);
    return () => clearTimeout(timer);
  }, [productSearch]);

  function addProduct(product: SearchProduct) {
    const existing = items.find((item) => item.id === product.id);
    if (existing) {
      setItems(
        items.map((item) =>
          item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        )
      );
    } else {
      setItems([...items, { id: product.id, productName: product.name, quantity: 1, price: product.price }]);
    }
    setProductSearch("");
    setShowProductDropdown(false);
  }

  function updateItem(id: string, field: keyof LineItem, value: string | number) {
    setItems(items.map((item) => (item.id === id ? { ...item, [field]: value } : item)));
  }

  function removeItem(id: string) {
    setItems(items.filter((item) => item.id !== id));
  }

  const total = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity * item.price, 0),
    [items]
  );

  function validate(): boolean {
    const newErrors: Record<string, string> = {};
    if (!selectedSupplier) newErrors.supplier = "Vui lòng chọn nhà cung cấp";
    if (items.length === 0) newErrors.items = "Chưa có sản phẩm nào";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    try {
      const supabase = getClient();
      const { data: { user } } = await supabase.auth.getUser();

      const { data: po, error: poErr } = await supabase
        .from("purchase_orders")
        .insert({
          tenant_id: "",
          branch_id: "",
          code,
          supplier_id: selectedSupplier!.id,
          supplier_name: selectedSupplier!.name,
          status: "ordered" as const,
          subtotal: total,
          discount_amount: 0,
          total,
          paid: 0,
          debt: total,
          note: notes || null,
          created_by: user?.id ?? "",
        } satisfies PurchaseOrderInsert)
        .select("id")
        .single();

      if (poErr) throw new Error(poErr.message);

      if (po && items.length > 0) {
        const { error: itemsErr } = await supabase
          .from("purchase_order_items")
          .insert(items.map(item => ({
            purchase_order_id: po.id,
            product_id: item.id,
            product_name: item.productName,
            unit: "Cái",
            quantity: item.quantity,
            received_quantity: 0,
            unit_price: item.price,
            discount: 0,
            total: item.quantity * item.price,
          } satisfies PurchaseOrderItemInsert)));
        if (itemsErr) throw new Error(itemsErr.message);
      }

      onOpenChange(false);
      toast({
        title: "Tạo đơn đặt hàng nhập thành công",
        description: `Đã tạo đơn đặt hàng ${code}`,
        variant: "success",
      });
      onSuccess?.();
    } catch (err) {
      toast({
        title: "Lỗi tạo đơn đặt hàng nhập",
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
          <DialogTitle>Tạo đơn đặt hàng nhập</DialogTitle>
          <DialogDescription>
            Mã đơn đặt hàng: {code}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Supplier search */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Nhà cung cấp <span className="text-destructive">*</span>
            </label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={supplierSearch}
                onChange={(e) => {
                  setSupplierSearch(e.target.value);
                  setShowSupplierDropdown(true);
                }}
                onFocus={() => setShowSupplierDropdown(true)}
                onBlur={() => setTimeout(() => setShowSupplierDropdown(false), 200)}
                placeholder="Tìm nhà cung cấp theo tên, SĐT..."
                className="pl-8"
                aria-invalid={!!errors.supplier}
              />
              {showSupplierDropdown && supplierSearch && (
                <div className="absolute z-10 mt-1 w-full rounded-lg border bg-popover shadow-md max-h-40 overflow-y-auto">
                  {filteredSuppliers.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      Không tìm thấy nhà cung cấp
                    </div>
                  ) : (
                    filteredSuppliers.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-accent cursor-pointer"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setSelectedSupplier({ id: s.id, name: s.name });
                          setSupplierSearch(s.name);
                          setShowSupplierDropdown(false);
                        }}
                      >
                        <span>{s.name}</span>
                        <span className="text-muted-foreground">{s.phone}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            {errors.supplier && (
              <p className="text-xs text-destructive">{errors.supplier}</p>
            )}
          </div>

          {/* Product search + add */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Thêm sản phẩm</label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={productSearch}
                onChange={(e) => {
                  setProductSearch(e.target.value);
                  setShowProductDropdown(true);
                }}
                onFocus={() => {
                  if (productSearch) setShowProductDropdown(true);
                }}
                onBlur={() => setTimeout(() => setShowProductDropdown(false), 200)}
                placeholder="Tìm sản phẩm theo tên, mã hàng..."
                className="pl-8"
              />
              {showProductDropdown && productSearch && (
                <div className="absolute z-10 mt-1 w-full rounded-lg border bg-popover shadow-md max-h-48 overflow-y-auto">
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
                        <span>{p.name}</span>
                        <span className="text-muted-foreground">
                          {formatCurrency(p.price)}
                        </span>
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

          {/* Line items */}
          {items.length > 0 && (
            <div className="rounded-lg border overflow-hidden">
              <div className="grid grid-cols-[1fr_70px_100px_36px] gap-2 px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground">
                <span>Sản phẩm</span>
                <span className="text-center">SL</span>
                <span className="text-right">Đơn giá</span>
                <span />
              </div>
              {items.map((item) => (
                <div
                  key={item.id}
                  className="grid grid-cols-[1fr_70px_100px_36px] gap-2 items-center px-3 py-2 border-t"
                >
                  <span className="text-sm truncate">{item.productName}</span>
                  <Input
                    type="number"
                    min={1}
                    value={item.quantity}
                    onChange={(e) =>
                      updateItem(item.id, "quantity", Math.max(1, Number(e.target.value) || 1))
                    }
                    className="h-7 text-center px-1"
                  />
                  <Input
                    type="number"
                    value={item.price}
                    onChange={(e) =>
                      updateItem(item.id, "price", Number(e.target.value) || 0)
                    }
                    className="h-7 text-right px-1"
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => removeItem(item.id)}
                    className="text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          {/* Total */}
          <div className="space-y-3 rounded-lg border p-3">
            <div className="flex items-center justify-between border-t pt-2">
              <span className="font-medium">Tổng cộng</span>
              <span className="text-lg font-semibold text-primary">
                {formatCurrency(total)}
              </span>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Ghi chú</label>
            <textarea
              className="flex min-h-[50px] w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ghi chú đơn đặt hàng"
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
            Tạo đơn đặt hàng
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
