"use client";

import { useState, useEffect, useMemo, useRef } from "react";
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
import { useToast, useBranchFilter } from "@/lib/contexts";
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
  calculateRecipeCostBySize,
  newRecipeRow,
  rekeyRecipeRows,
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
import { getUOMConversionsByProductIds } from "@/lib/services/supabase/uom";
// CEO 01/06/2026 — Sprint 2.4a
import {
  getVariantsByProduct,
  createVariant,
  updateVariant,
  deleteVariant,
  saveFnbSizeSetupAtomic,
  createFnbProductWithSizeSetupAtomic,
  type FnbSizeSetupVariantInput,
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
  type FnbProductBranchMenuPolicy,
} from "@/lib/services/supabase/fnb-product-branch-menu";
import { invalidateMenuCache } from "@/lib/offline";
import { useDurableFormDraft } from "@/lib/hooks/use-durable-form-draft";

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

function getBomComponentUnitPrice(product: Product, productChannel: string) {
  return productChannel === "fnb"
    ? Number(product.sellPrice) || 0
    : Number(product.costPrice) || 0;
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

/**
 * Inline BOM belongs to one SKU, so its readable code can be deterministic.
 * The branch suffix only identifies an explicit local recipe override; the
 * SKU itself keeps the product_id lookup model, which preserves global
 * fallback for every branch.
 */
function getAutomaticBomCode(
  productCode: string,
  branchId: string | null,
  branches: Array<{ id: string; code?: string }>,
): string {
  const normalizedProductCode = productCode.trim().toUpperCase() || "SKU";
  if (!branchId) return `BOM-${normalizedProductCode}`;
  const branchCode = branches.find((branch) => branch.id === branchId)?.code;
  const suffix = (branchCode || branchId.slice(0, 8)).trim().toUpperCase();
  return `BOM-${normalizedProductCode}-${suffix}`;
}

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
  const dialogProductKey = initialData?.id ?? "__new_product__";
  const { toast } = useToast();
  const { activeBranchId } = useBranchFilter();
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
  // Loading the saved amounts and the current effective choices are separate
  // concerns. Keeping both readiness flags prevents a later tab switch from
  // saving an empty replacement over an already configured FnB recipe.
  const [bomExactQuantitiesReady, setBomExactQuantitiesReady] = useState(false);
  const [bomExactOptionsReady, setBomExactOptionsReady] = useState(false);
  const bomExactRecipeReady = bomExactQuantitiesReady && bomExactOptionsReady;
  // Day 20/05/2026 (CEO BOM Phase 5): Mã BOM link với BOM có sẵn (standalone).
  // Khi user gõ Mã BOM → save sẽ verify + set products.bom_code (không tạo BOM
  // mới). Khi gõ items inline → tạo BOM riêng cho SKU (legacy path).
  const [bomCodeInput, setBomCodeInput] = useState("");
  const [bomCodeValid, setBomCodeValid] = useState<boolean | null>(null); // null = chưa verify
  const [bomExistingId, setBomExistingId] = useState<string | null>(null); // edit mode
  const [bomExistingCode, setBomExistingCode] = useState<string | null>(null);
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
  const [bomDraftSourceReady, setBomDraftSourceReady] = useState(
    !initialData?.hasBom,
  );
  const [uomDraftSourceReady, setUomDraftSourceReady] = useState(!initialData);

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
  const automaticBomCodePreview = getAutomaticBomCode(
    initialData?.code ?? previewCode,
    bomBranchId,
    branches,
  );
  const visibleBomCode = bomExistingCode ?? automaticBomCodePreview;

  // CEO 01/06/2026 — Sprint 2.2d: Modifier picker cho SKU FnB.
  // Pattern Toast inheritance:
  //   - Mặc định: inherit từ category_modifier_groups của nhóm SP.
  //   - User có thể bật "Override" → set product_modifier_groups riêng cho SP này.
  const [availableFnbModifierGroups, setAvailableFnbModifierGroups] = useState<
    ModifierGroup[]
  >([]);
  const [variantModifierOptionsByGroup, setVariantModifierOptionsByGroup] = useState<
    Record<string, ModifierOption[]>
  >({});
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
  // The branch policy is part of this dialog's draft. It is only persisted
  // by the main Save button, never by changing tabs or opening the section.
  const [fnbMenuScopeDirty, setFnbMenuScopeDirty] = useState(false);
  const [fnbMenuScopeError, setFnbMenuScopeError] = useState<string | null>(null);

  // A product dialog is a draft. Lazy loaders may run when the user changes
  // tabs, but they must never overwrite choices made in the same open dialog.
  const initializedDialogKeyRef = useRef<string | null>(null);
  const loadedBomKeyRef = useRef<string | null>(null);
  const loadedModifierDraftKeyRef = useRef<string | null>(null);
  const loadedMenuScopeKeyRef = useRef<string | null>(null);
  const loadedVariantsKeyRef = useRef<string | null>(null);

  // CEO 01/06/2026 — Sprint 2.4a: Variants Size (M/L/XL) inline editor.
  // Mỗi variant có giá riêng + BOM riêng (bom_code) — cho phép Size M dùng
  // 18g cà phê, Size L dùng 25g.
  const [variantItems, setVariantItems] = useState<InlineVariant[]>([]);
  const [variantDataReady, setVariantDataReady] = useState(false);
  const [variantDataError, setVariantDataError] = useState<string | null>(null);
  const [variantReloadNonce, setVariantReloadNonce] = useState(0);
  // Công thức theo size quản lý tập trung tại tab BOM và lưu chung một lần.
  // recipeRows = lưới NVL × size; recipeEnabled = toggle.
  const [recipeRows, setRecipeRows] = useState<RecipeRow[]>([]);
  const [recipeEnabled, setRecipeEnabled] = useState(false);
  const [recipeConversionsByMaterial, setRecipeConversionsByMaterial] = useState<
    Record<string, UOMConversion[]>
  >({});
  // Track ID variants đã có sẵn ở DB để diff khi save (cũ nhưng user xoá).
  const [originalVariantIds, setOriginalVariantIds] = useState<Set<string>>(
    new Set(),
  );
  const perSizeModifierGroups = useMemo(
    () =>
      modifierMode === "override"
        ? availableFnbModifierGroups.filter((group) => productModifierGroupIds.has(group.id))
        : inheritedModifierGroups,
    [
      availableFnbModifierGroups,
      inheritedModifierGroups,
      modifierMode,
      productModifierGroupIds,
    ],
  );
  const perSizeModifierGroupKey = perSizeModifierGroups
    .map((group) => group.id)
    .sort()
    .join(",");
  const perSizeCostByKey = useMemo(
    () =>
      calculateRecipeCostBySize(
        variantItems.map((variant) => ({ key: variant.key, name: variant.name })),
        recipeRows,
        materialOptions,
        variantModifierOptionsByGroup,
        recipeConversionsByMaterial,
      ),
    [
      variantItems,
      recipeRows,
      materialOptions,
      variantModifierOptionsByGroup,
      recipeConversionsByMaterial,
    ],
  );
  const hasFnbSizeVariants =
    scope === "sku" &&
    channel === "fnb" &&
    variantDataReady &&
    variantItems.length > 0;
  const fnbVariantContextPending =
    scope === "sku" && channel === "fnb" && isEdit && !variantDataReady;

  // Reset form khi dialog mở. Nếu có initialData → prefill từ sản phẩm đang sửa.
  useEffect(() => {
    if (!open) {
      initializedDialogKeyRef.current = null;
      loadedBomKeyRef.current = null;
      loadedModifierDraftKeyRef.current = null;
      loadedMenuScopeKeyRef.current = null;
      loadedVariantsKeyRef.current = null;
      setVariantDataReady(false);
      setVariantDataError(null);
      setFnbMenuScopeDirty(false);
      setRecipeConversionsByMaterial({});
      return;
    }
    if (initializedDialogKeyRef.current === dialogProductKey) return;
    initializedDialogKeyRef.current = dialogProductKey;
    if (initialData) {
      setVariantDataReady(false);
      setVariantDataError(null);
      setBomDraftSourceReady(!initialData.hasBom);
      setUomDraftSourceReady(false);
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
      setBomExistingCode(null);
      setBomName("");
      setBomNote("");
      setBomBranchId(null);
      setBomModifierGroups([]);
      setBomModifierOptionsByGroup({});
      setBomExactQuantityByKey({});
      setBomExactQuantitiesReady(!initialData.hasBom);
      setBomExactOptionsReady(false);
      setVariantModifierOptionsByGroup({});
      setFnbMenuScopeDirty(false);
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
      setVariantDataReady(true);
      setVariantDataError(null);
      setBomDraftSourceReady(true);
      setUomDraftSourceReady(true);
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
      setBomExistingCode(null);
      setBomName("");
      setBomNote("");
      setBomBranchId(null);
      setBomModifierGroups([]);
      setBomModifierOptionsByGroup({});
      setBomExactQuantityByKey({});
      setBomExactQuantitiesReady(true);
      setBomExactOptionsReady(false);
      setVariantModifierOptionsByGroup({});
      setFnbMenuScopeDirty(false);
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
  }, [open, dialogProductKey]);

  // Day 18/05/2026 (CEO): load BOM existing khi edit SKU has_bom=true.
  // Hiển thị form items prefilled để user sửa ngay trong tab "Công thức".
  useEffect(() => {
    if (!open || !initialData || initialData.productType !== "sku" || !initialData.hasBom) {
      return;
    }
    if (channel === "fnb") {
      if (!variantDataReady) return;
      // Món có size dùng ma trận variant/BOM bên dưới. Không được lấy BOM
      // đầu tiên (thường là Size M) đưa vào form BOM đơn rồi gây hiểu nhầm.
      if (variantItems.length > 0) {
        setBomDraftSourceReady(true);
        return;
      }
    }
    if (loadedBomKeyRef.current === initialData.id) return;
    loadedBomKeyRef.current = initialData.id;
    let cancelled = false;
    (async () => {
      try {
        // Lấy BOM active đầu tiên cho SP này (ưu tiên global, fallback per-branch)
        const boms = await getBOMsByProduct(initialData.id);
        if (cancelled || boms.length === 0) return;
        // Ưu tiên BOM global (branch_id=null) — em load BOM đầu tiên
        const bom = boms[0];
        setBomExistingId(bom.id);
        setBomExistingCode(bom.code ?? null);
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
          setBomExactQuantityByKey(quantities);
          setBomExactQuantitiesReady(true);
        } catch (exactError) {
          console.warn("Exact FnB recipe quantities are unavailable:", exactError);
          if (cancelled) return;
          setBomExactQuantitiesReady(false);
        }
      } catch {
        // fail silent — user vẫn có thể tạo BOM mới
      } finally {
        if (!cancelled) setBomDraftSourceReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    open,
    initialData?.id,
    initialData?.productType,
    initialData?.hasBom,
    channel,
    variantDataReady,
    variantItems.length,
  ]);

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
      } finally {
        if (!cancelled) setUomDraftSourceReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, initialData]);

  const { clearDraft } = useDurableFormDraft({
    form: isEdit ? "product-edit" : "product-create",
    open,
    branchId: activeBranchId,
    entityId: initialData?.id ?? null,
    autoRestore: !isEdit,
    saveOnlyWhenChanged: isEdit,
    ready: bomDraftSourceReady && uomDraftSourceReady,
    onRequestOpen: () => onOpenChange(true),
    snapshot: {
      scope,
      categoryId,
      name,
      sellPrice,
      costPrice,
      initialStock,
      stockUnit,
      uomConversions,
      shelfLifeDays,
      shelfLifeUnit,
      hasBom,
      bomBranchId,
      bomName,
      bomNote,
      bomItems,
      bomCodeInput,
      bomCodeValid,
      bomExistingId,
      bomExistingCode,
      bomExactQuantityByKey,
      channel,
      barcode,
      brand,
      supplierId,
      weight,
      vatRate,
      vatCustom,
      minStock,
      maxStock,
      description,
      allowSale,
      innerTab,
      modifierMode,
      productModifierGroupIds: Array.from(productModifierGroupIds),
      fnbMenuScopeMode,
      fnbMenuBranchIds: Array.from(fnbMenuBranchIds),
      fnbMenuScopeDirty,
      variantItems,
      recipeRows,
      recipeEnabled,
    },
    hasContent: (draft) =>
      !!draft.name.trim() ||
      !!draft.categoryId ||
      draft.bomItems.length > 0 ||
      draft.uomConversions.length > 0 ||
      draft.variantItems.length > 0 ||
      draft.productModifierGroupIds.length > 0 ||
      draft.fnbMenuScopeDirty,
    restore: (draft) => {
      setScope(draft.scope);
      setCategoryId(draft.categoryId);
      setName(draft.name);
      setSellPrice(draft.sellPrice);
      setCostPrice(draft.costPrice);
      setInitialStock(draft.initialStock);
      setStockUnit(draft.stockUnit);
      setPurchaseUnit(draft.stockUnit);
      setSellUnit(draft.stockUnit);
      setUomConversions(draft.uomConversions);
      setShelfLifeDays(draft.shelfLifeDays);
      setShelfLifeUnit(draft.shelfLifeUnit);
      setHasBom(draft.hasBom);
      setBomBranchId(draft.bomBranchId);
      setBomName(draft.bomName);
      setBomNote(draft.bomNote);
      setBomItems(draft.bomItems);
      setBomCodeInput(draft.bomCodeInput);
      setBomCodeValid(draft.bomCodeValid);
      setBomExistingId(draft.bomExistingId);
      setBomExistingCode(draft.bomExistingCode);
      setBomExactQuantityByKey(draft.bomExactQuantityByKey);
      setBomExactQuantitiesReady(true);
      setChannel(draft.channel);
      setBarcode(draft.barcode);
      setBrand(draft.brand);
      setSupplierId(draft.supplierId);
      setWeight(draft.weight);
      setVatRate(draft.vatRate);
      setVatCustom(draft.vatCustom);
      setMinStock(draft.minStock);
      setMaxStock(draft.maxStock);
      setDescription(draft.description);
      setAllowSale(draft.allowSale);
      setInnerTab(draft.innerTab);
      setModifierMode(draft.modifierMode);
      setProductModifierGroupIds(new Set(draft.productModifierGroupIds));
      setFnbMenuScopeMode(draft.fnbMenuScopeMode);
      setFnbMenuBranchIds(new Set(draft.fnbMenuBranchIds));
      setFnbMenuScopeDirty(draft.fnbMenuScopeDirty);
      setVariantItems(draft.variantItems);
      // Bản nháp FnB rỗng không chứng minh sản phẩm cũ không có size.
      const restoredVariantDataReady =
        !initialData || draft.channel !== "fnb" || draft.variantItems.length > 0;
      setVariantDataReady(restoredVariantDataReady);
      setVariantDataError(null);
      setRecipeRows(rekeyRecipeRows(draft.recipeRows));
      setRecipeEnabled(draft.recipeEnabled);
      loadedModifierDraftKeyRef.current = dialogProductKey;
      loadedMenuScopeKeyRef.current = initialData?.id ?? null;
      loadedVariantsKeyRef.current = restoredVariantDataReady
        ? initialData?.id ?? null
        : null;
    },
  });

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
  // Load on demand for either FnB configuration surface. The size recipe
  // editor needs the same effective groups as the modifier tab, otherwise an
  // operator could configure a BOM against a group that never appears on POS.
  useEffect(() => {
    if (!open || scope !== "sku" || channel !== "fnb") {
      setAvailableFnbModifierGroups([]);
      setInheritedModifierGroups([]);
      if (!open) {
        loadedModifierDraftKeyRef.current = null;
        setProductModifierGroupIds(new Set());
        setModifierMode("inherit");
      }
      return;
    }
    if (
      innerTab !== "modifier" &&
      innerTab !== "pricing" &&
      innerTab !== "bom" &&
      innerTab !== "variants"
    ) return;
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

        // 3. Load the server draft only once per dialog opening. Returning to
        // this tab must retain checkboxes the user has not saved yet.
        if (loadedModifierDraftKeyRef.current !== dialogProductKey) {
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
          loadedModifierDraftKeyRef.current = dialogProductKey;
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
  }, [open, scope, channel, categoryId, dialogProductKey, initialData?.id, innerTab]);

  // A size recipe with a target such as Mức đường must save exact amounts for
  // every live choice. Load only the groups actually effective for this SKU;
  // this keeps both the setup screen and POS on the same configuration.
  useEffect(() => {
    if (
      !open ||
      scope !== "sku" ||
      channel !== "fnb" ||
      (innerTab !== "pricing" && innerTab !== "bom" && innerTab !== "variants")
    ) {
      if (!open) setVariantModifierOptionsByGroup({});
      return;
    }
    if (!perSizeModifierGroupKey) {
      setVariantModifierOptionsByGroup({});
      return;
    }
    let cancelled = false;
    Promise.all(
      perSizeModifierGroups.map(async (group) => [
        group.id,
        await listModifierOptions(group.id),
      ] as const),
    )
      .then((entries) => {
        if (!cancelled) setVariantModifierOptionsByGroup(Object.fromEntries(entries));
      })
      .catch((error) => {
        console.warn("Load size recipe modifier options failed:", error);
        if (!cancelled) setVariantModifierOptionsByGroup({});
      });
    return () => {
      cancelled = true;
    };
  }, [
    open,
    scope,
    channel,
    innerTab,
    perSizeModifierGroupKey,
    perSizeModifierGroups,
  ]);

  // The BOM must read the same draft modifier groups as the modifier tab.
  // Otherwise a cashier-facing choice selected moments ago can disappear from
  // the recipe before the user presses the single final Save button.
  useEffect(() => {
    if (!open || scope !== "sku" || channel !== "fnb" || innerTab !== "bom") {
      if (!open) {
        setBomModifierGroups([]);
        setBomModifierOptionsByGroup({});
        setBomExactOptionsReady(false);
      }
      return;
    }
    if (!perSizeModifierGroupKey) {
      setBomModifierGroups([]);
      setBomModifierOptionsByGroup({});
      setBomExactOptionsReady(true);
      return;
    }

    let cancelled = false;
    setBomExactOptionsReady(false);
    Promise.all(
      perSizeModifierGroups.map(async (group) => [
        group.id,
        await listModifierOptions(group.id),
      ] as const),
    )
      .then((entries) => {
        if (cancelled) return;
        setBomModifierGroups(perSizeModifierGroups);
        setBomModifierOptionsByGroup(Object.fromEntries(entries));
        setBomExactOptionsReady(true);
      })
      .catch((error) => {
        console.warn("Load BOM modifier options failed:", error);
        if (cancelled) return;
        setBomModifierGroups([]);
        setBomModifierOptionsByGroup({});
        setBomExactOptionsReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    open,
    scope,
    channel,
    innerTab,
    perSizeModifierGroupKey,
    perSizeModifierGroups,
  ]);

  // Lazy-load branch menu policy only when the FnB configuration tab is opened.
  // Older deployed databases simply show a clear migration message; editing
  // normal product information remains available until 00354 is installed.
  useEffect(() => {
    if (!open || scope !== "sku" || channel !== "fnb" || !initialData) {
      if (!open) {
        loadedMenuScopeKeyRef.current = null;
        setFnbMenuScopeMode("all");
        setFnbMenuBranchIds(new Set());
        setFnbMenuScopeError(null);
      }
      return;
    }
    if (innerTab !== "modifier") return;
    if (loadedMenuScopeKeyRef.current === initialData.id) return;

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
        setFnbMenuScopeDirty(false);
        loadedMenuScopeKeyRef.current = initialData.id;
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
  }, [open, scope, channel, initialData?.id, innerTab]);

  function toggleProductModifierGroup(groupId: string) {
    setProductModifierGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  function toggleFnbMenuBranch(branchId: string) {
    setFnbMenuScopeDirty(true);
    setFnbMenuBranchIds((previous) => {
      const next = new Set(previous);
      if (next.has(branchId)) next.delete(branchId);
      else next.add(branchId);
      return next;
    });
  }

  function setFnbMenuScopeModeDraft(mode: "all" | "selected" | "excluded") {
    setFnbMenuScopeDirty(true);
    setFnbMenuScopeMode(mode);
  }

  function getFnbMenuScopeDraft(): FnbProductBranchMenuPolicy {
    const branchIds = Array.from(fnbMenuBranchIds);
    if (fnbMenuScopeMode !== "all" && branchIds.length === 0) {
      throw new Error("Chọn ít nhất một chi nhánh, hoặc chuyển về Bán tại tất cả chi nhánh.");
    }
    return {
      mode:
        fnbMenuScopeMode === "selected"
          ? "only"
          : fnbMenuScopeMode === "excluded"
            ? "except"
            : "all",
      branchIds: fnbMenuScopeMode === "all" ? [] : branchIds,
    };
  }

  async function saveFnbMenuScopeDraft(productId: string) {
    const draft = getFnbMenuScopeDraft();
    await saveFnbProductBranchMenuPolicy(productId, draft.mode, draft.branchIds);
    // This browser may also be running POS in another tab. Clearing the
    // local cache makes its next load re-read the server whitelist.
    await invalidateMenuCache();
    setFnbMenuScopeDirty(false);
    return draft;
  }

  // Sản phẩm nhiều size phải dùng cùng một dữ liệu ở Giá, BOM và Quy cách.
  // Chỉ nạp ở ba bề mặt quản trị này để giữ dialog mở nhanh, nhưng tuyệt đối
  // không cho BOM lấy dòng đầu tiên trước khi biết sản phẩm có variants không.
  useEffect(() => {
    if (!open || !initialData || initialData.productType !== "sku") {
      if (!open) {
        loadedVariantsKeyRef.current = null;
        setVariantItems([]);
        setOriginalVariantIds(new Set());
        setVariantDataReady(false);
        setVariantDataError(null);
      }
      return;
    }
    if (innerTab !== "pricing" && innerTab !== "bom" && innerTab !== "variants") return;
    if (loadedVariantsKeyRef.current === initialData.id) return;
    const loadingProductId = initialData.id;
    loadedVariantsKeyRef.current = loadingProductId;
    setVariantDataReady(false);
    setVariantDataError(null);
    let cancelled = false;
    let settled = false;
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
        // Exact option quantities are loaded with their preparation unit so an
        // existing recipe can be opened and saved without turning 35 G into .035 Kg.
        if (channel === "fnb") {
          const rowMap = new Map<string, RecipeRow>();
          const conversionCache = new Map<string, UOMConversion[]>();
          const getConversions = async (materialId: string) => {
            const cached = conversionCache.get(materialId);
            if (cached) return cached;
            const conversions = await getUOMConversions(materialId).catch(() => []);
            conversionCache.set(materialId, conversions);
            return conversions;
          };
          for (const v of variants) {
            if (!v.bomCode) continue;
            try {
              const boms = await getBOMByCode(v.bomCode);
              const bom = boms.find((b) => !b.branchId) ?? boms[0];
              if (!bom) continue;
              const full = await getBOMById(bom.id);
              const itemsByMaterial = new Map(
                (full.items ?? []).map((item) => [item.materialId, item]),
              );
              for (const it of full.items ?? []) {
                const sk = it.modifierScaleTarget ?? "";
                const rkey = `${it.materialId}|${sk}`;
                let row = rowMap.get(rkey);
                if (!row) {
                  row = newRecipeRow();
                  row.materialId = it.materialId;
                  row.unit = it.inputUnit ?? it.unit ?? "";
                  row.scaleTarget = it.modifierScaleTarget ?? null;
                  rowMap.set(rkey, row);
                }
                row.qty[v.id] = it.inputQuantity ?? it.quantity;
              }
              const savedQuantities = await listBOMModifierOptionQuantities(bom.id);
              for (const saved of savedQuantities) {
                const item = itemsByMaterial.get(saved.materialId);
                if (!item) continue;
                const rkey = `${saved.materialId}|${item.modifierScaleTarget ?? ""}`;
                const row = rowMap.get(rkey);
                if (!row?.scaleTarget) continue;
                const inputUnit = item.inputUnit ?? item.unit;
                const conversions = await getConversions(saved.materialId);
                const inputQuantity =
                  getRecipeQuantityInInputUnit(
                    saved.quantity,
                    item.unit,
                    inputUnit,
                    conversions,
                  ) ?? saved.quantity;
                row.exactQty[v.id] = {
                  ...(row.exactQty[v.id] ?? {}),
                  [saved.modifierOptionId]: inputQuantity,
                };
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
        if (!cancelled) {
          settled = true;
          setVariantDataReady(true);
          setVariantDataError(null);
        }
      } catch (err) {
        if (cancelled) return;
        console.warn("Load variants failed:", err);
        settled = true;
        if (loadedVariantsKeyRef.current === loadingProductId) {
          loadedVariantsKeyRef.current = null;
        }
        setVariantDataReady(false);
        setVariantDataError(
          "Không tải được đầy đủ giá và công thức theo size. Dữ liệu sản phẩm chưa bị thay đổi.",
        );
      }
    })();
    return () => {
      cancelled = true;
      // Đổi tab giữa lúc tải phải nhả khóa để tab kế tiếp nạp lại đầy đủ.
      if (!settled && loadedVariantsKeyRef.current === loadingProductId) {
        loadedVariantsKeyRef.current = null;
      }
    };
  }, [open, initialData?.id, initialData?.productType, innerTab, channel, variantReloadNonce]);

  function retryVariantDataLoad() {
    loadedVariantsKeyRef.current = null;
    setVariantDataError(null);
    setVariantDataReady(false);
    setVariantReloadNonce((current) => current + 1);
  }

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
    // Create/update first. Removed sizes are deactivated only after all current
    // rows succeeded, so a transient failure cannot erase the working setup.
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
    for (const oldId of originalVariantIds) {
      if (!currentIds.has(oldId)) await deleteVariant(oldId);
    }
    return vmap;
  }

  // CEO 17/06/2026 (Phương án B): lưu công thức theo size (CHỈ FnB) — mỗi variant
  // 1 BOM riêng (code = bomCode cũ hoặc MãSP-Size). Mirror logic dialog cũ nhưng
  // chạy chung trong handleSave để 1 nút Lưu là xong cả size + công thức.
  function getPerSizeRecipeQuantity(row: RecipeRow, variantKey: string): number {
    if (!row.scaleTarget) return row.qty[variantKey] ?? 0;
    const defaultOption = (variantModifierOptionsByGroup[row.scaleTarget] ?? []).find(
      (option) => option.isDefault,
    );
    return defaultOption
      ? row.exactQty[variantKey]?.[defaultOption.id] ?? 0
      : 0;
  }

  function buildPerSizeExactQuantityRows(variantKey: string) {
    return recipeRows.flatMap((row) => {
      if (!row.materialId || !row.scaleTarget) return [];
      return (variantModifierOptionsByGroup[row.scaleTarget] ?? []).map((option) => ({
        materialId: row.materialId,
        modifierOptionId: option.id,
        inputQuantity: row.exactQty[variantKey]?.[option.id] ?? 0,
        inputUnit: row.unit,
      }));
    });
  }

  function buildFnbSizeSetupPayload(
    productCode: string,
  ): FnbSizeSetupVariantInput[] {
    const valid = recipeRows.filter((r) => r.materialId);
    return variantItems.map((v, index) => {
      const items = valid
        .map((r) => ({
          materialId: r.materialId,
          inputQuantity: getPerSizeRecipeQuantity(r, v.key),
          inputUnit: r.unit || "g",
          modifierScaleTarget: r.scaleTarget,
        }))
        .filter((it) => it.inputQuantity > 0);

      const bomCode =
        v.bomCode?.trim() ||
        `${productCode}-${sanitizeBomCode(v.name || "SIZE")}`;
      if (items.length === 0) {
        throw new Error(
          `Quy cách ${v.name.trim() || "chưa đặt tên"} chưa có công thức riêng.`,
        );
      }

      return {
        clientKey: v.key,
        id: v.id ?? undefined,
        name: v.name.trim() || "Default",
        sellPrice: v.sellPrice,
        costPrice: perSizeCostByKey[v.key] ?? v.costPrice,
        isDefault: v.isDefault,
        sortOrder: index,
        bomCode,
        bomName: `${name} ${v.name}`.trim(),
        items,
        exactRows: buildPerSizeExactQuantityRows(v.key),
      };
    });
  }

  async function syncFnbSizeSetup(
    productId: string,
    productCode: string,
  ): Promise<void> {
    const payload = buildFnbSizeSetupPayload(productCode);
    const saved = await saveFnbSizeSetupAtomic(productId, payload);
    const savedByKey = new Map(saved.map((row) => [row.clientKey, row]));
    setVariantItems((current) =>
      current.map((variant) => {
        const row = savedByKey.get(variant.key);
        return row ? { ...variant, id: row.id, bomCode: row.bomCode } : variant;
      }),
    );
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
    // Giá, BOM và Quy cách dùng chung một nguồn công thức theo size. Tab Giá
    // cũng cần danh mục NVL để tính đúng giá vốn Retail của từng BOM.
    const needForBom = hasBom && innerTab === "bom";
    const needForRecipe =
      channel === "fnb" &&
      (innerTab === "pricing" || innerTab === "bom" || innerTab === "variants") &&
      variantItems.length > 0;
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
  }, [
    open,
    scope,
    hasBom,
    innerTab,
    materialOptions.length,
    channel,
    variantItems.length,
  ]);

  // F&B cost is the Retail selling value of each component. Reprice loaded
  // legacy BOM rows after the product catalogue arrives so the normal BOM and
  // per-size matrix always show the same source of truth.
  useEffect(() => {
    if (channel !== "fnb" || materialOptions.length === 0 || bomItems.length === 0) return;
    const retailPriceById = new Map(
      materialOptions.map((material) => [
        material.id,
        getBomComponentUnitPrice(material, "fnb"),
      ]),
    );
    setBomItems((previous) => {
      let changed = false;
      const next = previous.map((item) => {
        const retailPrice = retailPriceById.get(item.materialId);
        if (retailPrice == null || retailPrice === item.costPrice) return item;
        changed = true;
        return { ...item, costPrice: retailPrice };
      });
      return changed ? next : previous;
    });
  }, [channel, materialOptions, bomItems.length]);

  // Load the existing preparation-unit conversions for materials used by the
  // size matrix. Cost preview and stock deduction must share the same factor.
  useEffect(() => {
    if (
      !open ||
      (innerTab !== "pricing" && innerTab !== "bom" && innerTab !== "variants") ||
      channel !== "fnb"
    ) return;
    const materialIds = Array.from(
      new Set(recipeRows.map((row) => row.materialId).filter(Boolean)),
    );
    const missingIds = materialIds.filter(
      (materialId) => !(materialId in recipeConversionsByMaterial),
    );
    if (missingIds.length === 0) return;

    let cancelled = false;
    getUOMConversionsByProductIds(missingIds)
      .then((conversions) => {
        if (cancelled) return;
        setRecipeConversionsByMaterial((current) => {
          const next = { ...current };
          for (const materialId of missingIds) {
            next[materialId] = conversions.get(materialId) ?? [];
          }
          return next;
        });
      })
      .catch((error) =>
        console.warn("Load size recipe UOM conversions failed:", error),
      );
    return () => {
      cancelled = true;
    };
  }, [
    open,
    innerTab,
    channel,
    recipeRows,
    recipeConversionsByMaterial,
  ]);

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

    const bomCodeTrim = bomCodeInput.trim();
    if (bomCodeTrim && bomCodeValid !== true) {
      setInnerTab("bom");
      toast({
        variant: "error",
        title: "Chưa thể liên kết BOM có sẵn",
        description: "Mã BOM này chưa được xác nhận là một công thức đang tồn tại. Xóa mã để tạo công thức mới, hoặc kiểm tra lại mã BOM có sẵn.",
        duration: 10000,
      });
      return;
    }

    const fnbSetupIssues = validateFnbVariantSetup({
      isFnb: scope === "sku" && channel === "fnb",
      variants: variantItems,
      recipeEnabled,
      recipeRows,
      modifierOptionsByGroup: variantModifierOptionsByGroup,
    });
    if (fnbSetupIssues.length > 0) {
      const firstIssue = fnbSetupIssues[0];
      setInnerTab(
        firstIssue.code === "variant_price_invalid"
          ? "pricing"
          : firstIssue.code === "variant_name_required" ||
              firstIssue.code === "variant_name_duplicate" ||
              firstIssue.code === "variant_default_invalid"
            ? "variants"
            : "bom",
      );
      toast({
        variant: "error",
        title: "Chưa thể lưu quy cách FnB",
        description: firstIssue.message,
        duration: 10000,
      });
      return;
    }

    if (scope === "sku" && channel === "fnb") {
      const usedMaterialIds = new Set<string>();
      if (hasBom && !bomCodeTrim && variantItems.length === 0) {
        for (const item of bomItems) usedMaterialIds.add(item.materialId);
      }
      if (recipeEnabled) {
        for (const row of recipeRows) {
          if (row.materialId) usedMaterialIds.add(row.materialId);
        }
      }
      const missingRetailPrice = materialOptions.find(
        (material) => usedMaterialIds.has(material.id) && !(Number(material.sellPrice) > 0),
      );
      if (missingRetailPrice) {
        setInnerTab("bom");
        toast({
          variant: "error",
          title: "Chưa thể tính giá vốn F&B",
          description: `${missingRetailPrice.code} · ${missingRetailPrice.name} chưa có giá bán Retail lớn hơn 0. Hãy thiết lập giá Retail của thành phần trước khi lưu công thức.`,
          duration: 10000,
        });
        return;
      }
    }

    const invalidRecipeUnit = recipeRows.find((row) => {
      if (!row.materialId) return false;
      const material = materialOptions.find((candidate) => candidate.id === row.materialId);
      if (!material) return true;
      return (
        getDirectConversionFactor(
          material.stockUnit || material.unit || "",
          row.unit,
          recipeConversionsByMaterial[row.materialId] ?? [],
        ) == null
      );
    });
    if (
      scope === "sku" &&
      channel === "fnb" &&
      variantItems.length > 0 &&
      invalidRecipeUnit
    ) {
      const material = materialOptions.find(
        (candidate) => candidate.id === invalidRecipeUnit.materialId,
      );
      setInnerTab("bom");
      toast({
        variant: "error",
        title: "Chưa thể quy đổi đơn vị công thức",
        description: `${material?.name || "Nguyên liệu"} chưa có quy đổi từ ${invalidRecipeUnit.unit || "ĐVT pha chế"} sang ${material?.stockUnit || material?.unit || "ĐVT tồn"}.`,
        duration: 10000,
      });
      return;
    }

    let inlineExactQuantityRows: ReturnType<typeof buildInlineExactQuantityRows> = [];
    try {
      // A standalone BOM is linked as-is. The inline table is only persisted
      // when this dialog is creating or editing its own product BOM.
      if (!bomCodeTrim) {
        inlineExactQuantityRows = buildInlineExactQuantityRows();
      }
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

    const shouldSaveFnbMenuScope =
      isEdit &&
      !!initialData &&
      scope === "sku" &&
      channel === "fnb" &&
      fnbMenuScopeDirty;
    if (shouldSaveFnbMenuScope) {
      try {
        getFnbMenuScopeDraft();
      } catch (menuScopeError) {
        setInnerTab("modifier");
        toast({
          variant: "error",
          title: "Chưa thể lưu phạm vi menu FnB",
          description:
            menuScopeError instanceof Error
              ? menuScopeError.message
              : "Phạm vi menu FnB chưa hợp lệ.",
          duration: 10000,
        });
        return;
      }
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
      // Day 20/05/2026 (CEO BOM Phase 5): xử lý link Mã BOM có sẵn.
      // Nếu user nhập bomCode → set products.bom_code + has_bom=true
      // Nếu trống → bomCode = null (giữ logic cũ với items inline)
      // Clearing the advanced link must actually restore the normal inline
      // product BOM lookup; omitting the field would leave the old link in DB.
      const linkedBomCode =
        bomCodeTrim || (isEdit && initialData?.bomCode ? null : undefined);
      const defaultVariant = variantItems.find((variant) => variant.isDefault);
      const representativeSellPrice = defaultVariant
        ? defaultVariant.sellPrice
        : Number(sellPrice);
      const representativeCostPrice = defaultVariant
        ? perSizeCostByKey[defaultVariant.key] ?? defaultVariant.costPrice
        : Number(costPrice) || 0;

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
        sellPrice: scope === "sku" ? representativeSellPrice : 0,
        costPrice: representativeCostPrice,
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

        // Exact BOM quantities are guarded by the modifier groups currently
        // effective for this product. Persist the same draft shown in the FnB
        // tab before saving those quantities, otherwise the server correctly
        // rejects a newly selected product-level group as not yet effective.
        if (scope === "sku" && channel === "fnb") {
          try {
            const ids =
              modifierMode === "override"
                ? Array.from(productModifierGroupIds)
                : [];
            await setProductModifierGroups(initialData.id, ids);
          } catch (modErr) {
            console.warn("Save product modifier links failed:", modErr);
            setInnerTab("modifier");
            toast({
              variant: "warning",
              title: "Sản phẩm đã lưu, tùy chọn FnB chưa lưu",
              description:
                modErr instanceof Error
                  ? modErr.message
                  : "Kiểm tra lại nhóm tùy chọn rồi bấm Lưu lần nữa.",
              duration: 10000,
            });
            onSuccess?.();
            return;
          }
        }

        // Day 18/05/2026 (CEO refactor): sync BOM khi edit SKU
        if (scope === "sku") {
          if (
            variantItems.length === 0 &&
            hasBom &&
            bomItems.length > 0 &&
            !bomCodeTrim
          ) {
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
                  // Legacy inline BOMs may not have a code. Assign one the
                  // first time they are saved, but never rename an existing
                  // code that other historical documents may reference.
                  code:
                    bomExistingCode ??
                    getAutomaticBomCode(
                      initialData.code ?? "SKU",
                      bomBranchId,
                      branches,
                    ),
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
                  code: getAutomaticBomCode(
                    initialData.code ?? "SKU",
                    bomBranchId,
                    branches,
                  ),
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
                title: "Sản phẩm đã lưu, công thức chưa hoàn tất",
                description: bomErr instanceof Error ? bomErr.message : "Lỗi không xác định",
                duration: 10000,
              });
              setInnerTab("bom");
              onSuccess?.();
              return;
            }
          } else if (variantItems.length === 0 && !hasBom && bomExistingId) {
            // User tắt hasBom + có BOM existing → deactivate
            try {
              await deleteBOM(bomExistingId);
            } catch {
              // Ignore
            }
          }
        }

        // CEO 01/06/2026 — Sprint 2.4a: Sync variants (Size M/L/XL).
        if (scope === "sku") {
          try {
            if (channel === "fnb" && recipeEnabled) {
              await syncFnbSizeSetup(initialData.id, initialData.code ?? "");
            } else {
              await syncVariants(initialData.id);
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
              duration: 10000,
            });
            setInnerTab("variants");
            onSuccess?.();
            return;
          }
        }

        if (shouldSaveFnbMenuScope) {
          try {
            await saveFnbMenuScopeDraft(initialData.id);
          } catch (menuScopeError) {
            // The product and its BOM may already have been stored. Keep the
            // dialog open so the operator can retry the final menu-policy step
            // instead of silently leaving it in an unknown state.
            toast({
              variant: "warning",
              title: "Sản phẩm đã lưu, phạm vi menu chưa lưu",
              description:
                menuScopeError instanceof Error
                  ? menuScopeError.message
                  : "Kiểm tra lại kết nối rồi bấm Lưu lần nữa.",
              duration: 10000,
            });
            onSuccess?.();
            return;
          }
        }

        clearDraft();
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
      const createAtomicallyWithFnbSizes =
        scope === "sku" &&
        channel === "fnb" &&
        recipeEnabled &&
        variantItems.length > 0;
      let created: { id: string };

      if (createAtomicallyWithFnbSizes) {
        const atomicResult = await createFnbProductWithSizeSetupAtomic(
          {
            code,
            name,
            categoryId,
            unit: finalUnit,
            purchaseUnit: finalUnit,
            stockUnit: finalUnit,
            sellUnit: finalUnit,
            sellPrice: representativeSellPrice,
            costPrice: representativeCostPrice,
            minStock: commonPayload.minStock,
            maxStock: commonPayload.maxStock,
            vatRate: commonPayload.vatRate,
            barcode: commonPayload.barcode,
            weight: commonPayload.weight,
            description: commonPayload.description,
            image: commonPayload.image,
            allowSale: commonPayload.allowSale,
            groupCode: selectedCategory!.code,
            shelfLifeDays: commonPayload.shelfLifeDays,
            shelfLifeUnit: commonPayload.shelfLifeUnit,
            supplierId: commonPayload.supplierId,
            brand: commonPayload.brand,
            bomCode: bomCodeTrim || undefined,
          },
          buildFnbSizeSetupPayload(code),
          modifierMode === "override"
            ? Array.from(productModifierGroupIds)
            : [],
        );
        created = { id: atomicResult.productId };
      } else {
        created = await createProduct({
          ...commonPayload,
          code,
          productType: scope,
          // NVL không có kênh bán (nội bộ). SKU bắt buộc fnb hoặc retail.
          hasBom: scope === "sku" ? hasBom : false,
          groupCode: selectedCategory!.code,
          stock: Number(initialStock) || 0,
        });
      }

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

      // A newly created product-level override must exist before the guarded
      // exact-recipe RPC can accept quantities for that modifier group.
      if (
        created?.id &&
        scope === "sku" &&
        channel === "fnb" &&
        !createAtomicallyWithFnbSizes &&
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
          toast({
            variant: "warning",
            title: "Sản phẩm đã tạo, tùy chọn FnB chưa lưu",
            description:
              modErr instanceof Error
                ? modErr.message
                : "Mở lại sản phẩm và lưu nhóm tùy chọn trước khi khai định lượng.",
            duration: 10000,
          });
          onOpenChange(false);
          onSuccess?.();
          return;
        }
      }

      // Day 18/05/2026 (CEO refactor): nếu SKU có BOM + items → tạo BOM ngay
      // sau khi tạo SP. Vẫn trong cùng dialog, không pop thêm dialog mới.
      if (
        !createAtomicallyWithFnbSizes &&
        scope === "sku" &&
        variantItems.length === 0 &&
        hasBom &&
        created?.id &&
        bomItems.length > 0 &&
        !bomCodeTrim
      ) {
        try {
          const createdBom = await createBOM({
            productId: created.id,
            branchId: bomBranchId,
            code: getAutomaticBomCode(code, bomBranchId, branches),
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
          if (channel === "fnb") {
            await saveBOMModifierOptionQuantities(
              createdBom.id,
              inlineExactQuantityRows,
            );
          }
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

      // CEO 01/06/2026 — Sprint 2.4a: Sync variants khi tạo SKU.
      if (
        !createAtomicallyWithFnbSizes &&
        created?.id &&
        scope === "sku" &&
        variantItems.length > 0
      ) {
        try {
          if (channel === "fnb" && recipeEnabled) {
            await syncFnbSizeSetup(created.id, code);
          } else {
            await syncVariants(created.id);
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
            duration: 10000,
          });
          onOpenChange(false);
          onSuccess?.();
          return;
        }
      }

      clearDraft();
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

            {hasFnbSizeVariants && (
              <div className="flex items-start gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-3 text-xs">
                <Icon name="straighten" size={14} className="mt-0.5 shrink-0 text-primary" />
                <span>
                  Món có quy cách: quản lý giá theo từng size ở bảng dưới.
                  Giá đại diện ngoài danh sách được đồng bộ theo size mặc định khi lưu.
                </span>
              </div>
            )}

            {fnbVariantContextPending && (
              variantDataError ? (
                <div className="flex min-h-24 flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 text-center text-sm">
                  <p className="text-destructive">{variantDataError}</p>
                  <Button type="button" variant="outline" size="sm" onClick={retryVariantDataLoad}>
                    <Icon name="refresh" size={14} className="mr-1" />
                    Thử lại
                  </Button>
                </div>
              ) : (
                <div className="flex min-h-24 items-center justify-center rounded-lg border text-sm text-muted-foreground">
                  <Icon name="progress_activity" size={18} className="mr-2 animate-spin" />
                  Đang tải giá và công thức của các size...
                </div>
              )
            )}

            {hasFnbSizeVariants && (
              <section className="space-y-2">
                <div className="flex flex-wrap items-end justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-medium">Giá theo quy cách</h3>
                    <p className="text-xs text-muted-foreground">
                      Giá vốn lấy từ giá bán Retail của thành phần trong BOM từng size.
                    </p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => setInnerTab("bom")}>
                    <Icon name="science" size={14} className="mr-1" />
                    Xem công thức tất cả size
                  </Button>
                </div>
                <div className="overflow-x-auto rounded-lg border">
                  <table className="w-full min-w-[680px] text-sm">
                    <thead className="bg-surface-container-low text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">Quy cách</th>
                        <th className="w-40 px-3 py-2 text-right font-semibold">Giá bán (đ)</th>
                        <th className="w-36 px-3 py-2 text-right font-semibold">Giá vốn F&B</th>
                        <th className="px-3 py-2 text-left font-semibold">Mã BOM</th>
                        <th className="w-28 px-3 py-2 text-center font-semibold">POS mặc định</th>
                      </tr>
                    </thead>
                    <tbody>
                      {variantItems.map((variant, index) => (
                        <tr key={variant.key} className="border-t">
                          <td className="px-3 py-2 font-medium">{variant.name || `Size ${index + 1}`}</td>
                          <td className="px-3 py-2">
                            <NumericInput
                              value={variant.sellPrice || null}
                              onChange={(value) =>
                                setVariantItems((current) =>
                                  current.map((item) =>
                                    item.key === variant.key
                                      ? { ...item, sellPrice: value ?? 0 }
                                      : item,
                                  ),
                                )
                              }
                              min={0}
                              decimals={0}
                              placeholder="0"
                            />
                          </td>
                          <td className="px-3 py-2 text-right font-semibold tabular-nums">
                            {formatCurrency(perSizeCostByKey[variant.key] ?? variant.costPrice ?? 0)}
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">
                            {variant.bomCode || "Chưa tạo"}
                          </td>
                          <td className="px-3 py-2 text-center">
                            {variant.isDefault ? (
                              <span className="inline-flex rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                                Mặc định
                              </span>
                            ) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* Pricing — giá vốn / giá bán / VAT. Format số có dấu chấm ngăn cách. */}
            <div className={
              hasFnbSizeVariants
                ? "grid grid-cols-1 gap-4 sm:max-w-sm"
                : "grid grid-cols-1 gap-4 sm:grid-cols-3"
            }>
              {!hasFnbSizeVariants && !fnbVariantContextPending && <div className="space-y-2">
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
              </div>}
              {!hasFnbSizeVariants && !fnbVariantContextPending && <div className="space-y-2">
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
              </div>}
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
                {hasFnbSizeVariants
                  ? "Mỗi size có BOM riêng. Chỉnh cùng một ma trận để so sánh và tránh ghi nhầm công thức giữa các size."
                  : "Định nghĩa NVL cần để tạo 1 đơn vị SKU. Khi bán SKU, hệ thống tự trừ NVL theo công thức này."}
              </div>

              {fnbVariantContextPending ? (
                variantDataError ? (
                  <div className="flex min-h-32 flex-col items-center justify-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 text-center text-sm">
                    <p className="text-destructive">{variantDataError}</p>
                    <Button type="button" variant="outline" size="sm" onClick={retryVariantDataLoad}>
                      <Icon name="refresh" size={14} className="mr-1" />
                      Thử lại
                    </Button>
                  </div>
                ) : (
                  <div className="flex min-h-32 items-center justify-center rounded-lg border text-sm text-muted-foreground">
                    <Icon name="progress_activity" size={18} className="mr-2 animate-spin" />
                    Đang tải toàn bộ công thức theo size...
                  </div>
                )
              ) : hasFnbSizeVariants ? (
                <div className="space-y-4">
                  <section className="space-y-2">
                    <div className="flex flex-wrap items-end justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-medium">Tổng quan công thức theo size</h3>
                        <p className="text-xs text-muted-foreground">
                          Mỗi cột là một BOM độc lập; giá vốn được tính từ giá bán Retail của thành phần.
                        </p>
                      </div>
                      <Button type="button" variant="outline" size="sm" onClick={() => setInnerTab("pricing")}>
                        <Icon name="payments" size={14} className="mr-1" />
                        Xem giá tất cả size
                      </Button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                      {variantItems.map((variant) => (
                        <div key={variant.key} className="rounded-lg border bg-background p-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="font-medium break-words">{variant.name}</p>
                              <p className="mt-1 font-mono text-xs text-muted-foreground break-all">
                                {variant.bomCode || "Mã BOM sẽ tự tạo khi lưu"}
                              </p>
                            </div>
                            {variant.isDefault && (
                              <span className="shrink-0 rounded-full bg-primary/10 px-2 py-1 text-xs font-medium text-primary">
                                POS mặc định
                              </span>
                            )}
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <span className="block text-muted-foreground">Giá bán</span>
                              <span className="font-semibold tabular-nums">{formatCurrency(variant.sellPrice)}</span>
                            </div>
                            <div>
                              <span className="block text-muted-foreground">Giá vốn F&B</span>
                              <span className="font-semibold tabular-nums">
                                {formatCurrency(perSizeCostByKey[variant.key] ?? variant.costPrice ?? 0)}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>

                  <section className="space-y-3 rounded-lg border border-status-info/30 bg-status-info/5 p-3">
                    <label className="flex flex-wrap items-center gap-2 text-sm font-medium cursor-pointer">
                      <input
                        type="checkbox"
                        checked={recipeEnabled}
                        onChange={(event) => setRecipeEnabled(event.target.checked)}
                        className="size-4"
                      />
                      Trừ kho theo công thức từng size
                      <span className="text-xs font-normal text-muted-foreground">
                        Bán size nào dùng đúng BOM và định lượng của size đó.
                      </span>
                    </label>
                    {recipeEnabled ? (
                      <PerSizeRecipeMatrix
                        sizes={variantItems.map((variant) => ({ key: variant.key, name: variant.name }))}
                        rows={recipeRows}
                        onChange={setRecipeRows}
                        materials={materialOptions}
                        groups={perSizeModifierGroups}
                        optionsByGroup={variantModifierOptionsByGroup}
                        conversionsByMaterial={recipeConversionsByMaterial}
                        loading={
                          materialOptions.length === 0 ||
                          (perSizeModifierGroups.length > 0 &&
                            Object.keys(variantModifierOptionsByGroup).length === 0)
                        }
                      />
                    ) : (
                      <p className="rounded-md border border-dashed bg-background px-3 py-4 text-sm text-muted-foreground">
                        Bật công thức từng size để khai nguyên liệu và định lượng cho tất cả quy cách.
                      </p>
                    )}
                  </section>
                </div>
              ) : (
                <>
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 space-y-1.5">
                <p className="text-sm font-medium">Mã BOM</p>
                <p className="font-mono text-sm font-semibold text-primary">
                  {visibleBomCode}
                </p>
                <p className="text-xs text-muted-foreground">
                  {bomExistingCode
                    ? "Mã của công thức đang mở. Hệ thống giữ nguyên để các nghiệp vụ cũ vẫn tra được đúng công thức."
                    : "Hệ thống tự sinh khi lưu công thức mới. Không cần nhập mã thủ công."}
                </p>
              </div>

              {/* BOM standalone is an advanced shared-recipe workflow. It is
                  intentionally secondary to the normal inline recipe flow. */}
              <div className="rounded-lg border border-dashed bg-muted/20 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium">
                    Dùng BOM có sẵn thay cho công thức này{" "}
                    <span className="text-xs text-muted-foreground font-normal">
                      · nâng cao
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
                  placeholder="VD: BOM-CFS-001 (chỉ nhập khi BOM đã tồn tại)"
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
                    Không tìm thấy mã BOM đang hoạt động. Kiểm tra lại mã hoặc để trống để tạo công thức mới ở dưới.
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Để trống trong luồng thông thường. Chỉ nhập khi một BOM dùng chung đã được tạo sẵn ở trang Công thức.
                </p>
              </div>

              {/* A BOM is either global or a single branch override. The
                  product menu policy remains the multi-branch control. */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium">Phạm vi công thức</label>
                  <Select
                    value={bomBranchId ?? "__all__"}
                    onValueChange={(v) => setBomBranchId(v === "__all__" ? null : v)}
                    items={[
                      { value: "__all__", label: "Dùng chung cho mọi chi nhánh bán món này" },
                      ...branches.map((b) => ({ value: b.id, label: `Ghi đè riêng: ${b.name}` })),
                    ]}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue>
                        {(v) => {
                          if (!v || v === "__all__") return "Dùng chung cho mọi chi nhánh bán món này";
                          const m = branches.find((b) => b.id === v);
                          return m ? `Ghi đè riêng: ${m.name}` : v;
                        }}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__all__">Dùng chung cho mọi chi nhánh bán món này</SelectItem>
                      {branches.map((b) => (
                        <SelectItem key={b.id} value={b.id}>Ghi đè riêng: {b.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Muốn bán món ở nhiều quán: chọn phạm vi dùng chung ở đây, rồi chọn nhiều quán tại tab Tùy chọn FnB. Chỉ ghi đè khi quán đó có công thức khác.
                  </p>
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
                          <th className="text-right px-3 py-2 font-semibold w-28">
                            {channel === "fnb" ? "Giá vốn F&B/SP" : "Cost/SP"}
                          </th>
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
                            {channel === "fnb"
                              ? "Tổng giá vốn F&B (giá Retail):"
                              : "Tổng giá vốn (theo BOM):"}
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
                    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-primary/30 bg-background px-2 py-1 text-xs font-medium text-primary">
                      <Icon name="lock" size={13} />
                      Bắt buộc theo lựa chọn đã gắn
                    </span>
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
                </>
              )}
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
                            onClick={() => setFnbMenuScopeModeDraft("all")}
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
                            onClick={() => setFnbMenuScopeModeDraft("selected")}
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
                            onClick={() => setFnbMenuScopeModeDraft("excluded")}
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
                          <p
                            className={`text-xs ${
                              fnbMenuScopeDirty
                                ? "font-medium text-primary"
                                : "text-muted-foreground"
                            }`}
                          >
                            {fnbMenuScopeDirty
                              ? "Phạm vi menu sẽ được lưu cùng nút Lưu bên dưới."
                              : "Chưa có thay đổi phạm vi menu."}
                          </p>
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
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-1 items-start gap-2">
                  <Icon name="straighten" size={16} className="text-status-info shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Quy cách / Cỡ (vd M, L, XL hoặc 250g, 500g)</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Quản lý tên, thứ tự và cỡ mặc định trên POS. Giá quản lý tại tab Giá & Tồn kho; công thức quản lý tại tab BOM.
                    </p>
                  </div>
                  </div>
                  {variantItems.length > 0 && (
                    <Button type="button" variant="outline" size="sm" onClick={() => setInnerTab("pricing")}>
                      <Icon name="payments" size={14} className="mr-1" />
                      Thiết lập giá
                    </Button>
                  )}
                </div>
              </div>

              {channel === "fnb" && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary/25 bg-primary/5 p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">Chi nhánh bán món này</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Áp dụng chung cho mọi size. {fnbMenuScopeMode === "selected"
                        ? `Chỉ bán tại ${fnbMenuBranchIds.size} chi nhánh đã chọn.`
                        : fnbMenuScopeMode === "excluded"
                          ? `Ẩn tại ${fnbMenuBranchIds.size} chi nhánh đã chọn.`
                          : "Đang bán tại tất cả chi nhánh FnB."}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setInnerTab("modifier")}
                  >
                    <Icon name="storefront" size={14} className="mr-1" />
                    Thiết lập chi nhánh
                  </Button>
                </div>
              )}

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
                        <th className="text-right px-3 py-2 font-semibold w-32">
                          {channel === "fnb" ? "Giá vốn tự tính" : "Giá vốn (đ)"}
                        </th>
                        <th className="text-center px-3 py-2 font-semibold w-24">POS mặc định</th>
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
                            <div className="text-right font-medium tabular-nums">
                              {v.sellPrice > 0 ? formatCurrency(v.sellPrice) : (
                                <span className="text-status-warning">Chưa nhập</span>
                              )}
                            </div>
                          </td>
                          {channel !== "fnb" ? (
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
                          ) : (
                            <td className="px-3 py-2 text-right font-medium tabular-nums">
                              {formatCurrency(perSizeCostByKey[v.key] ?? 0)}
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

              {/* Công thức nằm tại đúng tab BOM để người quản lý có một nơi
                  duy nhất xem/chỉnh NVL cho mọi size. */}
              {channel === "fnb" && variantItems.length > 0 && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-status-info/30 bg-status-info/5 p-3">
                  <div>
                    <p className="text-sm font-medium">Công thức và định lượng theo size</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      Được quản lý tập trung tại tab Công thức sản xuất (BOM), hiển thị đồng thời mọi size.
                    </p>
                  </div>
                  <Button type="button" variant="outline" size="sm" onClick={() => setInnerTab("bom")}>
                    <Icon name="science" size={14} className="mr-1" />
                    Mở công thức tất cả size
                  </Button>
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
                                  {getBomComponentUnitPrice(p, channel) > 0 ? (
                                    <span className="text-[11px] text-muted-foreground tabular-nums whitespace-nowrap">
                                      {formatCurrency(getBomComponentUnitPrice(p, channel))}
                                    </span>
                                  ) : channel === "fnb" ? (
                                    <span className="text-[11px] text-destructive whitespace-nowrap">
                                      Chưa có giá Retail
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
                      costPrice: getBomComponentUnitPrice(m, channel),
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
