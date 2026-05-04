"use client";

import { useState, useEffect } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/lib/contexts";
import {
  createProduct,
  updateProduct,
  getProductCategoriesAsync,
  getSuppliers,
  getAllUnits,
} from "@/lib/services";
import { nextGroupCode, peekNextGroupCode } from "@/lib/services/supabase/base";
import { Icon } from "@/components/ui/icon";
import { ProductImageUpload } from "@/components/shared/product-image-upload";
import type { Product } from "@/lib/types";
import { formatNumber } from "@/lib/format";

type ShelfLifeUnit = "day" | "month" | "year";
type SupplierOption = { id: string; name: string; code?: string };
type InnerTab = "info" | "pricing";

// VAT phổ biến ở VN: 0% (không chịu), 5% (giảm thuế hoặc nông sản), 8%
// (giảm theo NĐ), 10% (chuẩn). User chọn "Khác..." để input tuỳ ý cho
// các trường hợp đặc biệt (8.5%, 12%, sản phẩm xuất khẩu, v.v.).
const VAT_PRESETS = ["0", "5", "8", "10"];
const VAT_CUSTOM = "__custom__";

// Tìm đơn vị tương tự (chỉ khác hoa/thường) trong list existing —
// VD input "kg", existing có "Kg" → return "Kg" để suggest dùng tên cũ.
// CEO chốt: "không cho đặt giống nhau" → cảnh báo từ đầu thay vì để
// nhân viên tạo trùng rồi phải merge sau.
function findCaseInsensitiveDup(input: string, existing: string[]): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  const match = existing.find(
    (u) => u.toLowerCase() === lower && u !== trimmed,
  );
  return match ?? null;
}

// Currency input: lưu raw digits trong state, format khi render. CEO complain
// "195000" khó đọc — convention en-US: "195,000" với separator ",".
function formatVnd(value: string): string {
  if (!value) return "";
  const digits = value.replace(/\D/g, "");
  if (!digits) return "";
  return formatNumber(Number(digits));
}
function parseVnd(value: string): string {
  return value.replace(/\D/g, "");
}

interface CreateProductDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  /**
   * Khi có initialData → dialog chuyển sang chế độ sửa.
   * Scope (NVL/SKU) và nhóm hàng bị khóa vì code đã gắn với groupCode.
   */
  initialData?: Product | null;
}

type ProductScope = "nvl" | "sku";
type ProductChannel = "fnb" | "retail";
type CategoryOption = { label: string; value: string; code?: string; count: number };

