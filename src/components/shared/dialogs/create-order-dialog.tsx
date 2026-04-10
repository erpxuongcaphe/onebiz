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
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Trash2, Search, Loader2 } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { useToast } from "@/lib/contexts";
import { getClient, getCurrentContext } from "@/lib/services/supabase/base";
import { nextEntityCode } from "@/lib/services/supabase/stock-adjustments";
import type { Database } from "@/lib/supabase/types";

type InvoiceInsert = Database["public"]["Tables"]["invoices"]["Insert"];
type InvoiceItemInsert = Database["public"]["Tables"]["invoice_items"]["Insert"];

interface CreateOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

interface OrderLineItem {
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

interface SearchCustomer {
  id: string;
  name: string;
  phone: string;
}

interface DeliveryPartner {
  id: string;
  name: string;
}

export function CreateOrderDialog({
  open,
  onOpenChange,
  onSuccess,
}: CreateOrderDialogProps) {
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<{ id: string; name: string } | null>(null);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [filteredCustomers, setFilteredCustomers] = useState<SearchCustomer[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [showProductDropdown, setShowProductDropdown] = useState(false);
  const [filteredProducts, setFilteredProducts] = useState<SearchProduct[]>([]);
  const [items, setItems] = useState<OrderLineItem[]>([]);
  const [deliveryPartners, setDeliveryPartners] = useState<DeliveryPartner[]>([]);
  const [selectedPartner, setSelectedPartner] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      nextEntityCode("invoice").then((c) => setCode(c)).catch(() => setCode(`DH${Date.now()}`));
      setCustomerSearch("");
      setSelectedCustomer(null);
      setShowCustomerDropdown(false);
      setFilteredCustomers([]);
      setProductSearch("");
      setShowProductDropdown(false);
      setFilteredProducts([]);
      setItems([]);
      setSelectedPartner("");
      setNotes("");
      setErrors({});
      setSaving(false);

      // Load delivery partners
      (async () => {
        const supabase = getClient();
        const { data } = await supabase
          .from("delivery_partners")
          .select("id, name")
          .eq("is_active", true)
          .limit(20);
        setDeliveryPartners((data ?? []).map(d => ({ id: d.id, name: d.name })));
      })();
    }
  }, [open]);

  // Live search customers
  useEffect(() => {
    if (!customerSearch || customerSearch.length < 1) { setFilteredCustomers([]); return; }
    const timer = setTimeout(async () => {
      const supabase = getClient();
      const { data } = await supabase
        .from("customers")
        .select("id, name, phone")
        .or(`name.ilike.%${customerSearch}%,phone.ilike.%${customerSearch}%`)
        .limit(8);
      setFilteredCustomers((data ?? []).map(c => ({ id: c.id, name: c.name, phone: c.phone ?? "" })));
    }, 300);
    return () => clearTimeout(timer);
  }, [customerSearch]);

  // Live search products
  useEffect(() => {
    if (!productSearch || productSearch.length < 1) { setFilteredProducts([]); return; }
    const timer = setTimeout(async () => {
      const supabase = getClient();
      const { data } = await supabase
        .from("products")
        .select("id, name, sell_price")
        .or(`name.ilike.%${productSearch}%,code.ilike.%${productSearch}%`)
        .eq("is_active", true)
        .limit(10);
      setFilteredProducts((data ?? []).map(p => ({ id: p.id, name: p.name, price: p.sell_price })));
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

  function updateItem(id: string, field: keyof OrderLineItem, value: string | number) {
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
    if (items.length === 0) newErrors.items = "Chưa có sản phẩm nào";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    try {
      const supabase = getClient();
      const ctx = await getCurrentContext();

      const { data: invoice, error: invoiceErr } = await supabase
        .from("invoices")
        .insert({
          tenant_id: ctx.tenantId,
          branch_id: ctx.branchId,
          code,
          customer_id: selectedCustomer?.id || null,
          customer_name: selectedCustomer?.name ?? "Khách lẻ",
          status: "draft" as const,
          subtotal: total,
          discount_amount: 0,
          total,
          paid: 0,
          debt: total,
          payment_method: "cash" as const,
          note: notes || null,
          created_by: ctx.userId,
        } satisfies InvoiceInsert)
        .select("id")
        .single();

      if (invoiceErr) throw new Error(invoiceErr.message);

      if (invoice && items.length > 0) {
        const { error: itemsErr } = await supabase
          .from("invoice_items")
          .insert(items.map(item => ({
            invoice_id: invoice.id,
            product_id: item.id,
            product_name: item.productName,
            unit: "Cái",
            quantity: item.quantity,
            unit_price: item.price,
            discount: 0,
            total: item.quantity * item.price,
          } satisfies InvoiceItemInsert)));
        if (itemsErr) throw new Error(itemsErr.message);
      }

      onOpenChange(false);
      toast({
        title: "Tạo đơn đặt hàng thành công",
        description: `Đã tạo đơn đặt hàng ${code}`,
        variant: "success",
      });
      onSuccess?.();
    } catch (err) {
      toast({
        title: "Lỗi tạo đơn đặt hàng",
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
          <DialogTitle>Tạo đơn đặt hàng</DialogTitle>
          <DialogDescription>
            Mã đơn hàng: {code}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Customer search */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Khách hàng</label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={customerSearch}
                onChange={(e) => {
                  setCustomerSearch(e.target.value);
                  setShowCustomerDropdown(true);
                }}
                onFocus={() => setShowCustomerDropdown(true)}
                onBlur={() => setTimeout(() => setShowCustomerDropdown(false), 200)}
                placeholder="Tìm khách hàng theo tên, SĐT..."
                className="pl-8"
              />
              {showCustomerDropdown && customerSearch && (
                <div className="absolute z-10 mt-1 w-full rounded-lg border bg-popover shadow-md max-h-40 overflow-y-auto">
                  {filteredCustomers.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      Không tìm thấy khách hàng
                    </div>
                  ) : (
                    filteredCustomers.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-accent cursor-pointer"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setSelectedCustomer({ id: c.id, name: c.name });
                          setCustomerSearch(c.name);
                          setShowCustomerDropdown(false);
                        }}
                      >
                        <span>{c.name}</span>
                        <span className="text-muted-foreground">{c.phone}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
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
                placeholder="Tìm sản phẩm theo tên..."
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
            <div className="flex items-center justify-between">
              <span className="font-medium">Tổng cộng</span>
              <span className="text-lg font-semibold text-primary">
                {formatCurrency(total)}
              </span>
            </div>
          </div>

          {/* Delivery partner */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Đối tác giao hàng</label>
            <Select value={selectedPartner} onValueChange={(v) => setSelectedPartner(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Chọn đối tác giao hàng" />
              </SelectTrigger>
              <SelectContent>
                {deliveryPartners.map((dp) => (
                  <SelectItem key={dp.id} value={dp.id}>
                    {dp.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Ghi chú</label>
            <textarea
              className="flex min-h-[50px] w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ghi chú đơn hàng"
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
            Tạo đơn hàng
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
