"use client";

import { useState, useEffect, useCallback } from "react";
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
import { useToast } from "@/lib/contexts";
import { useAuth } from "@/lib/contexts/auth-context";
import {
  createBOM,
  getBOMById,
  getProducts,
  calculateBOMCost,
} from "@/lib/services";
import { formatCurrency } from "@/lib/format";
import type { Product, BOMCostBreakdown } from "@/lib/types";
import { Icon } from "@/components/ui/icon";

interface BOMEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** If editing an existing BOM, pass its id */
  bomId?: string;
  /** Pre-fill product (when opened from product detail) */
  productId?: string;
  onSuccess?: () => void;
}

interface MaterialLine {
  materialId: string;
  materialName: string;
  materialCode: string;
  costPrice: number;
  quantity: string;
  unit: string;
  wastePercent: string;
}

export function BOMEditorDialog({
  open,
  onOpenChange,
  bomId,
  productId: initialProductId,
  onSuccess,
}: BOMEditorDialogProps) {
  const { toast } = useToast();
  const { branches } = useAuth();

  // Outputs (SKU choices)
  const [skuOptions, setSkuOptions] = useState<Product[]>([]);
  const [nvlOptions, setNvlOptions] = useState<Product[]>([]);

  // Form state
  const [productId, setProductId] = useState(initialProductId ?? "");
  // Day 18/05/2026 (CEO): null = BOM global (3 quán dùng chung), có value = BOM riêng quán
  const [branchId, setBranchId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [batchSize, setBatchSize] = useState("1");
  const [yieldQty, setYieldQty] = useState("1");
  const [yieldUnit, setYieldUnit] = useState("kg");
  const [note, setNote] = useState("");
  const [items, setItems] = useState<MaterialLine[]>([]);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMaterialId, setPickerMaterialId] = useState("");

  const [saving, setSaving] = useState(false);
  const [costPreview, setCostPreview] = useState<BOMCostBreakdown | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Load options on open
  useEffect(() => {
    if (!open) return;
    (async () => {
      // Day 18/05/2026 (CEO Pattern A): NVL trong BOM có thể là cả SKU
      // (vd "Cà phê rang 1kg" — bán nội bộ ở kho tổng, làm NVL ở quán).
      // → Material options = tất cả SP (NVL + SKU), trừ chính SKU đầu ra.
      const [skus, all] = await Promise.all([
        getProducts({
          page: 0,
          pageSize: 200,
          filters: { productType: "sku" },
        }),
        getProducts({
          page: 0,
          pageSize: 1000,
          filters: {}, // tất cả SP
        }),
      ]);
      setSkuOptions(skus.data);
      setNvlOptions(all.data);
    })();
  }, [open]);

  // Load BOM (edit mode)
  useEffect(() => {
    if (!open) return;
    if (!bomId) {
      // Reset for create mode
      setProductId(initialProductId ?? "");
      setBranchId(null);
      setName("");
      setBatchSize("1");
      setYieldQty("1");
      setYieldUnit("kg");
      setNote("");
      setItems([]);
      setCostPreview(null);
      setErrors({});
      return;
    }
    (async () => {
      const bom = await getBOMById(bomId);
      setProductId(bom.productId);
      setBranchId(bom.branchId ?? null);
      setName(bom.name);
      setBatchSize(String(bom.batchSize));
      setYieldQty(String(bom.yieldQty));
      setYieldUnit(bom.yieldUnit);
      setNote(bom.note ?? "");
      setItems(
        (bom.items ?? []).map((it) => ({
          materialId: it.materialId,
          materialName: it.materialName ?? "",
          materialCode: it.materialCode ?? "",
          costPrice: it.materialCostPrice ?? 0,
          quantity: String(it.quantity),
          unit: it.unit,
          wastePercent: String(it.wastePercent ?? 0),
        }))
      );
    })();
  }, [open, bomId, initialProductId]);

  // Compute live preview cost (client-side)
  const previewTotal = items.reduce((sum, it) => {
    const qty = Number(it.quantity) || 0;
    const waste = Number(it.wastePercent) || 0;
    const effectiveQty = qty * (1 + waste / 100);
    return sum + effectiveQty * (it.costPrice ?? 0);
  }, 0);

  const addMaterial = useCallback(() => {
    if (!pickerMaterialId) return;
    const mat = nvlOptions.find((p) => p.id === pickerMaterialId);
    if (!mat) return;
    if (items.some((it) => it.materialId === mat.id)) {
      toast({
        title: "NVL đã có trong công thức",
        variant: "warning",
      });
      return;
    }
    setItems((prev) => [
      ...prev,
      {
        materialId: mat.id,
        materialName: mat.name,
        materialCode: mat.code,
        costPrice: mat.costPrice,
        quantity: "1",
        unit: mat.stockUnit ?? mat.unit ?? "",
        wastePercent: "0",
      },
    ]);
    setPickerMaterialId("");
    setPickerOpen(false);
  }, [pickerMaterialId, nvlOptions, items, toast]);

  function updateItem(idx: number, patch: Partial<MaterialLine>) {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  }

  function removeItem(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
  }

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!productId) e.productId = "Chọn SKU đầu ra";
    if (!name.trim()) e.name = "Nhập tên công thức";
    if (items.length === 0) e.items = "Thêm ít nhất 1 NVL";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    try {
      const created = await createBOM({
        productId,
        branchId, // null = global, có giá trị = riêng quán
        name,
        batchSize: Number(batchSize) || 1,
        yieldQty: Number(yieldQty) || 1,
        yieldUnit,
        note: note || undefined,
        items: items.map((it, idx) => ({
          materialId: it.materialId,
          quantity: Number(it.quantity) || 0,
          unit: it.unit,
          wastePercent: Number(it.wastePercent) || 0,
          sortOrder: idx,
        })),
      });

      // Optionally fetch official cost from RPC
      try {
        const cost = await calculateBOMCost(created.id);
        setCostPreview(cost);
      } catch {
        // ignore — preview will fall back to client estimate
      }

      toast({
        title: "Lưu công thức thành công",
        description: `BOM "${name}" đã được tạo`,
        variant: "success",
      });
      onSuccess?.();
      onOpenChange(false);
    } catch (err) {
      toast({
        title: "Lỗi lưu công thức",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  const selectedSku = skuOptions.find((p) => p.id === productId);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-2xl lg:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{bomId ? "Sửa công thức (BOM)" : "Tạo công thức (BOM)"}</DialogTitle>
          <DialogDescription>
            Định nghĩa NVL cần thiết để sản xuất 1 batch SKU. Giá vốn được tính tự động.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Output SKU + Name */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                SKU đầu ra <span className="text-destructive">*</span>
              </label>
              <Select
                value={productId || null}
                onValueChange={(v) => setProductId(v ?? "")}
                disabled={!!initialProductId || !!bomId}
                items={skuOptions.map((p) => ({
                  value: p.id,
                  label: `${p.code} — ${p.name}`,
                }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Chọn SKU">
                    {(v) => {
                      const match = skuOptions.find((p) => p.id === v);
                      return match ? `${match.code} — ${match.name}` : "Chọn SKU";
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {skuOptions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.code} — {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.productId && (
                <p className="text-xs text-destructive">{errors.productId}</p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">
                Tên công thức <span className="text-destructive">*</span>
              </label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="VD: Robusta Rang Xay 1kg — v1"
              />
              {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
            </div>
          </div>

          {/* Day 18/05/2026 (CEO): Áp dụng cho chi nhánh */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Áp dụng cho chi nhánh</label>
            <Select
              value={branchId ?? "__all__"}
              onValueChange={(v) => setBranchId(v === "__all__" ? null : v)}
              items={[
                { value: "__all__", label: "Áp dụng tất cả chi nhánh (mặc định)" },
                ...branches.map((b) => ({
                  value: b.id,
                  label: `${b.name}${b.branchType ? ` (${b.branchType})` : ""}`,
                })),
              ]}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(v) => {
                    if (!v || v === "__all__") return "Áp dụng tất cả chi nhánh (mặc định)";
                    const match = branches.find((b) => b.id === v);
                    return match ? match.name : v;
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">
                  Áp dụng tất cả chi nhánh (mặc định)
                </SelectItem>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              <Icon name="info" size={12} className="inline-block mr-1 align-text-bottom" />
              {branchId
                ? "BOM này CHỈ áp dụng cho chi nhánh được chọn (override BOM global)."
                : "BOM global — mọi chi nhánh dùng chung công thức này. Có thể tạo BOM riêng cho từng quán sau."}
            </p>
          </div>

          {/* Batch / Yield */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Batch size</label>
              <Input
                type="number"
                value={batchSize}
                onChange={(e) => setBatchSize(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Sản lượng/batch</label>
              <Input
                type="number"
                value={yieldQty}
                onChange={(e) => setYieldQty(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">ĐVT sản lượng</label>
              <Input
                value={yieldUnit}
                onChange={(e) => setYieldUnit(e.target.value)}
                placeholder="kg, gói..."
              />
            </div>
          </div>

          {/* Materials Table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-medium">Nguyên vật liệu</h3>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setPickerOpen(true)}
                type="button"
              >
                <Icon name="add" size={14} className="mr-1" />
                Thêm NVL
              </Button>
            </div>

            {items.length === 0 && (
              <div className="text-sm text-muted-foreground text-center py-6 border-2 border-dashed rounded-lg">
                Chưa có NVL — nhấn &quot;Thêm NVL&quot; để bắt đầu
              </div>
            )}
            {errors.items && <p className="text-xs text-destructive">{errors.items}</p>}

            {items.length > 0 && (
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/30">
                    <tr>
                      <th className="text-left p-2 font-medium">NVL</th>
                      <th className="text-right p-2 font-medium w-24">Số lượng</th>
                      <th className="text-left p-2 font-medium w-20">ĐVT</th>
                      <th className="text-right p-2 font-medium w-20">Hao hụt %</th>
                      <th className="text-right p-2 font-medium w-32">Thành tiền</th>
                      <th className="w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it, idx) => {
                      const qty = Number(it.quantity) || 0;
                      const waste = Number(it.wastePercent) || 0;
                      const lineCost = qty * (1 + waste / 100) * (it.costPrice ?? 0);
                      return (
                        <tr key={`${it.materialId}-${idx}`} className="border-t">
                          <td className="p-2">
                            <div className="font-medium">{it.materialName}</div>
                            <div className="text-xs text-muted-foreground">
                              {it.materialCode} · {formatCurrency(it.costPrice)}/{it.unit}
                            </div>
                          </td>
                          <td className="p-2">
                            <Input
                              type="number"
                              value={it.quantity}
                              onChange={(e) =>
                                updateItem(idx, { quantity: e.target.value })
                              }
                              className="h-8 text-right"
                            />
                          </td>
                          <td className="p-2">
                            <Input
                              value={it.unit}
                              onChange={(e) => updateItem(idx, { unit: e.target.value })}
                              className="h-8"
                            />
                          </td>
                          <td className="p-2">
                            <Input
                              type="number"
                              value={it.wastePercent}
                              onChange={(e) =>
                                updateItem(idx, { wastePercent: e.target.value })
                              }
                              className="h-8 text-right"
                            />
                          </td>
                          <td className="p-2 text-right font-medium">
                            {formatCurrency(lineCost)}
                          </td>
                          <td className="p-2">
                            <button
                              type="button"
                              onClick={() => removeItem(idx)}
                              className="text-destructive hover:bg-destructive/10 rounded p-1"
                            >
                              <Icon name="delete" size={14} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-muted/30 border-t">
                    <tr>
                      <td colSpan={4} className="p-2 text-right font-medium">
                        Tổng giá vốn / batch:
                      </td>
                      <td className="p-2 text-right font-semibold text-primary">
                        {formatCurrency(previewTotal)}
                      </td>
                      <td />
                    </tr>
                    {Number(yieldQty) > 0 && (
                      <tr>
                        <td colSpan={4} className="p-2 text-right text-xs text-muted-foreground">
                          Giá vốn / {yieldUnit}:
                        </td>
                        <td className="p-2 text-right text-xs">
                          {formatCurrency(previewTotal / Number(yieldQty))}
                        </td>
                        <td />
                      </tr>
                    )}
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {/* Note */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Ghi chú</label>
            <textarea
              className="flex min-h-[60px] w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Quy trình sản xuất, lưu ý..."
              rows={2}
            />
          </div>

          {selectedSku && (
            <div className="text-xs text-muted-foreground bg-muted/30 rounded p-2">
              Sản xuất: <strong>{selectedSku.name}</strong> ({selectedSku.code})
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Icon name="progress_activity" size={16} className="mr-2 animate-spin" />}
            Lưu công thức
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Material picker mini-dialog */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Chọn nguyên vật liệu</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Select
              value={pickerMaterialId || null}
              onValueChange={(v) => setPickerMaterialId(v ?? "")}
              items={nvlOptions.map((p) => ({
                value: p.id,
                label: `${p.code} — ${p.name}`,
              }))}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Chọn NVL từ danh mục...">
                  {(v) => {
                    const match = nvlOptions.find((p) => p.id === v);
                    return match ? `${match.code} — ${match.name}` : "Chọn NVL từ danh mục...";
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {nvlOptions.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.code} — {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPickerOpen(false)}>
              Hủy
            </Button>
            <Button onClick={addMaterial} disabled={!pickerMaterialId}>
              Thêm
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
