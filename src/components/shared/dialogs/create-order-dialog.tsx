"use client";

import { useState, useEffect, useMemo, useRef } from "react";
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
import { useToast, useBranchFilter } from "@/lib/contexts";
import { getClient, getCurrentContext } from "@/lib/services/supabase/base";
import {
  getBranchSalesChannel,
  type BranchSalesChannel,
} from "@/lib/services/supabase/products";
import { nextEntityCode } from "@/lib/services/supabase/stock-adjustments";
import { saveSalesOrderAtomic } from "@/lib/services/supabase/orders";
import { Icon } from "@/components/ui/icon";
import {
  getSalesOrderSaveErrorMessage,
  normalizeSalesOrderReceiver,
  validateSalesOrderDraft,
} from "@/lib/sales-order-form";

/** Đơn cần SỬA — truyền vào → dialog chuyển chế độ sửa (giữ mã, prefill, cảnh báo diff). */
export interface EditOrderInput {
  id: string;
  code: string;
  customerId: string | null;
  customerName: string;
  deliveryFee: number;
  note: string | null;
  items: Array<{
    productId: string;
    productCode?: string;
    productName: string;
    unit: string;
    quantity: number;
    price: number;
    /** Ghi chú riêng của dòng (invoice_items.note) — giữ khi mở lại để sửa. */
    note?: string;
  }>;
}

interface CreateOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  /** Có giá trị → chế độ SỬA đơn đã có (thay vì tạo mới). */
  editOrder?: EditOrderInput | null;
}

/** 1 dòng thay đổi hiện trên bảng cảnh báo trước khi lưu. */
interface ChangeRow {
  type: "add" | "remove" | "qty" | "price" | "info";
  name: string;
  detail: string;
}

