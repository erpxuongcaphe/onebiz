"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumericInput } from "@/components/ui/numeric-input";
import { useToast } from "@/lib/contexts";
import { getClient, getCurrentContext } from "@/lib/services/supabase/base";
import { nextEntityCode } from "@/lib/services/supabase/stock-adjustments";
import { getUOMConversions } from "@/lib/services/supabase/uom";
import { pickBestConversion, getConversionText } from "@/lib/format-uom";
import type { UOMConversion } from "@/lib/types";
import type { Database } from "@/lib/supabase/types";
import { Icon } from "@/components/ui/icon";
import { formatNumber, formatCurrency } from "@/lib/format";

type InventoryCheckInsert = Database["public"]["Tables"]["inventory_checks"]["Insert"];
type ProductRow = Pick<
  Database["public"]["Tables"]["products"]["Row"],
  "id" | "code" | "name" | "unit" | "cost_price"
>;

interface InventoryCheckLine {
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  /** Giá vốn 1 đơn vị cơ bản — để tính giá trị lệch (tiền). */
  costPrice: number;
  systemStock: number;
  /** Tồn thực tế theo ĐƠN VỊ CƠ BẢN — dùng khi SP KHÔNG có quy cách. */
  actualStock: number;
  // CEO 28/05/2026: quy cách (UOM). Nếu có → nhập theo thùng + lẻ.
  conversions: UOMConversion[];
  /** Số đơn vị nhỏ trong 1 đơn vị lớn (vd 1 Thùng = 12 Hộp → 12). null = không quy cách. */
  convFactor: number | null;
  /** Tên đơn vị lớn (vd "Thùng"). */
  convBigUnit: string | null;
  // CEO 29/05/2026: nhập theo 2 ô — số đơn vị lớn (Thùng) + số lẻ (đơn vị chính).
  /** Input: số đơn vị lớn (thùng) — chỉ dùng khi có quy cách. */
  actualBig: number;
  /** Input: số lẻ (đơn vị nhỏ). */
  actualSmall: number;
}

/** Tồn thực tế quy về đơn vị cơ bản (nguồn sự thật cho lệch + submit).
 * Làm tròn 4 chữ số để khử sai số dấu phẩy động khi quy đổi qua lại
 * (vd 224.58 ÷ 12 × 12 = 224.5799… → tránh lệch "-0" giả). */
function lineActual(item: InventoryCheckLine): number {
  if (item.convFactor && item.convFactor > 0) {
    const raw = item.actualBig * item.convFactor + item.actualSmall;
    return Math.round(raw * 10000) / 10000;
  }
  return item.actualStock;
}

interface CreateInventoryCheckDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

const PENDING_CODE_PLACEHOLDER = "Tự tạo khi lưu";

