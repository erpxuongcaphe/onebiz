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
import { receivePurchaseOrder } from "@/lib/services/supabase/purchase-orders";
import { nextEntityCode } from "@/lib/services/supabase/stock-adjustments";
import type { Database } from "@/lib/supabase/types";
import { Icon } from "@/components/ui/icon";

type PurchaseOrderInsert = Database["public"]["Tables"]["purchase_orders"]["Insert"];
type PurchaseOrderItemInsert = Database["public"]["Tables"]["purchase_order_items"]["Insert"];

interface EditingPO {
  id: string;
  code: string;
  supplierId: string;
  supplierName: string;
  total?: number;
  taxAmount?: number;
  note?: string;
  /** CEO 01/06/2026: số tiền NCC đã trả khi phiếu được tạo/sửa lần trước. */
  paid?: number;
}

interface CreatePurchaseOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  editingPO?: EditingPO | null;
}

interface LineItem {
  id: string;
  productCode?: string;
  productName: string;
  unit: string;
  quantity: number;
  price: number;
  vatRate: number;
  /** Day 18/05/2026 (CEO): HSD nhập tại phiếu nhập */
  expiryDate?: string;
  lotNumber?: string;
}

interface SearchProduct {
  id: string;
  code: string;
  name: string;
  unit: string;
  price: number;
  vatRate: number;
}

interface SearchSupplier {
  id: string;
  name: string;
  phone: string;
}

type ProductCodeRelation = { code: string | null } | { code: string | null }[] | null;

interface ExistingPurchaseOrderItemRecord {
  product_id: string;
  product_name: string;
  unit: string;
  quantity: number;
  unit_price: number;
  vat_rate: number | null;
  expiry_date?: string | null;
  lot_number?: string | null;
  products: ProductCodeRelation;
}

function generatePurchaseOrderCode() {
  const num = Math.floor(Math.random() * 99999) + 1;
  return `PO${String(num).padStart(6, "0")}`;
}

function getProductCode(products: ProductCodeRelation) {
  if (Array.isArray(products)) return products[0]?.code ?? undefined;
  return products?.code ?? undefined;
}

function lineSubtotal(item: LineItem) {
  return item.quantity * item.price;
}

function lineTax(item: LineItem) {
  return Math.round((lineSubtotal(item) * item.vatRate) / 100);
}

function lineTotal(item: LineItem) {
  return lineSubtotal(item) + lineTax(item);
}

function getItemsSubtotal(items: LineItem[]) {
  return items.reduce((sum, item) => sum + lineSubtotal(item), 0);
}

/**
 * Day 18/05/2026 (CEO): Badge số ngày còn lại trước HSD.
 * Hiển thị ngay cạnh ô date HSD khi user nhập.
 *   - Đã quá hạn:  badge đỏ "Đã quá hạn X ngày"
 *   - 0-7 ngày:    badge đỏ "Còn X ngày — sắp hết!"
 *   - 8-30 ngày:   badge cam "Còn X ngày"
 *   - 31-90 ngày:  badge vàng "Còn X ngày"
 *   - >90 ngày:    badge xanh "Còn X ngày"
 */
