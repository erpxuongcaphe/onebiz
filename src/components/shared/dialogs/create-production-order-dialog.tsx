"use client";

import { DateTimeInput } from "@/components/shared/date-time-input";
import { validateProductionDateTimes } from "@/lib/production-date-time";
import { ExpiryDateInput } from "@/components/shared/expiry-date-input";
import { useEffect, useMemo, useRef, useState } from "react";
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
import { useBranchFilter, useToast } from "@/lib/contexts";
import {
  getAllBOMs,
  getBOMById,
  getBOMsByProduct,
  getBranches,
  getProductById,
  getUOMConversionsByProductIds,
  createProductionOrder,
  completeProductionAtomic,
  checkMaterialsAvailability,
} from "@/lib/services";
import { getFnbProductionStockHealth } from "@/lib/services/supabase/fnb-branch-cost";
import { getFnbSupplyBranchScope } from "@/lib/services/supabase/fnb-supply-catalog";
import { formatDateInputValue, formatNumber } from "@/lib/format";
import type { BOM, UOMConversion } from "@/lib/types";
import type { BranchDetail } from "@/lib/services/supabase/branches";
import { Icon } from "@/components/ui/icon";
import { filterProductionOutputBoms } from "@/lib/production-output-scope";
import { formatOperationalQuantity, operationalFactor, preferredWeighingUnit, quantityToStock, stockToInput, type OperationalUnitEntry } from "@/lib/operational-uom";
import { StockWithConversion } from "@/components/shared/stock-with-conversion";
import { OperationalQuantityInput } from "@/components/shared/operational-quantity-input";

interface CreateProductionOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

interface MaterialNeed {
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  perBatch: number;
  needed: number;
  available: number;
  shortage: boolean;
  costMismatch: boolean;
}

