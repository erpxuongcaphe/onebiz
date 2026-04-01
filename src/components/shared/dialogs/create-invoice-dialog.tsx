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
import { Plus, Trash2, Search } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { useToast } from "@/lib/contexts";

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
}

const mockProducts = [
  { id: "p1", name: "Cà phê rang xay Arabica 500g", price: 185000 },
  { id: "p2", name: "Trà oolong thượng hạng 200g", price: 250000 },
  { id: "p3", name: "Sữa đặc Ông Thọ 380g", price: 28000 },
  { id: "p4", name: "Đường phèn túi 1kg", price: 45000 },
  { id: "p5", name: "Ly giấy 12oz (50 cái)", price: 75000 },
  { id: "p6", name: "Cà phê hòa tan 3in1 hộp 20 gói", price: 95000 },
  { id: "p7", name: "Trà sen Tây Hồ 100g", price: 180000 },
  { id: "p8", name: "Ống hút giấy (100 cái)", price: 35000 },
];

const mockCustomers = [
  { id: "c1", name: "Nguyễn Minh Tuấn", phone: "0901234567" },
  { id: "c2", name: "Trần Thị Hoa", phone: "0912345678" },
  { id: "c3", name: "Công ty TNHH ABC Coffee", phone: "0281234567" },
  { id: "c4", name: "Lê Văn Đức", phone: "0934567890" },
  { id: "c5", name: "Phạm Mai Lan", phone: "0945678901" },
];

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
    }
  }, [open]);

  const filteredCustomers = mockCustomers.filter(
    (c) =>
      c.name.toLowerCase().includes(customerSearch.toLowerCase()) ||
      c.phone.includes(customerSearch)
  );

  const filteredProducts = mockProducts.filter((p) =>
    p.name.toLowerCase().includes(productSearch.toLowerCase())
  );

  function addProduct(product: (typeof mockProducts)[0]) {
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

  const total = Math.max(0, subtotal - discountAmount);

  function validate(): boolean {
    const newErrors: Record<string, string> = {};
    if (items.length === 0) newErrors.items = "Chưa có sản phẩm nào";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  function handleSave() {
    if (!validate()) return;
    console.log("Tạo hóa đơn:", {
      code,
      customer: selectedCustomer,
      items,
      paymentMethod,
      discountType,
      discountValue: Number(discountValue) || 0,
      discountAmount,
      subtotal,
      total,
      notes,
    });
    onOpenChange(false);
    toast({
      title: "Tạo hóa đơn thành công",
      description: `Đã tạo hóa đơn ${code}`,
      variant: "success",
    });
    onSuccess?.();
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
              <div className="grid grid-cols-[1fr_70px_100px_90px_36px] gap-2 px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground">
                <span>Sản phẩm</span>
                <span className="text-center">SL</span>
                <span className="text-right">Đơn giá</span>
                <span className="text-right">Giảm giá</span>
                <span />
              </div>
              {items.map((item) => (
                <div
                  key={item.id}
                  className="grid grid-cols-[1fr_70px_100px_90px_36px] gap-2 items-center px-3 py-2 border-t"
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
          <Button onClick={handleSave}>Tạo hóa đơn</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
