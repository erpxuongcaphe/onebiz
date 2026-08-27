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
import { NumericInput } from "@/components/ui/numeric-input";
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
  PerSizeRecipeMatrix,
  newRecipeRow,
  type RecipeRow,
} from "@/components/shared/dialogs/per-size-recipe-matrix";
import { getBOMByCode, getBOMById } from "@/lib/services/supabase/bom";
import {
  createBOM,
  getBOMsByProduct,
  updateBOM,
  deleteBOM,
  getUOMConversions,
  replaceProductUOMConversions,
} from "@/lib/services";
// CEO 01/06/2026 — Sprint 2.4a
import {
  getVariantsByProduct,
  createVariant,
  updateVariant,
  deleteVariant,
} from "@/lib/services/supabase/variants";
import type { ProductVariant } from "@/lib/types";
import { useAuth } from "@/lib/contexts/auth-context";
import type { Product, BOMItem, UOMConversion } from "@/lib/types";
import { formatNumber, formatCurrency } from "@/lib/format";
import {
  buildUomConversion,
  getDirectConversionFactor,
  getDirectConvertibleUnits,
  getRecipeQuantityInInputUnit,
  getRecipeQuantityInStockUnit,
} from "@/lib/format-uom";
import { validateFnbVariantSetup } from "@/lib/fnb-product-setup-validation";
// CEO 01/06/2026 — Sprint 2.2d: tab "Tuỳ chọn FnB" trong form SP.
import {
  listModifierGroups,
  listCategoryModifierLinks,
  listProductModifierLinks,
  listModifierOptions,
  getEffectiveModifierGroupsForProduct,
  setProductModifierGroups,
  type ModifierGroup,
  type ModifierOption,
} from "@/lib/services/supabase/modifier-groups";
import {
  listBOMModifierOptionQuantities,
  saveBOMModifierOptionQuantities,
} from "@/lib/services/supabase/bom-modifier-option-quantities";
import {
  getFnbProductBranchMenuPolicy,
  saveFnbProductBranchMenuPolicy,
} from "@/lib/services/supabase/fnb-product-branch-menu";
import { invalidateMenuCache } from "@/lib/offline";

type ShelfLifeUnit = "day" | "month" | "year";
type SupplierOption = { id: string; name: string; code?: string };
type InnerTab = "info" | "pricing" | "bom" | "modifier" | "variants";

/**
 * CEO 01/06/2026 — Sprint 2.4a: Variant (Size M/L/XL) inline trong form SP.
 * Pattern Toast: 1 SKU + multi variants, mỗi variant giá + BOM riêng.
 * Cashier FnB pick size khi tap món → load variant.bom_code.
 */
interface InlineVariant {
  /** key ổn định client-side để gắn công thức theo size (kể cả variant chưa lưu). */
  key: string;
  /** UUID nếu đã có DB (edit). Null = newly added in this session. */
  id: string | null;
  name: string;
  sellPrice: number;
  costPrice: number;
  bomCode: string | null;
  isDefault: boolean;
  sortOrder: number;
}

interface InlineUomConversion {
  key: string;
  id: string | null;
  relatedUnit: string;
  factor: string;
  mainUnitRole: "small" | "large";
}

const newInlineUomConversion = (): InlineUomConversion => ({
  key: crypto.randomUUID(),
  id: null,
  relatedUnit: "",
  factor: "",
  mainUnitRole: "small",
});

/** Item trong bảng BOM inline (gắn với SKU đang tạo/sửa) */
interface InlineBomItem {
  materialId: string;
  materialCode: string;
  materialName: string;
  costPrice: number;
  unit: string;
  /** Canonical unit used for stock and costing; `unit` is the prep unit. */
  stockUnit: string;
  conversions: UOMConversion[];
  quantity: number;
  wastePercent: number;
  note?: string;
  /**
   * Link dòng NVL với một nhóm lựa chọn. Sau khi tạo BOM, người dùng có thể
   * khai định lượng đo thực tế của từng option trong màn sửa BOM. scale_factor
   * chỉ còn là cơ chế tương thích cho BOM chưa chuyển đổi.
   */
  modifierScaleTarget?: string | null;
}

function formatRecipeQuantity(value: number): string {
  return new Intl.NumberFormat("vi-VN", {
    maximumFractionDigits: 4,
  }).format(value);
}

// VAT phổ biến ở VN: 0% (không chịu), 5% (giảm thuế hoặc nông sản), 8%
// (giảm theo NĐ), 10% (chuẩn). User chọn "Khác..." để input tuỳ ý cho
// các trường hợp đặc biệt (8.5%, 12%, sản phẩm xuất khẩu, v.v.).
const VAT_PRESETS = ["0", "5", "8", "10"];
const VAT_CUSTOM = "__custom__";

