"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
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
  updateBOM,
  getBOMById,
  getProducts,
  calculateBOMCost,
  getUOMConversions,
  listBOMModifierOptionQuantities,
  saveBOMModifierOptionQuantities,
} from "@/lib/services";
import {
  listModifierGroups,
  listModifierOptions,
  type ModifierGroup,
  type ModifierOption,
} from "@/lib/services/supabase/modifier-groups";
import { formatCurrency } from "@/lib/format";
import {
  getDirectConvertibleUnits,
  getDirectConversionFactor,
  getRecipeStockQuantity,
} from "@/lib/format-uom";
import type { Product, BOMCostBreakdown, UOMConversion } from "@/lib/types";
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
  stockUnit: string;
  conversions: UOMConversion[];
  wastePercent: string;
  modifierScaleTarget?: string | null;
}

function formatRecipeQuantity(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 4,
  }).format(value);
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
  const [modifierGroups, setModifierGroups] = useState<ModifierGroup[]>([]);
  const [modifierOptionsByGroup, setModifierOptionsByGroup] = useState<Record<string, ModifierOption[]>>({});
  const [exactQuantityByKey, setExactQuantityByKey] = useState<Record<string, string>>({});
  const [exactRecipeEnabled, setExactRecipeEnabled] = useState(false);
  const [exactRecipeReady, setExactRecipeReady] = useState(false);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerMaterialId, setPickerMaterialId] = useState("");
  const [pickerSearch, setPickerSearch] = useState("");

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
      setModifierGroups([]);
      setModifierOptionsByGroup({});
      setExactQuantityByKey({});
      setExactRecipeEnabled(false);
      setExactRecipeReady(false);
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
      const loadedItems = await Promise.all(
        (bom.items ?? []).map(async (it) => ({
          materialId: it.materialId,
          materialName: it.materialName ?? "",
          materialCode: it.materialCode ?? "",
          costPrice: it.materialCostPrice ?? 0,
          quantity: String(it.inputQuantity ?? it.quantity),
          unit: it.inputUnit ?? it.unit,
          stockUnit: it.unit,
          conversions: await getUOMConversions(it.materialId).catch(() => []),
          wastePercent: String(it.wastePercent ?? 0),
          modifierScaleTarget: it.modifierScaleTarget ?? null,
        }))
      );
      setItems(loadedItems);

      const targetGroupIds = [...new Set(
        (bom.items ?? [])
          .map((item) => item.modifierScaleTarget)
          .filter((id): id is string => Boolean(id)),
      )];
      if (targetGroupIds.length === 0) {
        setModifierGroups([]);
        setModifierOptionsByGroup({});
        setExactQuantityByKey({});
        setExactRecipeEnabled(false);
        setExactRecipeReady(false);
        return;
      }

      try {
        const groups = await listModifierGroups();
        const relevantGroups = groups.filter((group) => targetGroupIds.includes(group.id));
        const optionsEntries = await Promise.all(
          relevantGroups.map(async (group) => [group.id, await listModifierOptions(group.id)] as const),
        );
        setModifierGroups(relevantGroups);
        setModifierOptionsByGroup(Object.fromEntries(optionsEntries));

        // 00350 may not have been installed on an older environment yet. The
        // formula remains editable; only the exact-quantity panel stays off.
        const saved = await listBOMModifierOptionQuantities(bomId);
        const nextDraft: Record<string, string> = {};
        for (const row of saved) {
          nextDraft[`${row.materialId}:${row.modifierOptionId}`] = String(row.quantity);
        }
        setExactQuantityByKey(nextDraft);
        setExactRecipeEnabled(saved.length > 0);
        setExactRecipeReady(true);
      } catch (err) {
        console.warn("Exact FnB recipe quantities are unavailable:", err);
        setExactRecipeReady(false);
      }
    })();
  }, [open, bomId, initialProductId]);

  // A drink recipe should start as "1 Ly", not the legacy "1 kg" default.
  // Preserve an operator's explicit edit: this only reacts to the selected SKU.
  useEffect(() => {
    if (!open || bomId || !productId) return;
    const selectedSkuForYield = skuOptions.find((sku) => sku.id === productId);
    if (selectedSkuForYield?.unit) {
      setYieldUnit(selectedSkuForYield.unit);
    }
  }, [open, bomId, productId, skuOptions]);

  // Compute live preview cost (client-side)
  const previewTotal = items.reduce((sum, it) => {
    const qty = Number(it.quantity) || 0;
    const factor = getDirectConversionFactor(it.stockUnit, it.unit, it.conversions) ?? 0;
    const waste = Number(it.wastePercent) || 0;
    const effectiveQty = qty * factor * (1 + waste / 100);
    return sum + effectiveQty * (it.costPrice ?? 0);
  }, 0);

  const addMaterial = useCallback(async () => {
    if (!pickerMaterialId) return;
    const mat = nvlOptions.find((p) => p.id === pickerMaterialId);
    if (!mat) return;
    if (items.some((it) => it.materialId === mat.id)) {
      toast({
        title: "Thành phần đã có trong công thức",
        variant: "warning",
      });
      return;
    }
    const conversions = await getUOMConversions(mat.id).catch(() => []);
    setItems((prev) => [
      ...prev,
      {
        materialId: mat.id,
        materialName: mat.name,
        materialCode: mat.code,
        costPrice: mat.costPrice,
        quantity: "1",
        unit: mat.stockUnit ?? mat.unit ?? "",
        stockUnit: mat.stockUnit ?? mat.unit ?? "",
        conversions,
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
    if (items.length === 0) e.items = "Thêm ít nhất 1 thành phần";
    const invalidQuantity = items.find((item) => {
      const quantity = Number(item.quantity);
      const wastePercent = Number(item.wastePercent);
      return !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(wastePercent) || wastePercent < 0;
    });
    if (invalidQuantity) {
      e.items = `Nhập định lượng lớn hơn 0 và hao hụt từ 0 trở lên cho ${invalidQuantity.materialName}.`;
    }
    const missingConversion = items.find((item) =>
      getDirectConversionFactor(item.stockUnit, item.unit, item.conversions) == null,
    );
    if (missingConversion) {
      e.items = `${missingConversion.materialCode || missingConversion.materialName} chưa có quy đổi từ ${missingConversion.unit} sang đơn vị tồn ${missingConversion.stockUnit}.`;
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  /**
   * Prepares the complete replacement set before saving the BOM itself. That
   * prevents a basic BOM edit from being persisted when the exact recipe panel
   * is enabled but a cashier choice still has no measured quantity.
   */
  function buildExactQuantityRows() {
    if (!bomId || !exactRecipeReady) return null;

    const targetRows = items.filter((item) => item.modifierScaleTarget);
    if (!exactRecipeEnabled || targetRows.length === 0) return [];

    const rows = targetRows.flatMap((item) => {
      const options = modifierOptionsByGroup[item.modifierScaleTarget ?? ""] ?? [];
      if (options.length === 0) {
        throw new Error(`Nhóm lựa chọn của ${item.materialName} chưa có lựa chọn đang bật.`);
      }
      return options.map((option) => {
        const key = `${item.materialId}:${option.id}`;
        return {
          materialId: item.materialId,
          modifierOptionId: option.id,
          value: exactQuantityByKey[key]?.trim() ?? "",
        };
      });
    });

    const invalid = rows.find((row) => {
      const quantity = Number(row.value);
      return row.value === "" || !Number.isFinite(quantity) || quantity < 0;
    });
    if (invalid) {
      throw new Error(
        "Đã bật định lượng riêng thì phải nhập số hợp lệ cho mọi lựa chọn của từng nguyên liệu. Nhập 0 cho lựa chọn không tiêu hao.",
      );
    }

    return rows.map((row) => ({
      materialId: row.materialId,
      modifierOptionId: row.modifierOptionId,
      quantity: Number(row.value),
    }));
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    const isEdit = Boolean(bomId);
    try {
      // Validate the whole exact-recipe replacement before the base BOM is
      // touched. The database then replaces mappings atomically in one RPC.
      const exactQuantityRows = isEdit ? buildExactQuantityRows() : null;
      const itemsPayload = items.map((it, idx) => ({
        materialId: it.materialId,
        quantity: Number(it.quantity) || 0,
        unit: it.unit,
        wastePercent: Number(it.wastePercent) || 0,
        sortOrder: idx,
      }));

      let savedBomId: string;
      if (isEdit && bomId) {
        // SỬA: update tại chỗ (KHÔNG insert mới — sẽ đụng unique
        // idx_bom_product_branch_unique vì BOM cũ vẫn active cùng SP+chi nhánh).
        await updateBOM(bomId, {
          name,
          branchId, // null = global, có giá trị = riêng quán
          batchSize: Number(batchSize) || 1,
          yieldQty: Number(yieldQty) || 1,
          yieldUnit,
          note: note || undefined,
          items: itemsPayload, // replace bom_items (bảo toàn modifier_scale_target theo material_id)
        });
        savedBomId = bomId;
      } else {
        const created = await createBOM({
          productId,
          branchId, // null = global, có giá trị = riêng quán
          name,
          batchSize: Number(batchSize) || 1,
          yieldQty: Number(yieldQty) || 1,
          yieldUnit,
          note: note || undefined,
          items: itemsPayload,
        });
        savedBomId = created.id;
      }

      if (isEdit && bomId && exactQuantityRows !== null) {
        // Empty is an explicit atomic replacement: it removes mappings no
        // longer used by this BOM and returns it to the legacy model.
        await saveBOMModifierOptionQuantities(bomId, exactQuantityRows);
      }

      // Optionally fetch official cost from RPC
      try {
        const cost = await calculateBOMCost(savedBomId);
        setCostPreview(cost);
      } catch {
        // ignore — preview will fall back to client estimate
      }

      toast({
        title: isEdit ? "Cập nhật công thức thành công" : "Lưu công thức thành công",
        description: `BOM "${name}" đã được ${isEdit ? "cập nhật" : "tạo"}`,
        variant: "success",
      });
      onSuccess?.();
      onOpenChange(false);
    } catch (err) {
      toast({
        title: isEdit ? "Lỗi cập nhật công thức" : "Lỗi lưu công thức",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  const selectedSku = skuOptions.find((p) => p.id === productId);
  const exactTargets = items.filter((item) => item.modifierScaleTarget);
  const pickerOptions = useMemo(() => {
    const query = pickerSearch.trim().toLocaleLowerCase("vi");
    return nvlOptions
      .filter((product) => product.id !== productId)
      .filter((product) => !items.some((item) => item.materialId === product.id))
      .filter(
        (product) =>
          !query ||
          product.code.toLocaleLowerCase("vi").includes(query) ||
          product.name.toLocaleLowerCase("vi").includes(query),
      );
  }, [items, nvlOptions, pickerSearch, productId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="md:max-w-2xl lg:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{bomId ? "Sửa công thức sản xuất (BOM)" : "Tạo công thức sản xuất (BOM)"}</DialogTitle>
          <DialogDescription>
            Định nghĩa thành phần trừ kho khi bán/sản xuất 1 đơn vị SKU — thành
            phần có thể là NVL hoặc SKU Retail (vd quán F&amp;B pha chế từ sữa lon
            Retail). Giá vốn được tính tự động.
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
                Thêm thành phần
              </Button>
            </div>

            {items.length === 0 && (
              <div className="text-sm text-muted-foreground text-center py-6 border-2 border-dashed rounded-lg">
                Chưa có thành phần — nhấn &quot;Thêm thành phần&quot; để bắt đầu
              </div>
            )}
            {errors.items && <p className="text-xs text-destructive">{errors.items}</p>}

            {items.length > 0 && (
              <div className="border rounded-lg overflow-hidden">
                <div className="border-b bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                  Nhập theo đơn vị pha chế. Hệ thống tự quy đổi sang đơn vị tồn của SKU retail khi tính giá vốn, trừ kho và hoàn kho.
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-muted/30">
                    <tr>
                      <th className="text-left p-2 font-medium">Thành phần</th>
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
                      const factor = getDirectConversionFactor(it.stockUnit, it.unit, it.conversions) ?? 0;
                      const lineCost = qty * factor * (1 + waste / 100) * (it.costPrice ?? 0);
                      const stockQuantity = getRecipeStockQuantity(
                        qty,
                        it.stockUnit,
                        it.unit,
                        it.conversions,
                        waste,
                      );
                      const isConverted = it.stockUnit.trim().toLocaleLowerCase("vi") !== it.unit.trim().toLocaleLowerCase("vi");
                      return (
                        <tr key={`${it.materialId}-${idx}`} className="border-t">
                          <td className="p-2">
                            <div className="font-medium">{it.materialName}</div>
                            <div className="text-xs text-muted-foreground">
                              {it.materialCode} · {formatCurrency(it.costPrice)}/{it.stockUnit}
                            </div>
                            {isConverted && stockQuantity != null && (
                              <div className="mt-1 text-xs text-primary">
                                Pha chế {formatRecipeQuantity(qty)} {it.unit} · Trừ tồn {formatRecipeQuantity(stockQuantity)} {it.stockUnit} / 1 {yieldUnit}
                              </div>
                            )}
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
                            <Select
                              value={it.unit}
                              onValueChange={(value) => {
                                if (value) updateItem(idx, { unit: value });
                              }}
                            >
                              <SelectTrigger className="h-8 min-w-[82px] text-xs">
                                <SelectValue>{it.unit}</SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                {getDirectConvertibleUnits(it.stockUnit, it.conversions).map((unit) => (
                                  <SelectItem key={unit} value={unit}>{unit}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
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
          {bomId && exactTargets.length > 0 && (
            <section className="space-y-3 border rounded-lg p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium">Định lượng riêng theo lựa chọn FnB</h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Dùng số thực tế của từng món, không suy từ phần trăm chung. Bật mục này thì cần nhập đủ mọi lựa chọn; nhập 0 khi lựa chọn đó không dùng nguyên liệu.
                  </p>
                </div>
                <label className="flex shrink-0 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={exactRecipeEnabled}
                    disabled={!exactRecipeReady}
                    onChange={(event) => setExactRecipeEnabled(event.target.checked)}
                  />
                  Dùng định lượng riêng
                </label>
              </div>

              {!exactRecipeReady ? (
                <p className="rounded-md border border-status-warning/30 bg-status-warning/5 px-3 py-2 text-xs text-status-warning">
                  Chưa tải được lớp định lượng riêng. Công thức cơ bản vẫn không bị thay đổi; chạy migration 00350 rồi tải lại trang để cấu hình phần này.
                </p>
              ) : (
                exactTargets.map((item) => {
                  const group = modifierGroups.find((candidate) => candidate.id === item.modifierScaleTarget);
                  const options = modifierOptionsByGroup[item.modifierScaleTarget ?? ""] ?? [];
                  return (
                    <fieldset key={`${item.materialId}:${item.modifierScaleTarget}`} className="rounded-md border p-3">
                      <legend className="px-1 text-sm font-medium">
                        {item.materialName} - {group?.name ?? "Nhóm lựa chọn"}
                      </legend>
                      {options.length === 0 ? (
                        <p className="text-xs text-status-warning">Nhóm này chưa có lựa chọn đang bật.</p>
                      ) : (
                        <div className="grid gap-2 sm:grid-cols-2">
                          {options.map((option) => {
                            const key = `${item.materialId}:${option.id}`;
                            return (
                              <label key={option.id} className="grid grid-cols-[minmax(0,1fr)_7rem] items-center gap-2 text-sm">
                                <span className="truncate">{option.label}</span>
                                <Input
                                  type="number"
                                  min="0"
                                  step="0.0001"
                                  inputMode="decimal"
                                  disabled={!exactRecipeEnabled}
                                  value={exactQuantityByKey[key] ?? ""}
                                  onChange={(event) => setExactQuantityByKey((previous) => ({
                                    ...previous,
                                    [key]: event.target.value,
                                  }))}
                                  placeholder={item.unit}
                                  aria-label={`${item.materialName} - ${option.label}`}
                                />
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </fieldset>
                  );
                })
              )}
            </section>
          )}

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
      <Dialog
        open={pickerOpen}
        onOpenChange={(nextOpen) => {
          setPickerOpen(nextOpen);
          if (!nextOpen) {
            setPickerSearch("");
            setPickerMaterialId("");
          }
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Chọn thành phần (NVL hoặc SKU)</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <div className="relative">
              <Icon
                name="search"
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                autoFocus
                value={pickerSearch}
                onChange={(event) => setPickerSearch(event.target.value)}
                placeholder="Nhập mã hoặc tên thành phần..."
                className="pl-9"
              />
            </div>
            <div className="max-h-72 overflow-y-auto rounded-md border">
              {pickerOptions.length === 0 ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  Không tìm thấy thành phần phù hợp.
                </p>
              ) : (
                pickerOptions.map((product) => {
                  const selected = pickerMaterialId === product.id;
                  return (
                    <button
                      key={product.id}
                      type="button"
                      onClick={() => setPickerMaterialId(product.id)}
                      className={`flex w-full items-center gap-3 border-b px-3 py-2 text-left last:border-b-0 ${
                        selected ? "bg-primary/10" : "hover:bg-muted/50"
                      }`}
                    >
                      <Icon
                        name={selected ? "radio_button_checked" : "radio_button_unchecked"}
                        size={18}
                        className={selected ? "text-primary" : "text-muted-foreground"}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{product.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {product.code} · {product.stockUnit || product.unit || "Chưa có ĐVT"}
                        </span>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
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