function ExpiryBadge({ dateStr }: { dateStr?: string | null }) {
  if (!dateStr) return null;
  const expiry = new Date(dateStr + "T00:00:00");
  if (isNaN(expiry.getTime())) return null;

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffMs = expiry.getTime() - today.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    return (
      <span className="inline-flex items-center rounded-md bg-status-danger/15 text-status-danger border border-status-danger/30 px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap">
        ⚠ Đã quá hạn {Math.abs(diffDays)} ngày
      </span>
    );
  }
  if (diffDays === 0) {
    return (
      <span className="inline-flex items-center rounded-md bg-status-danger/15 text-status-danger border border-status-danger/30 px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap">
        ⚠ Hết hạn HÔM NAY
      </span>
    );
  }
  if (diffDays <= 7) {
    return (
      <span className="inline-flex items-center rounded-md bg-status-danger/15 text-status-danger border border-status-danger/30 px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap">
        ⚠ Còn {diffDays} ngày — sắp hết!
      </span>
    );
  }
  if (diffDays <= 30) {
    return (
      <span className="inline-flex items-center rounded-md bg-status-warning/15 text-status-warning border border-status-warning/30 px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap">
        Còn {diffDays} ngày
      </span>
    );
  }
  if (diffDays <= 90) {
    return (
      <span className="inline-flex items-center rounded-md bg-status-warning/10 text-status-warning border border-status-warning/20 px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap">
        Còn {diffDays} ngày
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-md bg-primary/10 text-primary border border-primary/20 px-1.5 py-0.5 text-[10px] font-medium whitespace-nowrap">
      Còn {diffDays} ngày
    </span>
  );
}

function getItemsTax(items: LineItem[]) {
  return items.reduce((sum, item) => sum + lineTax(item), 0);
}

