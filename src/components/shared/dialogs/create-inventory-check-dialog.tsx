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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/lib/contexts";
import { getClient, getCurrentContext } from "@/lib/services/supabase/base";
import { nextEntityCode } from "@/lib/services/supabase/stock-adjustments";
import type { Database } from "@/lib/supabase/types";
import { Icon } from "@/components/ui/icon";
import { formatNumber } from "@/lib/format";

type InventoryCheckInsert = Database["public"]["Tables"]["inventory_checks"]["Insert"];
type ProductRow = Pick<
  Database["public"]["Tables"]["products"]["Row"],
  "id" | "code" | "name" | "unit"
>;

interface InventoryCheckLine {
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  systemStock: number;
  actualStock: number;
}

interface CreateInventoryCheckDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

// Placeholder shown in the dialog header before save. Real code is generated
// via `next_code('inventory')` at save time.
const PENDING_CODE_PLACEHOLDER = "KK —";

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
    if (open) {
      setCode(PENDING_CODE_PLACEHOLDER);
      setNotes("");
      setProductSearch("");
      setShowProductDropdown(false);
      setFilteredProducts([]);
      setCheckItems([]);
      setErrors({});
      setSaving(false);
    }
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
      const { data, error } = await supabase
        .from("products")
        .select("id, code, name, unit")
        .eq("tenant_id", ctx.tenantId)
        .eq("is_active", true)
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
    setCheckItems((items) => [
      ...items,
      {
        productId: product.id,
        productCode: product.code,
        productName: product.name,
        unit: product.unit,
        systemStock,
        actualStock: systemStock,
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
          : item
      )
    );
  }

  function removeProduct(productId: string) {
    setCheckItems((items) => items.filter((item) => item.productId !== productId));
  }

  function validate(): boolean {
    const newErrors: Record<string, string> = {};
    if (checkItems.length === 0) {
      newErrors.items = "Vui lòng thêm ít nhất một sản phẩm kiểm kho";
    }
    if (checkItems.some((item) => !Number.isFinite(item.actualStock) || item.actualStock < 0)) {
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

      const itemsPayload = checkItems.map((item) => ({
        check_id: checkRow.id,
        product_id: item.productId,
        product_name: item.productName,
        system_stock: item.systemStock,
        actual_stock: item.actualStock,
        difference: item.actualStock - item.systemStock,
      }));

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
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Tạo phiếu kiểm kho</DialogTitle>
          <DialogDescription>
            Chọn sản phẩm, nhập số thực tế rồi lưu phiếu. Khi cân bằng, hệ thống sẽ tạo nhập/xuất điều chỉnh theo chênh lệch.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Code */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Mã phiếu kiểm kho</label>
            <div className="flex h-8 w-full rounded-lg border border-input bg-muted/50 px-3 py-2 text-sm">
              {code}
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Ghi chú</label>
            <textarea
              className="flex min-h-[80px] w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ghi chú phiếu kiểm kho (lý do kiểm kho, khu vực kiểm...)"
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">
              Sản phẩm kiểm kho <span className="text-destructive">*</span>
            </label>
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
                placeholder="Tìm theo mã, tên hoặc barcode..."
                className="pl-8"
              />
              {showProductDropdown && productSearch && (
                <div className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border bg-popover shadow-md">
                  {filteredProducts.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      Không tìm thấy sản phẩm
                    </div>
                  ) : (
                    filteredProducts.map((product) => (
                      <button
                        key={product.id}
                        type="button"
                        className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => addProduct(product)}
                      >
                        <span className="min-w-0">
                          <span className="block truncate font-medium">{product.name}</span>
                          <span className="block text-xs text-muted-foreground">
                            {product.code} · {product.unit}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs font-medium text-primary">Thêm</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            {errors.items && <p className="text-xs text-destructive">{errors.items}</p>}
          </div>

          <div className="rounded-lg border">
            <div className="grid grid-cols-[1fr_92px_112px_96px_40px] gap-2 border-b bg-muted/50 px-3 py-2 text-xs font-medium text-muted-foreground">
              <span>Sản phẩm</span>
              <span className="text-right">Sổ kho</span>
              <span className="text-right">Thực tế</span>
              <span className="text-right">Lệch</span>
              <span />
            </div>
            {checkItems.length === 0 ? (
              <div className="px-3 py-8 text-center text-sm text-muted-foreground">
                Chưa có sản phẩm kiểm kho
              </div>
            ) : (
              checkItems.map((item) => {
                const diff = item.actualStock - item.systemStock;
                return (
                  <div
                    key={item.productId}
                    className="grid grid-cols-[1fr_92px_112px_96px_40px] items-center gap-2 border-b px-3 py-2 last:border-b-0"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{item.productName}</div>
                      <div className="text-xs text-muted-foreground">
                        {item.productCode} · {item.unit}
                      </div>
                    </div>
                    <div className="text-right font-mono text-sm">
                      {formatNumber(item.systemStock)}
                    </div>
                    <Input
                      type="number"
                      min={0}
                      value={item.actualStock}
                      onChange={(e) => updateActualStock(item.productId, Number(e.target.value) || 0)}
                      className="h-8 text-right font-mono"
                    />
                    <div
                      className={`text-right font-mono text-sm font-semibold ${
                        diff === 0
                          ? "text-muted-foreground"
                          : diff > 0
                            ? "text-status-success"
                            : "text-destructive"
                      }`}
                    >
                      {diff > 0 ? "+" : ""}
                      {formatNumber(diff)}
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => removeProduct(item.productId)}
                      aria-label={`Bỏ ${item.productName}`}
                    >
                      <Icon name="close" size={16} />
                    </Button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Icon name="progress_activity" size={16} className="mr-2 animate-spin" />}
            Tạo phiếu kiểm kho
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
