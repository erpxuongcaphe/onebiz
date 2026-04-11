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
import { getClient } from "@/lib/services/supabase/base";
import type { Database } from "@/lib/supabase/types";

type InvoiceInsert = Database["public"]["Tables"]["invoices"]["Insert"];
type InvoiceItemInsert = Database["public"]["Tables"]["invoice_items"]["Insert"];

interface CreateInvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

interface InvoiceLineItem {
  id: string;
  productName: string;
  quantity: number;
  price: number;
  discount: number;
  vatRate: number;
}

interface SearchProduct {
  id: string;
  name: string;
  price: number;
  vatRate: number;
}

interface SearchCustomer {
  id: string;
  name: string;
  phone: string;
}

function generateInvoiceCode() {
  const num = Math.floor(Math.random() * 99999) + 1;
  return `HD${String(num).padStart(6, "0")}`;
}

export function CreateInvoiceDialog({
  open,
  onOpenChange,
  onSuccess,
}: CreateInvoiceDialogProps) {
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [showProductDropdown, setShowProductDropdown] = useState(false);
  const [items, setItems] = useState<InvoiceLineItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState("cash");
  const [discountType, setDiscountType] = useState<"fixed" | "percent">("fixed");
  const [discountValue, setDiscountValue] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [filteredCustomers, setFilteredCustomers] = useState<SearchCustomer[]>([]);
  const [filteredProducts, setFilteredProducts] = useState<SearchProduct[]>([]);

  useEffect(() => {
    if (open) {
      setCode(generateInvoiceCode());
      setCustomerSearch("");
      setSelectedCustomer("");
      setShowCustomerDropdown(false);
      setProductSearch("");
      setShowProductDropdown(false);
      setItems([]);
      setPaymentMethod("cash");
      setDiscountType("fixed");
      setDiscountValue("");
      setNotes("");
      setErrors({});
      setSaving(false);
      setFilteredCustomers([]);
      setFilteredProducts([]);
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
        .select("id, name, sell_price, vat_rate")
        .or(`name.ilike.%${productSearch}%,code.ilike.%${productSearch}%`)
        .eq("is_active", true)
        .limit(10);
      setFilteredProducts((data ?? []).map(p => ({ id: p.id, name: p.name, price: p.sell_price, vatRate: p.vat_rate ?? 0 })));
    }, 300);
    return () => clearTimeout(timer);
  }, [productSearch]);

  function addProduct(product: SearchProduct) {
    const existing = items.find((item) => item.id === product.id);
    if (existing) {
      setItems(
        items.map((item) =>
          item.id === product.id
            ? { ...item, quantity: item.quantity + 1 }
            : item
        )
      );
    } else {
      setItems([
        ...items,
        {
          id: product.id,
          productName: product.name,
          quantity: 1,
          price: product.price,
          discount: 0,
          vatRate: product.vatRate,
        },
      ]);
    }
    setProductSearch("");
    setShowProductDropdown(false);
  }

  function updateItem(
    id: string,
    field: keyof InvoiceLineItem,
    value: string | number
  ) {
    setItems(
      items.map((item) => (item.id === id ? { ...item, [field]: value } : item))
    );
  }

  function removeItem(id: string) {
    setItems(items.filter((item) => item.id !== id));
  }

  const subtotal = useMemo(
    () =>
      items.reduce(
        (sum, item) => sum + item.quantity * item.price - item.discount,
        0
      ),
    [items]
  );

  const discountAmount = useMemo(() => {
    const val = Number(discountValue) || 0;
    if (discountType === "percent") {
      return Math.round((subtotal * val) / 100);
    }
    return val;
  }, [subtotal, discountType, discountValue]);

  const taxAmount = useMemo(
    () =>
      items.reduce((sum, item) => {
        const lineBeforeTax = item.quantity * item.price - item.discount;
        return sum + Math.round(lineBeforeTax * item.vatRate / 100);
      }, 0),
    [items]
  );

  const total = Math.max(0, subtotal - discountAmount + taxAmount);

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
      const { data: { user } } = await supabase.auth.getUser();
      const customerObj = filteredCustomers.find(c => c.id === selectedCustomer);

      // Insert invoice
      const { data: invoice, error: invoiceErr } = await supabase
        .from("invoices")
        .insert({
          tenant_id: "",
          branch_id: "",
          code,
          customer_id: selectedCustomer || null,
          customer_name: customerObj?.name ?? "Khách lẻ",
          status: "completed" as const,
          subtotal,
          discount_amount: discountAmount,
          tax_amount: taxAmount,
          total,
          paid: total,
          debt: 0,
          payment_method: paymentMethod as "cash" | "transfer" | "card" | "mixed",
          note: notes || null,
          created_by: user?.id ?? "",
        } satisfies InvoiceInsert)
        .select("id")
        .single();

      if (invoiceErr) throw new Error(invoiceErr.message);

      // Insert invoice items
      if (invoice && items.length > 0) {
        const { error: itemsErr } = await supabase
          .from("invoice_items")
          .insert(items.map(item => {
            const lineBeforeTax = item.quantity * item.price - item.discount;
            const vatAmt = Math.round(lineBeforeTax * item.vatRate / 100);
            return {
              invoice_id: invoice.id,
              product_id: item.id,
              product_name: item.productName,
              unit: "Cái",
              quantity: item.quantity,
              unit_price: item.price,
              discount: item.discount,
              vat_rate: item.vatRate,
              vat_amount: vatAmt,
              total: lineBeforeTax,
            } satisfies InvoiceItemInsert;
          }));
        if (itemsErr) throw new Error(itemsErr.message);
      }

      onOpenChange(false);
      toast({
        title: "Tạo hóa đơn thành công",
        description: `Đã tạo hóa đơn ${code}`,
        variant: "success",
      });
      onSuccess?.();
    } catch (err) {
      toast({
        title: "Lỗi tạo hóa đơn",
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
          <DialogTitle>Tạo hóa đơn mới</DialogTitle>
          <DialogDescription>
            Mã hóa đơn: {code}
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
                onBlur={() =>
                  setTimeout(() => setShowCustomerDropdown(false), 200)
                }
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
                          setSelectedCustomer(c.id);
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
                onBlur={() =>
                  setTimeout(() => setShowProductDropdown(false), 200)
                }
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
              <div className="grid grid-cols-[1fr_60px_90px_80px_65px_36px] gap-2 px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground">
                <span>Sản phẩm</span>
                <span className="text-center">SL</span>
                <span className="text-right">Đơn giá</span>
                <span className="text-right">Giảm giá</span>
                <span className="text-right">VAT%</span>
                <span />
              </div>
              {items.map((item) => (
                <div
                  key={item.id}
                  className="grid grid-cols-[1fr_60px_90px_80px_65px_36px] gap-2 items-center px-3 py-2 border-t"
                >
                  <span className="text-sm truncate">{item.productName}</span>
                  <Input
                    type="number"
                    min={1}
                    value={item.quantity}
                    onChange={(e) =>
                      updateItem(
                        item.id,
                        "quantity",
                        Math.max(1, Number(e.target.value) || 1)
                      )
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
                  <Input
                    type="number"
                    value={item.discount}
                    onChange={(e) =>
                      updateItem(
                        item.id,
                        "discount",
                        Number(e.target.value) || 0
                      )
                    }
                    className="h-7 text-right px-1"
                  />
                  <Select
                    value={String(item.vatRate)}
                    onValueChange={(v) => updateItem(item.id, "vatRate", Number(v))}
                  >
                    <SelectTrigger className="h-7 text-xs px-1">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">0%</SelectItem>
                      <SelectItem value="5">5%</SelectItem>
                      <SelectItem value="8">8%</SelectItem>
                      <SelectItem value="10">10%</SelectItem>
                    </SelectContent>
                  </Select>
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

          {/* Totals section */}
          <div className="space-y-3 rounded-lg border p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Tạm tính</span>
              <span>{formatCurrency(subtotal)}</span>
            </div>

            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground shrink-0">
                Giảm giá
              </span>
              <div className="flex items-center gap-1 ml-auto">
                <Select
                  value={discountType}
                  onValueChange={(v) =>
                    setDiscountType((v ?? "fixed") as "fixed" | "percent")
                  }
                >
                  <SelectTrigger className="h-7 w-20 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed">VNĐ</SelectItem>
                    <SelectItem value="percent">%</SelectItem>
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  value={discountValue}
                  onChange={(e) => setDiscountValue(e.target.value)}
                  placeholder="0"
                  className="h-7 w-24 text-right"
                />
              </div>
            </div>

            {discountAmount > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Giảm</span>
                <span className="text-orange-600">
                  -{formatCurrency(discountAmount)}
                </span>
              </div>
            )}

            {taxAmount > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Thuế GTGT</span>
                <span>{formatCurrency(taxAmount)}</span>
              </div>
            )}

            <div className="flex items-center justify-between border-t pt-2">
              <span className="font-medium">Tổng cộng</span>
              <span className="text-lg font-semibold text-primary">
                {formatCurrency(total)}
              </span>
            </div>
          </div>

          {/* Payment method */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Phương thức thanh toán
            </label>
            <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v ?? "cash")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Tiền mặt</SelectItem>
                <SelectItem value="transfer">Chuyển khoản</SelectItem>
                <SelectItem value="card">Thẻ</SelectItem>
                <SelectItem value="mixed">Kết hợp</SelectItem>
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
            Tạo hóa đơn
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