export function CreatePurchaseOrderDialog({
  open,
  onOpenChange,
  onSuccess,
  editingPO,
}: CreatePurchaseOrderDialogProps) {
  const isEdit = !!editingPO;
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
  const [shippingFee, setShippingFee] = useState(0);
  const [otherCost, setOtherCost] = useState(0);
  const [notes, setNotes] = useState("");
  // CEO 01/06/2026: số tiền NCC đã thanh toán ngay khi tạo phiếu nhập.
  // Để trống (=0) = chưa trả, ghi nợ toàn bộ. Nếu nhập > 0 → trừ vào debt.
  const [paidAmount, setPaidAmount] = useState(0);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // CEO 29/05/2026: 2 nút lưu — "draft" (Lưu tạm) | "receive" (Nhập kho ngay).
  // Lưu nút nào đang chạy để hiện spinner đúng chỗ.
  const [savingMode, setSavingMode] = useState<"draft" | "receive" | null>(null);
  const saving = savingMode !== null;
  const [currentTenantId, setCurrentTenantId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;

    setShippingFee(0);
    setOtherCost(0);
    getCurrentContext()
      .then((ctx) => setCurrentTenantId(ctx.tenantId))
      .catch(() => setCurrentTenantId(null));

    if (editingPO) {
      setCode(editingPO.code);
      setSupplierSearch(editingPO.supplierName);
      setSelectedSupplier({ id: editingPO.supplierId, name: editingPO.supplierName });
      setNotes(editingPO.note ?? "");
      setPaidAmount(editingPO.paid ?? 0);

      (async () => {
        const supabase = getClient();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data } = await (supabase as any)
          .from("purchase_order_items")
          .select("product_id, product_name, unit, quantity, unit_price, vat_rate, expiry_date, lot_number, products(code)")
          .eq("purchase_order_id", editingPO.id);

        if (!data) return;
        const rows = data as unknown as ExistingPurchaseOrderItemRecord[];
        const mappedItems = rows.map((d) => ({
          id: d.product_id,
          productCode: getProductCode(d.products),
          productName: d.product_name,
          unit: d.unit || "Cái",
          quantity: Number(d.quantity ?? 0),
          price: Number(d.unit_price ?? 0),
          vatRate: Number(d.vat_rate ?? 0),
          expiryDate: d.expiry_date ?? undefined,
          lotNumber: d.lot_number ?? undefined,
        }));
        setItems(mappedItems);

        const baseTotal = getItemsSubtotal(mappedItems) + getItemsTax(mappedItems);
        const existingCost = Math.max(0, Number(editingPO.total ?? 0) - baseTotal);
        if (existingCost > 0) {
          setOtherCost(existingCost);
        }
      })();
    } else {
      // CEO 29/05/2026: mã phiếu nhập chạy số tuần tự qua bộ đếm (prefix PO),
      // thay cho random cũ. Fallback random chỉ khi RPC lỗi (hiếm).
      setCode("Đang tạo mã...");
      nextEntityCode("purchase_order")
        .then((c) => setCode(c))
        .catch(() => setCode(generatePurchaseOrderCode()));
      setSupplierSearch("");
      setSelectedSupplier(null);
      setItems([]);
      setNotes("");
    }

    setShowSupplierDropdown(false);
    setFilteredSuppliers([]);
    setProductSearch("");
    setShowProductDropdown(false);
    setFilteredProducts([]);
    setErrors({});
    setSavingMode(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!supplierSearch || supplierSearch.length < 1) {
      setFilteredSuppliers([]);
      return;
    }

    const timer = setTimeout(async () => {
      const supabase = getClient();
      const ctx = await getCurrentContext();
      const { data } = await supabase
        .from("suppliers")
        .select("id, name, phone")
        .or(`name.ilike.%${supplierSearch}%,phone.ilike.%${supplierSearch}%`)
        .eq("tenant_id", currentTenantId ?? ctx.tenantId)
        .eq("is_active", true)
        .limit(8);

      setFilteredSuppliers((data ?? []).map((s) => ({ id: s.id, name: s.name, phone: s.phone ?? "" })));
    }, 300);

    return () => clearTimeout(timer);
  }, [supplierSearch, currentTenantId]);

  useEffect(() => {
    if (!productSearch || productSearch.length < 1) {
      setFilteredProducts([]);
      return;
    }

    const timer = setTimeout(async () => {
      const supabase = getClient();
      const ctx = await getCurrentContext();
      // CEO 29/05/2026: Nhập hàng (mua từ NCC ngoài) chỉ là NVL — KHÔNG hiện
      // SKU (làm từ NVL, không mua ngoài). FnB lấy SKU từ Retail qua "Bán nội
      // bộ", không qua phiếu nhập. `is not true` lấy NVL + hàng bán-lại (no BOM).
      const { data } = await supabase
        .from("products")
        .select("id, code, name, unit, cost_price, vat_rate")
        .or(`name.ilike.%${productSearch}%,code.ilike.%${productSearch}%`)
        .eq("tenant_id", currentTenantId ?? ctx.tenantId)
        .eq("is_active", true)
        .not("has_bom", "is", true)
        .limit(10);

      setFilteredProducts((data ?? []).map((p) => ({
        id: p.id,
        code: p.code ?? "",
        name: p.name,
        unit: p.unit ?? "Cái",
        price: Number(p.cost_price ?? 0),
        vatRate: Number(p.vat_rate ?? 0),
      })));
    }, 300);

    return () => clearTimeout(timer);
  }, [productSearch, currentTenantId]);

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
          vatRate: product.vatRate,
        },
      ]);
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

  const subtotal = useMemo(() => getItemsSubtotal(items), [items]);

  const totalQuantity = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity, 0),
    [items],
  );

  const taxAmount = useMemo(() => getItemsTax(items), [items]);

  const purchaseCost = shippingFee + otherCost;
  const total = subtotal + taxAmount + purchaseCost;

  function validate(): boolean {
    const newErrors: Record<string, string> = {};
    if (!selectedSupplier) newErrors.supplier = "Vui lòng chọn nhà cung cấp";
    if (items.length === 0) newErrors.items = "Chưa có sản phẩm nào";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSave(mode: "draft" | "receive") {
    if (!validate()) return;
    setSavingMode(mode);
    let createdPoId: string | null = null;
    try {
      const supabase = getClient();
      const ctx = await getCurrentContext();
      let poId: string;

      if (isEdit && editingPO) {
        const { error: poErr } = await supabase
          .from("purchase_orders")
          .update({
            supplier_id: selectedSupplier!.id,
            supplier_name: selectedSupplier!.name,
            subtotal,
            discount_amount: 0,
            tax_amount: taxAmount,
            total,
            paid: paidAmount,
            debt: Math.max(0, total - paidAmount),
            note: notes || null,
          })
          .eq("tenant_id", ctx.tenantId)
          .eq("id", editingPO.id);
        if (poErr) throw new Error(poErr.message);
        poId = editingPO.id;

        await supabase.from("purchase_order_items").delete().eq("purchase_order_id", poId);
      } else {
        const { data: { user } } = await supabase.auth.getUser();
        const { data: po, error: poErr } = await supabase
          .from("purchase_orders")
          .insert({
            tenant_id: ctx.tenantId,
            branch_id: ctx.branchId,
            code,
            supplier_id: selectedSupplier!.id,
            supplier_name: selectedSupplier!.name,
            status: "draft" as const,
            subtotal,
            discount_amount: 0,
            tax_amount: taxAmount,
            total,
            paid: paidAmount,
            debt: Math.max(0, total - paidAmount),
            note: notes || null,
            created_by: user?.id ?? ctx.userId,
          } satisfies PurchaseOrderInsert)
          .select("id")
          .single();
        if (poErr) throw new Error(poErr.message);
        poId = po!.id;
      }

      if (items.length > 0) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: itemsErr } = await (supabase as any)
          .from("purchase_order_items")
          .insert(items.map((item) => {
            const lineBeforeTax = item.quantity * item.price;
            const vatAmt = Math.round((lineBeforeTax * item.vatRate) / 100);
            return {
              purchase_order_id: poId,
              product_id: item.id,
              product_name: item.productName,
              unit: item.unit || "Cái",
              quantity: item.quantity,
              received_quantity: 0,
              unit_price: item.price,
              discount: 0,
              vat_rate: item.vatRate,
              vat_amount: vatAmt,
              total: lineBeforeTax,
              // Day 18/05/2026 (CEO): HSD + lô từ form (cast vì
              // Supabase types chưa regen sau migration 00102)
              expiry_date: item.expiryDate || null,
              lot_number: item.lotNumber || null,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as PurchaseOrderItemInsert & { expiry_date: any; lot_number: any };
          }));
        if (itemsErr) throw new Error(itemsErr.message);
      }

      // "Nhập kho ngay": phiếu + dòng hàng đã lưu xong (vẫn 'draft'), giờ nâng
      // 'ordered' rồi gọi RPC atomic cộng tồn (đã test, all-or-nothing).
      // Làm sau cùng → nếu lỗi nửa chừng, phiếu chỉ ở 'draft'/'ordered', KHÔNG sai tồn.
      if (mode === "receive") {
        createdPoId = poId; // phiếu đã tồn tại — dùng cho thông báo nếu cộng tồn lỗi
        const { error: stErr } = await supabase
          .from("purchase_orders")
          .update({ status: "ordered" as const })
          .eq("tenant_id", ctx.tenantId)
          .eq("id", poId);
        if (stErr) throw new Error(stErr.message);
        await receivePurchaseOrder(poId);
      }

      onOpenChange(false);
      if (mode === "receive") {
        toast({
          title: "Đã nhập kho — đã cộng tồn",
          description: `${code}: đã cộng tồn kho cho ${formatNumber(items.length)} mặt hàng.`,
          variant: "success",
        });
      } else {
        toast({
          title: isEdit ? "Đã lưu thay đổi" : "Đã lưu phiếu tạm",
          description: isEdit
            ? `Đã cập nhật ${code} — phiếu vẫn ở dạng chờ, CHƯA cộng tồn.`
            : `${code}: phiếu chờ, CHƯA cộng tồn kho.`,
          variant: "success",
        });
      }
      onSuccess?.();
    } catch (err) {
      // Phiếu đã tạo (ordered) nhưng RPC cộng tồn lỗi → phiếu nằm ở "Đã đặt hàng",
      // KHÔNG mất data. Báo rõ để vào danh sách bấm "Hoàn thành nhập" thử lại.
      if (mode === "receive" && createdPoId) {
        onOpenChange(false);
        onSuccess?.();
        toast({
          title: "Phiếu đã tạo nhưng CHƯA cộng tồn",
          description: `${code} đang ở trạng thái "Đã đặt hàng". Vào danh sách → mở phiếu → bấm "Hoàn thành nhập" để cộng tồn. (${err instanceof Error ? err.message : "lỗi không xác định"})`,
          variant: "error",
        });
      } else {
        toast({
          title: mode === "receive" ? "Lỗi nhập kho" : isEdit ? "Lỗi cập nhật phiếu" : "Lỗi lưu phiếu tạm",
          description: err instanceof Error ? err.message : "Vui lòng thử lại",
          variant: "error",
        });
      }
    } finally {
      setSavingMode(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-[1500px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(1200px,calc(100vw-48px))] xl:max-w-[1500px] sm:rounded-2xl">
        <div className="shrink-0 border-b bg-white px-4 py-3 md:px-5">
          <DialogHeader className="gap-0 pr-10">
            <div className="flex flex-wrap items-center gap-3">
              <DialogTitle className="text-xl">
                {isEdit ? "Sửa phiếu nhập hàng" : "Tạo phiếu nhập hàng"}
              </DialogTitle>
              <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
                Nháp
              </span>
              <span className="ml-auto mr-8 max-w-none whitespace-nowrap rounded-lg border bg-primary/5 px-3 py-1.5 text-sm font-bold text-primary sm:text-base">
                {code}
              </span>
            </div>
          </DialogHeader>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-surface-container-low p-3 md:p-4">
          <div className="mx-auto flex max-w-[1420px] flex-col gap-3">
            <div className="grid gap-3 xl:grid-cols-[minmax(340px,0.9fr)_minmax(380px,1.2fr)_minmax(300px,0.85fr)]">
              <section className="rounded-xl border bg-white p-3 shadow-sm">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">Nhà cung cấp</h3>
                  {selectedSupplier && (
                    <span className="max-w-[180px] truncate rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                      Đã chọn
                    </span>
                  )}
                </div>
                <div className="relative">
                  <Icon name="search" size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={supplierSearch}
                    onChange={(e) => {
                      setSupplierSearch(e.target.value);
                      setShowSupplierDropdown(true);
                    }}
                    onFocus={() => setShowSupplierDropdown(true)}
                    onBlur={() => setTimeout(() => setShowSupplierDropdown(false), 200)}
                    placeholder="Tìm theo tên hoặc SĐT"
                    className="pl-8"
                    aria-invalid={!!errors.supplier}
                  />
                  {showSupplierDropdown && supplierSearch && (
                    <div className="absolute z-30 mt-1 max-h-52 w-full overflow-y-auto rounded-lg border bg-popover shadow-lg">
                      {filteredSuppliers.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">
                          Không tìm thấy nhà cung cấp
                        </div>
                      ) : (
                        filteredSuppliers.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setSelectedSupplier({ id: s.id, name: s.name });
                              setSupplierSearch(s.name);
                              setShowSupplierDropdown(false);
                            }}
                          >
                            <span className="truncate font-medium">{s.name}</span>
                            <span className="shrink-0 text-muted-foreground">{s.phone}</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
                {errors.supplier && <p className="mt-1 text-xs text-destructive">{errors.supplier}</p>}
              </section>

              <section className="rounded-xl border bg-white p-3 shadow-sm">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold">Dòng hàng nhập</h3>
                    <p className="text-[11px] text-muted-foreground">Chỉ hiện NVL (mua ngoài) — SKU lấy từ Retail qua Bán nội bộ</p>
                  </div>
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
                          Không tìm thấy NVL (phiếu nhập chỉ mua NVL, không gồm SKU)
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
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">Chi phí mua hàng</h3>
                  <span className="text-xs text-muted-foreground">Cộng vào phải trả</span>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                  <CostInput
                    label="Vận chuyển"
                    icon="local_shipping"
                    value={shippingFee}
                    onChange={setShippingFee}
                  />
                  <CostInput
                    label="Chi phí khác"
                    icon="payments"
                    value={otherCost}
                    onChange={setOtherCost}
                  />
                </div>
              </section>
            </div>

            <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
              <div className="hidden grid-cols-[minmax(300px,1fr)_90px_112px_150px_90px_150px_44px] gap-2 border-b bg-muted/50 px-3 py-2 text-xs font-semibold uppercase text-muted-foreground md:grid">
                <span>Sản phẩm</span>
                <span className="flex justify-center">ĐVT</span>
                <span className="flex justify-end">Số lượng</span>
                <span className="flex justify-end">Đơn giá</span>
                <span className="flex justify-end">VAT</span>
                <span className="flex justify-end">Thành tiền</span>
                <span />
              </div>

              {items.length === 0 ? (
                <div className="flex min-h-[260px] flex-col items-center justify-center px-4 py-10 text-center">
                  <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon name="add_shopping_cart" size={24} />
                  </div>
                  <div className="mt-3 font-semibold">Chưa có dòng hàng</div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    Tìm sản phẩm ở ô trên để thêm vào phiếu.
                  </div>
                </div>
              ) : (
                <div className="divide-y">
                  {items.map((item) => (
                    <div key={item.id} className="px-3 py-2.5 space-y-1.5">
                    <div
                      className="grid gap-2 md:grid-cols-[minmax(300px,1fr)_90px_112px_150px_90px_150px_44px] md:items-center"
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
                      <Select
                        value={String(item.vatRate)}
                        onValueChange={(v) => updateItem(item.id, "vatRate", Number(v))}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="0">0%</SelectItem>
                          <SelectItem value="5">5%</SelectItem>
                          <SelectItem value="8">8%</SelectItem>
                          <SelectItem value="10">10%</SelectItem>
                        </SelectContent>
                      </Select>
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
                    {/* Day 18/05/2026 (CEO): row con HSD + Số lô (NCC ghi trên bao bì) */}
                    <div className="flex items-center gap-2 pl-1 text-xs">
                      <label className="text-muted-foreground shrink-0">HSD:</label>
                      <input
                        type="date"
                        value={item.expiryDate || ""}
                        onChange={(e) => updateItem(item.id, "expiryDate", e.target.value)}
                        className="h-7 w-36 rounded-md border border-input bg-background px-2 text-xs"
                        aria-label={`HSD ${item.productName}`}
                      />
                      {/* Day 18/05/2026 (CEO): badge ngày còn lại sau ô HSD */}
                      <ExpiryBadge dateStr={item.expiryDate} />
                      <label className="text-muted-foreground shrink-0 ml-2">Số lô:</label>
                      <input
                        type="text"
                        value={item.lotNumber || ""}
                        onChange={(e) => updateItem(item.id, "lotNumber", e.target.value)}
                        placeholder="VD: LOT-2026-04-15"
                        className="h-7 flex-1 max-w-[200px] rounded-md border border-input bg-background px-2 text-xs"
                        aria-label={`Số lô ${item.productName}`}
                      />
                      <span className="text-muted-foreground italic ml-auto hidden md:inline">
                        (NCC ghi trên bao bì — optional)
                      </span>
                    </div>
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
                placeholder="Ví dụ: theo báo giá số..., cần kiểm HSD khi nhận hàng"
                rows={2}
              />
            </section>
          </div>
        </div>

        <DialogFooter className="mx-0 mb-0 shrink-0 flex-col items-stretch gap-2 rounded-none border-t bg-white px-4 py-3">
          {/* CEO 01/06/2026: row Thanh toán — anh nhập số đã trả NCC ngay khi
              tạo phiếu (để trống = chưa trả → ghi nợ toàn bộ). Tự tính "Còn nợ". */}
          <div className="mx-auto flex w-full max-w-[1420px] flex-wrap items-center gap-3 border-b pb-2 text-sm">
            <label className="font-medium text-muted-foreground" htmlFor="po-paid-amount">
              Đã thanh toán NCC:
            </label>
            <input
              id="po-paid-amount"
              type="number"
              step="any"
              min={0}
              value={paidAmount || ""}
              onChange={(e) => {
                const n = parseFloat(e.target.value);
                setPaidAmount(Number.isFinite(n) && n > 0 ? n : 0);
              }}
              placeholder="Để trống = chưa trả"
              className="h-9 w-44 rounded-md border border-border bg-background px-3 text-right tabular-nums outline-none focus:ring-2 focus:ring-primary/30"
            />
            <span className="text-muted-foreground">→ Còn nợ NCC:</span>
            <span className="font-bold tabular-nums text-status-warning">
              {formatCurrency(Math.max(0, total - paidAmount))}
            </span>
            {paidAmount > total && total > 0 && (
              <span className="text-xs text-status-error">
                (đã trả vượt tổng phiếu — phần dư sẽ ghi NCC trả lại sau)
              </span>
            )}
          </div>
          <div className="mx-auto grid w-full max-w-[1420px] grid-cols-1 items-center gap-3 lg:grid-cols-[1fr_auto]">
            <div className="grid gap-2 text-sm sm:grid-cols-3 xl:grid-cols-6">
              <FooterMetric label="Dòng" value={formatNumber(items.length)} />
              <FooterMetric label="Tổng SL" value={formatNumber(totalQuantity)} />
              <FooterMetric label="Tiền hàng" value={formatCurrency(subtotal)} />
              <FooterMetric label="VAT" value={formatCurrency(taxAmount)} />
              <FooterMetric label="Chi phí" value={formatCurrency(purchaseCost)} />
              <FooterMetric label="Tổng cộng" value={formatCurrency(total)} strong />
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
                Hủy
              </Button>
              {/* Lưu tạm — phiếu CHỜ, KHÔNG cộng tồn. Đặt NCC trước, hàng về sau. */}
              <Button
                variant="outline"
                onClick={() => handleSave("draft")}
                disabled={saving}
                title="Giữ phiếu chờ — CHƯA cộng tồn kho. Dùng khi đặt nhà cung cấp trước, hàng về sau."
                className="h-11 border-status-warning/60 px-4 font-semibold text-status-warning hover:bg-status-warning/10"
              >
                {savingMode === "draft" ? (
                  <Icon name="progress_activity" size={18} className="mr-2 animate-spin" />
                ) : (
                  <Icon name="schedule" size={18} className="mr-2" />
                )}
                {isEdit ? "Lưu thay đổi (chờ)" : "Lưu tạm"}
              </Button>
              {/* Nhập kho ngay — tạo phiếu + CỘNG TỒN liền. Hàng đã về tới kho. */}
              <Button
                onClick={() => handleSave("receive")}
                disabled={saving}
                title="Tạo phiếu và CỘNG TỒN KHO ngay. Dùng khi hàng đã về tới kho."
                className="h-11 bg-status-success px-5 font-semibold text-white shadow-sm hover:bg-status-success/90"
              >
                {savingMode === "receive" ? (
                  <Icon name="progress_activity" size={18} className="mr-2 animate-spin" />
                ) : (
                  <Icon name="inventory_2" size={18} className="mr-2" />
                )}
                Nhập kho ngay
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CostInput({
  label,
  icon,
  value,
  onChange,
}: {
  label: string;
  icon: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="grid grid-cols-[32px_minmax(0,1fr)] items-center gap-2 rounded-lg border bg-surface-container-lowest p-2">
      <span className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
        <Icon name={icon} size={16} />
      </span>
      <span className="min-w-0">
        <span className="mb-1 block truncate text-xs font-semibold text-muted-foreground">{label}</span>
        <NumericInput
          value={value}
          onChange={(next) => onChange(next ?? 0)}
          min={0}
          decimals={2}
          className="h-8 border-0 bg-transparent px-0 text-right font-semibold shadow-none focus-visible:ring-0"
          aria-label={label}
        />
      </span>
    </label>
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
