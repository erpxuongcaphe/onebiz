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
  getProducts,
} from "@/lib/services";
import {
  nextGroupCode,
  peekNextGroupCode,
} from "@/lib/services/supabase/base";
import { Icon } from "@/components/ui/icon";
import { ProductImageUpload } from "@/components/shared/product-image-upload";
import {
  createBOM,
  getBOMsByProduct,
  updateBOM,
  deleteBOM,
  getUOMConversions,
  createUOMConversion,
  updateUOMConversion,
  deleteUOMConversion,
} from "@/lib/services";
import { useAuth } from "@/lib/contexts/auth-context";
import type { Product, BOMItem } from "@/lib/types";
import { formatNumber, formatCurrency } from "@/lib/format";

type ShelfLifeUnit = "day" | "month" | "year";
type SupplierOption = { id: string; name: string; code?: string };
type InnerTab = "info" | "pricing" | "bom";

/** Item trong bảng BOM inline (gắn với SKU đang tạo/sửa) */
interface InlineBomItem {
  materialId: string;
  materialCode: string;
  materialName: string;
  costPrice: number;
  unit: string;
  quantity: number;
  wastePercent: number;
  note?: string;
}

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
type CategoryOption = {
  label: string;
  value: string;
  code?: string;
  count: number;
  /** Day 22/05/2026 (CEO Task #3): channel field từ DB — dùng để biết
   * nhóm SKU đã set channel chưa. Nếu chưa (undefined) + user tạo SP có
   * channel → auto-set channel cho cả nhóm. */
  channel?: "fnb" | "retail";
};
/**
 * `id` alias = `value` để tương thích code Task #3. Em không đổi struct
 * vì các nơi khác đang dùng `value` làm id.
 */

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
  // Day 19/05/2026 (CEO UOM Smart Hybrid): quy đổi đơn vị inline trong form
  // tạo SP — đỡ phải save → vào tab "ĐVT quy đổi" → thêm. Cặp 2 ô optional.
  const [bulkUnit, setBulkUnit] = useState("");
  const [bulkFactor, setBulkFactor] = useState("");
  const [existingConversionId, setExistingConversionId] = useState<string | null>(null);
  const [sellUnit, setSellUnit] = useState("");
  const [shelfLifeDays, setShelfLifeDays] = useState("");
  const [shelfLifeUnit, setShelfLifeUnit] = useState<ShelfLifeUnit>("day");
  const [hasBom, setHasBom] = useState(false);
  // Day 18/05/2026 (CEO refactor): BOM inline trong dialog SKU, không mở dialog riêng.
  // Tab "Công thức (BOM)" chỉ hiện khi scope=sku && hasBom=true.
  const [bomBranchId, setBomBranchId] = useState<string | null>(null); // null = global
  const [bomName, setBomName] = useState("");
  const [bomNote, setBomNote] = useState("");
  const [bomItems, setBomItems] = useState<InlineBomItem[]>([]);
  // Day 20/05/2026 (CEO BOM Phase 5): Mã BOM link với BOM có sẵn (standalone).
  // Khi user gõ Mã BOM → save sẽ verify + set products.bom_code (không tạo BOM
  // mới). Khi gõ items inline → tạo BOM riêng cho SKU (legacy path).
  const [bomCodeInput, setBomCodeInput] = useState("");
  const [bomCodeValid, setBomCodeValid] = useState<boolean | null>(null); // null = chưa verify
  const [bomExistingId, setBomExistingId] = useState<string | null>(null); // edit mode
  const [bomPickerOpen, setBomPickerOpen] = useState(false);
  // Day 19/05/2026 (CEO Phase A): multi-select picker — tick nhiều NVL,
  // thêm 1 lần. State chuyển từ string đơn → Set<string>.
  const [bomPickerSelected, setBomPickerSelected] = useState<Set<string>>(
    new Set(),
  );
  const [bomPickerSearch, setBomPickerSearch] = useState("");
  const [bomPickerTypeFilter, setBomPickerTypeFilter] = useState<
    "all" | "nvl" | "sku"
  >("all");
  const [bomPickerCategoryId, setBomPickerCategoryId] = useState<string>("");
  // Day 19/05/2026 (CEO Phase A.2): nested dialog tạo NVL ngay từ picker
  // khi list rỗng — tránh user phải đóng dialog đi sang trang khác.
  const [nestedNvlOpen, setNestedNvlOpen] = useState(false);
  const [bomConfirmDeleteOpen, setBomConfirmDeleteOpen] = useState(false);
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

  // Day 18/05/2026 (CEO): material options cho BOM picker — load tất cả SP
  // (cả NVL lẫn SKU vì Pattern A đa vai trò) để chọn làm NVL trong công thức.
  const [materialOptions, setMaterialOptions] = useState<Product[]>([]);
  const { branches } = useAuth();

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
      // Reset quy đổi — sẽ load qua getUOMConversions ở effect riêng
      setBulkUnit("");
      setBulkFactor("");
      setExistingConversionId(null);
      setShelfLifeDays(initialData.shelfLifeDays ? String(initialData.shelfLifeDays) : "");
      setShelfLifeUnit((initialData.shelfLifeUnit as ShelfLifeUnit) || "day");
      setHasBom(!!initialData.hasBom);
      setBomItems([]);
      setBomExistingId(null);
      setBomName("");
      setBomNote("");
      setBomBranchId(null);
      // Day 20/05/2026 (CEO BOM Phase 5): prefill bomCode từ products.bom_code
      setBomCodeInput(initialData.bomCode ?? "");
      setBomCodeValid(initialData.bomCode ? true : null);
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
      setBulkUnit("");
      setBulkFactor("");
      setExistingConversionId(null);
      setShelfLifeDays("");
      setShelfLifeUnit("day");
      setHasBom(false);
      setBomItems([]);
      setBomExistingId(null);
      setBomName("");
      setBomNote("");
      setBomBranchId(null);
      setBomCodeInput("");
      setBomCodeValid(null);
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

  // Day 18/05/2026 (CEO): load BOM existing khi edit SKU has_bom=true.
  // Hiển thị form items prefilled để user sửa ngay trong tab "Công thức".
  useEffect(() => {
    if (!open || !initialData || initialData.productType !== "sku" || !initialData.hasBom) {
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // Lấy BOM active đầu tiên cho SP này (ưu tiên global, fallback per-branch)
        const boms = await getBOMsByProduct(initialData.id);
        if (cancelled || boms.length === 0) return;
        // Ưu tiên BOM global (branch_id=null) — em load BOM đầu tiên
        const bom = boms[0];
        setBomExistingId(bom.id);
        setBomName(bom.name);
        setBomNote(bom.note ?? "");
        setBomBranchId(bom.branchId ?? null);
        // Items đã có trong bom.items (getBOMById return) nhưng getBOMsByProduct
        // có thể không return items → cần fetch
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fullBom = await (await import("@/lib/services")).getBOMById(bom.id);
        if (cancelled) return;
        setBomItems(
          (fullBom.items ?? []).map((it: BOMItem) => ({
            materialId: it.materialId,
            materialCode: it.materialCode ?? "",
            materialName: it.materialName ?? "",
            costPrice: it.materialCostPrice ?? 0,
            unit: it.unit,
            quantity: it.quantity,
            wastePercent: it.wastePercent ?? 0,
            note: it.note,
          })),
        );
      } catch {
        // fail silent — user vẫn có thể tạo BOM mới
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, initialData]);

  // Day 19/05/2026 (CEO UOM Smart Hybrid): load existing UOM conversion
  // khi edit SP — prefill 2 ô "Đóng gói" + "Hệ số quy đổi".
  useEffect(() => {
    if (!open || !initialData) return;
    let cancelled = false;
    (async () => {
      try {
        const convs = await getUOMConversions(initialData.id);
        if (cancelled) return;
        const productUnit =
          initialData.stockUnit || initialData.unit || "";
        // Lấy conversion đầu tiên match toUnit === unit chính của SP
        const match = convs.find((c) => c.toUnit === productUnit);
        if (match) {
          setBulkUnit(match.fromUnit);
          setBulkFactor(String(match.factor));
          setExistingConversionId(match.id);
        }
      } catch {
        // fail silent
      }
    })();
    return () => {
      cancelled = true;
    };
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
    // Day 18/05/2026 (CEO): load material options cho BOM (tất cả SP)
    getProducts({ page: 0, pageSize: 1000, filters: {} })
      .then((res) => {
        if (cancelled) return;
        setMaterialOptions(res.data);
      })
      .catch(() => {
        /* fail silent */
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Load categories mỗi khi scope đổi. Edit mode: KHÔNG reset categoryId (đã prefill).
  useEffect(() => {
    if (!open) return;
    // CEO 23/05/2026: Fix race condition khi user switch tab NVL↔SKU nhanh.
    // Trước đây thiếu cleanup → 2 fetch chồng → fetch cũ resolve sau ghi
    // đè data fetch mới HOẶC auth-token lock timeout (Sentry log) →
    // dropdown kẹt "Đang tải..." không click được.
    //
    // Fix: cancelled flag + reset trạng thái ngay khi unmount/scope đổi
    // → fetch cũ không touch state nữa.
    let cancelled = false;
    setLoadingCats(true);
    if (!isEdit) setCategoryId("");
    getProductCategoriesAsync(scope)
      .then((cats) => {
        if (cancelled) return;
        setCategories(cats as CategoryOption[]);
      })
      .catch((err) => {
        if (cancelled) return;
        // Auth-token lock timeout hoặc network error → log + set empty
        // thay vì để state stale gây UI kẹt.
        console.warn("[create-product-dialog] load categories failed:", err);
        setCategories([]);
      })
      .finally(() => {
        if (cancelled) return;
        setLoadingCats(false);
      });
    return () => {
      cancelled = true;
    };
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
      // CEO 22/05/2026: bỏ require giá bán. Workflow CEO mong muốn:
      //   1. Tạo SKU rỗng (chưa biết giá)
      //   2. Add BOM sau → giá vốn auto-compute
      //   3. Set giá bán sau qua dialog edit hoặc Excel
      // Trước đây bắt sellPrice > 0 → CEO không tạo được SKU placeholder.
      // Chỉ check format hợp lệ nếu có nhập (không cho âm).
      if (sellPrice.trim() && (isNaN(Number(sellPrice)) || Number(sellPrice) < 0)) {
        e.sellPrice = "Giá bán không hợp lệ (phải ≥ 0)";
      }
      // Day 20/05/2026 (CEO audit Fix #1): SKU BẮT BUỘC có channel
      if (!channel || (channel !== "fnb" && channel !== "retail")) {
        e.channel = "SKU bắt buộc có Kênh bán (FnB hoặc Retail)";
      }
    }
    setErrors(e);
    // Auto-switch tab về tab có lỗi đầu tiên — UX: user không phải đoán
    // tab nào đang lỗi khi bấm Lưu.
    if (e.name || e.category || e.channel) {
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
      // Day 19/05/2026 (CEO Phương án D): UI chỉ có 1 ô "Đơn vị tính"
      // (state lưu trong `stockUnit`). Backend auto-fill 4 cột DB = unit
      // chính → nhất quán, không break data cũ.
      const finalUnit = stockUnit.trim() || initialData?.unit || "Cái";
      // Day 20/05/2026 (CEO BOM Phase 5): xử lý link Mã BOM
      // Nếu user nhập bomCode → set products.bom_code + has_bom=true
      // Nếu trống → bomCode = null (giữ logic cũ với items inline)
      const bomCodeTrim = bomCodeInput.trim();
      const linkedBomCode = bomCodeTrim || undefined;

      const commonPayload = {
        name,
        channel: scope === "sku" ? channel : undefined,
        categoryId,
        unit: finalUnit,
        purchaseUnit: finalUnit,
        stockUnit: finalUnit,
        sellUnit: finalUnit,
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
        // Day 20/05/2026: link với BOM standalone qua code
        bomCode: linkedBomCode,
      };

      // Day 19/05/2026 (CEO UOM Smart Hybrid): chuẩn hoá data quy đổi
      // trước khi save. Validate client-side cặp ô.
      const bulkUnitTrim = bulkUnit.trim();
      const bulkFactorNum = Number(bulkFactor);
      const hasBulkInput = bulkUnitTrim.length > 0 || bulkFactor.trim().length > 0;
      const bulkValid =
        bulkUnitTrim.length > 0 &&
        bulkFactorNum > 0 &&
        bulkUnitTrim !== (commonPayload.unit ?? "");
      if (hasBulkInput && !bulkValid) {
        toast({
          variant: "error",
          title: "Quy đổi đơn vị không hợp lệ",
          description:
            "Cần điền cả 'Đóng gói' và 'Hệ số quy đổi' (≥ 1), và không trùng 'Đơn vị tính'.",
        });
        setSaving(false);
        return;
      }

      if (isEdit && initialData) {
        // EDIT — giữ nguyên code/productType, không đổi groupCode.
        await updateProduct(initialData.id, {
          ...commonPayload,
          // Day 18/05/2026: cho phép user TẮT hasBom trong edit — phải sync DB
          hasBom: scope === "sku" ? hasBom : false,
        });

        // Day 19/05/2026 (CEO UOM): sync quy đổi đơn vị (CRUD UOMConversion)
        try {
          if (bulkValid) {
            if (existingConversionId) {
              // Update conversion hiện có
              await updateUOMConversion(existingConversionId, {
                fromUnit: bulkUnitTrim,
                toUnit: commonPayload.unit ?? "",
                factor: bulkFactorNum,
              });
            } else {
              // Tạo mới
              await createUOMConversion({
                productId: initialData.id,
                fromUnit: bulkUnitTrim,
                toUnit: commonPayload.unit ?? "",
                factor: bulkFactorNum,
              });
            }
          } else if (!hasBulkInput && existingConversionId) {
            // User xoá cả 2 ô → xoá conversion (soft delete is_active=false)
            await deleteUOMConversion(existingConversionId);
          }
        } catch (convErr) {
          console.warn("[create-product-dialog] sync UOM conversion fail:", convErr);
        }

        // Day 18/05/2026 (CEO refactor): sync BOM khi edit SKU
        if (scope === "sku") {
          if (hasBom && bomItems.length > 0) {
            // Có BOM items → tạo mới hoặc replace BOM existing
            if (bomExistingId) {
              // Replace: deactivate cũ + create mới (atomic-ish)
              try {
                await deleteBOM(bomExistingId); // soft delete (set is_active=false)
              } catch {
                // Ignore — BOM cũ có thể đã bị xoá
              }
            }
            try {
              await createBOM({
                productId: initialData.id,
                branchId: bomBranchId,
                name: bomName || `Công thức cho ${name}`,
                note: bomNote || undefined,
                items: bomItems.map((it, idx) => ({
                  materialId: it.materialId,
                  quantity: it.quantity,
                  unit: it.unit,
                  wastePercent: it.wastePercent,
                  sortOrder: idx,
                  note: it.note,
                })),
              });
            } catch (bomErr) {
              toast({
                variant: "warning",
                title: "Cập nhật SKU OK nhưng BOM lỗi",
                description: bomErr instanceof Error ? bomErr.message : "Lỗi không xác định",
                duration: 10000,
              });
              onOpenChange(false);
              onSuccess?.();
              return;
            }
          } else if (!hasBom && bomExistingId) {
            // User tắt hasBom + có BOM existing → deactivate
            try {
              await deleteBOM(bomExistingId);
            } catch {
              // Ignore
            }
          }
        }

        onOpenChange(false);
        toast({
          title: "Cập nhật hàng hóa thành công",
          description: hasBom && bomItems.length > 0
            ? `Đã lưu ${name} (${initialData.code}) + cập nhật BOM ${bomItems.length} NVL`
            : `Đã lưu thay đổi ${name} (${initialData.code})`,
          variant: "success",
        });
        onSuccess?.();
        return;
      }

      // CREATE — sinh code mới theo groupCode.
      const prefix = scope === "nvl" ? "NVL" : "SKU";
      const code = await nextGroupCode(prefix, selectedCategory!.code!);

      const created = await createProduct({
        ...commonPayload,
        code,
        productType: scope,
        // NVL không có kênh bán (nội bộ). SKU bắt buộc fnb hoặc retail.
        hasBom: scope === "sku" ? hasBom : false,
        groupCode: selectedCategory!.code,
        stock: Number(initialStock) || 0,
      });

      // CEO 22/05/2026 (Task #3): Auto-set channel cho nhóm SKU nếu chưa
      // có. Khi user tạo SP đầu tiên cho nhóm channel=NULL + chọn channel
      // → silently update channel của nhóm = channel SP. Tránh phải edit
      // từng nhóm tay sau migration 00111.
      if (
        scope === "sku" &&
        channel &&
        selectedCategory &&
        !selectedCategory.channel
      ) {
        try {
          const { updateCategory } = await import("@/lib/services");
          // CategoryOption.value chính là category.id
          await updateCategory(selectedCategory.value, {
            channel: channel as "fnb" | "retail",
          });
        } catch (catErr) {
          // Không block flow — chỉ log
          console.warn(
            "[create-product] auto-set category channel failed:",
            catErr,
          );
        }
      }

      // Day 18/05/2026 (CEO refactor): nếu SKU có BOM + items → tạo BOM ngay
      // sau khi tạo SP. Vẫn trong cùng dialog, không pop thêm dialog mới.
      if (scope === "sku" && hasBom && created?.id && bomItems.length > 0) {
        try {
          await createBOM({
            productId: created.id,
            branchId: bomBranchId,
            name: bomName || `Công thức cho ${name}`,
            note: bomNote || undefined,
            items: bomItems.map((it, idx) => ({
              materialId: it.materialId,
              quantity: it.quantity,
              unit: it.unit,
              wastePercent: it.wastePercent,
              sortOrder: idx,
              note: it.note,
            })),
          });
        } catch (bomErr) {
          // SP đã tạo nhưng BOM fail → toast warning, không rollback SP
          toast({
            variant: "warning",
            title: "SP đã tạo nhưng BOM lỗi",
            description: `${code} đã lưu. Lỗi BOM: ${
              bomErr instanceof Error ? bomErr.message : "không xác định"
            }. Vào /hang-hoa/cong-thuc tạo BOM thủ công.`,
            duration: 10000,
          });
          onOpenChange(false);
          onSuccess?.();
          return;
        }
      }

      // Day 19/05/2026 (CEO UOM): tạo conversion nếu user khai 2 ô.
      // Tách try/catch riêng — conversion fail KHÔNG rollback SP.
      if (created?.id && bulkValid) {
        try {
          await createUOMConversion({
            productId: created.id,
            fromUnit: bulkUnitTrim,
            toUnit: commonPayload.unit ?? "",
            factor: bulkFactorNum,
          });
        } catch (convErr) {
          console.warn(
            "[create-product-dialog] tạo UOM conversion fail:",
            convErr,
          );
        }
      }

      onOpenChange(false);
      toast({
        title: "Tạo hàng hóa thành công",
        description:
          scope === "sku" && hasBom && bomItems.length > 0
            ? `Đã thêm SKU ${name} (${code}) + công thức sản xuất (BOM) với ${bomItems.length} NVL`
            : `Đã thêm ${scope === "nvl" ? "NVL" : "SKU"} ${name} (${code})`,
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
      <DialogContent className="sm:max-w-5xl max-h-[92vh] overflow-y-auto">
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
              <Icon name="info" size={14} className="mr-1" />
              Thông tin
              {(errors.name || errors.category) && (
                <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-destructive" />
              )}
            </TabsTrigger>
            <TabsTrigger value="pricing" className="flex-1">
              <Icon name="payments" size={14} className="mr-1" />
              Giá & Tồn kho
              {errors.sellPrice && (
                <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-destructive" />
              )}
            </TabsTrigger>
            {/* Day 18/05/2026 (CEO refactor): Tab BOM chỉ hiện cho SKU có BOM */}
            {scope === "sku" && hasBom && (
              <TabsTrigger value="bom" className="flex-1">
                <Icon name="science" size={14} className="mr-1" />
                Công thức sản xuất (BOM)
                {bomItems.length === 0 && !isEdit && (
                  <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-status-warning" />
                )}
              </TabsTrigger>
            )}
          </TabsList>

          {/* ─────────── Tab 1: Thông tin ─────────── */}
          <TabsContent value="info" className="space-y-4 mt-0">
            {/* Header row: Ảnh + Tên + Mã code (read-only nếu edit) */}
            <div className="flex gap-4 items-start">
              <ProductImageUpload value={image} onChange={setImage} />
              <div className="flex-1 space-y-2 min-w-0">
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
            <div className="space-y-2">
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

            <div className="space-y-2">
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
            <div className="space-y-2">
              <label className="text-sm font-medium">Thương hiệu</label>
              <Input
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                placeholder="VD: Monin, Trung Nguyên, Highlands…"
              />
            </div>
            <div className="space-y-2">
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
            <div className="space-y-2">
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
                  : "Chỉ hiện trên POS Retail của kho tổng."}
              </p>
            </div>
          )}

            {/* Day 19/05/2026 (CEO Phương án D): chỉ 1 ô "Đơn vị tính".
                Trước đây 3 ô (mua/kho/bán) gây rối + 99% redundant + KHÔNG có
                conversion logic trong flow nhập/xuất → chỉ là text hiển thị.
                Backend giữ 4 cột DB, service auto-fill purchase/stock/sell = unit. */}
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Đơn vị tính <span className="text-destructive">*</span>
              </label>
              <Input
                value={stockUnit}
                onChange={(e) => setStockUnit(e.target.value)}
                placeholder="VD: ly, kg, cái, lon, chai, gói..."
              />
              {stockUnitDup && (
                <p className="text-xs text-status-warning flex items-center gap-1">
                  <Icon name="warning" size={14} />
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
              <p className="text-xs text-muted-foreground">
                Đơn vị nhỏ nhất khi bán lẻ (vd: 1 lon, 1 kg, 1 ly).
              </p>
            </div>

            {/* Day 19/05/2026 (CEO UOM Smart Hybrid): 2 ô quy đổi optional.
                Khi điền cả 2 → save xong tự tạo UOM conversion → tồn kho hiện
                "24 hộp · 2 thùng". 1 ô trống = không có quy đổi. */}
            <div className="rounded-lg border border-dashed bg-muted/20 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">
                  Quy đổi đơn vị{" "}
                  <span className="text-xs text-muted-foreground font-normal">
                    · tuỳ chọn
                  </span>
                </div>
                {(bulkUnit || bulkFactor) && (
                  <button
                    type="button"
                    onClick={() => {
                      setBulkUnit("");
                      setBulkFactor("");
                    }}
                    className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                  >
                    <Icon name="close" size={12} />
                    Xoá quy đổi
                  </button>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">
                    Đóng gói (ĐVT lớn)
                  </label>
                  <Input
                    value={bulkUnit}
                    onChange={(e) => setBulkUnit(e.target.value)}
                    placeholder="VD: Thùng, Bao, Lốc"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">
                    Hệ số quy đổi
                  </label>
                  <Input
                    type="number"
                    min={1}
                    step={1}
                    value={bulkFactor}
                    onChange={(e) => setBulkFactor(e.target.value)}
                    placeholder="VD: 12"
                  />
                </div>
              </div>
              {bulkUnit.trim() &&
              bulkFactor.trim() &&
              Number(bulkFactor) > 0 &&
              stockUnit.trim() &&
              bulkUnit.trim() !== stockUnit.trim() ? (
                <p className="text-xs text-primary">
                  <Icon
                    name="check_circle"
                    size={12}
                    className="inline-block mr-1 align-text-bottom"
                  />
                  1 {bulkUnit.trim()} = {bulkFactor} {stockUnit.trim()}
                </p>
              ) : (bulkUnit || bulkFactor) ? (
                <p className="text-xs text-status-warning">
                  <Icon
                    name="warning"
                    size={12}
                    className="inline-block mr-1 align-text-bottom"
                  />
                  {!bulkUnit.trim()
                    ? "Thiếu Đóng gói (ĐVT lớn)"
                    : !bulkFactor.trim() || Number(bulkFactor) <= 0
                      ? "Thiếu Hệ số quy đổi (số nguyên ≥ 1)"
                      : bulkUnit.trim() === stockUnit.trim()
                        ? "Đóng gói không được trùng Đơn vị tính"
                        : ""}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Chỉ điền nếu muốn xem tồn kho theo đơn vị lớn (vd &quot;24 hộp · 2 thùng&quot;).
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Mô tả</label>
              <textarea
                className="flex min-h-[72px] w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
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
              <div className="flex items-start gap-2 rounded-lg bg-muted/40 px-3 py-3 text-xs text-muted-foreground">
                <Icon name="info" size={14} className="mt-0.5 shrink-0" />
                <span>
                  NVL là nguyên vật liệu nội bộ — không có giá bán. Chuyển sang
                  loại <strong>Hàng bán (SKU)</strong> nếu cần thiết lập giá bán.
                </span>
              </div>
            )}

            {/* Pricing — giá vốn / giá bán / VAT. Format số có dấu chấm ngăn cách. */}
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Giá vốn (₫)</label>
                <Input
                  inputMode="numeric"
                  value={formatVnd(costPrice)}
                  onChange={(e) => setCostPrice(parseVnd(e.target.value))}
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  Giá bán (₫)
                  {/* CEO 22/05/2026: bỏ * cho SKU — cho phép tạo SKU rỗng
                      rồi cập nhật giá sau (sau khi add BOM/setup). */}
                  {scope === "sku" && (
                    <span className="text-xs font-normal text-muted-foreground ml-1">
                      · có thể bổ sung sau
                    </span>
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
              <div className="space-y-2">
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
              <div className="space-y-2">
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
              <div className="space-y-2">
                <label className="text-sm font-medium">Tồn tối thiểu</label>
                <Input
                  type="number"
                  value={minStock}
                  onChange={(e) => setMinStock(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
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
              <div className="space-y-2">
                <label className="text-sm font-medium">Trọng lượng (g)</label>
                <Input
                  type="number"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">HSD mặc định</label>
                <Input
                  type="number"
                  value={shelfLifeDays}
                  onChange={(e) => setShelfLifeDays(e.target.value)}
                  placeholder="VD: 365"
                />
              </div>
              <div className="space-y-2">
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
            {/* Day 18/05/2026 (CEO refactor): hint khi tick BOM */}
            {scope === "sku" && hasBom && (
              <div className="mt-2 rounded-md border border-primary/30 bg-primary/5 p-2.5 text-xs text-foreground">
                <Icon name="info" size={14} className="inline-block mr-1 text-primary align-text-bottom" />
                Tab <b>&quot;Công thức sản xuất (BOM)&quot;</b> đã bật. Click qua tab đó để cấu hình NVL.
              </div>
            )}
          </TabsContent>

          {/* ─────────── Tab 3: Công thức BOM (chỉ SKU có BOM) ─────────── */}
          {scope === "sku" && hasBom && (
            <TabsContent value="bom" className="space-y-4 mt-0">
              <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-xs">
                <Icon name="info" size={14} className="inline-block mr-1 text-primary align-text-bottom" />
                Định nghĩa NVL cần để tạo 1 đơn vị SKU. Khi bán SKU, hệ thống
                tự trừ NVL theo công thức này.
              </div>

              {/* Day 20/05/2026 (CEO BOM Phase 5): input Mã BOM link với BOM
                  có sẵn. Nếu user nhập Mã BOM → save sẽ verify + set
                  products.bom_code (KHÔNG tạo BOM mới). Nếu để trống → user
                  tạo BOM inline với items bên dưới như cách cũ. */}
              <div className="rounded-lg border border-dashed bg-muted/20 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">
                    Mã BOM (link với công thức có sẵn){" "}
                    <span className="text-xs text-muted-foreground font-normal">
                      · tuỳ chọn
                    </span>
                  </label>
                  {bomCodeInput && (
                    <button
                      type="button"
                      onClick={() => {
                        setBomCodeInput("");
                        setBomCodeValid(null);
                      }}
                      className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                    >
                      <Icon name="close" size={12} />
                      Xoá link
                    </button>
                  )}
                </div>
                <Input
                  value={bomCodeInput}
                  onChange={(e) => {
                    setBomCodeInput(e.target.value);
                    setBomCodeValid(null);
                  }}
                  onBlur={async () => {
                    const code = bomCodeInput.trim();
                    if (!code) {
                      setBomCodeValid(null);
                      return;
                    }
                    try {
                      const { getBOMByCode } = await import(
                        "@/lib/services"
                      );
                      const found = await getBOMByCode(code);
                      setBomCodeValid(found.length > 0);
                    } catch {
                      setBomCodeValid(false);
                    }
                  }}
                  placeholder="VD: BOM-CFS-001 (phải đã tồn tại)"
                />
                {bomCodeValid === true && (
                  <p className="text-xs text-primary flex items-center gap-1">
                    <Icon name="check_circle" size={12} />
                    Mã BOM hợp lệ — sẽ link SKU này với BOM khi lưu
                  </p>
                )}
                {bomCodeValid === false && (
                  <p className="text-xs text-status-warning flex items-center gap-1">
                    <Icon name="warning" size={12} />
                    Mã BOM chưa tồn tại. Tạo BOM ở /hang-hoa/cong-thuc trước.
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Để TRỐNG nếu muốn tạo công thức MỚI cho SKU này (điền items
                  bên dưới). ĐIỀN nếu muốn dùng công thức đã có sẵn.
                </p>
              </div>

              {/* Branch áp dụng */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Áp dụng cho chi nhánh</label>
                  <Select
                    value={bomBranchId ?? "__all__"}
                    onValueChange={(v) => setBomBranchId(v === "__all__" ? null : v)}
                    items={[
                      { value: "__all__", label: "Áp dụng tất cả chi nhánh (mặc định)" },
                      ...branches.map((b) => ({ value: b.id, label: b.name })),
                    ]}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue>
                        {(v) => {
                          if (!v || v === "__all__") return "Áp dụng tất cả chi nhánh";
                          const m = branches.find((b) => b.id === v);
                          return m ? m.name : v;
                        }}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">Áp dụng tất cả chi nhánh (mặc định)</SelectItem>
                      {branches.map((b) => (
                        <SelectItem key={b.id} value={b.id}>{b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Tên công thức</label>
                  <Input
                    value={bomName}
                    onChange={(e) => setBomName(e.target.value)}
                    placeholder={`Mặc định: Công thức cho ${name || "SKU"}`}
                  />
                </div>
              </div>

              {/* Items table */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">
                    Nguyên vật liệu <span className="text-destructive">*</span>
                  </label>
                  <Button
                    size="sm"
                    variant="outline"
                    type="button"
                    onClick={() => setBomPickerOpen(true)}
                  >
                    <Icon name="add" size={14} className="mr-1" />
                    Thêm NVL
                  </Button>
                </div>

                {bomItems.length === 0 ? (
                  <div className="rounded-lg border-2 border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                    Chưa có NVL nào. Click <b>&quot;Thêm NVL&quot;</b> để bắt đầu.
                  </div>
                ) : (
                  <div className="rounded-lg border border-border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-surface-container-low text-xs text-muted-foreground">
                        <tr>
                          <th className="text-left px-3 py-2 font-semibold">NVL</th>
                          <th className="text-right px-3 py-2 font-semibold w-32">Số lượng</th>
                          <th className="text-left px-3 py-2 font-semibold w-28">ĐVT</th>
                          <th className="text-right px-3 py-2 font-semibold w-32">Cost/SP</th>
                          <th className="w-10"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {bomItems.map((it, idx) => {
                          // CEO 19/05/2026: bỏ Hao % khỏi UI (chưa cần), giá vốn = SL × cost
                          const lineCost = it.quantity * it.costPrice;
                          return (
                            <tr key={`${it.materialId}-${idx}`} className="border-t border-border">
                              <td className="px-3 py-2">
                                <div className="font-medium">{it.materialName}</div>
                                <div className="text-xs text-muted-foreground">{it.materialCode}</div>
                              </td>
                              <td className="px-3 py-2">
                                <Input
                                  type="number"
                                  value={it.quantity}
                                  step="0.0001"
                                  min="0"
                                  className="h-9 text-right text-sm"
                                  onChange={(e) => {
                                    const v = Number(e.target.value);
                                    setBomItems((prev) =>
                                      prev.map((p, i) => (i === idx ? { ...p, quantity: v } : p)),
                                    );
                                  }}
                                />
                              </td>
                              <td className="px-3 py-2">
                                <Input
                                  value={it.unit}
                                  className="h-9 text-sm"
                                  onChange={(e) => {
                                    setBomItems((prev) =>
                                      prev.map((p, i) =>
                                        i === idx ? { ...p, unit: e.target.value } : p,
                                      ),
                                    );
                                  }}
                                />
                              </td>
                              <td className="px-3 py-2 text-right text-sm tabular-nums">
                                {formatCurrency(lineCost)}
                              </td>
                              <td className="px-3 py-2">
                                <button
                                  type="button"
                                  onClick={() => setBomItems((prev) => prev.filter((_, i) => i !== idx))}
                                  className="text-muted-foreground hover:text-destructive"
                                  aria-label="Xoá NVL"
                                >
                                  <Icon name="delete" size={14} />
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                      <tfoot className="bg-surface-container-low/50 border-t-2 border-border">
                        <tr>
                          <td colSpan={3} className="px-3 py-2 text-right font-semibold text-sm">
                            Tổng giá vốn (theo BOM):
                          </td>
                          <td className="px-3 py-2 text-right font-bold text-primary">
                            {formatCurrency(
                              bomItems.reduce(
                                (s, it) => s + it.quantity * it.costPrice,
                                0,
                              ),
                            )}
                          </td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium">Ghi chú công thức</label>
                <textarea
                  className="flex min-h-[50px] w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  value={bomNote}
                  onChange={(e) => setBomNote(e.target.value)}
                  placeholder="Quy trình pha chế, lưu ý..."
                  rows={2}
                />
              </div>
            </TabsContent>
          )}
        </Tabs>

        {/* Day 19/05/2026 (CEO Phase A): Picker NVL multi-select. Tick nhiều
            dòng + thêm 1 lần. Empty state có CTA tạo NVL ngay nested. */}
        <Dialog
          open={bomPickerOpen}
          onOpenChange={(o) => {
            setBomPickerOpen(o);
            if (!o) {
              setBomPickerSearch("");
              setBomPickerTypeFilter("all");
              setBomPickerCategoryId("");
              setBomPickerSelected(new Set());
            }
          }}
        >
          <DialogContent className="sm:max-w-2xl max-h-[88vh] flex flex-col">
            <DialogHeader>
              <DialogTitle>Thêm NVL vào công thức sản xuất (BOM)</DialogTitle>
              <DialogDescription>
                Chọn nguyên vật liệu hoặc SKU khác làm thành phần (vd: cà phê
                rang 1kg làm NVL cho ly bạc xỉu).
              </DialogDescription>
            </DialogHeader>

            {/* Search + filter row */}
            <div className="space-y-2 pt-2 pb-3 border-b">
              <div className="relative">
                <Icon
                  name="search"
                  size={16}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                />
                <Input
                  value={bomPickerSearch}
                  onChange={(e) => setBomPickerSearch(e.target.value)}
                  placeholder="Tìm theo mã hoặc tên SP..."
                  className="pl-8"
                  autoFocus
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex rounded-md border p-0.5 text-xs">
                  {(
                    [
                      { v: "all", l: "Tất cả" },
                      { v: "nvl", l: "Chỉ NVL" },
                      { v: "sku", l: "Chỉ SKU" },
                    ] as const
                  ).map((o) => (
                    <button
                      key={o.v}
                      type="button"
                      onClick={() => setBomPickerTypeFilter(o.v)}
                      className={`px-2.5 py-1 rounded transition-colors ${
                        bomPickerTypeFilter === o.v
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {o.l}
                    </button>
                  ))}
                </div>
                <Select
                  value={bomPickerCategoryId || null}
                  onValueChange={(v) => setBomPickerCategoryId(v ?? "")}
                  items={[
                    { value: "", label: "Tất cả nhóm" },
                    ...categories.map((c) => ({ value: c.value, label: c.label })),
                  ]}
                >
                  <SelectTrigger className="w-48 h-8 text-xs">
                    <SelectValue placeholder="Tất cả nhóm">
                      {(v) => {
                        if (!v) return "Tất cả nhóm";
                        const c = categories.find((x) => x.value === v);
                        return c?.label ?? "Tất cả nhóm";
                      }}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Tất cả nhóm</SelectItem>
                    {categories.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {(bomPickerSearch ||
                  bomPickerTypeFilter !== "all" ||
                  bomPickerCategoryId) && (
                  <button
                    type="button"
                    onClick={() => {
                      setBomPickerSearch("");
                      setBomPickerTypeFilter("all");
                      setBomPickerCategoryId("");
                    }}
                    className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                  >
                    <Icon name="close" size={12} />
                    Xoá filter
                  </button>
                )}
              </div>
            </div>

            {/* Scrollable list + empty state CTA */}
            {(() => {
              // SP đã thêm vào BOM + chính SP đang sửa → loại khỏi list
              const available = materialOptions
                .filter((p) => !bomItems.some((it) => it.materialId === p.id))
                .filter((p) => !initialData || p.id !== initialData.id);

              const filtered = available
                .filter((p) =>
                  bomPickerTypeFilter === "all"
                    ? true
                    : p.productType === bomPickerTypeFilter,
                )
                .filter((p) =>
                  bomPickerCategoryId
                    ? p.categoryId === bomPickerCategoryId
                    : true,
                )
                .filter((p) => {
                  const q = bomPickerSearch.trim().toLowerCase();
                  if (!q) return true;
                  return (
                    p.code.toLowerCase().includes(q) ||
                    p.name.toLowerCase().includes(q)
                  );
                });

              // Empty state thực sự: hệ thống chưa có SP nào để chọn
              // (đã trừ những SP đã add). Show CTA tạo NVL ngay.
              const isReallyEmpty = available.length === 0;

              if (isReallyEmpty) {
                return (
                  <div className="flex-1 flex flex-col items-center justify-center py-10 px-6 text-center">
                    <div className="inline-flex size-14 items-center justify-center rounded-full bg-muted mb-3">
                      <Icon
                        name="package_2"
                        size={28}
                        className="text-muted-foreground"
                      />
                    </div>
                    <h4 className="font-semibold text-sm mb-1">
                      Chưa có NVL nào để chọn
                    </h4>
                    <p className="text-xs text-muted-foreground mb-5 max-w-sm">
                      Tạo NVL trước rồi mới gắn vào công thức được. Anh có thể
                      tạo ngay đây — không cần đóng dialog này.
                    </p>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={() => {
                          setBomPickerOpen(false);
                          setNestedNvlOpen(true);
                        }}
                      >
                        <Icon name="add" size={14} className="mr-1" />
                        Tạo NVL mới ngay
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setBomPickerOpen(false)}
                      >
                        Đóng
                      </Button>
                    </div>
                  </div>
                );
              }

              const allFilteredSelected =
                filtered.length > 0 &&
                filtered.every((p) => bomPickerSelected.has(p.id));

              return (
                <>
                  <div className="flex items-center justify-between px-1 py-1.5 text-[11px] text-muted-foreground">
                    <span>
                      <b className="text-foreground">{filtered.length}</b> SP
                      phù hợp
                      {materialOptions.length > filtered.length &&
                        ` · còn ${available.length} SP có thể thêm`}
                    </span>
                    {bomPickerSelected.size > 0 && (
                      <span className="text-primary font-medium">
                        Đã tick <b>{bomPickerSelected.size}</b> NVL
                      </span>
                    )}
                  </div>
                  <div className="flex-1 overflow-y-auto border rounded-md min-h-[200px] max-h-[360px]">
                    {filtered.length === 0 ? (
                      <div className="p-6 text-center text-xs text-muted-foreground">
                        <Icon
                          name="search_off"
                          size={20}
                          className="inline-block mb-1"
                        />
                        <div>Không có SP nào phù hợp filter hiện tại</div>
                      </div>
                    ) : (
                      <>
                        {/* Select-all header sticky */}
                        <div className="sticky top-0 z-10 px-3 py-2 bg-muted/80 backdrop-blur border-b flex items-center gap-3 text-[11px] uppercase tracking-wider text-muted-foreground">
                          <Checkbox
                            checked={allFilteredSelected}
                            onCheckedChange={(v) => {
                              setBomPickerSelected((prev) => {
                                const next = new Set(prev);
                                if (v) {
                                  filtered.forEach((p) => next.add(p.id));
                                } else {
                                  filtered.forEach((p) => next.delete(p.id));
                                }
                                return next;
                              });
                            }}
                          />
                          <span>Chọn tất cả ({filtered.length})</span>
                        </div>
                        <ul className="divide-y">
                          {filtered.map((p) => {
                            const isSelected = bomPickerSelected.has(p.id);
                            return (
                              <li key={p.id}>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setBomPickerSelected((prev) => {
                                      const next = new Set(prev);
                                      if (next.has(p.id)) next.delete(p.id);
                                      else next.add(p.id);
                                      return next;
                                    })
                                  }
                                  className={`w-full text-left px-3 py-2 flex items-center gap-3 transition-colors ${
                                    isSelected
                                      ? "bg-primary/5"
                                      : "hover:bg-muted/40"
                                  }`}
                                >
                                  <Checkbox
                                    checked={isSelected}
                                    onCheckedChange={() => {}}
                                  />
                                  <span className="font-mono text-[11px] text-muted-foreground min-w-[80px]">
                                    {p.code}
                                  </span>
                                  <span className="flex-1 min-w-0">
                                    <span className="block truncate font-medium text-sm">
                                      {p.name}
                                    </span>
                                    <span className="text-[10px] text-muted-foreground">
                                      {p.productType === "sku" ? "SKU" : "NVL"}
                                      {p.categoryName && ` · ${p.categoryName}`}
                                      {(p.stockUnit || p.unit) &&
                                        ` · ĐVT ${p.stockUnit || p.unit}`}
                                    </span>
                                  </span>
                                  {p.costPrice ? (
                                    <span className="text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">
                                      {formatCurrency(p.costPrice)}
                                    </span>
                                  ) : null}
                                </button>
                              </li>
                            );
                          })}
                        </ul>
                      </>
                    )}
                  </div>
                </>
              );
            })()}

            <DialogFooter className="pt-2 border-t">
              <Button variant="outline" onClick={() => setBomPickerOpen(false)}>
                Huỷ
              </Button>
              <Button
                disabled={bomPickerSelected.size === 0}
                onClick={() => {
                  // Thêm tất cả NVL đã tick vào BOM
                  const toAdd = Array.from(bomPickerSelected)
                    .map((id) => materialOptions.find((p) => p.id === id))
                    .filter((m): m is Product => !!m);
                  if (toAdd.length === 0) return;
                  setBomItems((prev) => [
                    ...prev,
                    ...toAdd.map((m) => ({
                      materialId: m.id,
                      materialCode: m.code,
                      materialName: m.name,
                      costPrice: m.costPrice ?? 0,
                      unit: m.stockUnit || m.unit || "",
                      quantity: 1,
                      wastePercent: 0,
                    })),
                  ]);
                  setBomPickerSelected(new Set());
                  setBomPickerOpen(false);
                }}
              >
                <Icon name="add" size={14} className="mr-1" />
                Thêm {bomPickerSelected.size > 0 ? bomPickerSelected.size : ""}{" "}
                NVL vào công thức
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* Day 19/05/2026 (CEO Phase A.2): nested dialog tạo NVL ngay từ
            empty state. Sau khi tạo xong, refetch materialOptions + tự
            mở lại picker để user tiếp tục chọn. */}
        <CreateProductDialog
          open={nestedNvlOpen}
          onOpenChange={setNestedNvlOpen}
          onSuccess={() => {
            // Re-fetch material options + mở lại picker
            getProducts({ page: 0, pageSize: 1000, filters: {} })
              .then((res) => {
                setMaterialOptions(res.data);
                setBomPickerOpen(true);
              })
              .catch(() => {
                /* fail silent */
              });
          }}
        />
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
