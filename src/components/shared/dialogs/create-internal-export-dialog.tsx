"use client";

import { useState, useEffect, useRef, useMemo } from "react";
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
import { formatCurrency, formatNumber } from "@/lib/format";
import { useToast } from "@/lib/contexts";
import { getClient, getCurrentContext } from "@/lib/services/supabase/base";
import { createInternalExport } from "@/lib/services/supabase/inventory";
import { Icon } from "@/components/ui/icon";

interface CreateInternalExportDialogProps {
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
  cost_price: number;
}

interface ExportItem {
  product_id: string;
  product_name: string;
  product_code: string;
  unit: string;
  stock: number;
  cost_price: number;
  quantity: number;
}

const PENDING_CODE_PLACEHOLDER = "Tự tạo khi lưu";

export function CreateInternalExportDialog({
  open,
  onOpenChange,
  onSuccess,
}: CreateInternalExportDialogProps) {
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [showProductDropdown, setShowProductDropdown] = useState(false);
  const [filteredProducts, setFilteredProducts] = useState<ProductResult[]>([]);
  const [items, setItems] = useState<ExportItem[]>([]);
  const [destination, setDestination] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [currentTenantId, setCurrentTenantId] = useState<string | null>(null);
  const saveLockRef = useRef(false);

  useEffect(() => {
    if (!open) return;

    getCurrentContext()
      .then((ctx) => setCurrentTenantId(ctx.tenantId))
      .catch(() => setCurrentTenantId(null));

    setCode(PENDING_CODE_PLACEHOLDER);
    setProductSearch("");
    setShowProductDropdown(false);
    setFilteredProducts([]);
    setItems([]);
    setDestination("");
    setNotes("");
    setErrors({});
    setSaving(false);
  }, [open]);

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
        .select("id, code, name, unit, stock, cost_price")
        .or(`name.ilike.%${productSearch}%,code.ilike.%${productSearch}%`)
        .eq("tenant_id", currentTenantId ?? ctx.tenantId)
        .eq("is_active", true)
        .limit(8);

      setFilteredProducts((data ?? []).map((p) => ({
        id: p.id,
        code: p.code ?? "",
        name: p.name,
        unit: p.unit ?? "Cái",
        stock: Number(p.stock ?? 0),
        cost_price: Number(p.cost_price ?? 0),
      })));
    }, 300);

    return () => clearTimeout(timer);
  }, [productSearch, currentTenantId]);

  function addProduct(product: ProductResult) {
    if (items.some((item) => item.product_id === product.id)) return;

    setItems([
      ...items,
      {
        product_id: product.id,
        product_name: product.name,
        product_code: product.code,
        unit: product.unit || "Cái",
        stock: product.stock,
        cost_price: product.cost_price,
        quantity: 1,
      },
    ]);
    setProductSearch("");
    setShowProductDropdown(false);
  }

  function removeItem(productId: string) {
    setItems(items.filter((item) => item.product_id !== productId));
  }

  function updateQuantity(productId: string, qty: number) {
    setItems(items.map((item) =>
      item.product_id === productId
        ? { ...item, quantity: Math.max(1, Math.min(qty, Math.max(1, item.stock))) }
        : item,
    ));
  }

  const totalQuantity = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity, 0),
    [items],
  );

  const totalValue = useMemo(
    () => items.reduce((sum, item) => sum + item.quantity * item.cost_price, 0),
    [items],
  );

  function validate(): boolean {
    const newErrors: Record<string, string> = {};
    if (items.length === 0) newErrors.items = "Vui lòng chọn ít nhất một sản phẩm";
    if (!destination.trim()) newErrors.destination = "Vui lòng nhập nơi nhận / mục đích sử dụng";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSave() {
    if (saveLockRef.current) return;
    if (!validate()) return;

    saveLockRef.current = true;
    setSaving(true);
    try {
      const result = await createInternalExport({
        department: destination,
        note: notes.trim() ? notes.trim() : undefined,
        items: items.map((item) => ({
          productId: item.product_id,
          productName: item.product_name,
          unit: item.unit,
          quantity: item.quantity,
          unitPrice: item.cost_price,
        })),
      });
      setCode(result.code);

      onOpenChange(false);
      toast({
        title: "Tạo phiếu xuất nội bộ thành công",
        description: `Đã tạo phiếu xuất nội bộ ${result.code}`,
        variant: "success",
      });
      onSuccess?.();
    } catch (err) {
      toast({
        title: "Lỗi tạo phiếu xuất nội bộ",
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
      <DialogContent className="flex h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-[1450px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(1200px,calc(100vw-48px))] xl:sm:max-w-[1450px] sm:rounded-2xl">
        <div className="shrink-0 border-b bg-white px-4 py-3 md:px-5">
          <DialogHeader className="gap-0 pr-14">
            <div className="flex flex-wrap items-center gap-3">
              <DialogTitle className="text-xl">Tạo phiếu xuất dùng nội bộ</DialogTitle>
              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                Xuất kho
              </span>
              <span className="ml-auto mr-8 max-w-none whitespace-nowrap rounded-lg border bg-primary/5 px-3 py-1.5 text-sm font-bold text-primary sm:text-base">
                {code}
              </span>
            </div>
          </DialogHeader>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-surface-container-low p-3 md:p-4">
          <div className="mx-auto flex max-w-[1380px] flex-col gap-3">
            <div className="grid gap-3 lg:grid-cols-[minmax(320px,0.85fr)_minmax(420px,1.15fr)]">
              <section className="rounded-xl border bg-white p-3 shadow-sm">
                <h3 className="mb-2 text-sm font-semibold">Nơi nhận / mục đích</h3>
                <Input
                  value={destination}
                  onChange={(e) => setDestination(e.target.value)}
                  placeholder="VD: Phòng Marketing, sự kiện khai trương..."
                  aria-invalid={!!errors.destination}
                />
                {errors.destination && <p className="mt-1 text-xs text-destructive">{errors.destination}</p>}
              </section>

              <section className="rounded-xl border bg-white p-3 shadow-sm">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">Dòng hàng xuất</h3>
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
                    onFocus={() => setShowProductDropdown(true)}
                    onBlur={() => setTimeout(() => setShowProductDropdown(false), 200)}
                    placeholder="Tìm sản phẩm theo tên hoặc mã"
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
                            className="grid w-full grid-cols-[minmax(0,1fr)_140px] gap-3 px-3 py-2 text-left text-sm hover:bg-accent"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => addProduct(p)}
                          >
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{p.name}</span>
                              <span className="block truncate text-xs text-muted-foreground">{p.code}</span>
                            </span>
                            <span className="text-right text-muted-foreground">
                              Tồn {formatNumber(p.stock)}
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
                {errors.items && <p className="mt-1 text-xs text-destructive">{errors.items}</p>}
              </section>
            </div>

            <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
              <div className="hidden grid-cols-[minmax(300px,1fr)_90px_110px_120px_140px_150px_44px] gap-2 border-b bg-muted/50 px-3 py-2 text-xs font-semibold uppercase text-muted-foreground md:grid">
                <span>Sản phẩm</span>
                <span className="flex justify-center">ĐVT</span>
                <span className="flex justify-end">Tồn kho</span>
                <span className="flex justify-end">Số lượng</span>
                <span className="flex justify-end">Giá vốn</span>
                <span className="flex justify-end">Thành tiền</span>
                <span />
              </div>

              {items.length === 0 ? (
                <div className="flex min-h-[300px] flex-col items-center justify-center px-4 py-10 text-center">
                  <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon name="inventory_2" size={24} />
                  </div>
                  <div className="mt-3 font-semibold">Chưa có dòng hàng</div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    Thêm sản phẩm cần xuất dùng nội bộ.
                  </div>
                </div>
              ) : (
                <div className="divide-y">
                  {items.map((item) => (
                    <div
                      key={item.product_id}
                      className="grid gap-2 px-3 py-2.5 md:grid-cols-[minmax(300px,1fr)_90px_110px_120px_140px_150px_44px] md:items-center"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{item.product_name}</div>
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">{item.product_code}</div>
                      </div>
                      <div className="flex justify-center">
                        <span className="min-w-[64px] rounded-md bg-muted/50 px-2 py-1 text-center text-xs font-semibold text-muted-foreground">
                          {item.unit || "Cái"}
                        </span>
                      </div>
                      <div className="text-right text-sm tabular-nums text-muted-foreground">
                        {formatNumber(item.stock)}
                      </div>
                      <NumericInput
                        value={item.quantity}
                        onChange={(value) => updateQuantity(item.product_id, value ?? 1)}
                        min={1}
                        max={Math.max(1, item.stock)}
                        decimals={2}
                        className="h-8 text-right"
                        aria-label={`Số lượng ${item.product_name}`}
                      />
                      <div className="text-right text-sm tabular-nums">
                        {formatCurrency(item.cost_price)}
                      </div>
                      <div className="text-right text-sm font-bold tabular-nums text-primary">
                        {formatCurrency(item.quantity * item.cost_price)}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => removeItem(item.product_id)}
                        className="justify-self-end text-muted-foreground hover:text-destructive"
                        aria-label={`Xóa ${item.product_name}`}
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
                placeholder="Ví dụ: xuất dùng cho chương trình khuyến mãi, bộ phận sử dụng, người nhận..."
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
              <FooterMetric label="Giá trị xuất" value={formatCurrency(totalValue)} strong />
              <FooterMetric label="Trạng thái" value="Ghi sổ khi tạo" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Hủy
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving && <Icon name="progress_activity" size={16} className="mr-2 animate-spin" />}
                Tạo phiếu xuất
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