export function CreateProductDialog({
  open,
  onOpenChange,
  onSuccess,
  initialData,
}: CreateProductDialogProps) {
  const isEdit = !!initialData;
  const { toast } = useToast();
  const [scope, setScope] = useState<ProductScope>("nvl");
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [loadingCats, setLoadingCats] = useState(false);

  const [categoryId, setCategoryId] = useState("");
  const [name, setName] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [initialStock, setInitialStock] = useState("");
  const [purchaseUnit, setPurchaseUnit] = useState("");
  const [stockUnit, setStockUnit] = useState("");
  const [sellUnit, setSellUnit] = useState("");
  const [shelfLifeDays, setShelfLifeDays] = useState("");
  const [shelfLifeUnit, setShelfLifeUnit] = useState<ShelfLifeUnit>("day");
  const [hasBom, setHasBom] = useState(false);
  // Kênh bán — chỉ áp dụng cho SKU. NVL luôn null.
  const [channel, setChannel] = useState<ProductChannel>("fnb");
  const [barcode, setBarcode] = useState("");
  const [brand, setBrand] = useState("");
  const [supplierId, setSupplierId] = useState<string>("");
  const [weight, setWeight] = useState("");
  const [vatRate, setVatRate] = useState<string>("10");
  // Khi user chọn "Khác..." → bật input để nhập VAT tuỳ ý (8.5, 12, ...).
  // Tự động true nếu prefill 1 giá trị không nằm trong VAT_PRESETS.
  const [vatCustom, setVatCustom] = useState(false);
  const [minStock, setMinStock] = useState("");
  const [maxStock, setMaxStock] = useState("");
  const [description, setDescription] = useState("");
  const [image, setImage] = useState<string | null>(null);
  const [allowSale, setAllowSale] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Inner tab — chia dialog thành 2 section để gọn (CEO feedback layout dài).
  // Tab 1 "info": identity (tên, nhóm, NCC, ĐVT, ảnh, mô tả).
  // Tab 2 "pricing": giá / VAT / tồn / HSD / trọng lượng.
  const [innerTab, setInnerTab] = useState<InnerTab>("info");

  // NCC list cho picker. Load lúc open dialog để có sẵn cho edit mode prefill.
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);

  // Existing units list — dùng để cảnh báo case-insensitive duplicate khi
  // user gõ "kg" mà tenant đã có "Kg" (CEO chốt: "không cho đặt giống nhau").
  const [existingUnits, setExistingUnits] = useState<string[]>([]);

  // Preview mã SP — query peek_next_group_code khi chọn nhóm (create mode).
  // Edit mode hiện code thật của SP nên không cần preview.
  const [previewCode, setPreviewCode] = useState<string>("");
  const [loadingPreview, setLoadingPreview] = useState(false);

  // Reset form khi dialog mở. Nếu có initialData → prefill từ sản phẩm đang sửa.
  useEffect(() => {
    if (!open) return;
    if (initialData) {
      setScope(initialData.productType);
      setCategoryId(initialData.categoryId || "");
      setName(initialData.name);
      setSellPrice(initialData.sellPrice ? String(initialData.sellPrice) : "");
      setCostPrice(initialData.costPrice ? String(initialData.costPrice) : "");
      setInitialStock(initialData.stock ? String(initialData.stock) : "");
      setPurchaseUnit(initialData.purchaseUnit || "");
      setStockUnit(initialData.stockUnit || initialData.unit || "");
      setSellUnit(initialData.sellUnit || "");
      setShelfLifeDays(initialData.shelfLifeDays ? String(initialData.shelfLifeDays) : "");
      setShelfLifeUnit((initialData.shelfLifeUnit as ShelfLifeUnit) || "day");
      setHasBom(!!initialData.hasBom);
      setChannel((initialData.channel as ProductChannel) || "fnb");
      // Prefill các field mới để edit "sửa được toàn bộ" như CEO yêu cầu.
      setBarcode(initialData.barcode || "");
      setBrand(initialData.brand || "");
      setSupplierId(initialData.supplierId || "");
      setWeight(initialData.weight ? String(initialData.weight) : "");
      setVatRate(String(initialData.vatRate ?? 10));
      setVatCustom(!VAT_PRESETS.includes(String(initialData.vatRate ?? 10)));
      setMinStock(initialData.minStock ? String(initialData.minStock) : "");
      setMaxStock(initialData.maxStock ? String(initialData.maxStock) : "");
      setDescription(initialData.description || "");
      setImage(initialData.image || null);
      setAllowSale(true);
      setErrors({});
      setInnerTab("info");
    } else {
      setScope("nvl");
      setCategoryId("");
      setName("");
      setSellPrice("");
      setCostPrice("");
      setInitialStock("");
      setPurchaseUnit("");
      setStockUnit("");
      setSellUnit("");
      setShelfLifeDays("");
      setShelfLifeUnit("day");
      setHasBom(false);
      setChannel("fnb");
      setBarcode("");
      setBrand("");
      setSupplierId("");
      setWeight("");
      setVatRate("10");
      setVatCustom(false);
      setMinStock("");
      setMaxStock("");
      setDescription("");
      setImage(null);
      setAllowSale(true);
      setErrors({});
      setInnerTab("info");
    }
  }, [open, initialData]);

  // Load existing units khi dialog mở — dùng cho case-insensitive duplicate
  // warning (3 ô ĐVT). Gọi 1 lần, light query (chỉ 4 cột text).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getAllUnits()
      .then((list) => {
        if (cancelled) return;
        setExistingUnits(list.map((u) => u.unit));
      })
      .catch(() => {
        // fail silent — warning chỉ là nice-to-have, không block
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Load NCC list 1 lần mỗi lần dialog mở. 500 NCC ~ 50KB payload — ok.
  // Nếu tenant scale >2k NCC sau này thì đổi sang async search combobox.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getSuppliers({ page: 0, pageSize: 500, sortBy: "name", sortOrder: "asc" })
      .then((res) => {
        if (cancelled) return;
        setSuppliers(
          res.data.map((s) => ({ id: s.id, name: s.name, code: s.code })),
        );
      })
      .catch(() => {
        /* suppliers optional — fail silent */
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Load categories mỗi khi scope đổi. Edit mode: KHÔNG reset categoryId (đã prefill).
  useEffect(() => {
    if (!open) return;
    setLoadingCats(true);
    if (!isEdit) setCategoryId("");
    getProductCategoriesAsync(scope)
      .then((cats) => setCategories(cats as CategoryOption[]))
      .finally(() => setLoadingCats(false));
  }, [open, scope, isEdit]);

  const selectedCategory = categories.find((c) => c.value === categoryId);
  const selectedCategoryCode = selectedCategory?.code;

  // Case-insensitive dup check cho 3 ô ĐVT
  const purchaseUnitDup = findCaseInsensitiveDup(purchaseUnit, existingUnits);
  const stockUnitDup = findCaseInsensitiveDup(stockUnit, existingUnits);
  const sellUnitDup = findCaseInsensitiveDup(sellUnit, existingUnits);

  // Preview mã SP tiếp theo khi user chọn nhóm (create mode).
  // peek_next_group_code RPC trả về mã thật như NVL-CPH-014 — không phải XXX.
  // Edit mode: skip vì SP đã có code cố định, không sinh mới.
  useEffect(() => {
    if (!open || isEdit || !selectedCategoryCode) {
      setPreviewCode("");
      return;
    }
    let cancelled = false;
    setLoadingPreview(true);
    const prefix = scope === "nvl" ? "NVL" : "SKU";
    peekNextGroupCode(prefix, selectedCategoryCode)
      .then((code) => {
        if (!cancelled) setPreviewCode(code);
      })
      .catch(() => {
        // Fallback đã handle trong peekNextGroupCode → string XXX
      })
      .finally(() => {
        if (!cancelled) setLoadingPreview(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, isEdit, scope, selectedCategoryCode]);

  function validate(): boolean {
    const e: Record<string, string> = {};
    if (!name.trim()) e.name = "Tên hàng là bắt buộc";
    if (!categoryId) e.category = "Chọn nhóm hàng";
    if (!selectedCategory?.code) e.category = "Nhóm hàng chưa có code";
    if (scope === "sku") {
      if (!sellPrice.trim() || isNaN(Number(sellPrice)) || Number(sellPrice) <= 0)
        e.sellPrice = "Giá bán không hợp lệ";
    }
    setErrors(e);
    // Auto-switch tab về tab có lỗi đầu tiên — UX: user không phải đoán
    // tab nào đang lỗi khi bấm Lưu.
    if (e.name || e.category) {
      setInnerTab("info");
    } else if (e.sellPrice) {
      setInnerTab("pricing");
    }
    return Object.keys(e).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    try {
      // Common payload — dùng cho cả create và update. Gom hết field mà user
      // có thể sửa. CEO dặn "toàn bộ thông tin đều có thể thay đổi trừ mã",
      // nên edit mode gửi đủ tất cả field vào updateProduct.
      const commonPayload = {
        name,
        channel: scope === "sku" ? channel : undefined,
        categoryId,
        unit: stockUnit || purchaseUnit || initialData?.unit || "Cái",
        purchaseUnit: purchaseUnit || undefined,
        stockUnit: stockUnit || undefined,
        sellUnit: sellUnit || undefined,
        shelfLifeDays: shelfLifeDays ? Number(shelfLifeDays) : undefined,
        shelfLifeUnit,
        barcode: barcode || undefined,
        brand: brand.trim() || undefined,
        supplierId: supplierId || undefined,
        weight: weight ? Number(weight) : undefined,
        vatRate: vatRate ? Number(vatRate) : 0,
        minStock: minStock ? Number(minStock) : undefined,
        maxStock: maxStock ? Number(maxStock) : undefined,
        sellPrice: scope === "sku" ? Number(sellPrice) : 0,
        costPrice: Number(costPrice) || 0,
        description: description || undefined,
        image: image ?? undefined,
        allowSale: scope === "sku" ? allowSale : false,
      };

      if (isEdit && initialData) {
        // EDIT — giữ nguyên code/productType, không đổi groupCode.
        await updateProduct(initialData.id, commonPayload);
        onOpenChange(false);
        toast({
          title: "Cập nhật hàng hóa thành công",
          description: `Đã lưu thay đổi ${name} (${initialData.code})`,
          variant: "success",
        });
        onSuccess?.();
        return;
      }

      // CREATE — sinh code mới theo groupCode.
      const prefix = scope === "nvl" ? "NVL" : "SKU";
      const code = await nextGroupCode(prefix, selectedCategory!.code!);

      await createProduct({
        ...commonPayload,
        code,
        productType: scope,
        // NVL không có kênh bán (nội bộ). SKU bắt buộc fnb hoặc retail.
        hasBom: scope === "sku" ? hasBom : false,
        groupCode: selectedCategory!.code,
        stock: Number(initialStock) || 0,
      });

      onOpenChange(false);
      toast({
        title: "Tạo hàng hóa thành công",
        description: `Đã thêm ${scope === "nvl" ? "NVL" : "SKU"} ${name} (${code})`,
        variant: "success",
      });
      onSuccess?.();
    } catch (err) {
      toast({
        title: isEdit ? "Lỗi cập nhật hàng hóa" : "Lỗi tạo hàng hóa",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isEdit ? `Sửa hàng hóa ${initialData?.code ?? ""}` : "Thêm hàng hóa mới"}</DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Cập nhật thông tin hàng hóa. Mã và loại (NVL/SKU) không thể đổi sau khi tạo."
              : "Chọn loại hàng (NVL hoặc SKU) và điền thông tin. Mã sẽ tự sinh theo nhóm."}
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={scope}
          onValueChange={(v) => {
            // Edit mode: không cho đổi NVL↔SKU vì code đã gắn với prefix.
            if (isEdit) return;
            setScope(v as ProductScope);
          }}
        >
          <TabsList className="w-full">
            <TabsTrigger value="nvl" className="flex-1" disabled={isEdit && scope !== "nvl"}>
              Nguyên vật liệu (NVL)
            </TabsTrigger>
            <TabsTrigger value="sku" className="flex-1" disabled={isEdit && scope !== "sku"}>
              Hàng bán (SKU)
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="py-2">
        <Tabs value={innerTab} onValueChange={(v) => setInnerTab(v as InnerTab)}>
          <TabsList className="w-full mb-4">
            <TabsTrigger value="info" className="flex-1">
              <Icon name="info" size={14} className="mr-1.5" />
              Thông tin
              {(errors.name || errors.category) && (
                <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-destructive" />
              )}
            </TabsTrigger>
            <TabsTrigger value="pricing" className="flex-1">
              <Icon name="payments" size={14} className="mr-1.5" />
              Giá & Tồn kho
              {errors.sellPrice && (
                <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-destructive" />
              )}
            </TabsTrigger>
          </TabsList>

          {/* ─────────── Tab 1: Thông tin ─────────── */}
          <TabsContent value="info" className="space-y-4 mt-0">
            {/* Header row: Ảnh + Tên + Mã code (read-only nếu edit) */}
            <div className="flex gap-4 items-start">
              <ProductImageUpload value={image} onChange={setImage} />
              <div className="flex-1 space-y-1.5 min-w-0">
                <label className="text-sm font-medium">
                  Tên hàng <span className="text-destructive">*</span>
                </label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={
                    scope === "nvl"
                      ? "VD: Cà phê hạt Robusta S18 60kg/bao"
                      : "VD: Robusta Rang Xay 1kg"
                  }
                  aria-invalid={!!errors.name}
                />
                {errors.name && (
                  <p className="text-xs text-destructive">{errors.name}</p>
                )}
                {isEdit && initialData?.code && (
                  <p className="text-xs text-muted-foreground">
                    Mã:{" "}
                    <span className="font-mono font-medium text-foreground">
                      {initialData.code}
                    </span>{" "}
                    — không thể đổi
                  </p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Nhóm hàng <span className="text-destructive">*</span>
              </label>
              <Select
                value={categoryId || null}
                onValueChange={(v) => setCategoryId(v ?? "")}
                // items cho phép Base UI tự resolve UUID -> label, tránh trigger hiện UUID
                // khi value set trước khi SelectContent mount (edit mode async load).
                items={categories.map((cat) => ({
                  value: cat.value,
                  label: cat.code ? `${cat.code} — ${cat.label}` : cat.label,
                }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={loadingCats ? "Đang tải..." : "Chọn nhóm hàng"}>
                    {(v) => {
                      const match = categories.find((c) => c.value === v);
                      if (match) {
                        return match.code ? `${match.code} — ${match.label}` : match.label;
                      }
                      // Value đặt nhưng chưa match (đang load hoặc category đã xoá) →
                      // hiện placeholder thay vì UUID thô.
                      return loadingCats ? "Đang tải..." : "Chọn nhóm hàng";
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {categories.map((cat) => (
                    <SelectItem key={cat.value} value={cat.value}>
                      {cat.code ? `${cat.code} — ` : ""}
                      {cat.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.category && (
                <p className="text-xs text-destructive">{errors.category}</p>
              )}
              {!isEdit && selectedCategory?.code && (
                <p className="text-xs text-muted-foreground">
                  Mã sẽ là:{" "}
                  <span className="font-mono font-medium text-foreground">
                    {loadingPreview
                      ? `${scope === "nvl" ? "NVL" : "SKU"}-${selectedCategory.code}-...`
                      : previewCode || `${scope === "nvl" ? "NVL" : "SKU"}-${selectedCategory.code}-001`}
                  </span>
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Mã vạch</label>
              <Input
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                placeholder="Nhập hoặc quét mã vạch"
              />
            </div>
          </div>

          {/* Thương hiệu + NCC — optional cho NVL, dùng nhiều cho filter + báo cáo */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Thương hiệu</label>
              <Input
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="VD: Monin, Trung Nguyên, Highlands…"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Nhà cung cấp</label>
              <Select
                value={supplierId || null}
                onValueChange={(v) => setSupplierId(v ?? "")}
                items={suppliers.map((s) => ({
                  value: s.id,
                  label: s.code ? `${s.code} — ${s.name}` : s.name,
                }))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Chọn nhà cung cấp">
                    {(v) => {
                      const match = suppliers.find((s) => s.id === v);
                      if (match) {
                        return match.code ? `${match.code} — ${match.name}` : match.name;
                      }
                      return "Chọn nhà cung cấp";
                    }}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {suppliers.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.code ? `${s.code} — ` : ""}
                      {s.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Kênh bán — chỉ hiển thị cho SKU. Tách FnB vs bán lẻ/sỉ để POS hiển thị đúng danh sách. */}
          {scope === "sku" && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Kênh bán <span className="text-destructive">*</span>
              </label>
              <Select
                value={channel}
                onValueChange={(v) => setChannel(v as ProductChannel)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="fnb">
                    Quán FnB — pha chế tại quán (Caramel Macchiato, Cà phê sữa đá…)
                  </SelectItem>
                  <SelectItem value="retail">
                    Bán lẻ / Sỉ — đóng gói (Rang xay 250g, Hộp quà, Syrup chai…)
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {channel === "fnb"
                  ? "Chỉ hiện trên POS FnB của quán."
                  : "Chỉ hiện trên POS bán lẻ của kho tổng."}
              </p>
            </div>
          )}

            {/* UOM 3 đơn vị — gom chung 1 row, NVL chỉ disable ĐVT bán.
                Mỗi ô có cảnh báo case-insensitive dup: nếu user gõ "kg" mà
                tenant đã có "Kg" → suggest click để dùng tên hiện có,
                tránh tạo 2 đơn vị tương tự khác hoa/thường. */}
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">ĐVT mua</label>
                <Input
                  value={purchaseUnit}
                  onChange={(e) => setPurchaseUnit(e.target.value)}
                  placeholder="thùng, bao..."
                />
                {purchaseUnitDup && (
                  <p className="text-xs text-status-warning flex items-center gap-1">
                    <Icon name="warning" size={12} />
                    Đã có{" "}
                    <button
                      type="button"
                      onClick={() => setPurchaseUnit(purchaseUnitDup)}
                      className="font-mono font-medium underline hover:text-foreground"
                    >
                      {purchaseUnitDup}
                    </button>
                    <span className="text-muted-foreground">— dùng tên đó?</span>
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  ĐVT kho{" "}
                  <span className="text-muted-foreground">(chuẩn)</span>
                </label>
                <Input
                  value={stockUnit}
                  onChange={(e) => setStockUnit(e.target.value)}
                  placeholder="lon, gói, kg..."
                />
                {stockUnitDup && (
                  <p className="text-xs text-status-warning flex items-center gap-1">
                    <Icon name="warning" size={12} />
                    Đã có{" "}
                    <button
                      type="button"
                      onClick={() => setStockUnit(stockUnitDup)}
                      className="font-mono font-medium underline hover:text-foreground"
                    >
                      {stockUnitDup}
                    </button>
                    <span className="text-muted-foreground">— dùng tên đó?</span>
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">ĐVT bán</label>
                <Input
                  value={sellUnit}
                  onChange={(e) => setSellUnit(e.target.value)}
                  placeholder="thùng, lốc..."
                  disabled={scope === "nvl"}
                />
                {sellUnitDup && scope === "sku" && (
                  <p className="text-xs text-status-warning flex items-center gap-1">
                    <Icon name="warning" size={12} />
                    Đã có{" "}
                    <button
                      type="button"
                      onClick={() => setSellUnit(sellUnitDup)}
                      className="font-mono font-medium underline hover:text-foreground"
                    >
                      {sellUnitDup}
                    </button>
                    <span className="text-muted-foreground">— dùng tên đó?</span>
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Mô tả</label>
              <textarea
                className="flex min-h-[72px] w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Mô tả sản phẩm (xuất xứ, đặc điểm, ghi chú nội bộ…)"
                rows={3}
              />
            </div>
          </TabsContent>

          {/* ─────────── Tab 2: Giá & Tồn kho ─────────── */}
          <TabsContent value="pricing" className="space-y-4 mt-0">
            {/* NVL banner — giải thích vì sao Giá bán + ĐVT bán bị disabled, tránh
                CEO tưởng là bug. NVL = nguyên vật liệu nội bộ, không bán cho khách. */}
            {scope === "nvl" && (
              <div className="flex items-start gap-2 rounded-lg bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
                <Icon name="info" size={14} className="mt-0.5 shrink-0" />
                <span>
                  NVL là nguyên vật liệu nội bộ — không có giá bán. Chuyển sang
                  loại <strong>Hàng bán (SKU)</strong> nếu cần thiết lập giá bán.
                </span>
              </div>
            )}

            {/* Pricing — giá vốn / giá bán / VAT. Format số có dấu chấm ngăn cách. */}
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Giá vốn (₫)</label>
                <Input
                  inputMode="numeric"
                  value={formatVnd(costPrice)}
                  onChange={(e) => setCostPrice(parseVnd(e.target.value))}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  Giá bán (₫)
                  {scope === "sku" && (
                    <span className="text-destructive"> *</span>
                  )}
                </label>
                <Input
                  inputMode="numeric"
                  value={formatVnd(sellPrice)}
                  onChange={(e) => setSellPrice(parseVnd(e.target.value))}
                  placeholder={scope === "nvl" ? "Không áp dụng" : "0"}
                  disabled={scope === "nvl"}
                  aria-invalid={!!errors.sellPrice}
                />
                {errors.sellPrice && (
                  <p className="text-xs text-destructive">{errors.sellPrice}</p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Thuế VAT (%)</label>
                {vatCustom ? (
                  <div className="flex gap-1">
                    <Input
                      type="number"
                      step="0.1"
                      min="0"
                      max="100"
                      value={vatRate}
                      onChange={(e) => setVatRate(e.target.value)}
                      placeholder="VD: 8.5"
                      autoFocus
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-9 w-9 shrink-0"
                      title="Quay lại danh sách chuẩn"
                      onClick={() => {
                        setVatCustom(false);
                        setVatRate("10");
                      }}
                    >
                      <Icon name="close" size={14} />
                    </Button>
                  </div>
                ) : (
                  <Select
                    value={vatRate}
                    onValueChange={(v) => {
                      if (v === VAT_CUSTOM) {
                        // Reset value khi switch sang custom mode — nếu giữ
                        // giá trị cũ thì user gõ thêm sẽ thành "108.5" thay vì
                        // "8.5". Reset rỗng + autoFocus + user gõ ngay được.
                        setVatRate("");
                        setVatCustom(true);
                      } else {
                        setVatRate(v ?? "10");
                      }
                    }}
                    items={[
                      ...VAT_PRESETS.map((v) => ({ value: v, label: `${v}%` })),
                      { value: VAT_CUSTOM, label: "Khác..." },
                    ]}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {VAT_PRESETS.map((v) => (
                        <SelectItem key={v} value={v}>
                          {v}%
                        </SelectItem>
                      ))}
                      <SelectItem value={VAT_CUSTOM}>Khác...</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>

            {/* Tồn: hiện tại / tối thiểu / tối đa. Min-max dùng cho alert hết hàng. */}
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">
                  {isEdit ? "Tồn hiện tại" : "Tồn ban đầu"}
                </label>
                <Input
                  type="number"
                  value={initialStock}
                  onChange={(e) => setInitialStock(e.target.value)}
                  placeholder="0"
                  disabled={isEdit}
                />
                {isEdit && (
                  <p className="text-xs text-muted-foreground">
                    Sửa qua Kiểm kho / Nhập xuất kho.
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Tồn tối thiểu</label>
                <Input
                  type="number"
                  value={minStock}
                  onChange={(e) => setMinStock(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Tồn tối đa</label>
                <Input
                  type="number"
                  value={maxStock}
                  onChange={(e) => setMaxStock(e.target.value)}
                  placeholder="0"
                />
              </div>
            </div>

            {/* Trọng lượng + HSD số + đơn vị — gom thành 1 row */}
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Trọng lượng (g)</label>
                <Input
                  type="number"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">HSD mặc định</label>
                <Input
                  type="number"
                  value={shelfLifeDays}
                  onChange={(e) => setShelfLifeDays(e.target.value)}
                  placeholder="VD: 365"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Đơn vị HSD</label>
                <Select
                  value={shelfLifeUnit}
                  onValueChange={(v) =>
                    setShelfLifeUnit((v as ShelfLifeUnit) ?? "day")
                  }
                  items={[
                    { value: "day", label: "Ngày" },
                    { value: "month", label: "Tháng" },
                    { value: "year", label: "Năm" },
                  ]}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="day">Ngày</SelectItem>
                    <SelectItem value="month">Tháng</SelectItem>
                    <SelectItem value="year">Năm</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Toggles cuối — chỉ SKU. Đặt cùng row để gọn. */}
            {scope === "sku" && (
              <div className="flex flex-wrap gap-x-6 gap-y-2 pt-2 border-t">
                <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                  <Checkbox
                    checked={allowSale}
                    onCheckedChange={(c) => setAllowSale(!!c)}
                  />
                  Cho phép bán
                </label>
                <label className="flex items-center gap-2 text-sm font-medium cursor-pointer">
                  <Checkbox
                    checked={hasBom}
                    onCheckedChange={(c) => setHasBom(!!c)}
                  />
                  Có công thức sản xuất (BOM)
                </label>
              </div>
            )}
          </TabsContent>
        </Tabs>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Icon name="progress_activity" size={16} className="mr-2 animate-spin" />}
            Lưu
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
