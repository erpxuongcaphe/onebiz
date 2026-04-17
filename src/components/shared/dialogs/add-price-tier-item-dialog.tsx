"use client";

// AddPriceTierItemDialog — thêm sản phẩm vào bảng giá với giá riêng + min qty

import { useEffect, useState } from "react";
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
import { useToast } from "@/lib/contexts";
import { addPriceTierItem, getProducts } from "@/lib/services";
import { formatCurrency } from "@/lib/format";
import type { Product } from "@/lib/types";
import { Icon } from "@/components/ui/icon";

interface AddPriceTierItemDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tierId: string;
  tierName: string;
  onSuccess?: () => void;
}

export function AddPriceTierItemDialog({
  open,
  onOpenChange,
  tierId,
  tierName,
  onSuccess,
}: AddPriceTierItemDialogProps) {
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Product[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<Product | null>(null);
  const [price, setPrice] = useState("");
  const [minQty, setMinQty] = useState("1");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setSearch("");
    setResults([]);
    setSelected(null);
    setPrice("");
    setMinQty("1");
    setErrors({});
    setSaving(false);
  }, [open]);

  useEffect(() => {
    if (!open || search.length < 2 || selected) {
      setResults([]);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const t = setTimeout(async () => {
      try {
        const r = await getProducts({
          page: 0,
          pageSize: 8,
          search,
          filters: { productType: "sku" },
        });
        if (!cancelled) setResults(r.data);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [search, open, selected]);

  function selectProduct(p: Product) {
    setSelected(p);
    setSearch(p.name);
    setPrice(String(p.sellPrice));
    setResults([]);
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!selected) e.product = "Vui lòng chọn sản phẩm";
    const priceNum = Number(price);
    if (!price || isNaN(priceNum) || priceNum < 0)
      e.price = "Giá không hợp lệ";
    const qty = Number(minQty);
    if (!minQty || isNaN(qty) || qty < 1)
      e.minQty = "Số lượng tối thiểu phải ≥ 1";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSave() {
    if (!validate() || !selected) return;
    setSaving(true);
    try {
      await addPriceTierItem({
        priceTierId: tierId,
        productId: selected.id,
        price: Number(price),
        minQty: Number(minQty),
      });
      toast({
        title: "Đã thêm vào bảng giá",
        description: `${selected.name} → ${formatCurrency(Number(price))}`,
        variant: "success",
      });
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      toast({
        title: "Lỗi thêm sản phẩm",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Thêm sản phẩm vào bảng giá</DialogTitle>
          <DialogDescription>
            Bảng giá: <strong>{tierName}</strong>
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Product picker */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Sản phẩm <span className="text-destructive">*</span>
            </label>
            <div className="relative">
              <Icon name="search" size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setSelected(null);
                }}
                placeholder="Tìm theo tên hoặc mã SKU..."
                className="pl-8"
                aria-invalid={!!errors.product}
              />
              {results.length > 0 && !selected && (
                <div className="absolute z-10 mt-1 w-full rounded-lg border bg-popover shadow-md max-h-52 overflow-y-auto">
                  {results.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => selectProduct(p)}
                      className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-accent text-left"
                    >
                      <span>
                        <span className="font-medium block">{p.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {p.code}
                        </span>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatCurrency(p.sellPrice)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {searching && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  Đang tìm...
                </span>
              )}
            </div>
            {errors.product && (
              <p className="text-xs text-destructive">{errors.product}</p>
            )}
          </div>

          {selected && (
            <div className="rounded-lg border p-3 bg-muted/30 text-sm space-y-0.5">
              <div className="font-medium">{selected.name}</div>
              <div className="text-xs text-muted-foreground">
                {selected.code} · Giá niêm yết: {formatCurrency(selected.sellPrice)}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Giá riêng <span className="text-destructive">*</span>
              </label>
              <Input
                type="number"
                min={0}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0"
                aria-invalid={!!errors.price}
              />
              {errors.price && (
                <p className="text-xs text-destructive">{errors.price}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                SL tối thiểu <span className="text-destructive">*</span>
              </label>
              <Input
                type="number"
                min={1}
                value={minQty}
                onChange={(e) => setMinQty(e.target.value)}
                aria-invalid={!!errors.minQty}
              />
              {errors.minQty && (
                <p className="text-xs text-destructive">{errors.minQty}</p>
              )}
            </div>
          </div>

          {selected && price && Number(price) > 0 && (
            <div className="text-xs text-muted-foreground">
              Chênh lệch:{" "}
              <span
                className={
                  Number(price) < selected.sellPrice
                    ? "text-emerald-600 font-medium"
                    : "text-amber-600 font-medium"
                }
              >
                {Number(price) < selected.sellPrice ? "-" : "+"}
                {formatCurrency(Math.abs(Number(price) - selected.sellPrice))}
                {" ("}
                {selected.sellPrice > 0
                  ? (
                      ((Number(price) - selected.sellPrice) / selected.sellPrice) *
                      100
                    ).toFixed(1)
                  : "0"}
                {"%)"}
              </span>{" "}
              so với giá niêm yết
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Icon name="progress_activity" size={16} className="mr-2 animate-spin" />}
            Thêm vào bảng giá
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