export function CreateInventoryCheckDialog({
  open,
  onOpenChange,
  onSuccess,
}: CreateInventoryCheckDialogProps) {
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [notes, setNotes] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [showProductDropdown, setShowProductDropdown] = useState(false);
  const [filteredProducts, setFilteredProducts] = useState<ProductRow[]>([]);
  const [checkItems, setCheckItems] = useState<InventoryCheckLine[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const saveLockRef = useRef(false);

  useEffect(() => {
    if (!open) return;

    setCode(PENDING_CODE_PLACEHOLDER);
    setNotes("");
    setProductSearch("");
    setShowProductDropdown(false);
    setFilteredProducts([]);
    setCheckItems([]);
    setErrors({});
    setSaving(false);
  }, [open]);

  useEffect(() => {
    const term = productSearch.trim();
    if (!term) {
      setFilteredProducts([]);
      return;
    }

    const timer = setTimeout(async () => {
      const supabase = getClient();
      const ctx = await getCurrentContext();
      // CEO 29/05/2026: KHÔNG hiện SKU (has_bom=true) — SKU không giữ tồn,
      // kiểm kê chỉ áp dụng cho NVL / hàng giữ tồn thật. `is not true` lấy cả
      // has_bom=false lẫn null.
      const { data, error } = await supabase
        .from("products")
        .select("id, code, name, unit, cost_price")
        .eq("tenant_id", ctx.tenantId)
        .eq("is_active", true)
        .not("has_bom", "is", true)
        .or(`code.ilike.%${term}%,name.ilike.%${term}%,barcode.ilike.%${term}%`)
        .limit(10);

      if (!error) setFilteredProducts((data ?? []) as ProductRow[]);
    }, 250);

    return () => clearTimeout(timer);
  }, [productSearch]);

  async function addProduct(product: ProductRow) {
    if (checkItems.some((item) => item.productId === product.id)) {
      setProductSearch("");
      setShowProductDropdown(false);
      return;
    }

    const supabase = getClient();
    const ctx = await getCurrentContext();
    const { data: branchStock, error: stockErr } = await supabase
      .from("branch_stock")
      .select("quantity")
      .eq("tenant_id", ctx.tenantId)
      .eq("branch_id", ctx.branchId)
      .eq("product_id", product.id)
      .maybeSingle();

    if (stockErr) {
      toast({
        title: "Không đọc được tồn kho chi nhánh",
        description: stockErr.message,
        variant: "error",
      });
      return;
    }

    const systemStock = Number(branchStock?.quantity ?? 0);

    // CEO 28/05/2026: load quy cách để cho nhập theo thùng + lẻ.
    let conversions: UOMConversion[] = [];
    try {
      conversions = await getUOMConversions(product.id);
    } catch {
      conversions = [];
    }
    const best = pickBestConversion(product.unit, conversions);
    const convFactor = best && best.factor > 0 ? best.factor : null;
    const convBigUnit = best ? best.fromUnit : null;
    // CEO 29/05/2026: tách tồn hệ thống thành thùng nguyên + lẻ (mặc định thực tế = hệ thống).
    const actualBig = convFactor ? Math.floor(systemStock / convFactor) : 0;
    const actualSmall = convFactor ? systemStock - actualBig * convFactor : systemStock;

    setCheckItems((items) => [
      ...items,
      {
        productId: product.id,
        productCode: product.code,
        productName: product.name,
        unit: product.unit,
        costPrice: Number(product.cost_price ?? 0),
        systemStock,
        actualStock: systemStock,
        conversions,
        convFactor,
        convBigUnit,
        actualBig,
        actualSmall,
      },
    ]);
    setProductSearch("");
    setShowProductDropdown(false);
    setFilteredProducts([]);
    setErrors((prev) => ({ ...prev, items: "" }));
  }

  function updateActualStock(productId: string, actualStock: number) {
    setCheckItems((items) =>
      items.map((item) =>
        item.productId === productId
          ? { ...item, actualStock: Number.isFinite(actualStock) ? Math.max(0, actualStock) : 0 }
          : item,
      ),
    );
  }

  // CEO 29/05/2026: cập nhật số đơn vị lớn (thùng).
  function updateActualBig(productId: string, big: number) {
    setCheckItems((items) =>
      items.map((item) =>
        item.productId === productId
          ? { ...item, actualBig: Number.isFinite(big) ? Math.max(0, big) : 0 }
          : item,
      ),
    );
  }

  // Cập nhật số lẻ (đơn vị nhỏ).
  function updateActualSmall(productId: string, small: number) {
    setCheckItems((items) =>
      items.map((item) =>
        item.productId === productId
          ? { ...item, actualSmall: Number.isFinite(small) ? Math.max(0, small) : 0 }
          : item,
      ),
    );
  }

  function removeProduct(productId: string) {
    setCheckItems((items) => items.filter((item) => item.productId !== productId));
  }

  // KiotViet style: tổng theo TIỀN (giá trị lệch), KHÔNG cộng số lượng vì
  // các SP khác đơn vị (Lon + Cái + Kg) cộng lại vô nghĩa.
  const increaseValue = useMemo(
    () =>
      checkItems.reduce((sum, item) => {
        const d = (lineActual(item) - item.systemStock) * item.costPrice;
        return d > 0 ? sum + d : sum;
      }, 0),
    [checkItems],
  );
  const decreaseValue = useMemo(
    () =>
      checkItems.reduce((sum, item) => {
        const d = (lineActual(item) - item.systemStock) * item.costPrice;
        return d < 0 ? sum + d : sum;
      }, 0),
    [checkItems],
  );
  const netValue = increaseValue + decreaseValue;

  const increaseLines = checkItems.filter((item) => lineActual(item) > item.systemStock).length;
  const decreaseLines = checkItems.filter((item) => lineActual(item) < item.systemStock).length;

  function validate(): boolean {
    const newErrors: Record<string, string> = {};
    if (checkItems.length === 0) {
      newErrors.items = "Vui lòng thêm ít nhất một sản phẩm kiểm kho";
    }
    if (checkItems.some((item) => !Number.isFinite(lineActual(item)) || lineActual(item) < 0)) {
      newErrors.items = "Số thực tế phải là số không âm";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSave() {
    if (saveLockRef.current) return;
    if (!validate()) return;

    saveLockRef.current = true;
    setSaving(true);
    try {
      const supabase = getClient();
      const ctx = await getCurrentContext();
      const realCode = await nextEntityCode("inventory", { tenantId: ctx.tenantId });
      setCode(realCode);

      const { data: checkRow, error: checkErr } = await supabase
        .from("inventory_checks")
        .insert({
          tenant_id: ctx.tenantId,
          branch_id: ctx.branchId,
          code: realCode,
          status: "in_progress" as const,
          note: notes || null,
          created_by: ctx.userId,
        } satisfies InventoryCheckInsert)
        .select("id")
        .single();

      if (checkErr) throw new Error(checkErr.message);

      const itemsPayload = checkItems.map((item) => {
        // CEO 28/05/2026: tồn thực tế quy về đơn vị cơ bản (thùng×factor + lẻ).
        const actual = lineActual(item);
        // Lưu ý: KHÔNG truyền `difference` — Migration 00031 đã đổi cột
        // này thành GENERATED ALWAYS AS (actual_stock - system_stock) STORED
        // để chống user sửa devtools. Truyền sẽ bị Postgres reject với
        // "cannot insert a non-DEFAULT value into column difference".
        return {
          check_id: checkRow.id,
          product_id: item.productId,
          product_name: item.productName,
          system_stock: item.systemStock,
          actual_stock: actual,
        };
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error: itemsErr } = await (supabase as any)
        .from("inventory_check_items")
        .insert(itemsPayload);

      if (itemsErr) {
        await supabase
          .from("inventory_checks")
          .update({
            status: "cancelled" as const,
            note: notes
              ? `${notes}\nTự hủy do lỗi ghi dòng kiểm kho: ${itemsErr.message}`
              : `Tự hủy do lỗi ghi dòng kiểm kho: ${itemsErr.message}`,
          })
          .eq("tenant_id", ctx.tenantId)
          .eq("id", checkRow.id);
        throw new Error(itemsErr.message);
      }

      onOpenChange(false);
      toast({
        title: "Tạo phiếu kiểm kho thành công",
        description: `Đã tạo ${realCode} với ${formatNumber(checkItems.length)} sản phẩm. Chênh lệch sẽ được điều chỉnh khi cân bằng phiếu.`,
        variant: "success",
      });
      onSuccess?.();
    } catch (err) {
      toast({
        title: "Lỗi tạo phiếu kiểm kho",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      saveLockRef.current = false;
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-[1450px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(1200px,calc(100vw-48px))] xl:max-w-[1450px] sm:rounded-2xl">
        <div className="shrink-0 border-b bg-white px-4 py-3 md:px-5">
          <DialogHeader className="gap-0 pr-10">
            <div className="flex flex-wrap items-center gap-3">
              <DialogTitle className="text-xl">Tạo phiếu kiểm kho</DialogTitle>
              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                Cân bằng sau kiểm
              </span>
              <span className="ml-auto mr-8 max-w-none whitespace-nowrap rounded-lg border bg-primary/5 px-3 py-1.5 text-sm font-bold text-primary sm:text-base">
                {code}
              </span>
            </div>
          </DialogHeader>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-surface-container-low p-3 md:p-4">
          <div className="mx-auto flex max-w-[1380px] flex-col gap-3">
            <div className="grid gap-3 lg:grid-cols-[minmax(420px,1fr)_minmax(320px,0.75fr)]">
              <section className="rounded-xl border bg-white p-3 shadow-sm">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold">Sản phẩm kiểm kho</h3>
                    <p className="text-[11px] text-muted-foreground">Chỉ hiện NVL / hàng giữ tồn (không gồm SKU)</p>
                  </div>
                  <span className="text-xs text-muted-foreground">{formatNumber(checkItems.length)} dòng</span>
                </div>
                <div className="relative">
                  <Icon name="search" size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={productSearch}
                    onChange={(e) => {
                      setProductSearch(e.target.value);
                      setShowProductDropdown(true);
                    }}
                    onFocus={() => setShowProductDropdown(true)}
                    onBlur={() => setTimeout(() => setShowProductDropdown(false), 200)}
                    placeholder="Tìm theo mã, tên hoặc barcode"
                    className="pl-8"
                  />
                  {showProductDropdown && productSearch && (
                    <div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border bg-popover shadow-lg">
                      {filteredProducts.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">
                          Không tìm thấy NVL / hàng giữ tồn (SKU không kiểm kê)
                        </div>
                      ) : (
                        filteredProducts.map((product) => (
                          <button
                            key={product.id}
                            type="button"
                            className="grid w-full grid-cols-[minmax(0,1fr)_64px] gap-3 px-3 py-2 text-left text-sm hover:bg-accent"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => addProduct(product)}
                          >
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{product.name}</span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {product.code} · {product.unit}
                              </span>
                            </span>
                            <span className="text-right text-xs font-semibold text-primary">Thêm</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
                {errors.items && <p className="mt-1 text-xs text-destructive">{errors.items}</p>}
              </section>

              <section className="rounded-xl border bg-white p-3 shadow-sm">
                <h3 className="mb-2 text-sm font-semibold">Ghi chú</h3>
                <textarea
                  className="flex min-h-[74px] w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Ví dụ: kiểm kho cuối ngày, khu vực quầy, ca kiểm..."
                  rows={3}
                />
              </section>
            </div>

            <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
              <div className="hidden grid-cols-[minmax(220px,1fr)_60px_148px_268px_120px_150px_40px] gap-3 border-b bg-muted/50 px-3 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground md:grid">
                <span>Sản phẩm</span>
                <span className="flex justify-center">ĐVT</span>
                <span className="flex justify-end">Tồn kho</span>
                <span className="flex justify-end">Thực tế (nhập)</span>
                <span className="flex justify-end">SL lệch</span>
                <span className="flex justify-end">Giá trị lệch</span>
                <span />
              </div>

              {checkItems.length === 0 ? (
                <div className="flex min-h-[320px] flex-col items-center justify-center px-4 py-10 text-center">
                  <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon name="fact_check" size={24} />
                  </div>
                  <div className="mt-3 font-semibold">Chưa có sản phẩm kiểm kho</div>
                  <div className="mt-1 max-w-md text-sm text-muted-foreground">
                    Khi cân bằng phiếu, chênh lệch dương sẽ tạo nhập điều chỉnh, chênh lệch âm sẽ tạo xuất điều chỉnh.
                  </div>
                </div>
              ) : (
                <div className="divide-y">
                  {checkItems.map((item) => {
                    // Làm tròn + chuẩn hoá -0 → 0 (tránh hiện "-0" khi vừa đổi đơn vị).
                    const diff =
                      Math.round((lineActual(item) - item.systemStock) * 10000) / 10000 || 0;
                    const diffValue = diff * item.costPrice;
                    const diffColor =
                      diff === 0
                        ? "text-muted-foreground"
                        : diff > 0
                          ? "text-status-success"
                          : "text-destructive";
                    const sysConvText = getConversionText(item.systemStock, item.unit, item.conversions);
                    return (
                      <div
                        key={item.productId}
                        className="grid gap-3 px-3 py-3 md:grid-cols-[minmax(220px,1fr)_60px_148px_268px_120px_150px_40px] md:items-center"
                      >
                        {/* Sản phẩm */}
                        <div className="min-w-0 pr-2">
                          <div className="truncate text-sm font-semibold">{item.productName}</div>
                          <div className="mt-0.5 truncate text-xs text-muted-foreground">{item.productCode}</div>
                        </div>

                        {/* ĐVT */}
                        <div className="hidden justify-center md:flex">
                          <span className="min-w-[44px] rounded-md bg-muted/50 px-2 py-1 text-center text-xs font-semibold text-muted-foreground">
                            {item.unit || "Cái"}
                          </span>
                        </div>

                        {/* Tồn kho */}
                        <div className="flex items-baseline justify-between gap-2 md:block md:text-right">
                          <span className="text-[11px] font-medium uppercase text-muted-foreground md:hidden">Tồn kho</span>
                          <div className="text-right">
                            <div className="text-sm font-medium tabular-nums">{formatNumber(item.systemStock)}</div>
                            {sysConvText && (
                              <div className="text-[11px] tabular-nums text-muted-foreground">{sysConvText}</div>
                            )}
                          </div>
                        </div>

                        {/* Thực tế (nhập) */}
                        <div className="md:block">
                          <span className="mb-1 block text-[11px] font-medium uppercase text-muted-foreground md:hidden">
                            Thực tế (nhập)
                          </span>
                          {item.convFactor ? (
                            <div className="space-y-1.5">
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <NumericInput
                                    value={item.actualBig}
                                    onChange={(value) => updateActualBig(item.productId, value ?? 0)}
                                    min={0}
                                    decimals={0}
                                    className="h-9 text-right"
                                    aria-label={`Số ${item.convBigUnit} ${item.productName}`}
                                  />
                                  <div className="mt-1 text-center text-[10px] font-medium text-muted-foreground">
                                    {item.convBigUnit}
                                  </div>
                                </div>
                                <div>
                                  <NumericInput
                                    value={item.actualSmall}
                                    onChange={(value) => updateActualSmall(item.productId, value ?? 0)}
                                    min={0}
                                    decimals={2}
                                    className="h-9 text-right"
                                    aria-label={`Số lẻ ${item.productName}`}
                                  />
                                  <div className="mt-1 text-center text-[10px] font-medium text-muted-foreground">
                                    {item.unit} lẻ
                                  </div>
                                </div>
                              </div>
                              <div className="text-right text-[11px] text-muted-foreground">
                                ={" "}
                                <b className="tabular-nums text-foreground">{formatNumber(lineActual(item))}</b>{" "}
                                {item.unit}
                              </div>
                            </div>
                          ) : (
                            <NumericInput
                              value={item.actualStock}
                              onChange={(value) => updateActualStock(item.productId, value ?? 0)}
                              min={0}
                              decimals={2}
                              className="h-9 text-right"
                              aria-label={`Tồn thực tế ${item.productName}`}
                            />
                          )}
                        </div>

                        {/* SL lệch */}
                        <div className="flex items-baseline justify-between gap-2 md:block md:text-right">
                          <span className="text-[11px] font-medium uppercase text-muted-foreground md:hidden">SL lệch</span>
                          <div className="text-right">
                            <span className={`text-sm font-bold tabular-nums ${diffColor}`}>
                              {diff > 0 ? "+" : ""}
                              {formatNumber(diff)}
                            </span>
                            <span className="ml-1 text-[10px] text-muted-foreground">{item.unit}</span>
                          </div>
                        </div>

                        {/* Giá trị lệch (tiền) */}
                        <div className="flex items-baseline justify-between gap-2 md:block md:text-right">
                          <span className="text-[11px] font-medium uppercase text-muted-foreground md:hidden">Giá trị lệch</span>
                          <span
                            className={`text-sm font-bold tabular-nums ${item.costPrice > 0 ? diffColor : "text-muted-foreground"}`}
                          >
                            {item.costPrice > 0 ? `${diff > 0 ? "+" : ""}${formatCurrency(diffValue)}` : "—"}
                          </span>
                        </div>

                        {/* Xóa */}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => removeProduct(item.productId)}
                          className="justify-self-end text-muted-foreground hover:text-destructive"
                          aria-label={`Bỏ ${item.productName}`}
                        >
                          <Icon name="delete" size={14} />
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="mx-0 mb-0 shrink-0 rounded-none border-t bg-white px-4 py-3">
          <div className="mx-auto grid w-full max-w-[1380px] grid-cols-1 items-center gap-3 lg:grid-cols-[1fr_auto]">
            <div className="grid gap-2 text-sm sm:grid-cols-3 xl:grid-cols-5">
              <FooterMetric label="Mặt hàng" value={formatNumber(checkItems.length)} />
              <FooterMetric
                label="Dòng lệch"
                value={`${formatNumber(increaseLines)} thừa · ${formatNumber(decreaseLines)} thiếu`}
              />
              <FooterMetric label="Giá trị thừa" value={formatCurrency(increaseValue)} tone="success" />
              <FooterMetric label="Giá trị thiếu" value={formatCurrency(decreaseValue)} tone="destructive" />
              <FooterMetric
                label="Tổng chênh lệch"
                value={`${netValue > 0 ? "+" : ""}${formatCurrency(netValue)}`}
                strong
                tone={netValue === 0 ? "default" : netValue > 0 ? "success" : "destructive"}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Hủy
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving && <Icon name="progress_activity" size={16} className="mr-2 animate-spin" />}
                Tạo phiếu kiểm kho
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
  tone = "default",
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: "default" | "success" | "destructive";
}) {
  const toneClass =
    tone === "success"
      ? "text-status-success"
      : tone === "destructive"
        ? "text-destructive"
        : strong
          ? "text-primary"
          : "";
  return (
    <div className="rounded-lg border bg-surface-container-lowest px-3 py-2">
      <div className="text-[11px] font-semibold uppercase text-muted-foreground">{label}</div>
      <div className={`mt-0.5 break-words font-bold leading-tight tabular-nums ${strong ? "text-lg" : ""} ${toneClass}`}>
        {value}
      </div>
    </div>
  );
}
