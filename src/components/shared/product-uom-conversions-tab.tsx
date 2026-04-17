"use client";

// ProductUomConversionsTab — quản lý ĐVT quy đổi cho 1 sản phẩm
// 3 đơn vị: purchase_unit (mua) → stock_unit (kho) → sell_unit (bán)
// Inline list + add form, không cần dialog riêng

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/lib/contexts";
import {
  getUOMConversions,
  createUOMConversion,
  deleteUOMConversion,
} from "@/lib/services";
import type { UOMConversion, Product } from "@/lib/types";
import { Icon } from "@/components/ui/icon";

interface Props {
  product: Product;
}

export function ProductUomConversionsTab({ product }: Props) {
  const { toast } = useToast();
  const [items, setItems] = useState<UOMConversion[]>([]);
  const [loading, setLoading] = useState(true);

  // Inline add form
  const [showAdd, setShowAdd] = useState(false);
  const [fromUnit, setFromUnit] = useState("");
  const [toUnit, setToUnit] = useState("");
  const [factor, setFactor] = useState("");
  const [saving, setSaving] = useState(false);

  const baseUnits = [
    product.purchaseUnit,
    product.stockUnit,
    product.sellUnit,
    product.unit,
  ].filter((u): u is string => !!u);
  const unitOptions = Array.from(new Set(baseUnits));

  async function load() {
    setLoading(true);
    try {
      const data = await getUOMConversions(product.id);
      setItems(data);
    } catch (err) {
      toast({
        title: "Lỗi tải quy đổi",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product.id]);

  function resetForm() {
    setFromUnit("");
    setToUnit("");
    setFactor("");
    setShowAdd(false);
  }

  async function handleAdd() {
    if (!fromUnit.trim() || !toUnit.trim() || !factor.trim()) {
      toast({
        title: "Thiếu thông tin",
        description: "Vui lòng nhập đầy đủ ĐVT và hệ số",
        variant: "error",
      });
      return;
    }
    if (fromUnit === toUnit) {
      toast({
        title: "ĐVT không hợp lệ",
        description: "ĐVT nguồn và đích không được trùng nhau",
        variant: "error",
      });
      return;
    }
    const f = Number(factor);
    if (isNaN(f) || f <= 0) {
      toast({
        title: "Hệ số không hợp lệ",
        description: "Hệ số phải là số dương",
        variant: "error",
      });
      return;
    }

    setSaving(true);
    try {
      await createUOMConversion({
        productId: product.id,
        fromUnit: fromUnit.trim(),
        toUnit: toUnit.trim(),
        factor: f,
      });
      toast({ title: "Đã thêm quy đổi", variant: "success" });
      resetForm();
      load();
    } catch (err) {
      toast({
        title: "Lỗi thêm quy đổi",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      await deleteUOMConversion(id);
      toast({ title: "Đã xóa quy đổi", variant: "success" });
      load();
    } catch (err) {
      toast({
        title: "Lỗi xóa",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    }
  }

  return (
    <div className="space-y-4">
      {/* Default units */}
      <div className="rounded-lg border p-3 bg-muted/20">
        <div className="text-xs font-semibold text-muted-foreground uppercase mb-2">
          Đơn vị tính cơ bản
        </div>
        <div className="flex items-center gap-2 text-sm">
          <UnitChip label="ĐVT mua" value={product.purchaseUnit ?? "—"} />
          <Icon name="arrow_forward" size={14} className="text-muted-foreground" />
          <UnitChip label="ĐVT kho" value={product.stockUnit ?? product.unit ?? "—"} />
          <Icon name="arrow_forward" size={14} className="text-muted-foreground" />
          <UnitChip label="ĐVT bán" value={product.sellUnit ?? "—"} />
        </div>
      </div>

      {/* Conversions list */}
      <div className="border rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/30">
          <h3 className="text-sm font-semibold">
            Hệ số quy đổi ({items.length})
          </h3>
          {!showAdd && (
            <Button size="sm" variant="outline" onClick={() => setShowAdd(true)}>
              <Icon name="add" size={16} className="mr-1" />
              Thêm quy đổi
            </Button>
          )}
        </div>

        {showAdd && (
          <div className="p-3 border-b bg-primary-fixed/30 grid grid-cols-12 gap-2 items-end">
            <div className="col-span-3">
              <label className="text-[11px] text-muted-foreground block mb-0.5">
                Từ ĐVT
              </label>
              <Input
                list="uom-options"
                value={fromUnit}
                onChange={(e) => setFromUnit(e.target.value)}
                placeholder="VD: thùng"
              />
            </div>
            <div className="col-span-1 flex items-center justify-center pb-2">
              <Icon name="arrow_forward" size={16} className="text-muted-foreground" />
            </div>
            <div className="col-span-3">
              <label className="text-[11px] text-muted-foreground block mb-0.5">
                Sang ĐVT
              </label>
              <Input
                list="uom-options"
                value={toUnit}
                onChange={(e) => setToUnit(e.target.value)}
                placeholder="VD: chai"
              />
            </div>
            <div className="col-span-3">
              <label className="text-[11px] text-muted-foreground block mb-0.5">
                Hệ số
              </label>
              <Input
                type="number"
                min={0}
                value={factor}
                onChange={(e) => setFactor(e.target.value)}
                placeholder="VD: 24"
              />
            </div>
            <div className="col-span-2 flex gap-1">
              <Button
                size="sm"
                onClick={handleAdd}
                disabled={saving}
                className="flex-1"
              >
                {saving ? <Icon name="progress_activity" size={12} className="animate-spin" /> : "Lưu"}
              </Button>
              <Button size="sm" variant="ghost" onClick={resetForm}>
                Hủy
              </Button>
            </div>
            <datalist id="uom-options">
              {unitOptions.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
            {fromUnit && toUnit && factor && (
              <div className="col-span-12 text-xs text-muted-foreground">
                Ý nghĩa:{" "}
                <strong>
                  1 {fromUnit} = {factor} {toUnit}
                </strong>
              </div>
            )}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Icon name="progress_activity" size={16} className="animate-spin mr-2" />
            <span className="text-sm">Đang tải...</span>
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
            <Icon name="repeat" size={32} className="mb-2 opacity-30" />
            <p className="text-sm">Chưa có quy đổi nào</p>
            <p className="text-xs mt-1">
              Quy đổi giúp nhập theo thùng/lốc, bán theo lon/chai
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/20">
              <tr>
                <th className="text-left p-2 font-medium">Từ ĐVT</th>
                <th className="text-center p-2 font-medium w-12"></th>
                <th className="text-left p-2 font-medium">Sang ĐVT</th>
                <th className="text-right p-2 font-medium">Hệ số</th>
                <th className="text-right p-2 font-medium w-12"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((c) => (
                <tr key={c.id} className="border-t">
                  <td className="p-2 font-medium">{c.fromUnit}</td>
                  <td className="p-2 text-center">
                    <Icon name="arrow_forward" size={14} className="text-muted-foreground inline" />
                  </td>
                  <td className="p-2 font-medium">{c.toUnit}</td>
                  <td className="p-2 text-right">
                    <span className="font-semibold">×{c.factor}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      1 {c.fromUnit} = {c.factor} {c.toUnit}
                    </span>
                  </td>
                  <td className="p-2 text-right">
                    <button
                      onClick={() => handleDelete(c.id)}
                      className="text-muted-foreground hover:text-destructive transition-colors"
                      title="Xóa"
                    >
                      <Icon name="delete" size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function UnitChip({ label, value }: { label: string; value: string }) {
  return (
    <span className="inline-flex flex-col items-center px-2.5 py-1 rounded border bg-background">
      <span className="text-[10px] text-muted-foreground uppercase">
        {label}
      </span>
      <span className="text-xs font-semibold">{value}</span>
    </span>
  );
}