export function CreateProductionOrderDialog({
  open,
  onOpenChange,
  onSuccess,
}: CreateProductionOrderDialogProps) {
  const { toast } = useToast();
  const { activeBranchId } = useBranchFilter();

  const [boms, setBoms] = useState<BOM[]>([]);
  const [branches, setBranches] = useState<BranchDetail[]>([]);

  // CEO 25/05/2026: Đổi UX — primary picker là Sản phẩm cần SX, BOM tự
  // lookup theo SP. Nếu SP có nhiều BOM thì show sub-picker (rare case).
  const [productId, setProductId] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [showProductDropdown, setShowProductDropdown] = useState(false);
  const [bomsOfProduct, setBomsOfProduct] = useState<BOM[]>([]);
  const [bomId, setBomId] = useState("");
  const [branchId, setBranchId] = useState("");
  const [plannedQty, setPlannedQty] = useState("1");
  const [batchCount, setBatchCount] = useState("1");
  const [weighedQty, setWeighedQty] = useState("");
  const [tareQty, setTareQty] = useState("0");
  const [materialActuals, setMaterialActuals] = useState<Record<string, string>>({});
  const [materialEntries,setMaterialEntries] = useState<Record<string,OperationalUnitEntry>>({});
  const [plannedStart, setPlannedStart] = useState("");
  const [plannedEnd, setPlannedEnd] = useState("");
  const [notes, setNotes] = useState("");
  // CEO 06/07/2026: BỎ HẲN bước lên kế hoạch — tạo lệnh = trừ NVL + nhập thành
  // phẩm vào kho LUÔN (1 nút). Mẻ làm xong ngoài đời mới bấm, khỏi 2 lần.
  const [lotNumber, setLotNumber] = useState("");
  const [manufacturedDate, setManufacturedDate] = useState("");
  const [expiryDate, setExpiryDate] = useState("");

  const [selectedBom, setSelectedBom] = useState<BOM | null>(null);
  const [outputUnit, setOutputUnit] = useState("");
  const [conversionMap, setConversionMap] = useState<Map<string, UOMConversion[]>>(new Map());
  const [materials, setMaterials] = useState<MaterialNeed[]>([]);
  const [computing, setComputing] = useState(false);
  const [checkedMaterialKey, setCheckedMaterialKey] = useState("");

  const [saving, setSaving] = useState(false);
  const submittingRef = useRef(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const selectedBranchMode = branches.find((branch) => branch.id === branchId)?.cascadeMode;

  // Load options
  useEffect(() => {
    if (!open) return;
    (async () => {
      try {
        const [bomList, brList] = await Promise.all([getAllBOMs({ activeProductsOnly: true }), getBranches()]);
        setBoms(bomList);
        setBranches(brList);
        setBranchId(
          activeBranchId && brList.some((branch) => branch.id === activeBranchId)
            ? activeBranchId
            : "",
        );
      } catch (err) {
        toast({
          title: "Lỗi tải dữ liệu",
          description: err instanceof Error ? err.message : "Vui lòng thử lại",
          variant: "error",
        });
      }
    })();
  }, [open, activeBranchId, toast]);

  // Reset on open
  useEffect(() => {
    if (open) {
      setProductId("");
      setProductSearch("");
      setShowProductDropdown(false);
      setBomsOfProduct([]);
      setBomId("");
      setBranchId("");
      setPlannedQty("1"); setBatchCount("1"); setWeighedQty(""); setTareQty("0"); setMaterialActuals({}); setMaterialEntries({});
      setPlannedStart("");
      setPlannedEnd("");
      setNotes("");
      setSelectedBom(null);
      setMaterials([]);
      setCheckedMaterialKey("");
      setErrors({});
      setLotNumber("");
      setManufacturedDate(formatDateInputValue());
      setExpiryDate("");
    }
  }, [open]);

  // Khi user chọn SP → fetch BOMs của SP đó. Auto-select BOM đầu tiên
  // nếu chỉ có 1 (common case). Nếu nhiều BOM → show sub-picker.
  useEffect(() => {
    if (!productId) {
      setBomsOfProduct([]);
      setBomId("");
      return;
    }
    let cancelled = false;
    setBomsOfProduct([]);
    setBomId("");
    (async () => {
      try {
        const list = await getBOMsByProduct(productId);
        if (cancelled) return;
        const actives = filterProductionOutputBoms(list, branchId, selectedBranchMode);
        setBomsOfProduct(actives);
        if (actives.length === 1) {
          setBomId(actives[0].id);
        } else if (actives.length === 0) {
          setBomId("");
          toast({
            title: "Sản phẩm chưa có công thức BOM",
            description:
              "Tạo BOM trong /hang-hoa/cong-thuc trước khi lên lệnh SX.",
            variant: "warning",
          });
        } else {
          // Nhiều BOM — để user chọn
          setBomId("");
        }
      } catch (err) {
        if (cancelled) return;
        console.error("[CreateProductionOrder] load BOMs by product", err);
        setBomsOfProduct([]);
        setBomId("");
      }
    })();
    return () => { cancelled = true; };
  }, [productId, branchId, selectedBranchMode, toast]);

  // Danh sách SP unique từ boms list (sản phẩm có ít nhất 1 BOM active).
  const productOptions = useMemo(() => {
    const map = new Map<string, { id: string; code: string; name: string }>();
    for (const b of filterProductionOutputBoms(boms, branchId, selectedBranchMode)) {
      if (!b.productId) continue;
      if (b.isActive === false) continue;
      if (!map.has(b.productId)) {
        map.set(b.productId, {
          id: b.productId,
          code: b.productCode ?? "",
          name: b.productName ?? "",
        });
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      (a.code || "").localeCompare(b.code || ""),
    );
  }, [boms, branchId, selectedBranchMode]);

  useEffect(() => {
    if (productId && !productOptions.some((product) => product.id === productId)) {
      setProductId("");
      setBomId("");
      setSelectedBom(null);
      setMaterials([]);
      setCheckedMaterialKey("");
    }
  }, [productId, productOptions]);

  // Filter SP theo search query (CEO 25/05/2026): mã hoặc tên SP
  const filteredProductOptions = useMemo(() => {
    const q = productSearch.trim().toLowerCase();
    if (!q) return productOptions;
    return productOptions.filter(
      (p) =>
        p.code.toLowerCase().includes(q) ||
        p.name.toLowerCase().includes(q),
    );
  }, [productOptions, productSearch]);

  const selectedProductLabel = useMemo(() => {
    if (!productId) return "";
    const p = productOptions.find((x) => x.id === productId);
    return p ? `${p.code} — ${p.name}` : "";
  }, [productId, productOptions]);

  // When BOM or qty changes → recompute material needs
  useEffect(() => { setMaterialActuals({}); setMaterialEntries({}); setWeighedQty(""); setTareQty("0"); }, [bomId]);
  useEffect(() => {
    let cancelled = false;
    setCheckedMaterialKey("");
    if (!bomId) {
      setSelectedBom(null);
      setOutputUnit("");
      setMaterials([]);
      setComputing(false);
      return;
    }
    setComputing(true);
    (async () => {
      try {
        const bom = await getBOMById(bomId);

        const qty = Number(plannedQty) || 0;
        const batches = selectedBranchMode === "outlet" ? Number(batchCount) || 0 : bom.yieldQty > 0 ? qty / bom.yieldQty : 0;

        const baseNeeds = (bom.items ?? []).map((item) => {
          const perBatch = item.quantity * (1 + (item.wastePercent ?? 0) / 100);
          return {
            productId: item.materialId,
            productCode: item.materialCode ?? "",
            productName: item.materialName ?? "",
            unit: item.unit,
            perBatch,
            needed: materialActuals[item.materialId] !== undefined ? Number(materialActuals[item.materialId]) : perBatch * batches,
          };
        });

        // CEO 06/07: tồn NVL phải đo tại CHI NHÁNH SX (branch_stock) — trước
        // đây so products.stock toàn công ty nên dialog nói "Đủ" mà RPC hoàn
        // thành vẫn chặn vì kho chi nhánh thiếu. Batch 1 query, hết N+1.
        let needs: MaterialNeed[];
        let resolvedOutputUnit = bom.yieldUnit;
        if (branchId) {
          const [checks, product, units] = await Promise.all([
            checkMaterialsAvailability(
              branchId,
              baseNeeds.map((n) => ({
                productId: n.productId,
                productName: n.productName,
                plannedQty: n.needed,
                unit: n.unit,
              })),
            ),
            getProductById(bom.productId),
            getUOMConversionsByProductIds([bom.productId, ...baseNeeds.map(item => item.productId)]),
          ]);
          if (!product) throw new Error("Không tìm thấy sản phẩm cần sản xuất.");
          if (cancelled) return;
          setConversionMap(units);
          // Completion credits the entered quantity in the product's stock unit,
          // not in a legacy inline BOM's default yield label.
          if (product.isFnbStockItem) {
            resolvedOutputUnit = product.unit?.trim() || product.stockUnit?.trim() || bom.yieldUnit;
          }
          const scope = product.isFnbStockItem
            ? await getFnbSupplyBranchScope(branchId)
            : null;
          const costs = scope?.enforcementEnabled
            ? await getFnbProductionStockHealth(branchId, baseNeeds.map((n) => n.productId))
            : null;
          const availOf = new Map(checks.map((c) => [c.productId, c.available]));
          needs = baseNeeds.map((n) => {
            const available = availOf.get(n.productId) ?? 0;
            const cost = costs?.get(n.productId);
            return {
              ...n,
              available,
              shortage: available < n.needed,
              costMismatch: Boolean(costs && (!cost ||
                Math.abs(cost.costedQuantity - cost.physicalQuantity) > 0.0001 ||
                cost.physicalQuantity + 0.0001 < n.needed ||
                cost.costedQuantity + 0.0001 < n.needed)),
            };
          });
        } else {
          needs = baseNeeds.map((n) => ({
            ...n,
            available: 0,
            shortage: n.needed > 0,
            costMismatch: false,
          }));
        }
        if (cancelled) return;
        setSelectedBom(bom);
        setOutputUnit(resolvedOutputUnit);
        setMaterials(needs);
        setCheckedMaterialKey(JSON.stringify([bomId, plannedQty, branchId, batchCount, materialActuals]));
      } catch (err) {
        if (cancelled) return;
        setSelectedBom(null);
        setMaterials([]);
        toast({
          title: "Lỗi tính NVL",
          description: err instanceof Error ? err.message : "Vui lòng thử lại",
          variant: "error",
        });
      } finally {
        if (!cancelled) setComputing(false);
      }
    })();
    return () => { cancelled = true; };
  }, [bomId, plannedQty, branchId, selectedBranchMode, batchCount, materialActuals, toast]);

  const expectedOutput = selectedBranchMode === "outlet" ? (selectedBom?.yieldQty ?? 0) * Number(batchCount) : Number(plannedQty);
  const outputConversions = conversionMap.get(selectedBom?.productId ?? "") ?? [];
  const actualWeighUnit = preferredWeighingUnit(outputUnit, outputConversions);
  const netWeight = Number(weighedQty) - Number(tareQty);
  const actualOutput = selectedBranchMode === "outlet" ? quantityToStock(netWeight, outputUnit, actualWeighUnit, outputConversions) ?? NaN : Number(plannedQty);
  const hasShortage = materials.some((m) => m.shortage);
  const hasCostMismatch = materials.some((m) => m.costMismatch);
  const materialCheckKey = JSON.stringify([bomId, plannedQty, branchId, batchCount, materialActuals]);
  const canComplete = !computing && selectedBom?.id === bomId &&
    checkedMaterialKey === materialCheckKey && materials.length > 0 &&
    !hasShortage && !hasCostMismatch;

  const dateFieldsRef = useRef<HTMLFieldSetElement>(null);

  function validate(): boolean {
    const invalidDate = dateFieldsRef.current?.querySelector<HTMLInputElement>('input[type="date"]:invalid,input[type="time"]:invalid');
    if (invalidDate) { invalidDate.reportValidity(); return false; }
    const dateError = validateProductionDateTimes({ plannedStart, plannedEnd, manufacturedDate, expiryDate });
    if (dateError) { toast({ title: "Kiểm tra ngày giờ", description: dateError, variant: "warning" }); return false; }
    const e: Record<string, string> = {};
    if (!productId) e.productId = "Chọn sản phẩm cần SX";
    else if (!productOptions.some((product) => product.id === productId)) {
      e.productId = "Mặt hàng không phù hợp với chi nhánh sản xuất";
    }
    if (!bomId) e.bomId = "Sản phẩm chưa có BOM hợp lệ";
    if (!branchId || !branches.some((branch) => branch.id === branchId)) {
      e.branchId = "Chọn chi nhánh";
    }
    if (!Number.isFinite(expectedOutput) || expectedOutput <= 0) e.plannedQty = "Số mẻ / số lượng phải lớn hơn 0";
    if (!Number.isFinite(actualOutput) || actualOutput <= 0 || Number(tareQty) < 0) e.actualOutput = "Nhập khối lượng thực tế lớn hơn khối lượng vỏ hộp";
    if (materials.some(m => !Number.isFinite(m.needed) || m.needed <= 0)) e.materials = "Nguyên liệu thực dùng phải lớn hơn 0";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  // CEO 06/07/2026: tạo lệnh = HOÀN THÀNH LUÔN (bỏ bước lên kế hoạch). Tạo lệnh
  // → trừ NVL + nhập thành phẩm + tạo lô qua RPC nguyên tử 00159, trong 1 phát.
  async function handleSave() {
    if (submittingRef.current) return;
    if (!validate()) return;
    if (!selectedBom || !canComplete) return;
    if (saving) return;

    submittingRef.current = true;
    setSaving(true);
    try {
      const created = await createProductionOrder({
        branchId,
        bomId,
        productId: selectedBom.productId,
        plannedQty: expectedOutput,
        stockUnit: outputUnit,
        plannedStart: plannedStart || undefined,
        plannedEnd: plannedEnd || undefined,
        notes: selectedBranchMode === "outlet" ? `${notes}\nSố mẻ nguyên liệu: ${batchCount}; dự kiến ${expectedOutput} ${outputUnit}; cân cả hộp ${weighedQty} ${actualWeighUnit}; vỏ ${tareQty} ${actualWeighUnit}; thực cân ${netWeight} ${actualWeighUnit}; ghi kho ${actualOutput} ${outputUnit}.`.trim() : notes || undefined,
        materials: materials.map((m) => ({
          productId: m.productId,
          plannedQty: m.needed,
          unit: m.unit,
        })),
      });

      const createdCode = (created as { code?: string })?.code ?? "";
      const createdId = (created as { id: string }).id;
      const today = formatDateInputValue();
      const lot =
        lotNumber.trim() ||
        (createdCode ? `${createdCode}-${today.replace(/-/g, "")}` : undefined);
      try {
        await completeProductionAtomic(
          createdId,
          actualOutput,
          lot,
          manufacturedDate || today,
          expiryDate || undefined,
          selectedBranchMode === "outlet" ? { quantity: netWeight, unit: actualWeighUnit, expectedFactor: operationalFactor(outputUnit, actualWeighUnit, outputConversions)?.toDecimalPlaces(12).toNumber(), materials: materials.map(m=>({productId:m.productId,...(materialEntries[m.productId] ?? {quantity:m.needed,unit:m.unit,expectedFactor:1})})) } : undefined,
        );
        toast({
          title: "Sản xuất hoàn thành",
          description: `${createdCode}: +${formatNumber(actualOutput)} ${outputUnit} ${selectedBom.productName ?? ""} vào kho — NVL đã trừ, lô ${lot ?? "tự sinh"}.`,
          variant: "success",
        });
      } catch (err) {
        // Atomic fail (vd thiếu NVL hoặc thiếu RPC) = không ghi nhận kho từ bước
        // hoàn thành. Lệnh nằm lại danh sách để xử lý điều kiện rồi hoàn thành lại.
        toast({
          title: "Đã tạo lệnh nhưng chưa nhập kho được",
          description: `${createdCode}: lệnh đã tạo, kho chưa ghi nhận trừ NVL/nhập thành phẩm. ${err instanceof Error ? err.message : "Lỗi không rõ"}. Kiểm tra migration/RPC hoặc nhập đủ NVL rồi hoàn thành lại.`,
          variant: "warning",
          duration: 9000,
        });
      }

      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      toast({
        title: "Lỗi tạo lệnh sản xuất",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setSaving(false);
      submittingRef.current = false;
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!submittingRef.current) onOpenChange(next); }}>
      <DialogContent className="md:max-w-3xl lg:max-w-4xl max-h-[90dvh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Sản xuất &amp; nhập kho</DialogTitle>
          <DialogDescription>
            Ghi nhận nguyên liệu đã dùng và thành phẩm thực nhận. Hoàn thành một lần để xuất nguyên liệu và nhập thành phẩm.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 min-w-0 flex-auto overflow-y-auto py-2 pr-1" data-production-scroll-area>
        <fieldset ref={dateFieldsRef} disabled={saving} className="grid min-w-0 gap-4">
          <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {selectedBranchMode === "outlet" ? "Bán thành phẩm cần sản xuất" : "Sản phẩm cần sản xuất"} <span className="text-destructive">*</span>
              </label>
              {/* CEO 25/05/2026: thay Select bằng input search để gõ tìm SP
                  nhanh (mã hoặc tên). Click input → show dropdown filtered. */}
              <div className="relative">
                <Icon
                  name="search"
                  size={16}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  type="text"
                  className="pl-8 pr-8"
                  placeholder="Gõ mã hoặc tên sản phẩm..."
                  value={productId ? selectedProductLabel : productSearch}
                  onChange={(e) => {
                    setProductSearch(e.target.value);
                    setShowProductDropdown(true);
                    if (productId) setProductId(""); // user gõ lại → clear chọn cũ
                  }}
                  onFocus={() => setShowProductDropdown(true)}
                  onBlur={() => {
                    // Delay để onClick item kịp chạy trước onBlur
                    setTimeout(() => setShowProductDropdown(false), 150);
                  }}
                />
                {productId && (
                  <button
                    type="button"
                    onClick={() => {
                      setProductId("");
                      setProductSearch("");
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label="Xóa chọn"
                  >
                    <Icon name="close" size={14} />
                  </button>
                )}
                {showProductDropdown && (
                  <div className="absolute z-50 mt-1 w-full max-h-64 overflow-y-auto rounded-md border border-border bg-white shadow-lg">
                    {productOptions.length === 0 && (
                      <div className="px-3 py-2 text-xs text-muted-foreground">
                        {!branchId ? "Chọn chi nhánh để xem mặt hàng sản xuất." : selectedBranchMode === "outlet"
                          ? "Chưa có bán thành phẩm F&B với công thức phù hợp. Kiểm tra đánh dấu Bán thành phẩm và BOM của sản phẩm."
                          : "Chưa có sản phẩm với công thức phù hợp tại chi nhánh này. Kiểm tra mục Công thức BOM."}
                      </div>
                    )}
                    {productOptions.length > 0 &&
                      filteredProductOptions.length === 0 && (
                        <div className="px-3 py-2 text-xs text-muted-foreground">
                          Không tìm thấy SP &quot;{productSearch}&quot;
                        </div>
                      )}
                    {filteredProductOptions.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setProductId(p.id);
                          setProductSearch("");
                          setShowProductDropdown(false);
                        }}
                        className="block w-full text-left px-3 py-2 text-sm hover:bg-muted"
                      >
                        <span className="font-mono text-xs text-primary">
                          {p.code}
                        </span>
                        <span className="mx-1 text-muted-foreground">—</span>
                        <span>{p.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              {/* Sub-picker BOM — chỉ hiện khi SP có nhiều BOM (rare) */}
              {productId && bomsOfProduct.length > 1 && (
                <div className="mt-1 space-y-1">
                  <label className="text-xs uppercase text-muted-foreground">
                    Sản phẩm có {bomsOfProduct.length} công thức — chọn 1
                  </label>
                  <Select
                    value={bomId || null}
                    onValueChange={(v) => setBomId(v ?? "")}
                    items={bomsOfProduct.map((b) => ({
                      value: b.id,
                      label: b.name,
                    }))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Chọn công thức...">
                        {(v) => bomsOfProduct.find((b) => b.id === v)?.name ?? "Chọn công thức..."}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {bomsOfProduct.map((b) => (
                        <SelectItem key={b.id} value={b.id}>
                          {b.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {/* Hiển thị BOM auto-picked khi chỉ có 1 */}
              {productId && bomsOfProduct.length === 1 && selectedBom && (
                <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <Icon name="auto_awesome" size={12} className="text-primary" />
                  Công thức áp dụng: <b>{selectedBom.name}</b> (1 mẻ ra{" "}
                  {selectedBom.yieldQty} {outputUnit})
                </div>
              )}
              {errors.productId && <p className="text-xs text-destructive">{errors.productId}</p>}
              {errors.bomId && <p className="text-xs text-destructive">{errors.bomId}</p>}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">
                Chi nhánh sản xuất <span className="text-destructive">*</span>
              </label>
              <Select
                value={branchId || null}
                onValueChange={(v) => setBranchId(v ?? "")}
                items={branches.map((b) => ({ value: b.id, label: b.name }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Chọn chi nhánh...">
                    {(v) => branches.find((b) => b.id === v)?.name ?? "Chọn chi nhánh..."}
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
              {errors.branchId && <p className="text-xs text-destructive">{errors.branchId}</p>}
            </div>
          </div>

          <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                {selectedBranchMode === "outlet" ? "Số mẻ nguyên liệu đã làm" : "Số lượng"} <span className="text-destructive">*</span>
              </label>
              <div className="flex gap-2">
                <Input
                  type="number"
                  aria-label="Số mẻ hoặc số lượng sản xuất"
                  value={selectedBranchMode === "outlet" ? batchCount : plannedQty}
                  min="0" step="any"
                  onChange={(e) => { setMaterialActuals({}); setMaterialEntries({}); selectedBranchMode === "outlet" ? setBatchCount(e.target.value) : setPlannedQty(e.target.value); }}
                />
                {selectedBom && (
                  <span className="flex items-center text-sm text-muted-foreground">
                    {selectedBranchMode === "outlet" ? "mẻ" : outputUnit}
                  </span>
                )}
              </div>
              {errors.plannedQty && (
                <p className="text-xs text-destructive">{errors.plannedQty}</p>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Ngày bắt đầu sản xuất
              </label>
              <DateTimeInput aria-label="Bắt đầu sản xuất" value={plannedStart} onValueChange={setPlannedStart} />
              <p className="text-xs text-muted-foreground">
                Khi nào bắt đầu làm? (để trống = bắt đầu ngay khi tạo lệnh)
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Ngày dự kiến hoàn thành
              </label>
              <DateTimeInput aria-label="Dự kiến hoàn thành" value={plannedEnd} onValueChange={setPlannedEnd} />
              <p className="text-xs text-muted-foreground">
                Khi nào làm xong? (để trống nếu chưa rõ — có thể cập nhật sau)
              </p>
            </div>
          </div>

          {/* CEO 06/07: thông tin lô thành phẩm nhập kho */}
          <div className="rounded-lg border border-border p-3 space-y-2 bg-surface-container-lowest">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Icon name="package_2" size={16} className="text-primary" />
              Lô thành phẩm nhập kho
            </div>
            <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Số lô</label>
                <Input
                  value={lotNumber}
                  onChange={(e) => setLotNumber(e.target.value)}
                  placeholder="Để trống = tự sinh theo mã lệnh"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">NSX</label>
                <DateTimeInput aria-label="Ngày sản xuất" value={manufacturedDate} onValueChange={setManufacturedDate} />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">HSD</label>
                <ExpiryDateInput
                  value={expiryDate}
                  onValueChange={nextValue => setExpiryDate(nextValue)}
                />
              </div>
            </div>
          </div>

          {selectedBranchMode === "outlet" && selectedBom && <section className="space-y-3 rounded-lg border bg-primary/5 p-3">
            <h3 className="font-medium text-primary">Cân thành phẩm thực nhận</h3>
            <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="space-y-1 text-sm">Cân cả hộp ({actualWeighUnit})<Input aria-label={`Cân cả hộp (${actualWeighUnit})`} type="number" min="0" step="any" value={weighedQty} onChange={e => setWeighedQty(e.target.value)} /></label>
              <label className="space-y-1 text-sm">Trừ vỏ hộp ({actualWeighUnit})<Input type="number" min="0" step="any" value={tareQty} onChange={e => setTareQty(e.target.value)} /></label>
            </div>
            <p className="text-sm">Thực cân <b>{formatOperationalQuantity(Math.max(0, netWeight))} {actualWeighUnit}</b> · Ghi kho <b>{formatOperationalQuantity(Math.max(0, actualOutput))} {outputUnit}</b></p>
            <p className="text-xs text-muted-foreground">Dự kiến {formatOperationalQuantity(stockToInput(expectedOutput, outputUnit, actualWeighUnit, outputConversions) ?? expectedOutput)} {actualWeighUnit}. Quy đổi theo thông tin sản phẩm; đơn vị và tồn cũ giữ nguyên.</p>
            {Number.isFinite(actualOutput) && Math.abs((stockToInput(actualOutput, outputUnit, actualWeighUnit, outputConversions) ?? netWeight) - netWeight) > 0.00001 && <p className="text-xs text-muted-foreground">Sổ kho lưu 4 số lẻ: lượng ghi kho tương đương {formatOperationalQuantity(stockToInput(actualOutput, outputUnit, actualWeighUnit, outputConversions) ?? 0)} {actualWeighUnit}. Số cân gốc vẫn lưu trên chứng từ.</p>}
            <p className="text-xs text-muted-foreground">Tương đương {formatNumber(Math.max(0, actualOutput) / selectedBom.yieldQty)} mẻ chuẩn — chỉ để tham khảo. Nguyên liệu trừ theo số mẻ đã làm / thực dùng bên dưới, không suy ngược từ cân thành phẩm.</p>
            {errors.actualOutput && <p className="text-xs text-destructive">{errors.actualOutput}</p>}
          </section>}
          {/* Material needs */}
          {bomId && (
            <div className="min-w-0 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Nguyên liệu thực dùng</h3>
                {computing && (
                  <Icon name="progress_activity" size={14} className="animate-spin text-muted-foreground" />
                )}
              </div>

              {materials.length > 0 && (
                <div className="min-w-0 w-full overflow-x-auto rounded-lg border">
                  <table className="block w-full text-sm sm:table sm:min-w-[800px]">
                    <thead className="hidden bg-muted/30 sm:table-header-group">
                      <tr>
                        <th className="text-left p-2 font-medium">NVL</th>
                        <th className="text-right p-2 font-medium w-60">{selectedBranchMode === "outlet" ? "Thực dùng" : "Cần"}</th>
                        <th className="text-right p-2 font-medium w-44">Tồn kho</th>
                        <th className="text-center p-2 font-medium w-24">Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody className="block sm:table-row-group">
                      {materials.map((m) => (
                        <tr key={m.productId} className="grid gap-3 border-t p-3 sm:table-row sm:p-0">
                          <td className="block sm:table-cell sm:p-2">
                            <div className="font-medium">{m.productName}</div>
                            <div className="text-xs text-muted-foreground">{m.productCode}</div>
                          </td>
                          <td className="block text-right sm:table-cell sm:p-2">
                            <span className="mb-1 block text-left text-xs text-muted-foreground sm:hidden">{selectedBranchMode === "outlet" ? "Thực dùng" : "Cần"}</span>
                            {selectedBranchMode === "outlet" ? <>
                              <OperationalQuantityInput productId={m.productId} quantity={Number(materialActuals[m.productId] ?? m.needed)} unit={m.unit} conversions={conversionMap.get(m.productId)} max={m.available} label={`Thực dùng ${m.productName}`} onChange={(value,input) => {setMaterialActuals(previous => ({...previous,[m.productId]:String(value)}));setMaterialEntries(previous=>({...previous,[m.productId]:input}));}} />
                              {Math.abs(m.needed-m.perBatch*Number(batchCount))>0.0001 && <p className="mt-1 text-xs text-status-warning">Khác công thức: <StockWithConversion quantity={m.perBatch*Number(batchCount)} unit={m.unit} conversions={conversionMap.get(m.productId)} /></p>}
                            </> : <StockWithConversion variant="cell" quantity={m.needed} unit={m.unit} conversions={conversionMap.get(m.productId)} />}
                          </td>
                          <td className="block text-right sm:table-cell sm:p-2">
                            <span className="mr-2 text-xs text-muted-foreground sm:hidden">Tồn kho</span>
                            <span
                              className={
                                m.shortage ? "text-destructive font-medium" : "text-foreground"
                              }
                            >
                              <StockWithConversion variant="cell" quantity={m.available} unit={m.unit} conversions={conversionMap.get(m.productId)} />
                            </span>{" "}
                          </td>
                          <td className="block text-right sm:table-cell sm:p-2 sm:text-center">
                            {m.shortage || m.costMismatch ? (
                              <span className="inline-flex items-center gap-1 text-destructive text-xs">
                                <Icon name="warning" size={14} />
                                {m.shortage ? "Thiếu" : "Lệch giá vốn"}
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-status-success text-xs">
                                <Icon name="check_circle" size={14} />
                                Đủ
                              </span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {hasShortage && (
                <div className="text-xs text-destructive flex items-center gap-2 bg-destructive/5 rounded p-2">
                  <Icon name="warning" size={14} />
                  Thiếu nguyên liệu tại chi nhánh này. Nhập đủ tồn rồi mới hoàn thành mẻ.
                </div>
              )}
              {hasCostMismatch && !hasShortage && (
                <div className="text-xs text-destructive flex items-center gap-2 bg-destructive/5 rounded p-2">
                  <Icon name="warning" size={14} />
                  Tồn và sổ giá vốn F&B tại chi nhánh chưa khớp. Cần đối soát trước khi hoàn thành mẻ.
                </div>
              )}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Ghi chú</label>
            <textarea
              className="flex min-h-[60px] w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>
        </fieldset>
        </div>

        <DialogFooter className="shrink-0 border-t pt-3">
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          {/* CEO 06/07: 1 nút duy nhất — tạo lệnh = hoàn thành + nhập kho luôn */}
          <Button onClick={() => handleSave()} disabled={saving || !canComplete || !Number.isFinite(actualOutput) || actualOutput <= 0 || materials.some(m => !Number.isFinite(m.needed) || m.needed <= 0)}>
            {saving && (
              <Icon name="progress_activity" size={16} className="mr-2 animate-spin" />
            )}
            Hoàn thành sản xuất &amp; nhập kho
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
