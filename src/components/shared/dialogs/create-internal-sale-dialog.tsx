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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency } from "@/lib/format";
import { useToast, useAuth } from "@/lib/contexts";
import { getClient } from "@/lib/services/supabase/base";
import { createInternalSale, getBranches, syncInternalEntities } from "@/lib/services";
import type { BranchDetail } from "@/lib/services";
import { Icon } from "@/components/ui/icon";

interface CreateInternalSaleDialogProps {
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
  sell_price: number;
  vat_rate: number;
}

interface SaleItem {
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  stock: number;
  quantity: number;
  unitPrice: number;
  vatRate: number;
}

export function CreateInternalSaleDialog({
  open,
  onOpenChange,
  onSuccess,
}: CreateInternalSaleDialogProps) {
  const { toast } = useToast();
  const { user } = useAuth();
  const [branches, setBranches] = useState<BranchDetail[]>([]);
  const [fromBranchId, setFromBranchId] = useState("");
  const [toBranchId, setToBranchId] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"transfer" | "cash" | "debt">("transfer");
  const [productSearch, setProductSearch] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [filteredProducts, setFilteredProducts] = useState<ProductResult[]>([]);
  const [items, setItems] = useState<SaleItem[]>([]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const saveLockRef = useRef(false);

  // Load branches on open
  useEffect(() => {
    if (!open) return;
    setFromBranchId("");
    setToBranchId("");
    setPaymentMethod("transfer");
    setProductSearch("");
    setShowDropdown(false);
    setFilteredProducts([]);
    setItems([]);
    setNote("");
    setSaving(false);

    getBranches().then(setBranches).catch(() => {});
  }, [open]);

  // Product search debounce
  useEffect(() => {
    if (!productSearch || productSearch.length < 1) {
      setFilteredProducts([]);
      return;
    }
    const timer = setTimeout(async () => {
      const supabase = getClient();
      const { data } = await supabase
        .from("products")
        .select("id, code, name, unit, stock, sell_price, vat_rate")
        .or(`name.ilike.%${productSearch}%,code.ilike.%${productSearch}%`)
        .eq("is_active", true)
        .limit(8);
      setFilteredProducts(
        (data ?? []).map((p) => ({
          id: p.id,
          code: p.code,
          name: p.name,
          unit: p.unit,
          stock: p.stock,
          sell_price: p.sell_price,
          vat_rate: p.vat_rate ?? 0,
        })),
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [productSearch]);

  function addProduct(p: ProductResult) {
    if (items.some((i) => i.productId === p.id)) return;
    setItems([
      ...items,
      {
        productId: p.id,
        productCode: p.code,
        productName: p.name,
        unit: p.unit,
        stock: p.stock,
        quantity: 1,
        unitPrice: p.sell_price,
        vatRate: p.vat_rate,
      },
    ]);
    setProductSearch("");
    setShowDropdown(false);
  }

  function removeItem(productId: string) {
    setItems(items.filter((i) => i.productId !== productId));
  }

  function updateItem(productId: string, field: "quantity" | "unitPrice", value: number) {
    setItems(items.map((i) => (i.productId === productId ? { ...i, [field]: value } : i)));
  }

  const subtotal = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const taxTotal = items.reduce(
    (s, i) => s + Math.round(i.quantity * i.unitPrice * i.vatRate / 100),
    0,
  );
  const total = subtotal + taxTotal;

  async function handleSave() {
    if (saveLockRef.current) return;
    if (!fromBranchId || !toBranchId) {
      toast({ title: "Chọn chi nhánh bán và chi nhánh mua", variant: "error" });
      return;
    }
    if (fromBranchId === toBranchId) {
      toast({ title: "Chi nhánh bán và mua phải khác nhau", variant: "error" });
      return;
    }
    if (items.length === 0) {
      toast({ title: "Thêm ít nhất 1 sản phẩm", variant: "error" });
      return;
    }

    saveLockRef.current = true;
    setSaving(true);
    try {
      // Ensure internal entities exist
      if (user?.tenantId) {
        await syncInternalEntities(user.tenantId);
      }

      const result = await createInternalSale({
        fromBranchId,
        toBranchId,
        items: items.map((i) => ({
          productId: i.productId,
          productCode: i.productCode,
          productName: i.productName,
          unit: i.unit,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          vatRate: i.vatRate,
        })),
        paymentMethod,
        note: note || undefined,
      });

      toast({ title: `Tạo thành công đơn nội bộ ${result.code}` });
      onOpenChange(false);
      onSuccess?.();
    } catch (err: unknown) {
      toast({
        title: "Lỗi tạo đơn nội bộ",
        description: (err as Error).message,
        variant: "error",
      });
    } finally {
      setSaving(false);
      saveLockRef.current = false;
    }
  }

  const fromBranch = branches.find((b) => b.id === fromBranchId);
  const toBranch = branches.find((b) => b.id === toBranchId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Tạo đơn bán nội bộ</DialogTitle>
          <DialogDescription>
            Giao dịch nội bộ giữa 2 chi nhánh — tạo hoá đơn bán + hoá đơn nhập + stock tự động
          </DialogDescription>
        </DialogHeader>

        {/* Branch selectors */}
        <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-end">
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Chi nhánh bán</label>
            <Select value={fromBranchId} onValueChange={(v) => v && setFromBranchId(v)}>
              <SelectTrigger>
                <SelectValue placeholder="Chọn bên bán..." />
              </SelectTrigger>
              <SelectContent>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Icon name="arrow_forward" className="text-muted-foreground mb-2" />
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Chi nhánh mua</label>
            <Select value={toBranchId} onValueChange={(v) => v && setToBranchId(v)}>
              <SelectTrigger>
                <SelectValue placeholder="Chọn bên mua..." />
              </SelectTrigger>
              <SelectContent>
                {branches
                  .filter((b) => b.id !== fromBranchId)
                  .map((b) => (
                    <SelectItem key={b.id} value={b.id}>
                      {b.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Payment method */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Hình thức thanh toán</label>
          <Select value={paymentMethod} onValueChange={(v) => v && setPaymentMethod(v as "transfer" | "cash" | "debt")}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="transfer">Chuyển khoản</SelectItem>
              <SelectItem value="cash">Tiền mặt</SelectItem>
              <SelectItem value="debt">Ghi nợ</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Product search */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Thêm sản phẩm</label>
          <div className="relative">
            <Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Tìm sản phẩm theo tên hoặc mã..."
              value={productSearch}
              onChange={(e) => {
                setProductSearch(e.target.value);
                setShowDropdown(true);
              }}
              onFocus={() => setShowDropdown(true)}
            />
            {showDropdown && filteredProducts.length > 0 && (
              <div className="absolute z-50 mt-1 w-full bg-background border rounded-md shadow-lg max-h-48 overflow-y-auto">
                {filteredProducts.map((p) => (
                  <button
                    key={p.id}
                    className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex justify-between"
                    onClick={() => addProduct(p)}
                  >
                    <span>
                      <strong>{p.code}</strong> — {p.name}
                    </span>
                    <span className="text-muted-foreground">
                      Kho: {p.stock} {p.unit} | {formatCurrency(p.sell_price)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Items table */}
        {items.length > 0 && (
          <div className="border rounded-md overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-2">Sản phẩm</th>
                  <th className="text-right p-2 w-20">SL</th>
                  <th className="text-right p-2 w-32">Đơn giá</th>
                  <th className="text-right p-2 w-16">VAT%</th>
                  <th className="text-right p-2 w-28">Thành tiền</th>
                  <th className="w-10 p-2" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.productId} className="border-t">
                    <td className="p-2">
                      <div className="font-medium">{item.productName}</div>
                      <div className="text-xs text-muted-foreground">
                        {item.productCode} · {item.unit} · Kho: {item.stock}
                      </div>
                    </td>
                    <td className="p-2">
                      <Input
                        type="number"
                        min={1}
                        className="w-20 text-right h-8"
                        value={item.quantity}
                        onChange={(e) => updateItem(item.productId, "quantity", Number(e.target.value) || 1)}
                      />
                    </td>
                    <td className="p-2">
                      <Input
                        type="number"
                        min={0}
                        className="w-32 text-right h-8"
                        value={item.unitPrice}
                        onChange={(e) => updateItem(item.productId, "unitPrice", Number(e.target.value) || 0)}
                      />
                    </td>
                    <td className="p-2 text-right">{item.vatRate}%</td>
                    <td className="p-2 text-right font-medium">
                      {formatCurrency(item.quantity * item.unitPrice)}
                    </td>
                    <td className="p-2 text-center">
                      <button onClick={() => removeItem(item.productId)} className="text-muted-foreground hover:text-destructive">
                        <Icon name="close" size={16} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Totals */}
        {items.length > 0 && (
          <div className="flex justify-end">
            <div className="text-sm space-y-1 text-right">
              <div>
                Tạm tính: <strong>{formatCurrency(subtotal)}</strong>
              </div>
              {taxTotal > 0 && (
                <div>
                  Thuế VAT: <strong>{formatCurrency(taxTotal)}</strong>
                </div>
              )}
              <div className="text-base font-bold">
                Tổng cộng: {formatCurrency(total)}
              </div>
            </div>
          </div>
        )}

        {/* Note */}
        <div className="space-y-1.5">
          <label className="text-sm font-medium">Ghi chú</label>
          <Input
            placeholder="Ghi chú..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {/* Summary */}
        {fromBranch && toBranch && items.length > 0 && (
          <div className="rounded-md bg-muted/50 p-3 text-sm">
            <strong>{fromBranch.name}</strong> bán cho <strong>{toBranch.name}</strong>
            {" · "}
            {items.length} sản phẩm · {formatCurrency(total)}
            {" · "}
            {paymentMethod === "debt" ? "Ghi nợ" : paymentMethod === "cash" ? "Tiền mặt" : "Chuyển khoản"}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Huỷ
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Icon name="progress_activity" size={16} className="animate-spin mr-2" />}
            Tạo đơn nội bộ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