interface OrderLineItem {
  id: string;
  productCode?: string;
  productName: string;
  unit: string;
  quantity: number;
  price: number;
  /** CEO 23/07: ghi chú riêng cho từng mã hàng (dùng cột invoice_items.note). */
  note?: string;
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
  address: string;
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
  editOrder = null,
}: CreateOrderDialogProps) {
  const { toast } = useToast();
  const isEdit = !!editOrder;
  // Ảnh chụp trạng thái GỐC (lúc mở sửa) để so ra danh sách thay đổi.
  const originalRef = useRef<{
    items: OrderLineItem[];
    customerId: string | null;
    customerName: string;
    deliveryFee: number;
    note: string;
  } | null>(null);
  // Danh sách thay đổi đang chờ CEO duyệt (null = chưa bấm Lưu).
  const [pendingChanges, setPendingChanges] = useState<ChangeRow[] | null>(null);
  const [code, setCode] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<{ id: string; name: string } | null>(null);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [filteredCustomers, setFilteredCustomers] = useState<SearchCustomer[]>([]);
  const [productSearch, setProductSearch] = useState("");
  const [showProductDropdown, setShowProductDropdown] = useState(false);
  const [filteredProducts, setFilteredProducts] = useState<SearchProduct[]>([]);
  // CEO 23/07: ngành hàng bán được tại CN đang chọn (Kho Tổng→retail, quán→fnb,
  // "Tất cả chi nhánh"→null = không lọc). Chặn NVL + món F&B lọt vào đơn Retail.
  const { activeBranchId } = useBranchFilter();
  const [salesChannel, setSalesChannel] = useState<
    BranchSalesChannel | undefined
  >(undefined);
  const [items, setItems] = useState<OrderLineItem[]>([]);
  const [deliveryPartners, setDeliveryPartners] = useState<DeliveryPartner[]>([]);
  const [selectedPartner, setSelectedPartner] = useState("");
  const [shippingFee, setShippingFee] = useState(0);
  // CEO 08/07: thông tin người nhận — đủ 3 ô → tự tạo VẬN ĐƠN gắn đơn.
  const [receiverName, setReceiverName] = useState("");
  const [receiverPhone, setReceiverPhone] = useState("");
  const [receiverAddress, setReceiverAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;

    setPendingChanges(null);
    setShowCustomerDropdown(false);
    setFilteredCustomers([]);
    setProductSearch("");
    setShowProductDropdown(false);
    setFilteredProducts([]);
    setSelectedPartner("");
    setReceiverName("");
    setReceiverPhone("");
    setReceiverAddress("");
    setErrors({});
    setSaving(false);

    if (editOrder) {
      // ── Chế độ SỬA: giữ mã, prefill từ đơn ──
      setCode(editOrder.code);
      setSelectedCustomer(
        editOrder.customerId ? { id: editOrder.customerId, name: editOrder.customerName } : null,
      );
      setCustomerSearch(editOrder.customerName ?? "");
      const prefillItems: OrderLineItem[] = editOrder.items.map((it) => ({
        id: it.productId,
        productCode: it.productCode,
        productName: it.productName,
        unit: it.unit || "Cái",
        quantity: it.quantity,
        price: it.price,
        note: it.note,
      }));
      setItems(prefillItems);
      setShippingFee(editOrder.deliveryFee ?? 0);
      setNotes(editOrder.note ?? "");
      // Chụp gốc để diff khi lưu (deep copy items).
      originalRef.current = {
        items: prefillItems.map((it) => ({ ...it })),
        customerId: editOrder.customerId,
        customerName: editOrder.customerName,
        deliveryFee: editOrder.deliveryFee ?? 0,
        note: editOrder.note ?? "",
      };
    } else {
      // ── Chế độ TẠO: sinh mã mới, reset trắng ──
      // CEO 10/07: đơn đặt hàng lấy dãy 'order' (DH...), KHÔNG lấy 'invoice' (HD).
      // Số HD chỉ cấp khi thanh toán (complete_draft_atomic v2 gán HD + order_code).
      nextEntityCode("order")
        .then((c) => setCode(c))
        .catch(() => setCode(`DH${Date.now()}`));
      setCustomerSearch("");
      setSelectedCustomer(null);
      setItems([]);
      setShippingFee(0);
      setNotes("");
      originalRef.current = null;
    }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editOrder?.id]);

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
        .select("id, name, phone, address")
        .or(`name.ilike.%${customerSearch}%,phone.ilike.%${customerSearch}%`)
        .eq("tenant_id", ctx.tenantId)
        .limit(8);

      setFilteredCustomers((data ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        phone: c.phone ?? "",
        address: c.address ?? "",
      })));
    }, 300);

    return () => clearTimeout(timer);
  }, [customerSearch]);

  // Nạp ngành hàng theo chi nhánh đang chọn (1 lần mỗi lần đổi CN).
  useEffect(() => {
    let cancelled = false;
    setSalesChannel(undefined);
    getBranchSalesChannel(activeBranchId)
      .then((ch) => !cancelled && setSalesChannel(ch))
      .catch(() => !cancelled && setSalesChannel(undefined));
    return () => {
      cancelled = true;
    };
  }, [activeBranchId]);

  useEffect(() => {
    if (!productSearch || productSearch.length < 1) {
      setFilteredProducts([]);
      return;
    }

    // Chưa xác định được kênh chi nhánh thì không tìm SKU. Không được mở
    // rộng thành cả Retail + FnB khi lỗi mạng hoặc cấu hình chi nhánh sai.
    if (!salesChannel) {
      setFilteredProducts([]);
      return;
    }

    const timer = setTimeout(async () => {
      const supabase = getClient();
      const ctx = await getCurrentContext();
      // CEO 23/07: trước đây tìm trong TOÀN BỘ bảng sản phẩm → lọt cả NVL
      // (không được bán) lẫn món F&B của quán khi đang đứng ở Kho Tổng.
      // Nay: chỉ hàng BÁN (sku) + đúng ngành của chi nhánh đang chọn.
      let query = supabase
        .from("products")
        .select("id, code, name, unit, sell_price")
        .or(`name.ilike.%${productSearch}%,code.ilike.%${productSearch}%`)
        .eq("tenant_id", ctx.tenantId)
        .eq("is_active", true)
        .eq("product_type", "sku");
      if (salesChannel === "fnb") {
        query = query.eq("channel", "fnb");
      } else {
        query = query.or("channel.is.null,channel.neq.fnb");
      }
      const { data } = await query.limit(10);

      setFilteredProducts((data ?? []).map((p) => ({
        id: p.id,
        code: p.code ?? "",
        name: p.name,
        unit: p.unit ?? "Cái",
        price: Number(p.sell_price ?? 0),
      })));
    }, 300);

    return () => clearTimeout(timer);
  }, [productSearch, salesChannel]);

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
    setErrors((current) => ({ ...current, items: "" }));
  }

  function updateItem(id: string, field: keyof OrderLineItem, value: string | number) {
    setItems(items.map((item) => (item.id === id ? { ...item, [field]: value } : item)));
    setErrors((current) => ({ ...current, items: "" }));
  }

  function removeItem(id: string) {
    setItems(items.filter((item) => item.id !== id));
  }

  const total = useMemo(
    () => items.reduce((sum, item) => sum + lineTotal(item), 0),
    [items],
  );

  // Khách cần trả = tiền hàng + phí giao hàng (discount = 0 ở dialog này).
  const grandTotal = useMemo(() => total + shippingFee, [total, shippingFee]);

  const totalQuantity = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity, 0),
    [items],
  );

  function validate(): boolean {
    const newErrors = validateSalesOrderDraft({
      items,
      deliveryFee: shippingFee,
      receiver: normalizeSalesOrderReceiver(receiverName, receiverPhone, receiverAddress),
    });
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  /** So trạng thái hiện tại với gốc → danh sách thay đổi cho bảng cảnh báo. */
  function computeChanges(): ChangeRow[] {
    const orig = originalRef.current;
    if (!orig) return [];
    const changes: ChangeRow[] = [];
    const origById = new Map(orig.items.map((it) => [it.id, it]));
    const nowById = new Map(items.map((it) => [it.id, it]));

    for (const it of items) {
      const before = origById.get(it.id);
      if (!before) {
        changes.push({ type: "add", name: it.productName, detail: `thêm mới · SL ${formatNumber(it.quantity)}` });
        continue;
      }
      if (before.quantity !== it.quantity) {
        changes.push({ type: "qty", name: it.productName, detail: `SL ${formatNumber(before.quantity)} → ${formatNumber(it.quantity)}` });
      }
      if (before.price !== it.price) {
        changes.push({ type: "price", name: it.productName, detail: `đơn giá ${formatCurrency(before.price)} → ${formatCurrency(it.price)}` });
      }
      if ((before.note ?? "").trim() !== (it.note ?? "").trim()) {
        changes.push({ type: "info", name: it.productName, detail: "đã thay đổi ghi chú" });
      }
    }
    for (const it of orig.items) {
      if (!nowById.has(it.id)) {
        changes.push({ type: "remove", name: it.productName, detail: `bỏ khỏi đơn (đang có SL ${formatNumber(it.quantity)})` });
      }
    }
    const currentCustomerId = selectedCustomer?.id ?? null;
    if (orig.customerId !== currentCustomerId) {
      changes.push({
        type: "info",
        name: "Khách hàng",
        detail:
          (orig.customerName || "Khách lẻ") +
          " → " +
          (selectedCustomer?.name || "Khách lẻ"),
      });
    }
    if (orig.deliveryFee !== shippingFee) {
      changes.push({ type: "price", name: "Phí giao hàng", detail: `${formatCurrency(orig.deliveryFee)} → ${formatCurrency(shippingFee)}` });
    }
    if ((orig.note ?? "") !== (notes ?? "")) {
      changes.push({ type: "qty", name: "Ghi chú đơn", detail: "đã thay đổi" });
    }
    return changes;
  }

  /** Bấm Lưu ở chế độ SỬA → tính diff → mở bảng cảnh báo (không lưu ngay). */
  function handleReviewChanges() {
    if (!validate()) return;
    const changes = computeChanges();
    if (changes.length === 0) {
      toast({ title: "Không có thay đổi nào để lưu", variant: "default" });
      return;
    }
    setPendingChanges(changes);
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    try {
      const ctx = await getCurrentContext();
      const receiver = normalizeSalesOrderReceiver(
        receiverName,
        receiverPhone,
        receiverAddress,
      );
      const wantShipment = receiver.isComplete;
      const result = await saveSalesOrderAtomic({
        requestedCode: code,
        branchId: activeBranchId ?? ctx.branchId,
        customerId: selectedCustomer?.id ?? null,
        deliveryFee: shippingFee,
        note: notes || null,
        partnerId: wantShipment ? selectedPartner || null : null,
        receiverName: wantShipment ? receiver.name : null,
        receiverPhone: wantShipment ? receiver.phone : null,
        receiverAddress: wantShipment ? receiver.address : null,
        items: items.map((item) => ({
          productId: item.id,
          quantity: item.quantity,
          unitPrice: item.price,
          note: item.note?.trim() || null,
        })),
      });

      onOpenChange(false);
      toast({
        title: "Tạo đơn đặt hàng thành công",
        description: wantShipment && result.shipmentCode
          ? `Đã tạo đơn ${result.orderCode} và vận đơn ${result.shipmentCode}`
          : `Đã tạo đơn đặt hàng ${result.orderCode}`,
        variant: "success",
      });
      onSuccess?.();
    } catch (err) {
      toast({
        title: "Lỗi tạo đơn đặt hàng",
        description: getSalesOrderSaveErrorMessage(err),
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  /** CEO đã DUYỆT bảng cảnh báo → ghi thay đổi vào đơn (chỉ khi vẫn là nháp). */
  async function handleUpdate() {
    if (!editOrder || !validate()) return;
    setSaving(true);
    try {
      const ctx = await getCurrentContext();
      const receiver = normalizeSalesOrderReceiver(
        receiverName,
        receiverPhone,
        receiverAddress,
      );
      const result = await saveSalesOrderAtomic({
        orderId: editOrder.id,
        requestedCode: editOrder.code,
        branchId: activeBranchId ?? ctx.branchId,
        customerId: selectedCustomer?.id ?? null,
        deliveryFee: shippingFee,
        note: notes || null,
        partnerId: receiver.isComplete ? selectedPartner || null : null,
        receiverName: receiver.isComplete ? receiver.name : null,
        receiverPhone: receiver.isComplete ? receiver.phone : null,
        receiverAddress: receiver.isComplete ? receiver.address : null,
        items: items.map((item) => ({
          productId: item.id,
          quantity: item.quantity,
          unitPrice: item.price,
          note: item.note?.trim() || null,
        })),
      });

      setPendingChanges(null);
      onOpenChange(false);
      toast({
        title: "Đã lưu thay đổi đơn đặt hàng",
        description: `Đơn ${result.orderCode} đã cập nhật đầy đủ.`,
        variant: "success",
      });
      onSuccess?.();
    } catch (err) {
      toast({
        title: "Lỗi lưu thay đổi",
        description: getSalesOrderSaveErrorMessage(err),
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-[1450px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(1200px,calc(100vw-48px))] xl:max-w-[1450px] sm:rounded-2xl">
        <div className="shrink-0 border-b bg-white px-4 py-3 md:px-5">
          <DialogHeader className="gap-0 pr-10">
            <div className="flex flex-wrap items-center gap-3">
              <DialogTitle className="text-xl">
                {isEdit ? "Sửa đơn đặt hàng" : "Tạo đơn đặt hàng"}
              </DialogTitle>
              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                {isEdit ? "Đang sửa" : "Đơn nháp"}
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
                      const nextSearch = e.target.value;
                      setCustomerSearch(nextSearch);
                      if (selectedCustomer && nextSearch !== selectedCustomer.name) {
                        setSelectedCustomer(null);
                      }
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
                              // Chỉ tự điền khi hồ sơ khách có đủ thông tin giao hàng.
                              if (c.phone.trim() && c.address.trim()) {
                                setReceiverName((v) => v || c.name);
                                setReceiverPhone((v) => v || c.phone);
                                setReceiverAddress((v) => v || c.address);
                                setErrors((current) => ({ ...current, receiver: "" }));
                              }
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
                <div className="mt-3">
                  <label className="mb-1 block text-xs font-medium text-muted-foreground">
                    Phí giao hàng
                  </label>
                  <NumericInput
                    value={shippingFee}
                    onChange={(v) => {
                      setShippingFee(Math.max(0, v ?? 0));
                      setErrors((current) => ({ ...current, shippingFee: "" }));
                    }}
                    min={0}
                    decimals={0}
                    className="text-right"
                    placeholder="0"
                    aria-label="Phí giao hàng"
                  />
                  {errors.shippingFee && (
                    <p className="mt-1 text-xs text-destructive">{errors.shippingFee}</p>
                  )}
                </div>
                {/* CEO 08/07: đủ 3 ô dưới → tự tạo VẬN ĐƠN gắn đơn khi lưu */}
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Input
                    value={receiverName}
                    onChange={(e) => {
                      setReceiverName(e.target.value);
                      setErrors((current) => ({ ...current, receiver: "" }));
                    }}
                    placeholder="Người nhận"
                    aria-label="Người nhận"
                  />
                  <Input
                    value={receiverPhone}
                    onChange={(e) => {
                      setReceiverPhone(e.target.value);
                      setErrors((current) => ({ ...current, receiver: "" }));
                    }}
                    placeholder="SĐT người nhận"
                    aria-label="SĐT người nhận"
                  />
                </div>
                <div className="mt-2">
                  <Input
                    value={receiverAddress}
                    onChange={(e) => {
                      setReceiverAddress(e.target.value);
                      setErrors((current) => ({ ...current, receiver: "" }));
                    }}
                    placeholder="Địa chỉ giao hàng"
                    aria-label="Địa chỉ giao hàng"
                  />
                </div>
                {errors.receiver && (
                  <p className="mt-1.5 text-xs text-destructive">{errors.receiver}</p>
                )}
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Điền đủ người nhận + SĐT + địa chỉ → hệ thống tự tạo vận đơn
                  kèm đơn này.
                </p>
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
                        {/* CEO 23/07: ghi chú riêng từng mã hàng — in ra ở cột "Ghi chú". */}
                        <Input
                          value={item.note ?? ""}
                          onChange={(e) => updateItem(item.id, "note", e.target.value)}
                          placeholder="Ghi chú riêng mã này (tùy chọn)"
                          className="mt-1 h-7 text-xs"
                          aria-label={`Ghi chú ${item.productName}`}
                        />
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
            <div className="grid gap-2 text-sm sm:grid-cols-3 xl:grid-cols-5">
              <FooterMetric label="Dòng" value={formatNumber(items.length)} />
              <FooterMetric label="Tổng SL" value={formatNumber(totalQuantity)} />
              <FooterMetric label="Tiền hàng" value={formatCurrency(total)} />
              {shippingFee > 0 && (
                <FooterMetric label="Phí giao hàng" value={formatCurrency(shippingFee)} />
              )}
              <FooterMetric label="Khách cần trả" value={formatCurrency(grandTotal)} strong />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                {isEdit ? "Đóng" : "Hủy"}
              </Button>
              <Button onClick={isEdit ? handleReviewChanges : handleSave} disabled={saving}>
                {saving && <Icon name="progress_activity" size={16} className="mr-2 animate-spin" />}
                {isEdit ? "Lưu thay đổi" : "Tạo đơn hàng"}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* Cảnh báo thay đổi — CEO 20/07: luôn xác nhận trước khi ghi đè đơn */}
    <Dialog open={!!pendingChanges} onOpenChange={(o) => { if (!o) setPendingChanges(null); }}>
      <DialogContent className="w-[min(560px,calc(100vw-2rem))] max-w-none sm:max-w-none">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="warning" size={20} className="text-status-warning" />
            Xác nhận thay đổi đơn {code}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Đơn sẽ được cập nhật theo các thay đổi dưới đây. Kiểm tra kỹ trước khi lưu:
        </p>
        <div className="max-h-[46vh] space-y-1.5 overflow-y-auto rounded-lg border bg-muted/20 p-2">
          {(pendingChanges ?? []).map((c, i) => (
            <div key={i} className="flex items-start gap-2 text-sm">
              <Icon
                name={
                  c.type === "add" ? "add_circle"
                    : c.type === "remove" ? "remove_circle"
                    : "edit"
                }
                size={16}
                className={
                  c.type === "add" ? "mt-0.5 shrink-0 text-status-success"
                    : c.type === "remove" ? "mt-0.5 shrink-0 text-status-danger"
                    : "mt-0.5 shrink-0 text-status-warning"
                }
              />
              <span className="min-w-0">
                <span className="font-medium">{c.name}</span>
                <span className="text-muted-foreground"> — {c.detail}</span>
              </span>
            </div>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg border bg-surface-container-lowest px-3 py-2 text-sm">
          <span className="text-muted-foreground">Khách cần trả sau khi sửa</span>
          <span className="text-lg font-bold tabular-nums text-primary">{formatCurrency(grandTotal)}</span>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setPendingChanges(null)} disabled={saving}>
            Xem lại
          </Button>
          <Button onClick={handleUpdate} disabled={saving}>
            {saving && <Icon name="progress_activity" size={16} className="mr-2 animate-spin" />}
            Đồng ý lưu
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
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
