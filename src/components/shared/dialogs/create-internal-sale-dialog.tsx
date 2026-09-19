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
import { NumericInput } from "@/components/ui/numeric-input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency, formatNumber } from "@/lib/format";
import { useToast, useAuth } from "@/lib/contexts";
import { searchInternalSaleProducts, type InternalSaleProduct } from "@/lib/services/supabase/internal-sale-products";
import { getFnbSupplyBranchScope, listFnbSupplyCatalogProductIds } from "@/lib/services/supabase/fnb-supply-catalog";
import { createInternalSale, getBranches, syncInternalEntities } from "@/lib/services";
import type { BranchDetail } from "@/lib/services";
import { Icon } from "@/components/ui/icon";

interface CreateInternalSaleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

interface SaleItem {
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
}

interface DestinationCatalogState {
  loading: boolean;
  error: boolean;
  enforcementEnabled: boolean;
  productIds: string[];
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
  const [filteredProducts, setFilteredProducts] = useState<InternalSaleProduct[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [destinationCatalog, setDestinationCatalog] = useState<DestinationCatalogState>({
    loading: false, error: false, enforcementEnabled: false, productIds: [],
  });
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
    setDestinationCatalog({ loading: false, error: false, enforcementEnabled: false, productIds: [] });
    setItems([]);
    setNote("");
    setSaving(false);

    getBranches().then(setBranches).catch(() => {});
  }, [open]);

  // The database RPC remains the authority. This only makes the opt-in rule
  // visible before the user builds an internal-sale document.
  useEffect(() => {
    if (!open || !toBranchId) {
      setDestinationCatalog({ loading: false, error: false, enforcementEnabled: false, productIds: [] });
      return;
    }
    const controller = new AbortController();
    setDestinationCatalog({ loading: true, error: false, enforcementEnabled: false, productIds: [] });
    void (async () => {
      try {
        const scope = await getFnbSupplyBranchScope(toBranchId, controller.signal);
        if (controller.signal.aborted) return;
        if (!scope.enforcementEnabled) {
          setDestinationCatalog({ loading: false, error: false, enforcementEnabled: false, productIds: [] });
          return;
        }
        const productIds = await listFnbSupplyCatalogProductIds(toBranchId, controller.signal);
        if (!controller.signal.aborted) {
          setDestinationCatalog({ loading: false, error: false, enforcementEnabled: true, productIds });
        }
      } catch {
        if (!controller.signal.aborted) {
          setDestinationCatalog({ loading: false, error: true, enforcementEnabled: false, productIds: [] });
        }
      }
    })();
    return () => controller.abort();
  }, [open, toBranchId]);

  // Product search debounce
  useEffect(() => {
    setFilteredProducts([]);
    setSearchError("");
    if (destinationCatalog.error) {
      setSearchLoading(false);
      setSearchError("Không kiểm tra được danh mục cấp hàng của quán. Chưa thể chọn sản phẩm.");
      return;
    }
    if (!open || !productSearch.trim()) {
      setSearchLoading(false);
      return;
    }
    const controller = new AbortController();
    setSearchLoading(true);
    const timer = setTimeout(async () => {
      try {
        const products = await searchInternalSaleProducts(
          productSearch,
          controller.signal,
          false,
          destinationCatalog.enforcementEnabled ? destinationCatalog.productIds : undefined,
        );
        if (!controller.signal.aborted) setFilteredProducts(products);
      } catch {
        if (!controller.signal.aborted) setSearchError("Không tải được sản phẩm. Vui lòng tìm lại.");
      } finally {
        if (!controller.signal.aborted) setSearchLoading(false);
      }
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [open, productSearch, destinationCatalog.error, destinationCatalog.enforcementEnabled, destinationCatalog.productIds]);

  function addProduct(p: InternalSaleProduct) {
    if (items.some((i) => i.productId === p.id)) return;
    setItems([
      ...items,
      {
        productId: p.id,
        productCode: p.code,
        productName: p.name,
        unit: p.unit,
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
  const totalQuantity = items.reduce((s, i) => s + i.quantity, 0);

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
    if (destinationCatalog.loading) {
      toast({ title: "Đang kiểm tra danh mục cấp hàng của quán", variant: "error" });
      return;
    }
    if (destinationCatalog.error) {
      toast({ title: "Chưa kiểm tra được danh mục cấp hàng của quán", variant: "error" });
      return;
    }
    if (destinationCatalog.enforcementEnabled) {
      const unapproved = items.filter((item) => !destinationCatalog.productIds.includes(item.productId));
      if (unapproved.length > 0) {
        toast({
          title: "Có SKU chưa được duyệt cấp cho quán này",
          description: unapproved.map((item) => item.productCode).join(", "),
          variant: "error",
        });
        return;
      }
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
      <DialogContent className="max-w-[min(1100px,calc(100vw-32px))] max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Tạo đơn bán nội bộ</DialogTitle>
          <DialogDescription>
            Giao dịch nội bộ giữa 2 chi nhánh — tạo hoá đơn bán + hoá đơn nhập + stock tự động
          </DialogDescription>
        </DialogHeader>

        {/* Branch selectors */}
        <div className="grid grid-cols-[1fr_auto_1fr] gap-3 items-end">
          <div className="space-y-2">
            <label className="text-sm font-medium">Chi nhánh bán</label>
            <Select
              value={fromBranchId || null}
              onValueChange={(v) => v && setFromBranchId(v)}
              items={branches.map((b) => ({ value: b.id, label: b.name }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Chọn bên bán...">
                  {(v) => branches.find((b) => b.id === v)?.name ?? "Chọn bên bán..."}
                </SelectValue>
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
          <div className="space-y-2">
            <label className="text-sm font-medium">Chi nhánh mua</label>
            <Select
              value={toBranchId || null}
              onValueChange={(v) => v && setToBranchId(v)}
              items={branches
                .filter((b) => b.id !== fromBranchId)
                .map((b) => ({ value: b.id, label: b.name }))}
            >
              <SelectTrigger>
                <SelectValue placeholder="Chọn bên mua...">
                  {(v) => branches.find((b) => b.id === v)?.name ?? "Chọn bên mua..."}
                </SelectValue>
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
        <div className="space-y-2">
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
        <div className="space-y-2">
          <label className="text-sm font-medium">Thêm sản phẩm</label>
          {destinationCatalog.loading ? (
            <p className="text-xs text-muted-foreground">Đang kiểm tra danh mục cấp hàng của quán...</p>
          ) : destinationCatalog.error ? (
            <p role="alert" className="text-xs text-destructive">Không kiểm tra được danh mục cấp hàng. Thử lại trước khi tạo phiếu.</p>
          ) : destinationCatalog.enforcementEnabled ? (
            <p className="text-xs text-muted-foreground">
              Quán này đang kiểm soát SKU cấp hàng: chỉ tìm trong {formatNumber(destinationCatalog.productIds.length)} mã đã duyệt.
            </p>
          ) : null}
          <div className="relative">
            <Icon name="search" size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Tìm sản phẩm theo tên hoặc mã..."
              value={productSearch}
              disabled={destinationCatalog.loading || destinationCatalog.error}
              onChange={(e) => {
                setProductSearch(e.target.value);
                setShowDropdown(true);
              }}
              onFocus={() => setShowDropdown(true)}
              onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
            />
            {showDropdown && productSearch && (
              <div className="absolute z-50 mt-1 w-full bg-background border rounded-lg shadow-lg max-h-48 overflow-y-auto">
                {searchLoading ? (
                  <div role="status" className="px-3 py-2 text-sm text-muted-foreground">Đang tìm sản phẩm...</div>
                ) : searchError ? (
                  <div role="alert" className="px-3 py-2 text-sm text-destructive">{searchError}</div>
                ) : filteredProducts.length === 0 ? (
                  <div className="px-3 py-2 text-sm text-muted-foreground">Không tìm thấy sản phẩm</div>
                ) : (
                  filteredProducts.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex justify-between gap-3"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => addProduct(p)}
                    >
                      <span>
                        <strong>{p.code}</strong> — {p.name}
                      </span>
                      <span className="text-muted-foreground shrink-0">
                        {formatCurrency(p.sell_price)} / {p.unit}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* Items table */}
        {items.length > 0 && (
          <div className="border rounded-lg overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-2">Sản phẩm</th>
                  <th className="text-center p-2 w-24">ĐVT</th>
                  <th className="text-right p-2 w-20">SL</th>
                  <th className="text-right p-2 w-32">Đơn giá</th>
                  <th className="text-right p-2 w-16">VAT%</th>
                  <th className="text-right p-2 w-28">Thành tiền</th>
                  <th className="w-10 p-2" />
                </tr>
              </thead>
              <tbody>
                {/* CEO 04/07: dòng mới thêm hiện TRÊN CÙNG — chỉ đảo hiển thị, data giữ cũ→mới. */}
                {[...items].reverse().map((item) => (
                  <tr key={item.productId} className="border-t">
                    <td className="p-2">
                      <div className="font-medium">{item.productName}</div>
                      <div className="text-xs text-muted-foreground">
                        {item.productCode}
                      </div>
                    </td>
                    <td className="p-2 text-center">
                      <span className="inline-flex min-w-14 justify-center rounded-md bg-muted px-2 py-1 font-medium">
                        {item.unit}
                      </span>
                    </td>
                    <td className="p-2">
                      <NumericInput
                        value={item.quantity}
                        min={0}
                        className="h-8 w-20 text-right"
                        onChange={(value) => updateItem(item.productId, "quantity", value ?? 0)}
                      />
                    </td>
                    <td className="p-2">
                      <NumericInput
                        value={item.unitPrice}
                        min={0}
                        decimals={0}
                        className="h-8 w-32 text-right"
                        onChange={(value) => updateItem(item.productId, "unitPrice", value ?? 0)}
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
        <div className="space-y-2">
          <label className="text-sm font-medium">Ghi chú</label>
          <Input
            placeholder="Ghi chú..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>

        {/* Summary */}
        {fromBranch && toBranch && items.length > 0 && (
          <div className="rounded-lg bg-muted/50 p-3 text-sm">
            <strong>{fromBranch.name}</strong> bán cho <strong>{toBranch.name}</strong>
            {" · "}
            {formatNumber(items.length)} sản phẩm · SL {formatNumber(totalQuantity)} · {formatCurrency(total)}
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
