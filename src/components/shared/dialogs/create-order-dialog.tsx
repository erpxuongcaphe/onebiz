"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NumericInput } from "@/components/ui/numeric-input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { formatCurrency, formatNumber } from "@/lib/format";
import { useToast } from "@/lib/contexts";
import { getClient, getCurrentContext } from "@/lib/services/supabase/base";
import { nextEntityCode } from "@/lib/services/supabase/stock-adjustments";
import type { Database } from "@/lib/supabase/types";
import { Icon } from "@/components/ui/icon";

type InvoiceInsert = Database["public"]["Tables"]["invoices"]["Insert"];
type InvoiceItemInsert = Database["public"]["Tables"]["invoice_items"]["Insert"];

interface CreateOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

interface OrderLineItem {
  id: string;
  productCode?: string;
  productName: string;
  unit: string;
  quantity: number;
  price: number;
}

interface SearchProduct {
  id: string;
  code: string;
  name: string;
  unit: string;
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

function lineTotal(item: OrderLineItem) {
  return item.quantity * item.price;
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
    if (!open) return;

    nextEntityCode("invoice")
      .then((c) => setCode(c))
      .catch(() => setCode(`DH${Date.now()}`));

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

    (async () => {
      const supabase = getClient();
      const ctx = await getCurrentContext();
      const { data } = await supabase
        .from("delivery_partners")
        .select("id, name")
        .eq("tenant_id", ctx.tenantId)
        .eq("is_active", true)
        .limit(20);

      setDeliveryPartners((data ?? []).map((d) => ({ id: d.id, name: d.name })));
    })();
  }, [open]);

  useEffect(() => {
    if (!customerSearch || customerSearch.length < 1) {
      setFilteredCustomers([]);
      return;
    }

    const timer = setTimeout(async () => {
      const supabase = getClient();
      const ctx = await getCurrentContext();
      const { data } = await supabase
        .from("customers")
        .select("id, name, phone")
        .or(`name.ilike.%${customerSearch}%,phone.ilike.%${customerSearch}%`)
        .eq("tenant_id", ctx.tenantId)
        .limit(8);

      setFilteredCustomers((data ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone ?? "",
      })));
    }, 300);

    return () => clearTimeout(timer);
  }, [customerSearch]);

  useEffect(() => {
    if (!productSearch || productSearch.length < 1) {
      setFilteredProducts([]);
      return;
    }

    const timer = setTimeout(async () => {
      const supabase = getClient();
      const ctx = await getCurrentContext();
      const { data } = await supabase
        .from("products")
        .select("id, code, name, unit, sell_price")
        .or(`name.ilike.%${productSearch}%,code.ilike.%${productSearch}%`)
        .eq("tenant_id", ctx.tenantId)
        .eq("is_active", true)
        .limit(10);

      setFilteredProducts((data ?? []).map((p) => ({
        id: p.id,
        code: p.code ?? "",
        name: p.name,
        unit: p.unit ?? "Cái",
        price: Number(p.sell_price ?? 0),
      })));
    }, 300);

    return () => clearTimeout(timer);
  }, [productSearch]);

  function addProduct(product: SearchProduct) {
    const existing = items.find((item) => item.id === product.id);
    if (existing) {
      setItems(
        items.map((item) =>
          item.id === product.id ? { ...item, quantity: item.quantity + 1 } : item,
        ),
      );
    } else {
      setItems([
        ...items,
        {
          id: product.id,
          productCode: product.code,
          productName: product.name,
          unit: product.unit || "Cái",
          quantity: 1,
          price: product.price,
        },
      ]);
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
    () => items.reduce((sum, item) => sum + lineTotal(item), 0),
    [items],
  );

  const totalQuantity = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity, 0),
    [items],
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
          .insert(items.map((item) => ({
            invoice_id: invoice.id,
            product_id: item.id,
            product_name: item.productName,
            unit: item.unit || "Cái",
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
      <DialogContent className="flex h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-[1450px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(1200px,calc(100vw-48px))] xl:max-w-[1450px] sm:rounded-2xl">
        <div className="shrink-0 border-b bg-white px-4 py-3 md:px-5">
          <DialogHeader className="gap-0 pr-10">
            <div className="flex flex-wrap items-center gap-3">
              <DialogTitle className="text-xl">Tạo đơn đặt hàng</DialogTitle>
              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                Đơn nháp
              </span>
              <span className="ml-auto mr-8 max-w-none whitespace-nowrap rounded-lg border bg-primary/5 px-3 py-1.5 text-sm font-bold text-primary sm:text-base">
                {code}
              </span>
            </div>
          </DialogHeader>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-surface-container-low p-3 md:p-4">
          <div className="mx-auto flex max-w-[1380px] flex-col gap-3">
            <div className="grid gap-3 xl:grid-cols-[minmax(320px,0.85fr)_minmax(420px,1.15fr)_minmax(280px,0.75fr)]">
              <section className="rounded-xl border bg-white p-3 shadow-sm">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">Khách hàng</h3>
                  {selectedCustomer && (
                    <span className="max-w-[180px] truncate rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                      Đã chọn
                    </span>
                  )}
                </div>
                <div className="relative">
                  <Icon name="search" size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={customerSearch}
                    onChange={(e) => {
                      setCustomerSearch(e.target.value);
                      setShowCustomerDropdown(true);
                    }}
                    onFocus={() => setShowCustomerDropdown(true)}
                    onBlur={() => setTimeout(() => setShowCustomerDropdown(false), 200)}
                    placeholder="Tìm theo tên hoặc SĐT"
                    className="pl-8"
                  />
                  {showCustomerDropdown && customerSearch && (
                    <div className="absolute z-30 mt-1 max-h-52 w-full overflow-y-auto rounded-lg border bg-popover shadow-lg">
                      {filteredCustomers.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">
                          Không tìm thấy khách hàng
                        </div>
                      ) : (
                        filteredCustomers.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setSelectedCustomer({ id: c.id, name: c.name });
                              setCustomerSearch(c.name);
                              setShowCustomerDropdown(false);
                            }}
                          >
                            <span className="truncate font-medium">{c.name}</span>
                            <span className="shrink-0 text-muted-foreground">{c.phone}</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              </section>

              <section className="rounded-xl border bg-white p-3 shadow-sm">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">Dòng hàng</h3>
                  <span className="text-xs text-muted-foreground">{formatNumber(items.length)} dòng</span>
                </div>
                <div className="relative">
                  <Icon name="search" size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
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
                    placeholder="Tìm sản phẩm, mã hàng"
                    className="pl-8"
                  />
                  {showProductDropdown && productSearch && (
                    <div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border bg-popover shadow-lg">
                      {filteredProducts.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">
                          Không tìm thấy sản phẩm
                        </div>
                      ) : (
                        filteredProducts.map((p) => (
                          <button
                            key={p.id}
                            type="button"
                            className="grid w-full grid-cols-[minmax(0,1fr)_130px] gap-3 px-3 py-2 text-left text-sm hover:bg-accent"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => addProduct(p)}
                          >
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{p.name}</span>
                              {p.code && <span className="block truncate text-xs text-muted-foreground">{p.code}</span>}
                            </span>
                            <span className="text-right text-muted-foreground">{formatCurrency(p.price)}</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
                {errors.items && <p className="mt-1 text-xs text-destructive">{errors.items}</p>}
              </section>

              <section className="rounded-xl border bg-white p-3 shadow-sm">
                <h3 className="mb-2 text-sm font-semibold">Giao hàng</h3>
                <Select
                  value={selectedPartner || null}
                  onValueChange={(value) => setSelectedPartner(value ?? "")}
                  items={deliveryPartners.map((dp) => ({ value: dp.id, label: dp.name }))}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Chọn đối tác giao hàng">
                      {(value) => deliveryPartners.find((dp) => dp.id === value)?.name ?? "Chọn đối tác giao hàng"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {deliveryPartners.map((dp) => (
                      <SelectItem key={dp.id} value={dp.id}>
                        {dp.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </section>
            </div>

            <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
              <div className="hidden grid-cols-[minmax(300px,1fr)_90px_112px_150px_150px_44px] gap-2 border-b bg-muted/50 px-3 py-2 text-xs font-semibold uppercase text-muted-foreground md:grid">
                <span>Sản phẩm</span>
                <span className="flex justify-center">ĐVT</span>
                <span className="flex justify-end">Số lượng</span>
                <span className="flex justify-end">Đơn giá</span>
                <span className="flex justify-end">Thành tiền</span>
                <span />
              </div>

              {items.length === 0 ? (
                <div className="flex min-h-[300px] flex-col items-center justify-center px-4 py-10 text-center">
                  <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon name="add_shopping_cart" size={24} />
                  </div>
                  <div className="mt-3 font-semibold">Chưa có dòng hàng</div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    Tìm sản phẩm ở ô trên để thêm vào đơn đặt hàng.
                  </div>
                </div>
              ) : (
                <div className="divide-y">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className="grid gap-2 px-3 py-2.5 md:grid-cols-[minmax(300px,1fr)_90px_112px_150px_150px_44px] md:items-center"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{item.productName}</div>
                        {item.productCode && (
                          <div className="mt-0.5 truncate text-xs text-muted-foreground">{item.productCode}</div>
                        )}
                      </div>
                      <div className="flex justify-center">
                        <span className="min-w-[64px] rounded-md bg-muted/50 px-2 py-1 text-center text-xs font-semibold text-muted-foreground">
                          {item.unit || "Cái"}
                        </span>
                      </div>
                      <NumericInput
                        value={item.quantity}
                        onChange={(value) => updateItem(item.id, "quantity", Math.max(0.01, value ?? 0.01))}
                        min={0.01}
                        decimals={2}
                        className="h-8 text-right"
                        aria-label={`Số lượng ${item.productName}`}
                      />
                      <NumericInput
                        value={item.price}
                        onChange={(value) => updateItem(item.id, "price", value ?? 0)}
                        min={0}
                        decimals={2}
                        className="h-8 text-right"
                        aria-label={`Đơn giá ${item.productName}`}
                      />
                      <div className="text-right text-sm font-bold tabular-nums text-primary">
                        {formatCurrency(lineTotal(item))}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => removeItem(item.id)}
                        className="justify-self-end text-muted-foreground hover:text-destructive"
                        aria-label={`Xóa ${item.productName}`}
                      >
                        <Icon name="delete" size={14} />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <section className="rounded-xl border bg-white p-3 shadow-sm">
              <label className="text-sm font-medium">Ghi chú</label>
              <textarea
                className="mt-2 flex min-h-[52px] w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ví dụ: thời gian giao, địa chỉ giao, yêu cầu của khách..."
                rows={2}
              />
            </section>
          </div>
        </div>

        <DialogFooter className="mx-0 mb-0 shrink-0 rounded-none border-t bg-white px-4 py-3">
          <div className="mx-auto grid w-full max-w-[1380px] grid-cols-1 items-center gap-3 lg:grid-cols-[1fr_auto]">
            <div className="grid gap-2 text-sm sm:grid-cols-3 xl:grid-cols-4">
              <FooterMetric label="Dòng" value={formatNumber(items.length)} />
              <FooterMetric label="Tổng SL" value={formatNumber(totalQuantity)} />
              <FooterMetric label="Tổng cộng" value={formatCurrency(total)} strong />
              <FooterMetric label="Trạng thái" value="Nháp" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Hủy
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving && <Icon name="progress_activity" size={16} className="mr-2 animate-spin" />}
                Tạo đơn hàng
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FooterMetric({
  label,
  value,
  strong,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-surface-container-lowest px-3 py-2">
      <div className="text-[11px] font-semibold uppercase text-muted-foreground">{label}</div>
      <div className={`mt-0.5 break-words font-bold leading-tight tabular-nums ${strong ? "text-lg text-primary" : ""}`}>
        {value}
      </div>
    </div>
  );
}