// CEO 17/06/2026 (Phương án B): key ổn định cho variant + sinh mã BOM theo size.
let _vk = 0;
const newVariantKey = () => `vk${++_vk}`;
const sanitizeBomCode = (s: string) =>
  s.trim().toUpperCase().replace(/\s+/g, "");

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
  const [uomConversions, setUomConversions] = useState<InlineUomConversion[]>([]);
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
  // The compact product form must preserve and edit the same measured FnB
  // quantities as the full BOM editor. Keeping this state here avoids a
  // product save silently replacing a BOM and dropping its exact options.
  const [bomModifierGroups, setBomModifierGroups] = useState<ModifierGroup[]>([]);
  const [bomModifierOptionsByGroup, setBomModifierOptionsByGroup] = useState<
    Record<string, ModifierOption[]>
  >({});
  const [bomExactQuantityByKey, setBomExactQuantityByKey] = useState<
    Record<string, string>
  >({});
  const [bomExactRecipeEnabled, setBomExactRecipeEnabled] = useState(false);
  const [bomExactRecipeReady, setBomExactRecipeReady] = useState(false);
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
  // CEO 05/06/2026: default VAT = 0 — không tự áp thuế. Khi cần áp VAT cho
  // SP cụ thể, anh chọn 5/8/10% trong form tạo SP. Tránh POS tự cộng thuế.
  const [vatRate, setVatRate] = useState<string>("0");
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

  // CEO 01/06/2026 — Sprint 2.2d: Modifier picker cho SKU FnB.
  // Pattern Toast inheritance:
  //   - Mặc định: inherit từ category_modifier_groups của nhóm SP.
  //   - User có thể bật "Override" → set product_modifier_groups riêng cho SP này.
  const [availableFnbModifierGroups, setAvailableFnbModifierGroups] = useState<
    ModifierGroup[]
  >([]);
  const [inheritedModifierGroups, setInheritedModifierGroups] = useState<
    ModifierGroup[]
  >([]);
  const [productModifierGroupIds, setProductModifierGroupIds] = useState<
    Set<string>
  >(new Set());
  const [modifierMode, setModifierMode] = useState<"inherit" | "override">(
    "inherit",
  );
  const [loadingModifierPicker, setLoadingModifierPicker] = useState(false);

  // A FnB SKU is global until an explicit branch policy is saved. This is
  // intentionally separate from the product form, so changing a price can
  // never accidentally move or hide a menu.
  const [fnbMenuScopeMode, setFnbMenuScopeMode] = useState<
    "all" | "selected" | "excluded"
  >("all");
  const [fnbMenuBranchIds, setFnbMenuBranchIds] = useState<Set<string>>(
    new Set(),
  );
  const [loadingFnbMenuScope, setLoadingFnbMenuScope] = useState(false);
  const [savingFnbMenuScope, setSavingFnbMenuScope] = useState(false);
  const [fnbMenuScopeError, setFnbMenuScopeError] = useState<string | null>(null);

  // CEO 01/06/2026 — Sprint 2.4a: Variants Size (M/L/XL) inline editor.
  // Mỗi variant có giá riêng + BOM riêng (bom_code) — cho phép Size M dùng
  // 18g cà phê, Size L dùng 25g.
  const [variantItems, setVariantItems] = useState<InlineVariant[]>([]);
  // CEO 17/06/2026 (Phương án B): công thức theo size gộp ngay trong tab Quy
  // cách, lưu chung 1 lần. recipeRows = lưới NVL × size; recipeEnabled = toggle.
  const [recipeRows, setRecipeRows] = useState<RecipeRow[]>([]);
  const [recipeEnabled, setRecipeEnabled] = useState(false);
  // Track ID variants đã có sẵn ở DB để diff khi save (cũ nhưng user xoá).
  const [originalVariantIds, setOriginalVariantIds] = useState<Set<string>>(
    new Set(),
  );

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
      setUomConversions([]);
      setShelfLifeDays(initialData.shelfLifeDays ? String(initialData.shelfLifeDays) : "");
      setShelfLifeUnit((initialData.shelfLifeUnit as ShelfLifeUnit) || "day");
      setHasBom(!!initialData.hasBom);
      setBomItems([]);
      setBomExistingId(null);
      setBomName("");
      setBomNote("");
      setBomBranchId(null);
      setBomModifierGroups([]);
      setBomModifierOptionsByGroup({});
      setBomExactQuantityByKey({});
      setBomExactRecipeEnabled(false);
      setBomExactRecipeReady(false);
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
      setUomConversions([]);
      setShelfLifeDays("");
      setShelfLifeUnit("day");
      setHasBom(false);
      setBomItems([]);
      setBomExistingId(null);
      setBomName("");
      setBomNote("");
      setBomBranchId(null);
      setBomModifierGroups([]);
      setBomModifierOptionsByGroup({});
      setBomExactQuantityByKey({});
      setBomExactRecipeEnabled(false);
      setBomExactRecipeReady(false);
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
        // có thể không return items → cần fetch. Keep the preparation snapshot
        // here, otherwise this compact form would turn 35 G back into .035 Kg.
        const fullBom = await getBOMById(bom.id);
        const loadedItems = await Promise.all(
          (fullBom.items ?? []).map(async (it: BOMItem) => ({
            materialId: it.materialId,
            materialCode: it.materialCode ?? "",
            materialName: it.materialName ?? "",
            costPrice: it.materialCostPrice ?? 0,
            unit: it.inputUnit ?? it.unit,
            stockUnit: it.unit,
            conversions: await getUOMConversions(it.materialId).catch(() => []),
            quantity: it.inputQuantity ?? it.quantity,
            wastePercent: it.wastePercent ?? 0,
            note: it.note,
            modifierScaleTarget: it.modifierScaleTarget ?? null,
          })),
        );
        if (cancelled) return;
        setBomItems(loadedItems);

        try {
          const groups = (await getEffectiveModifierGroupsForProduct(
            initialData.id,
            initialData.categoryId ?? null,
          )).filter((group) => group.rule === "single" || group.rule === "single_required");
          const optionEntries = await Promise.all(
            groups.map(async (group) => [group.id, await listModifierOptions(group.id)] as const),
          );
          const savedQuantities = await listBOMModifierOptionQuantities(bom.id);
          if (cancelled) return;

          const quantities: Record<string, string> = {};
          for (const row of savedQuantities) {
            const item = loadedItems.find((candidate) => candidate.materialId === row.materialId);
            const inputQuantity = item
              ? getRecipeQuantityInInputUnit(
                  row.quantity,
                  item.stockUnit,
                  item.unit,
                  item.conversions,
                )
              : null;
            if (inputQuantity != null) {
              quantities[`${row.materialId}:${row.modifierOptionId}`] = String(inputQuantity);
            }
          }
          setBomModifierGroups(groups);
          setBomModifierOptionsByGroup(Object.fromEntries(optionEntries));
          setBomExactQuantityByKey(quantities);
          setBomExactRecipeEnabled(savedQuantities.length > 0);
          setBomExactRecipeReady(true);
        } catch (exactError) {
          console.warn("Exact FnB recipe quantities are unavailable:", exactError);
          if (cancelled) return;
          setBomModifierGroups([]);
          setBomModifierOptionsByGroup({});
          setBomExactQuantityByKey({});
          setBomExactRecipeEnabled(false);
          setBomExactRecipeReady(false);
        }
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
        const matches = convs.filter(
          (c) => c.toUnit === productUnit || c.fromUnit === productUnit,
        );
        setUomConversions(
          matches.map((match) => {
            const mainIsLarge = match.fromUnit === productUnit;
            return {
              key: match.id,
              id: match.id,
              relatedUnit: mainIsLarge ? match.toUnit : match.fromUnit,
              factor: String(match.factor),
              mainUnitRole: mainIsLarge ? "large" : "small",
            };
          }),
        );
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

  // CEO 01/06/2026 — Sprint 2.2d: Load modifier picker khi dialog mở cho SKU FnB.
  // Reset khi đóng / switch sang NVL / Retail.
  // CEO 01/06/2026 — Bước 1 (perf): LAZY load — chỉ fetch khi user thực sự
  // bấm vào tab "Tuỳ chọn FnB". Trước đây dialog mở là fetch ngay 8 API
  // song song → renderer freeze trên máy chậm. Giờ tab Thông tin nhẹ, các
  // tab khác fetch on-demand. Track loadedRef để khỏi re-fetch khi switch tab.
  useEffect(() => {
    if (!open || scope !== "sku" || channel !== "fnb") {
      setAvailableFnbModifierGroups([]);
      setInheritedModifierGroups([]);
      setProductModifierGroupIds(new Set());
      setModifierMode("inherit");
      return;
    }
    // LAZY: chỉ fetch khi user đã bấm tab modifier ít nhất 1 lần.
    if (innerTab !== "modifier") return;
    let cancelled = false;
    setLoadingModifierPicker(true);
    (async () => {
      try {
        // 1. Load available groups (channel=fnb hoặc all)
        const all = await listModifierGroups();
        const fnbGroups = all.filter(
          (g) => g.channel === "fnb" || g.channel === "all",
        );
        if (cancelled) return;
        setAvailableFnbModifierGroups(fnbGroups);

        // 2. Load inherited từ category
        if (categoryId) {
          const links = await listCategoryModifierLinks(categoryId);
          if (cancelled) return;
          const inheritedIds = new Set(links.map((l) => l.modifierGroupId));
          setInheritedModifierGroups(
            fnbGroups.filter((g) => inheritedIds.has(g.id)),
          );
        } else {
          setInheritedModifierGroups([]);
        }

        // 3. Load SP-level override (chỉ edit mode)
        if (initialData) {
          const productLinks = await listProductModifierLinks(initialData.id);
          if (cancelled) return;
          if (productLinks.length > 0) {
            setModifierMode("override");
            setProductModifierGroupIds(
              new Set(productLinks.map((l) => l.modifierGroupId)),
            );
          } else {
            setModifierMode("inherit");
            setProductModifierGroupIds(new Set());
          }
        } else {
          setModifierMode("inherit");
          setProductModifierGroupIds(new Set());
        }
      } catch (err) {
        console.warn("Load modifier picker failed:", err);
      } finally {
        if (!cancelled) setLoadingModifierPicker(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, scope, channel, categoryId, initialData, innerTab]);

  // Lazy-load branch menu policy only when the FnB configuration tab is opened.
  // Older deployed databases simply show a clear migration message; editing
  // normal product information remains available until 00354 is installed.
  useEffect(() => {
    if (!open || scope !== "sku" || channel !== "fnb" || !initialData) {
      setFnbMenuScopeMode("all");
      setFnbMenuBranchIds(new Set());
      setFnbMenuScopeError(null);
      return;
    }
    if (innerTab !== "modifier") return;

    let cancelled = false;
    setLoadingFnbMenuScope(true);
    setFnbMenuScopeError(null);
    getFnbProductBranchMenuPolicy(initialData.id)
      .then((policy) => {
        if (cancelled) return;
        setFnbMenuBranchIds(new Set(policy.branchIds));
        setFnbMenuScopeMode(
          policy.mode === "only"
            ? "selected"
            : policy.mode === "except"
              ? "excluded"
              : "all",
        );
      })
      .catch((err) => {
        if (cancelled) return;
        setFnbMenuScopeError(
          err instanceof Error
            ? err.message
            : "Không tải được phạm vi menu FnB.",
        );
      })
      .finally(() => {
        if (!cancelled) setLoadingFnbMenuScope(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, scope, channel, initialData, innerTab]);

  function toggleProductModifierGroup(groupId: string) {
    setProductModifierGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  function toggleFnbMenuBranch(branchId: string) {
    setFnbMenuBranchIds((previous) => {
      const next = new Set(previous);
      if (next.has(branchId)) next.delete(branchId);
      else next.add(branchId);
      return next;
    });
  }

  async function handleSaveFnbMenuScope() {
    if (!initialData) return;
    const branchIds = Array.from(fnbMenuBranchIds);
    if (fnbMenuScopeMode !== "all" && branchIds.length === 0) {
      toast({
        title: "Chọn ít nhất một chi nhánh",
        description: "Hoặc chuyển về Bán tại tất cả chi nhánh.",
        variant: "warning",
      });
      return;
    }

    setSavingFnbMenuScope(true);
    try {
      await saveFnbProductBranchMenuPolicy(
        initialData.id,
        fnbMenuScopeMode === "selected"
          ? "only"
          : fnbMenuScopeMode === "excluded"
            ? "except"
            : "all",
        fnbMenuScopeMode === "all" ? [] : branchIds,
      );
      // This browser may also be running POS in another tab. Clearing the
      // local cache makes its next load re-read the server whitelist.
      await invalidateMenuCache();
      toast({
        title: "Đã lưu phạm vi menu FnB",
        description:
          fnbMenuScopeMode === "selected"
            ? `Món chỉ hiện tại ${branchIds.length} chi nhánh đã chọn.`
            : fnbMenuScopeMode === "excluded"
              ? `Món bị ẩn tại ${branchIds.length} chi nhánh đã chọn.`
              : "Món đang bán tại tất cả chi nhánh FnB.",
        variant: "success",
      });
      onSuccess?.();
    } catch (err) {
      toast({
        title: "Chưa lưu được phạm vi menu",
        description:
          err instanceof Error ? err.message : "Lỗi không xác định.",
        variant: "error",
        duration: 10000,
      });
    } finally {
      setSavingFnbMenuScope(false);
    }
  }

  // CEO 01/06/2026 — Sprint 2.4a + Bước 1 (perf): LAZY load variants
  // chỉ khi user bấm tab "Quy cách". Tránh fetch eager + dialog freeze.
  useEffect(() => {
    if (!open || !initialData || initialData.productType !== "sku") {
      setVariantItems([]);
      setOriginalVariantIds(new Set());
      return;
    }
    if (innerTab !== "variants") return;
    let cancelled = false;
    (async () => {
      try {
        const variants = await getVariantsByProduct(initialData.id);
        if (cancelled) return;
        setVariantItems(
          variants.map((v: ProductVariant) => ({
            key: v.id, // existing variant → key = id (ổn định)
            id: v.id,
            name: v.name,
            sellPrice: v.sellPrice,
            costPrice: v.costPrice,
            bomCode: v.bomCode ?? null,
            isDefault: v.isDefault,
            sortOrder: v.sortOrder,
          })),
        );
        setOriginalVariantIds(new Set(variants.map((v) => v.id)));

        // CEO 17/06/2026 (Phương án B): nạp công thức theo size sẵn có vào lưới
        // (chỉ FnB). Gộp item theo (NVL + scale-target); qty keyed theo variant id.
        if (channel === "fnb") {
          const rowMap = new Map<string, RecipeRow>();
          for (const v of variants) {
            if (!v.bomCode) continue;
            try {
              const boms = await getBOMByCode(v.bomCode);
              const bom = boms.find((b) => !b.branchId) ?? boms[0];
              if (!bom) continue;
              const full = await getBOMById(bom.id);
              for (const it of full.items ?? []) {
                const sk = it.modifierScaleTarget ?? "";
                const rkey = `${it.materialId}|${sk}`;
                let row = rowMap.get(rkey);
                if (!row) {
                  row = newRecipeRow();
                  row.materialId = it.materialId;
                  row.unit = it.unit || "";
                  row.scaleTarget = it.modifierScaleTarget ?? null;
                  rowMap.set(rkey, row);
                }
                row.qty[v.id] = it.quantity;
              }
            } catch {
              /* bỏ qua BOM lỗi 1 size, vẫn nạp các size khác */
            }
          }
          if (cancelled) return;
          const loaded = [...rowMap.values()];
          setRecipeRows(loaded);
          setRecipeEnabled(loaded.length > 0);
        }
      } catch (err) {
        console.warn("Load variants failed:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, initialData, innerTab, channel]);

  // Helper: add empty variant row.
  // CEO 01/06/2026: tên để trống mặc định — placeholder gợi ý M/L/XL/250ml/...,
  // anh tự đặt theo nhu cầu (không ép FnB Size, có thể là Retail "250g/500g/1kg").
  function addVariantRow() {
    setVariantItems((prev) => [
      ...prev,
      {
        key: newVariantKey(),
        id: null,
        name: "",
        sellPrice: 0,
        costPrice: 0,
        bomCode: null,
        // Force first variant default
        isDefault: prev.length === 0,
        sortOrder: prev.length,
      },
    ]);
  }

  // Set 1 variant default → uncheck others
  function setVariantDefault(idx: number) {
    setVariantItems((prev) =>
      prev.map((v, i) => ({ ...v, isDefault: i === idx })),
    );
  }

  function removeVariantRow(idx: number) {
    setVariantItems((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      // Nếu xoá default → force first thành default
      if (next.length > 0 && !next.some((v) => v.isDefault)) {
        next[0].isDefault = true;
      }
      return next;
    });
  }

  // CEO 01/06/2026 — Sprint 2.4a: sync variants với DB.
  // Diff: old not in current → delete; current with id → update;
  //       current without id → create.
  // CEO 17/06/2026 (Phương án B): trả về map (variant.key → {id, bomCode}) để
  // bước lưu công thức theo size gắn BOM đúng variant (kể cả variant vừa tạo).
  async function syncVariants(
    productId: string,
  ): Promise<Map<string, { id: string; bomCode: string | null }>> {
    const vmap = new Map<string, { id: string; bomCode: string | null }>();
    const currentIds = new Set(
      variantItems.filter((v) => v.id).map((v) => v.id as string),
    );
    // 1. Delete old variants không còn trong list (soft delete)
    for (const oldId of originalVariantIds) {
      if (!currentIds.has(oldId)) {
        try {
          await deleteVariant(oldId);
        } catch (err) {
          console.warn("deleteVariant failed:", err);
        }
      }
    }
    // 2. Create or update current items
    for (let i = 0; i < variantItems.length; i++) {
      const v = variantItems[i];
      if (v.id) {
        await updateVariant(v.id, {
          name: v.name.trim() || "Default",
          sellPrice: v.sellPrice,
          costPrice: v.costPrice,
          bomCode: v.bomCode,
          isDefault: v.isDefault,
          sortOrder: i,
        });
        vmap.set(v.key, { id: v.id, bomCode: v.bomCode });
      } else {
        const created = await createVariant({
          productId,
          name: v.name.trim() || "Default",
          sellPrice: v.sellPrice,
          costPrice: v.costPrice,
          bomCode: v.bomCode,
          isDefault: v.isDefault,
          sortOrder: i,
        });
        if (created?.id) vmap.set(v.key, { id: created.id, bomCode: v.bomCode });
      }
    }
    return vmap;
  }

  // CEO 17/06/2026 (Phương án B): lưu công thức theo size (CHỈ FnB) — mỗi variant
  // 1 BOM riêng (code = bomCode cũ hoặc MãSP-Size). Mirror logic dialog cũ nhưng
  // chạy chung trong handleSave để 1 nút Lưu là xong cả size + công thức.
  async function syncPerSizeRecipes(
    productId: string,
    productCode: string,
    vmap: Map<string, { id: string; bomCode: string | null }>,
  ): Promise<void> {
    const valid = recipeRows.filter((r) => r.materialId);
    for (const v of variantItems) {
      const persisted = vmap.get(v.key);
      if (!persisted) continue;
      const items = valid
        .map((r) => ({
          materialId: r.materialId,
          quantity: r.qty[v.key] ?? 0,
          unit: r.unit || "g",
          modifierScaleTarget: r.scaleTarget,
        }))
        .filter((it) => it.quantity > 0);

      const code =
        persisted.bomCode?.trim() ||
        `${productCode}-${sanitizeBomCode(v.name || "SIZE")}`;

      // Thay công thức: xoá-mềm mọi BOM cùng code rồi tạo lại (lookup theo code).
      try {
        const existing = await getBOMByCode(code);
        for (const b of existing) {
          try {
            await deleteBOM(b.id);
          } catch {
            /* bỏ qua */
          }
        }
      } catch {
        /* getBOMByCode lỗi → vẫn thử tạo mới */
      }

      if (items.length > 0) {
        await createBOM({
          productId,
          variantId: persisted.id,
          code,
          name: `${name} ${v.name}`.trim(),
          items,
        });
        if (persisted.bomCode !== code) {
          await updateVariant(persisted.id, { bomCode: code });
        }
      } else {
        throw new Error(
          `Quy cách ${v.name.trim() || "chưa đặt tên"} chưa có công thức riêng.`,
        );
      }
    }
    // SP phải has_bom=true để khi bán mới trừ NVL theo công thức size.
    await updateProduct(productId, { hasBom: true });
  }

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

  // CEO 01/06/2026 — Bước 1 (perf): LAZY load material options (1000 SP, ~100KB)
  // chỉ khi user bật hasBom + bấm tab "bom" (Công thức). Trước đây fetch eager
  // mỗi lần mở dialog → dialog freeze. Giờ chỉ tab BOM mới fetch.
  useEffect(() => {
    // Load NVL khi: (a) tab BOM + hasBom, HOẶC (b) tab Quy cách + FnB (cho lưới
    // công thức theo size — Phương án B cần materials để chọn NVL + tính giá vốn).
    const needForBom = hasBom && innerTab === "bom";
    const needForRecipe = channel === "fnb" && innerTab === "variants";
    if (!open || scope !== "sku" || (!needForBom && !needForRecipe)) return;
    if (materialOptions.length > 0) return; // dedup — đã load
    let cancelled = false;
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
  }, [open, scope, hasBom, innerTab, materialOptions.length, channel]);

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

  function buildInlineExactQuantityRows() {
    const targets = bomItems.filter((item) => item.modifierScaleTarget);
    if (targets.length === 0) return [];
    if (!bomExactRecipeReady) {
      throw new Error(
        "Chưa tải được định lượng riêng của BOM. Tải lại form trước khi lưu để tránh mất cấu hình đang có.",
      );
    }
    if (!bomExactRecipeEnabled) return [];

    const rows = targets.flatMap((item) => {
      const options = bomModifierOptionsByGroup[item.modifierScaleTarget ?? ""] ?? [];
      if (options.length === 0) {
        throw new Error(
          `Nhóm lựa chọn của ${item.materialName} chưa có lựa chọn đang bật.`,
        );
      }
      return options.map((option) => ({
        materialId: item.materialId,
        modifierOptionId: option.id,
        value: bomExactQuantityByKey[`${item.materialId}:${option.id}`]?.trim() ?? "",
      }));
    });
    const invalid = rows.find((row) => {
      const quantity = Number(row.value);
      return row.value === "" || !Number.isFinite(quantity) || quantity < 0;
    });
    if (invalid) {
      throw new Error(
        "Đã bật định lượng riêng thì phải nhập số hợp lệ cho mọi lựa chọn. Nhập 0 khi lựa chọn không dùng nguyên liệu.",
      );
    }

    return rows.map((row) => {
      const item = bomItems.find((candidate) => candidate.materialId === row.materialId);
      if (!item) throw new Error("Không tìm thấy nguyên liệu của định lượng riêng.");
      if (
        getRecipeQuantityInStockUnit(
          Number(row.value),
          item.stockUnit,
          item.unit,
          item.conversions,
        ) == null
      ) {
        throw new Error(
          `${item.materialName} chưa có quy đổi từ ${item.unit} sang đơn vị tồn ${item.stockUnit}.`,
        );
      }
      return {
        materialId: row.materialId,
        modifierOptionId: row.modifierOptionId,
        inputQuantity: Number(row.value),
        inputUnit: item.unit,
      };
    });
  }

  async function handleSave() {
    if (!validate()) return;

    const fnbSetupIssues = validateFnbVariantSetup({
      isFnb: scope === "sku" && channel === "fnb",
      variants: variantItems,
      recipeEnabled,
      recipeRows,
    });
    if (fnbSetupIssues.length > 0) {
      setInnerTab("variants");
      toast({
        variant: "error",
        title: "Chưa thể lưu quy cách FnB",
        description: fnbSetupIssues[0].message,
        duration: 10000,
      });
      return;
    }

    let inlineExactQuantityRows: ReturnType<typeof buildInlineExactQuantityRows>;
    try {
      inlineExactQuantityRows = buildInlineExactQuantityRows();
    } catch (exactError) {
      setInnerTab("bom");
      toast({
        variant: "error",
        title: "Chưa thể lưu công thức FnB",
        description: exactError instanceof Error ? exactError.message : "Định lượng riêng chưa hợp lệ.",
        duration: 10000,
      });
      return;
    }

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
      const mainUnit = (commonPayload.unit ?? "").trim();
      const normalizedConversions = uomConversions.map((item) => ({
        ...item,
        relatedUnit: item.relatedUnit.trim(),
        factorNumber: Number(item.factor),
      }));
      const invalidConversion = normalizedConversions.some(
        (item) =>
          !item.relatedUnit ||
          !Number.isFinite(item.factorNumber) ||
          item.factorNumber < 0.0001 ||
          item.relatedUnit.toLocaleLowerCase("vi") === mainUnit.toLocaleLowerCase("vi"),
      );
      const duplicateConversion = normalizedConversions.some(
        (item, index) =>
          normalizedConversions.findIndex(
            (candidate) =>
              candidate.relatedUnit.toLocaleLowerCase("vi") ===
              item.relatedUnit.toLocaleLowerCase("vi"),
          ) !== index,
      );
      if (invalidConversion || duplicateConversion) {
        toast({
          variant: "error",
          title: "Quy đổi đơn vị không hợp lệ",
          description:
            duplicateConversion
              ? "Có hai dòng cùng đơn vị quy đổi."
              : "Mỗi dòng cần đủ đơn vị, hệ số từ 0,0001 và không trùng đơn vị chính.",
        });
        setSaving(false);
        return;
      }

      if (isEdit && initialData) {
        const nonUnitPayload: Partial<typeof commonPayload> = { ...commonPayload };
        delete nonUnitPayload.unit;
        delete nonUnitPayload.purchaseUnit;
        delete nonUnitPayload.stockUnit;
        delete nonUnitPayload.sellUnit;
        // EDIT — giữ nguyên code/productType, không đổi groupCode.
        await updateProduct(initialData.id, {
          ...nonUnitPayload,
          // Day 18/05/2026: cho phép user TẮT hasBom trong edit — phải sync DB
          hasBom: scope === "sku" ? hasBom : false,
        });

        // Day 19/05/2026 (CEO UOM): sync quy đổi đơn vị (CRUD UOMConversion)
        await replaceProductUOMConversions(
          initialData.id,
          mainUnit,
          normalizedConversions.map((item) =>
            buildUomConversion(
              mainUnit,
              item.relatedUnit,
              item.factorNumber,
              item.mainUnitRole,
            ),
          ),
        );

        // Day 18/05/2026 (CEO refactor): sync BOM khi edit SKU
        if (scope === "sku") {
          if (hasBom && bomItems.length > 0) {
            // Update the existing BOM in place. Replacing it with a new BOM id
            // used to orphan the exact FnB option quantities configured here.
            try {
              let savedBomId: string;
              const items = bomItems.map((it, idx) => ({
                materialId: it.materialId,
                quantity: it.quantity,
                unit: it.unit,
                wastePercent: it.wastePercent,
                sortOrder: idx,
                modifierScaleTarget: it.modifierScaleTarget ?? null,
              }));
              if (bomExistingId) {
                await updateBOM(bomExistingId, {
                  branchId: bomBranchId,
                  name: bomName || `Công thức cho ${name}`,
                  note: bomNote || undefined,
                  items,
                });
                savedBomId = bomExistingId;
              } else {
                const createdBom = await createBOM({
                  productId: initialData.id,
                  branchId: bomBranchId,
                  name: bomName || `Công thức cho ${name}`,
                  note: bomNote || undefined,
                  items,
                });
                savedBomId = createdBom.id;
              }
              if (channel === "fnb") {
                await saveBOMModifierOptionQuantities(
                  savedBomId,
                  inlineExactQuantityRows,
                );
              }
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

        // CEO 01/06/2026 — Sprint 2.2d: Sync product_modifier_groups.
        // - Mode "inherit"  → set [] để clear override (POS fallback inherit từ nhóm).
        // - Mode "override" → set list tick.
        if (scope === "sku" && channel === "fnb") {
          try {
            const ids =
              modifierMode === "override"
                ? Array.from(productModifierGroupIds)
                : [];
            await setProductModifierGroups(initialData.id, ids);
          } catch (modErr) {
            console.warn("Save product modifier links failed:", modErr);
            toast({
              variant: "warning",
              title: "Đã lưu SP nhưng lỗi gán Tuỳ chọn",
              description:
                modErr instanceof Error
                  ? modErr.message
                  : "Anh có thể sửa lại sau từ form SP.",
            });
          }
        }

        // CEO 01/06/2026 — Sprint 2.4a: Sync variants (Size M/L/XL).
        if (scope === "sku") {
          try {
            const vmap = await syncVariants(initialData.id);
            if (channel === "fnb" && recipeEnabled) {
              await syncPerSizeRecipes(
                initialData.id,
                initialData.code ?? "",
                vmap,
              );
            }
          } catch (varErr) {
            console.warn("Save variants failed:", varErr);
            toast({
              variant: "warning",
              title: "Đã lưu SP nhưng lỗi Quy cách",
              description:
                varErr instanceof Error
                  ? varErr.message
                  : "Vui lòng vào lại form sửa Quy cách.",
            });
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
              modifierScaleTarget: it.modifierScaleTarget ?? null,
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
      if (created?.id && normalizedConversions.length > 0) {
        try {
          await replaceProductUOMConversions(
            created.id,
            mainUnit,
            normalizedConversions.map((item) =>
              buildUomConversion(
                mainUnit,
                item.relatedUnit,
                item.factorNumber,
                item.mainUnitRole,
              ),
            ),
          );
        } catch (convErr) {
          console.warn(
            "[create-product-dialog] tạo UOM conversion fail:",
            convErr,
          );
          toast({
            variant: "warning",
            title: "Sản phẩm đã tạo, quy đổi chưa được lưu",
            description:
              convErr instanceof Error
                ? convErr.message
                : "Kiểm tra lại quyền và các dòng quy đổi.",
            duration: 10000,
          });
          onOpenChange(false);
          onSuccess?.();
          return;
        }
      }

      // CEO 01/06/2026 — Sprint 2.2d: Sync product_modifier_groups khi tạo
      // SP FnB. Mode "override" → set list tick; "inherit" → bỏ qua (mặc định).
      if (
        created?.id &&
        scope === "sku" &&
        channel === "fnb" &&
        modifierMode === "override" &&
        productModifierGroupIds.size > 0
      ) {
        try {
          await setProductModifierGroups(
            created.id,
            Array.from(productModifierGroupIds),
          );
        } catch (modErr) {
          console.warn(
            "[create-product-dialog] sync product modifier links failed:",
            modErr,
          );
        }
      }

      // CEO 01/06/2026 — Sprint 2.4a: Sync variants khi tạo SKU.
      if (created?.id && scope === "sku" && variantItems.length > 0) {
        try {
          const vmap = await syncVariants(created.id);
          if (channel === "fnb" && recipeEnabled) {
            await syncPerSizeRecipes(created.id, code, vmap);
          }
        } catch (varErr) {
          console.warn(
            "[create-product-dialog] sync variants failed:",
            varErr,
          );
          toast({
            variant: "warning",
            title: "SP đã tạo nhưng lỗi Quy cách",
            description:
              varErr instanceof Error
                ? varErr.message
                : "Vui lòng vào lại form sửa Quy cách.",
          });
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
      // CEO 01/06/2026: dịch lỗi Postgres phổ biến sang tiếng Việt dễ hiểu
      // thay vì raw "[createProduct] duplicate key value violates ...".
      const rawMsg = err instanceof Error ? err.message : String(err);
      let friendly = rawMsg;
      if (rawMsg.includes("products_tenant_id_code_key") || rawMsg.includes("duplicate key")) {
        friendly = `Mã hàng đề xuất bị trùng với hàng đã có sẵn (vd do import từ phần mềm cũ). Hệ thống cần đồng bộ counter — anh báo dev apply migration 00119, hoặc thử "Lưu" lại sau vài giây.`;
      } else if (rawMsg.toLowerCase().includes("not-null") || rawMsg.includes("23502")) {
        friendly = `Còn thiếu trường bắt buộc trong form. Vui lòng điền đủ các ô có dấu (*).`;
      } else if (rawMsg.toLowerCase().includes("foreign key") || rawMsg.includes("23503")) {
        friendly = `Có ràng buộc liên kết bị vi phạm (vd nhóm hàng không tồn tại). Chọn lại nhóm hàng hợp lệ rồi thử lại.`;
      } else if (rawMsg.toLowerCase().includes("network") || rawMsg.toLowerCase().includes("failed to fetch")) {
        friendly = `Mất kết nối mạng. Kiểm tra wifi rồi thử lại.`;
      }
      toast({
        title: isEdit ? "Lỗi cập nhật hàng hóa" : "Lỗi tạo hàng hóa",
        description: friendly,
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl max-h-[92vh] overflow-x-hidden overflow-y-auto">
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
            {/* CEO 01/06/2026 — Sprint 2.2d: Tab Tuỳ chọn FnB cho SKU FnB */}
            {scope === "sku" && channel === "fnb" && (
              <TabsTrigger value="modifier" className="flex-1">
                <Icon name="tune" size={14} className="mr-1" />
                Tuỳ chọn FnB
              </TabsTrigger>
            )}
            {/* CEO 01/06/2026 — Sprint 2.4a: Tab Quy cách (Variants Size) cho SKU */}
            {scope === "sku" && (
              <TabsTrigger value="variants" className="flex-1">
                <Icon name="straighten" size={14} className="mr-1" />
                Quy cách
                {variantItems.length > 0 && (
                  <span className="ml-1 inline-flex items-center justify-center h-4 min-w-[16px] px-1 text-[10px] font-bold rounded-full bg-primary text-primary-foreground">
                    {variantItems.length}
                  </span>
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

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Nhóm hàng <span className="text-destructive">*</span>
              </label>
              <Select
                // CEO 23/05/2026: key={scope} buộc Select REMOUNT khi user
                // switch NVL ↔ SKU trong dialog tạo mới. Trước đây Base UI
                // Select reuse cùng instance giữa 2 scope → state internal
                // (popper position, items list) bị stale → click trigger
                // không expand được dropdown ở scope thứ 2. Force remount
                // = state fresh = dropdown sổ đúng mỗi lần.
                key={`category-select-${scope}`}
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                Đơn vị hệ thống dùng để quản lý tồn của sản phẩm.
              </p>
            </div>

            <div className="rounded-lg border border-dashed bg-muted/20 p-3 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-sm font-medium">
                  Quy đổi đơn vị{" "}
                  <span className="text-xs text-muted-foreground font-normal">
                    · tuỳ chọn
                  </span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setUomConversions((current) => [
                      ...current,
                      newInlineUomConversion(),
                    ])
                  }
                >
                  <Icon name="add" size={14} className="mr-1" />
                  Thêm quy đổi
                </Button>
              </div>
              {uomConversions.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  Có thể thêm nhiều quy đổi, ví dụ 1 Túi = 15 Trái và 1 Thùng = 12 Túi.
                </p>
              ) : (
                <div className="space-y-2">
                  {uomConversions.map((item) => {
                    const mainIsLarge = item.mainUnitRole === "large";
                    const valid =
                      item.relatedUnit.trim() &&
                      Number(item.factor) > 0 &&
                      item.relatedUnit.trim().toLocaleLowerCase("vi") !==
                        stockUnit.trim().toLocaleLowerCase("vi");
                    return (
                      <div
                        key={item.key}
                        className="rounded-md border bg-background p-2"
                      >
                        <div className="grid grid-cols-[minmax(0,1fr)_8rem_8rem_2.25rem] items-end gap-2 max-sm:grid-cols-[minmax(0,1fr)_2.25rem]"
                        >
                          <div className="space-y-1 max-sm:col-span-2">
                            <label className="text-xs text-muted-foreground">
                              Đơn vị quy đổi
                            </label>
                            <Input
                              value={item.relatedUnit}
                              onChange={(event) =>
                                setUomConversions((current) =>
                                  current.map((conversion) =>
                                    conversion.key === item.key
                                      ? { ...conversion, relatedUnit: event.target.value }
                                      : conversion,
                                  ),
                                )
                              }
                              placeholder={mainIsLarge ? "VD: Hộp" : "VD: Thùng"}
                            />
                          </div>
                          <div className="space-y-1 max-sm:col-start-1">
                            <label className="text-xs text-muted-foreground">
                              Chiều quy đổi
                            </label>
                            <Select
                              value={item.mainUnitRole}
                              onValueChange={(value) =>
                                setUomConversions((current) =>
                                  current.map((conversion) =>
                                    conversion.key === item.key
                                      ? {
                                          ...conversion,
                                          mainUnitRole: value as "small" | "large",
                                        }
                                      : conversion,
                                  ),
                                )
                              }
                            >
                              <SelectTrigger className="h-9">
                                <SelectValue>
                                  {mainIsLarge ? "ĐVT chính lớn" : "ĐVT chính nhỏ"}
                                </SelectValue>
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="small">ĐVT chính nhỏ</SelectItem>
                                <SelectItem value="large">ĐVT chính lớn</SelectItem>
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="space-y-1 max-sm:col-start-1">
                            <label className="text-xs text-muted-foreground">
                              Hệ số
                            </label>
                            <Input
                              type="number"
                              min={0.0001}
                              step="any"
                              value={item.factor}
                              onChange={(event) =>
                                setUomConversions((current) =>
                                  current.map((conversion) =>
                                    conversion.key === item.key
                                      ? { ...conversion, factor: event.target.value }
                                      : conversion,
                                  ),
                                )
                              }
                              placeholder="VD: 12"
                            />
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            title="Xóa dòng quy đổi"
                            aria-label="Xóa dòng quy đổi"
                            onClick={() =>
                              setUomConversions((current) =>
                                current.filter(
                                  (conversion) => conversion.key !== item.key,
                                ),
                              )
                            }
                          >
                            <Icon name="delete" size={16} />
                          </Button>
                        </div>
                        {valid && (
                          <p className="mt-1.5 text-xs text-primary">
                            1 {mainIsLarge ? stockUnit.trim() : item.relatedUnit.trim()} ={" "}
                            {formatNumber(Number(item.factor))}{" "}
                            {mainIsLarge ? item.relatedUnit.trim() : stockUnit.trim()}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
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
                <NumericInput
                  value={costPrice === "" ? null : Number(costPrice)}
                  onChange={(value) =>
                    setCostPrice(value == null ? "" : String(value))
                  }
                  min={0}
                  decimals={4}
                  placeholder="0"
                />
                {/* Có công thức thì giá vốn do công thức quyết định (00236) —
                    nói rõ để không ai sửa tay rồi tưởng bị mất số. */}
                {hasBom && (
                  <p className="text-xs text-muted-foreground">
                    Tự tính từ công thức. Sửa tay sẽ bị ghi đè khi công thức
                    hoặc giá nguyên liệu thay đổi.
                  </p>
                )}
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
                <NumericInput
                  value={sellPrice === "" ? null : Number(sellPrice)}
                  onChange={(value) =>
                    setSellPrice(value == null ? "" : String(value))
                  }
                  min={0}
                  decimals={0}
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
                          <th className="text-right px-3 py-2 font-semibold w-28">Số lượng</th>
                          <th className="text-left px-3 py-2 font-semibold w-20">ĐVT</th>
                          {/* Nhóm chọn một dùng định lượng chính xác theo option. */}
                          {channel === "fnb" && (
                            <th
                              className="text-left px-3 py-2 font-semibold w-40"
                              title="Gắn nhóm lựa chọn cho dòng NVL và nhập định lượng thực tế theo từng lựa chọn ngay bên dưới."
                            >
                              Theo lựa chọn FnB
                            </th>
                          )}
                          <th className="text-right px-3 py-2 font-semibold w-28">Cost/SP</th>
                          <th className="w-10"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {bomItems.map((it, idx) => {
                          const conversionFactor = getDirectConversionFactor(
                            it.stockUnit,
                            it.unit,
                            it.conversions,
                          ) ?? 0;
                          const lineCost = it.quantity * conversionFactor * it.costPrice;
                          const stockQuantity = getRecipeQuantityInStockUnit(
                            it.quantity,
                            it.stockUnit,
                            it.unit,
                            it.conversions,
                          );
                          const isConverted = it.stockUnit.trim().toLocaleLowerCase("vi") !== it.unit.trim().toLocaleLowerCase("vi");
                          return (
                            <tr key={`${it.materialId}-${idx}`} className="border-t border-border">
                              <td className="px-3 py-2">
                                <div className="font-medium">{it.materialName}</div>
                                <div className="text-xs text-muted-foreground">{it.materialCode}</div>
                                {isConverted && stockQuantity != null && (
                                  <div className="mt-1 text-xs text-primary">
                                    Pha chế {formatRecipeQuantity(it.quantity)} {it.unit} · Trừ tồn {formatRecipeQuantity(stockQuantity)} {it.stockUnit}
                                  </div>
                                )}
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
                                <Select
                                  value={it.unit}
                                  onValueChange={(value) => {
                                    if (!value) return;
                                    setBomItems((prev) =>
                                      prev.map((p, i) =>
                                        i === idx ? { ...p, unit: value } : p,
                                      ),
                                    );
                                  }}
                                  items={getDirectConvertibleUnits(it.stockUnit, it.conversions).map((unit) => ({
                                    value: unit,
                                    label: unit,
                                  }))}
                                >
                                  <SelectTrigger className="h-9 min-w-[76px] text-sm">
                                    <SelectValue>{it.unit}</SelectValue>
                                  </SelectTrigger>
                                  <SelectContent>
                                    {getDirectConvertibleUnits(it.stockUnit, it.conversions).map((unit) => (
                                      <SelectItem key={unit} value={unit}>{unit}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </td>
                              {/* Nhóm lựa chọn FnB gắn với dòng NVL này. */}
                              {channel === "fnb" && (
                                <td className="px-3 py-2">
                                  <select
                                    value={it.modifierScaleTarget ?? ""}
                                    onChange={(e) => {
                                      const v = e.target.value || null;
                                      setBomItems((prev) =>
                                        prev.map((p, i) =>
                                          i === idx ? { ...p, modifierScaleTarget: v } : p,
                                        ),
                                      );
                                    }}
                                    className="h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm outline-none focus:border-ring"
                                  >
                                    <option value="">— Không áp dụng —</option>
                                    {bomModifierGroups
                                      .map((g) => (
                                        <option key={g.id} value={g.id}>
                                          {g.name}
                                        </option>
                                      ))}
                                  </select>
                                </td>
                              )}
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
                          <td
                            colSpan={channel === "fnb" ? 4 : 3}
                            className="px-3 py-2 text-right font-semibold text-sm"
                          >
                            Tổng giá vốn (theo BOM):
                          </td>
                          <td className="px-3 py-2 text-right font-bold text-primary">
                            {formatCurrency(
                              bomItems.reduce((sum, item) => (
                                sum + item.quantity * (
                                  getDirectConversionFactor(
                                    item.stockUnit,
                                    item.unit,
                                    item.conversions,
                                  ) ?? 0
                                ) * item.costPrice
                              ), 0),
                            )}
                          </td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </div>

              {channel === "fnb" && bomItems.some((item) => item.modifierScaleTarget) && (
                <section className="space-y-3 rounded-lg border border-primary/25 bg-primary/5 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <h3 className="text-sm font-medium">Định lượng riêng theo lựa chọn FnB</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Nhập theo đơn vị pha chế của công thức. Hệ thống tự quy đổi sang đơn vị tồn khi tính giá vốn, trừ kho và hoàn kho; không dùng hệ số phần trăm chung.
                      </p>
                    </div>
                    <label className="flex shrink-0 items-center gap-2 text-sm font-medium">
                      <Checkbox
                        checked={bomExactRecipeEnabled}
                        disabled={!bomExactRecipeReady}
                        onCheckedChange={(checked) => setBomExactRecipeEnabled(Boolean(checked))}
                      />
                      Dùng định lượng riêng
                    </label>
                  </div>

                  {!bomExactRecipeReady ? (
                    <p className="rounded-md border border-status-warning/30 bg-status-warning/5 px-3 py-2 text-xs text-status-warning">
                      Chưa tải được định lượng riêng. Tải lại form trước khi lưu để giữ nguyên cấu hình hiện có.
                    </p>
                  ) : (
                    bomItems
                      .filter((item) => item.modifierScaleTarget)
                      .map((item) => {
                        const group = bomModifierGroups.find(
                          (candidate) => candidate.id === item.modifierScaleTarget,
                        );
                        const options = bomModifierOptionsByGroup[item.modifierScaleTarget ?? ""] ?? [];
                        return (
                          <fieldset
                            key={`${item.materialId}:${item.modifierScaleTarget}`}
                            className="rounded-md border bg-background p-3"
                          >
                            <legend className="px-1 text-sm font-medium">
                              {item.materialName} - {group?.name ?? "Nhóm lựa chọn"}
                            </legend>
                            {options.length === 0 ? (
                              <p className="text-xs text-status-warning">
                                Nhóm này chưa có lựa chọn đang bật hoặc chưa được áp dụng cho sản phẩm.
                              </p>
                            ) : (
                              <div className="grid gap-2 sm:grid-cols-3">
                                {options.map((option) => {
                                  const key = `${item.materialId}:${option.id}`;
                                  const rawValue = bomExactQuantityByKey[key] ?? "";
                                  const stockQuantity = rawValue.trim()
                                    ? getRecipeQuantityInStockUnit(
                                        Number(rawValue),
                                        item.stockUnit,
                                        item.unit,
                                        item.conversions,
                                      )
                                    : null;
                                  return (
                                    <label key={option.id} className="rounded-md border p-2 text-sm">
                                      <span className="block font-medium">{option.label}</span>
                                      <span className="mt-1 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                                        <Input
                                          type="number"
                                          min="0"
                                          step="0.0001"
                                          inputMode="decimal"
                                          disabled={!bomExactRecipeEnabled}
                                          value={rawValue}
                                          onChange={(event) => setBomExactQuantityByKey((previous) => ({
                                            ...previous,
                                            [key]: event.target.value,
                                          }))}
                                          aria-label={`${item.materialName} - ${option.label}`}
                                        />
                                        <span className="text-xs text-muted-foreground">{item.unit}</span>
                                      </span>
                                      <span className="mt-1 block text-xs text-muted-foreground">
                                        {stockQuantity == null
                                          ? `Nhập ${item.unit}`
                                          : `Trừ ${formatRecipeQuantity(stockQuantity)} ${item.stockUnit}`}
                                      </span>
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

          {/* ─────────── Tab 4: Tuỳ chọn FnB ───────────
              CEO 01/06/2026 — Sprint 2.2d.
              Pattern Toast inheritance:
                - Default = inherit từ category_modifier_groups.
                - User có thể "Override" → set product_modifier_groups riêng.
              SP retail không thấy tab này. */}
          {scope === "sku" && channel === "fnb" && (
            <TabsContent value="modifier" className="space-y-4 mt-0">
              {loadingModifierPicker ? (
                <div className="flex h-32 items-center justify-center text-muted-foreground">
                  <Icon name="progress_activity" size={20} className="mr-2 animate-spin" />
                  Đang tải...
                </div>
              ) : (
                <div className="space-y-4">
                  {/* 00353: menu scope follows the SKU, not the modifier
                      group. This keeps a pilot product isolated before its
                      exact modifier quantities are configured. */}
                  <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
                    <div className="flex items-start gap-2">
                      <Icon name="storefront" size={16} className="mt-0.5 shrink-0 text-primary" />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">Menu FnB theo chi nhánh</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          Chưa chọn riêng thì giữ cách cũ: món hiện ở mọi chi nhánh FnB.
                          Khi chọn quán, món chỉ hiện ở các quán đã chọn; không làm thay đổi tồn kho, giá hoặc BOM.
                        </p>
                      </div>
                    </div>

                    {!initialData ? (
                      <p className="mt-3 text-xs text-muted-foreground">
                        Tạo món xong rồi mở lại phần sửa để chọn các quán được bán.
                      </p>
                    ) : loadingFnbMenuScope ? (
                      <div className="mt-3 flex items-center text-xs text-muted-foreground">
                        <Icon name="progress_activity" size={14} className="mr-2 animate-spin" />
                        Đang tải phạm vi menu...
                      </div>
                    ) : fnbMenuScopeError ? (
                      <p className="mt-3 text-xs text-destructive">
                        Chưa đọc được phạm vi menu. Cần cài 00354 (sau 00353) trước khi cấu hình: {fnbMenuScopeError}
                      </p>
                    ) : (
                      <div className="mt-3 space-y-3">
                        <div className="grid grid-cols-1 gap-2 lg:grid-cols-3">
                          <button
                            type="button"
                            onClick={() => setFnbMenuScopeMode("all")}
                            className={`rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                              fnbMenuScopeMode === "all"
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border bg-card text-muted-foreground hover:bg-muted/50"
                            }`}
                          >
                            <span className="block font-medium">Bán tại tất cả chi nhánh</span>
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              Giữ hành vi hiện tại của món.
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setFnbMenuScopeMode("selected")}
                            className={`rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                              fnbMenuScopeMode === "selected"
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border bg-card text-muted-foreground hover:bg-muted/50"
                            }`}
                          >
                            <span className="block font-medium">Chỉ bán tại quán đã chọn</span>
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              Dùng khi thử nghiệm hoặc mỗi quán có menu riêng.
                            </span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setFnbMenuScopeMode("excluded")}
                            className={`rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                              fnbMenuScopeMode === "excluded"
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border bg-card text-muted-foreground hover:bg-muted/50"
                            }`}
                          >
                            <span className="block font-medium">Ẩn tại quán đã chọn</span>
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              Giữ menu quán khác khi quán này đang nhập dữ liệu.
                            </span>
                          </button>
                        </div>

                        {fnbMenuScopeMode !== "all" && (
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            {branches
                              .filter((branch) => branch.branchType === "store")
                              .map((branch) => {
                                const checked = fnbMenuBranchIds.has(branch.id);
                                return (
                                  <label
                                    key={branch.id}
                                    className={`flex cursor-pointer items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm transition-colors ${
                                      checked
                                        ? "border-primary bg-primary/10"
                                        : "border-border hover:bg-muted/50"
                                    }`}
                                  >
                                    <Checkbox
                                      checked={checked}
                                      onCheckedChange={() => toggleFnbMenuBranch(branch.id)}
                                    />
                                    <span className="min-w-0 truncate">{branch.name}</span>
                                  </label>
                                );
                              })}
                          </div>
                        )}

                        {fnbMenuScopeMode !== "all" &&
                          branches.filter((branch) => branch.branchType === "store").length === 0 && (
                            <p className="text-xs text-destructive">
                              Chưa có chi nhánh FnB đang hoạt động để chọn.
                            </p>
                          )}

                        <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-3">
                          <p className="text-xs text-muted-foreground">
                            {fnbMenuScopeMode === "selected"
                              ? `Chỉ bán tại ${fnbMenuBranchIds.size} chi nhánh đã chọn.`
                              : fnbMenuScopeMode === "excluded"
                                ? `Ẩn tại ${fnbMenuBranchIds.size} chi nhánh đã chọn.`
                                : "Món không bị giới hạn chi nhánh."}
                          </p>
                          <Button
                            type="button"
                            size="sm"
                            onClick={handleSaveFnbMenuScope}
                            disabled={
                              savingFnbMenuScope ||
                              (fnbMenuScopeMode !== "all" && fnbMenuBranchIds.size === 0)
                            }
                          >
                            {savingFnbMenuScope ? (
                              <Icon name="progress_activity" size={14} className="mr-1 animate-spin" />
                            ) : (
                              <Icon name="save" size={14} className="mr-1" />
                            )}
                            Lưu phạm vi menu
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Section 1: Inherit từ nhóm (read-only) */}
                  <div className="rounded-lg border bg-muted/30 p-3">
                    <div className="flex items-start gap-2 mb-2">
                      <Icon name="account_tree" size={16} className="text-muted-foreground shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-sm font-medium">Thừa kế từ nhóm hàng</p>
                        <p className="text-xs text-muted-foreground">
                          Các nhóm tuỳ chọn đã gán cho nhóm hàng chứa SP này. Sửa ở{" "}
                          <a href="/hang-hoa/nhom" target="_blank" className="text-primary underline">
                            Nhóm hàng
                          </a>{" "}
                          → form nhóm.
                        </p>
                      </div>
                    </div>
                    {!categoryId ? (
                      <p className="text-xs text-muted-foreground italic py-2">
                        Chọn nhóm hàng (tab Thông tin) để xem các tuỳ chọn thừa kế.
                      </p>
                    ) : inheritedModifierGroups.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-2">
                        Nhóm hàng này chưa gán tuỳ chọn nào. Anh có thể:
                        <br />
                        1. Gán mặc định ở{" "}
                        <a href="/hang-hoa/nhom" target="_blank" className="text-primary underline">
                          Nhóm hàng
                        </a>{" "}
                        (áp cho cả nhóm), hoặc
                        <br />
                        2. Bật Override bên dưới để gán riêng cho SP này.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {inheritedModifierGroups.map((g) => (
                          <span
                            key={g.id}
                            className="inline-flex items-center gap-1 rounded-md bg-card border px-2 py-1 text-xs"
                          >
                            <Icon name="check_circle" size={12} className="text-status-success" />
                            {g.name}
                            {g.optionCount !== undefined && (
                              <span className="text-muted-foreground">({g.optionCount})</span>
                            )}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Section 2: Toggle inherit / override */}
                  <div className="rounded-lg border p-3">
                    <div className="flex items-start gap-2 mb-3">
                      <Icon name="tune" size={16} className="text-status-warning shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-sm font-medium">Tuỳ chọn riêng cho SP này</p>
                        <p className="text-xs text-muted-foreground">
                          Mặc định SP dùng tuỳ chọn của nhóm. Bật Override khi SP cần khác (vd thêm Topping riêng).
                        </p>
                      </div>
                    </div>

                    <div className="flex gap-2 mb-3">
                      <button
                        type="button"
                        onClick={() => setModifierMode("inherit")}
                        className={`flex-1 rounded-md border px-3 py-2 text-sm transition-colors ${
                          modifierMode === "inherit"
                            ? "border-primary bg-primary/10 text-primary font-medium"
                            : "border-border bg-card text-muted-foreground hover:bg-muted/50"
                        }`}
                      >
                        <Icon name="account_tree" size={14} className="inline mr-1" />
                        Thừa kế từ nhóm
                      </button>
                      <button
                        type="button"
                        onClick={() => setModifierMode("override")}
                        className={`flex-1 rounded-md border px-3 py-2 text-sm transition-colors ${
                          modifierMode === "override"
                            ? "border-status-warning bg-status-warning/10 text-status-warning font-medium"
                            : "border-border bg-card text-muted-foreground hover:bg-muted/50"
                        }`}
                      >
                        <Icon name="edit" size={14} className="inline mr-1" />
                        Override riêng
                      </button>
                    </div>

                    {modifierMode === "override" && (
                      <>
                        {availableFnbModifierGroups.length === 0 ? (
                          <p className="text-xs text-muted-foreground py-3 text-center">
                            Chưa có nhóm tuỳ chọn nào. Vào{" "}
                            <a href="/hang-hoa/tuy-chon-fnb" target="_blank" className="text-primary underline">
                              Tuỳ chọn món FnB
                            </a>{" "}
                            để tạo.
                          </p>
                        ) : (
                          <div className="grid grid-cols-2 gap-1.5">
                            {availableFnbModifierGroups.map((g) => {
                              const checked = productModifierGroupIds.has(g.id);
                              return (
                                <label
                                  key={g.id}
                                  className={`flex items-center gap-2 rounded-md border bg-card px-2.5 py-1.5 text-sm cursor-pointer transition-colors ${
                                    checked
                                      ? "border-status-warning bg-status-warning/10"
                                      : "border-border hover:bg-muted/50"
                                  }`}
                                >
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggleProductModifierGroup(g.id)}
                                    className="size-4"
                                  />
                                  <span className="truncate">{g.name}</span>
                                  {g.optionCount !== undefined && g.optionCount > 0 && (
                                    <span className="text-xs text-muted-foreground">
                                      ({g.optionCount})
                                    </span>
                                  )}
                                </label>
                              );
                            })}
                          </div>
                        )}
                        {productModifierGroupIds.size > 0 && (
                          <p className="text-xs text-status-warning mt-2">
                            ⚠️ SP này sẽ dùng {productModifierGroupIds.size} nhóm trên — KHÔNG thừa kế nhóm hàng nữa.
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </TabsContent>
          )}

          {/* ─────────── Tab 5: Quy cách (Variants Size) ───────────
              CEO 01/06/2026 — Sprint 2.4a.
              Mỗi variant có giá riêng + bom_code riêng (cho FnB scale theo size).
              Pattern Toast: 1 SKU + multi sizes, cashier pick size khi tap món. */}
          {scope === "sku" && (
            <TabsContent value="variants" className="space-y-3 mt-0">
              <div className="rounded-lg border bg-status-info/5 p-3">
                <div className="flex items-start gap-2">
                  <Icon name="straighten" size={16} className="text-status-info shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Quy cách / Cỡ (vd M, L, XL hoặc 250g, 500g)</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Mỗi cỡ có giá bán riêng và công thức riêng. Khi bán, nhân viên chọn cỡ → máy POS dùng đúng giá + công thức của cỡ đó. Để trống nếu mặt hàng chỉ bán 1 loại.
                    </p>
                  </div>
                </div>
              </div>

              {/* CEO 17/06/2026 (Phương án B): công thức theo size chuyển xuống
                  DƯỚI bảng size + gộp vào nút Lưu (xem cuối tab). */}

              {variantItems.length === 0 ? (
                <div className="rounded-lg border-2 border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                  <Icon name="straighten" size={28} className="mx-auto mb-2 opacity-40" />
                  <p>Chưa có cỡ nào. Mặt hàng sẽ bán với 1 giá duy nhất.</p>
                  <p className="text-xs mt-1">
                    Ví dụ: <span className="font-mono">M / L / XL</span>, hoặc{" "}
                    <span className="font-mono">250g / 500g / 1kg</span>.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="mt-3"
                    onClick={addVariantRow}
                  >
                    <Icon name="add" size={14} className="mr-1" />
                    Thêm quy cách
                  </Button>
                </div>
              ) : (
                <div className="rounded-lg border overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-surface-container-low text-xs text-muted-foreground">
                      <tr>
                        <th className="text-left px-3 py-2 font-semibold w-28">Tên</th>
                        <th className="text-right px-3 py-2 font-semibold w-32">Giá bán (đ)</th>
                        {channel !== "fnb" && (
                          <th className="text-right px-3 py-2 font-semibold w-32">Giá vốn (đ)</th>
                        )}
                        <th className="text-center px-3 py-2 font-semibold w-20">Mặc định</th>
                        <th className="w-10"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {variantItems.map((v, idx) => (
                        <tr key={v.id ?? `new-${idx}`} className="border-t border-border">
                          <td className="px-3 py-2">
                            <Input
                              value={v.name}
                              placeholder="VD: M, L, XL, 250g, 1kg..."
                              className="h-9 text-sm"
                              onChange={(e) => {
                                const val = e.target.value;
                                setVariantItems((prev) =>
                                  prev.map((p, i) => (i === idx ? { ...p, name: val } : p)),
                                );
                              }}
                            />
                          </td>
                          <td className="px-3 py-2">
                            <Input
                              inputMode="numeric"
                              value={v.sellPrice ? formatNumber(v.sellPrice) : ""}
                              placeholder="0"
                              className="h-9 text-right text-sm"
                              onChange={(e) => {
                                const digits = e.target.value.replace(/[^\d]/g, "");
                                const n = digits ? parseInt(digits, 10) : 0;
                                setVariantItems((prev) =>
                                  prev.map((p, i) =>
                                    i === idx ? { ...p, sellPrice: n } : p,
                                  ),
                                );
                              }}
                            />
                          </td>
                          {channel !== "fnb" && (
                            <td className="px-3 py-2">
                              <Input
                                inputMode="numeric"
                                value={v.costPrice ? formatNumber(v.costPrice) : ""}
                                placeholder="0"
                                className="h-9 text-right text-sm"
                                onChange={(e) => {
                                  const digits = e.target.value.replace(/[^\d]/g, "");
                                  const n = digits ? parseInt(digits, 10) : 0;
                                  setVariantItems((prev) =>
                                    prev.map((p, i) =>
                                      i === idx ? { ...p, costPrice: n } : p,
                                    ),
                                  );
                                }}
                              />
                            </td>
                          )}
                          <td className="px-3 py-2 text-center">
                            <input
                              type="radio"
                              name="variant-default"
                              checked={v.isDefault}
                              onChange={() => setVariantDefault(idx)}
                              className="size-4"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              onClick={() => removeVariantRow(idx)}
                              className="text-muted-foreground hover:text-destructive"
                              aria-label="Xoá quy cách"
                            >
                              <Icon name="delete" size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="border-t bg-muted/20 px-3 py-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={addVariantRow}
                    >
                      <Icon name="add" size={14} className="mr-1" />
                      Thêm quy cách
                    </Button>
                  </div>
                </div>
              )}

              {/* CEO 17/06/2026 (Phương án B): lưới công thức theo size — gộp
                  ngay đây, lưu chung 1 nút. Chỉ FnB + khi đã có ít nhất 1 size. */}
              {channel === "fnb" && variantItems.length > 0 && (
                <div className="space-y-3 rounded-lg border border-status-info/30 bg-status-info/5 p-3">
                  <label className="flex flex-wrap items-center gap-2 text-sm font-medium cursor-pointer">
                    <input
                      type="checkbox"
                      checked={recipeEnabled}
                      onChange={(e) => setRecipeEnabled(e.target.checked)}
                      className="size-4"
                    />
                    Trừ kho theo công thức từng cỡ
                    <span className="text-xs font-normal text-muted-foreground">
                      (cà phê/sữa/ly… — bán cỡ nào trừ đúng công thức cỡ đó)
                    </span>
                  </label>
                  {recipeEnabled && (
                    <PerSizeRecipeMatrix
                      sizes={variantItems.map((v) => ({ key: v.key, name: v.name }))}
                      rows={recipeRows}
                      onChange={setRecipeRows}
                      materials={materialOptions}
                      groups={availableFnbModifierGroups}
                      loading={materialOptions.length === 0}
                    />
                  )}
                </div>
              )}
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
                                  <span
                                    aria-hidden
                                    data-selected={isSelected ? "true" : "false"}
                                    className={`grid size-4 shrink-0 place-items-center rounded-[4px] border ${
                                      isSelected
                                        ? "border-primary bg-primary text-primary-foreground"
                                        : "border-input"
                                    }`}
                                  >
                                    {isSelected && <Icon name="check" size={14} />}
                                  </span>
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
                onClick={async () => {
                  // Thêm tất cả NVL đã tick vào BOM
                  const toAdd = Array.from(bomPickerSelected)
                    .map((id) => materialOptions.find((p) => p.id === id))
                    .filter((m): m is Product => !!m);
                  if (toAdd.length === 0) return;
                  const newItems = await Promise.all(
                    toAdd.map(async (m) => ({
                      materialId: m.id,
                      materialCode: m.code,
                      materialName: m.name,
                      costPrice: m.costPrice ?? 0,
                      unit: m.stockUnit || m.unit || "",
                      stockUnit: m.stockUnit || m.unit || "",
                      conversions: await getUOMConversions(m.id).catch(() => []),
                      quantity: 1,
                      wastePercent: 0,
                    })),
                  );
                  setBomItems((prev) => [
                    ...prev,
                    ...newItems,
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
