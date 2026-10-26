"use client";

import { useState, useEffect, useMemo, useRef, useCallback, memo } from "react";
import { getFnbBranchComponentCosts } from "@/lib/services/supabase/fnb-branch-cost";
import { useDurableFormDraft } from "@/lib/hooks/use-durable-form-draft";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumericInput } from "@/components/ui/numeric-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAuth, useToast } from "@/lib/contexts";
import { getClient, getCurrentContext } from "@/lib/services/supabase/base";
import { getUOMConversions, getUOMConversionsByProductIds } from "@/lib/services/supabase/uom";
import { loadDocumentCopy, type DocumentCopySource } from "@/lib/services/supabase/document-copy";
import { pickBestConversion, getDirectConvertibleUnits, getDirectConversionFactor } from "@/lib/format-uom";
import { inventoryCountFromStock, inventoryCountToStock } from "@/lib/inventory-count-uom";
import { preferredWeighingUnit, stockToInput, operationalFactor, switchInputQuantity } from "@/lib/operational-uom";
import { StockWithConversion } from "@/components/shared/stock-with-conversion";
import type { UOMConversion } from "@/lib/types";
import type { Database } from "@/lib/supabase/types";
import { isRpcUnavailable } from "@/lib/services/supabase/rpc-utils";
import { Icon } from "@/components/ui/icon";
import { formatNumber, formatCurrency, formatStockQuantity } from "@/lib/format";
import { buildInventoryCheckProductFilter } from "@/lib/inventory-check-search";

type ProductRow = Pick<
  Database["public"]["Tables"]["products"]["Row"],
  "id" | "code" | "name" | "unit" | "cost_price"
>;

interface InventoryCheckLine {
  needsCount?: boolean;
  productId: string;
  productCode: string;
  productName: string;
  unit: string;
  /** Giá vốn 1 đơn vị cơ bản — để tính giá trị lệch (tiền). */
  costPrice: number;
  systemStock: number;
  /** Tồn thực tế theo ĐƠN VỊ CƠ BẢN — dùng khi SP KHÔNG có quy cách. */
  actualStock: number;
  /** null keeps the existing packaging-plus-remainder entry mode. */
  countUnit: string | null;
  // CEO 28/05/2026: quy cách (UOM). Nếu có → nhập theo thùng + lẻ.
  conversions: UOMConversion[];
  /** Số đơn vị nhỏ trong 1 đơn vị lớn (vd 1 Thùng = 12 Hộp → 12). null = không quy cách. */
  convFactor: number | null;
  /** Tên đơn vị lớn (vd "Thùng"). */
  convBigUnit: string | null;
  // CEO 29/05/2026: nhập theo 2 ô — số đơn vị lớn (Thùng) + số lẻ (đơn vị chính).
  /** Input: số đơn vị lớn (thùng) — chỉ dùng khi có quy cách. */
  actualBig: number;
  /** Input: số lẻ (đơn vị nhỏ). */
  actualSmall: number;
}

/** Tồn thực tế quy về đơn vị cơ bản (nguồn sự thật cho lệch + submit).
 * Làm tròn 4 chữ số để khử sai số dấu phẩy động khi quy đổi qua lại
 * (vd 224.58 ÷ 12 × 12 = 224.5799… → tránh lệch "-0" giả). */
function lineActual(item: InventoryCheckLine): number {
  if (item.needsCount) return item.systemStock;
  if (item.countUnit !== null) {
    return inventoryCountToStock(item.actualStock, item.unit, item.countUnit, item.conversions) ?? NaN;
  }
  if (item.convFactor && item.convFactor > 0) {
    const raw = item.actualBig * item.convFactor + item.actualSmall;
    return Math.round(raw * 10000) / 10000;
  }
  return item.actualStock;
}

interface CreateInventoryCheckDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  copySource?: DocumentCopySource | null;
}

const PENDING_CODE_PLACEHOLDER = "Tự tạo khi lưu";

export function CreateInventoryCheckDialog({
  open,
  onOpenChange,
  onSuccess,
  copySource,
}: CreateInventoryCheckDialogProps) {
  const { toast } = useToast();
  const { currentBranch, branches, activeBranchId } = useAuth();
  const allowFlexibleCountUnits = (branches.find((branch) => branch.id === activeBranchId) ?? currentBranch)?.branchType === "store";
  const [code, setCode] = useState("");
  const [notes, setNotes] = useState("");
  const [productSearch, setProductSearch] = useState("");
  const [showProductDropdown, setShowProductDropdown] = useState(false);
  const [filteredProducts, setFilteredProducts] = useState<ProductRow[]>([]);
  const [productSearchStatus, setProductSearchStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [checkItems, setCheckItems] = useState<InventoryCheckLine[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const saveLockRef = useRef(false);
  const addingProducts = useRef(new Set<string>());
  const formSession = useRef(0);
  const invalidateFormSession = useCallback(() => { formSession.current++; addingProducts.current.clear(); }, []);
  const [addingCount, setAddingCount] = useState(0);
  const [copyLoading, setCopyLoading] = useState(false);
  const [copyError, setCopyError] = useState("");
  const [request, setRequest] = useState({ id: crypto.randomUUID(), signature: "" });

  useEffect(() => {
    invalidateFormSession();
    setAddingCount(0);
    if (!open) return;

    setCode(PENDING_CODE_PLACEHOLDER);
    setNotes("");
    setProductSearch("");
    setShowProductDropdown(false);
    setFilteredProducts([]);
    setProductSearchStatus("idle");
    setCheckItems([]);
    setErrors({});
    setSaving(false);
    return invalidateFormSession;
  }, [open, activeBranchId, invalidateFormSession]);

  useEffect(() => {
    if (!open || !copySource || !activeBranchId) return;
    let cancelled = false;
    setCopyLoading(true); setCopyError("");
    (async () => {
      const seed = await loadDocumentCopy('inventory', copySource.id, activeBranchId, allowFlexibleCountUnits);
      const ids = seed.items.map(p => p.id);
      const conversions = await getUOMConversionsByProductIds(ids);
      const costs = await getFnbBranchComponentCosts(activeBranchId, ids);
      const ctx = await getCurrentContext();
      const stock = new Map<string,number>();
      for (let offset=0;offset<ids.length;offset+=100) {
        const {data,error} = await getClient().from('branch_stock').select('product_id,quantity')
          .eq('tenant_id',ctx.tenantId).eq('branch_id',activeBranchId).is('variant_id',null).in('product_id',ids.slice(offset,offset+100)).limit(1000);
        if (error) throw error;
        if (data?.length === 1000) throw new Error('Dữ liệu tồn quá lớn để sao chép an toàn. Vui lòng kiểm tra từng mặt hàng.');
        for (const row of data ?? []) stock.set(row.product_id,(stock.get(row.product_id) ?? 0)+Number(row.quantity ?? 0));
      }
      if (cancelled) return;
      setCheckItems(seed.items.map(p => ({productId:p.id,productCode:p.code,productName:p.name,unit:p.unit,costPrice:costs.get(p.id)?.unitCost ?? Number(p.cost_price),systemStock:stock.get(p.id) ?? 0,actualStock:0,countUnit:p.unit,conversions:conversions.get(p.id) ?? [],convFactor:null,convBigUnit:null,actualBig:0,actualSmall:0,needsCount:true})));
      setNotes(`[Sao chép danh sách hàng từ ${seed.code}]`);
    })().catch(e => {if (!cancelled) setCopyError(e instanceof Error ? e.message : 'Không đọc được phiếu nguồn.');})
      .finally(() => {if (!cancelled) setCopyLoading(false);});
    return () => {cancelled = true;};
  }, [open, copySource, activeBranchId, allowFlexibleCountUnits]);

  const { clearDraft, flushDraft } = useDurableFormDraft({
    form: copySource ? "inventory-check-copy" : "inventory-check-create",
    entityId: copySource?.id,
    branchId: activeBranchId,
    autoRestore: !copySource,
    ready: !copySource || (!copyLoading && !copyError && checkItems.length > 0),
    open,
    onRequestOpen: () => onOpenChange(true),
    snapshot: { checkItems, notes, request },
    hasContent: (draft) => draft.checkItems.length > 0 || !!draft.notes.trim(),
    restore: (draft) => {
      setCheckItems(draft.checkItems);
      setNotes(draft.notes);
      setRequest(draft.request);
    },
  });

  useEffect(() => {
    let cancelled = false;
    const term = productSearch.trim();
    if (!term) {
      setFilteredProducts([]);
      setProductSearchStatus("idle");
      return;
    }

    setProductSearchStatus("loading");
    const timer = setTimeout(async () => {
      try {
        const supabase = getClient();
        const ctx = await getCurrentContext();
        const isOutlet =
          currentBranch?.branchType === "store" ||
          branches.some(
            (branch) => branch.id === activeBranchId && branch.branchType === "store",
          );
        // CEO 07/07/2026 (Cách B) — lọc SP kiểm kho theo VAI TRÒ + CHI NHÁNH:
        //  • LUÔN loại món menu F&B (fnb_menu_item) — không giữ tồn ở đâu.
        //  • Kho/Xưởng: NVL vẫn giữ tồn trực tiếp dù có BOM; chỉ loại SKU
        //    Retail có BOM vì tồn của SKU này nằm ở NVL.
        //  • QUÁN (outlet): GIỮ SKU Retail has_bom (thành phần giữ tồn thật tại
        //    quán) → cho đếm sữa lon / ly / cà phê rang xay.
        // Gộp điều kiện vai trò, phạm vi kho và tìm kiếm thành một bộ lọc lồng nhau;
        // PostgREST chỉ nhận một biểu thức `or` cho mỗi truy vấn.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let q: any = (supabase as any)
          .from("products_scoped")
          .select("id, code, name, unit, cost_price")
          .eq("tenant_id", ctx.tenantId)
          .eq("is_active", true);
        const productFilter = buildInventoryCheckProductFilter(term, isOutlet);
        if (productFilter) q = q.or(productFilter);
        q = q.limit(10);
        const { data, error } = await q;

        if (cancelled) return;
        if (error) {
          setFilteredProducts([]);
          setProductSearchStatus("error");
          return;
        }

        setFilteredProducts((data ?? []) as ProductRow[]);
        setProductSearchStatus("ready");
      } catch {
        if (cancelled) return;
        setFilteredProducts([]);
        setProductSearchStatus("error");
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [productSearch, currentBranch?.branchType, branches, activeBranchId]);

  async function addProduct(product: ProductRow) {
    if (saving || addingProducts.current.has(product.id) || checkItems.some((item) => item.productId === product.id)) {
      setProductSearch("");
      setShowProductDropdown(false);
      return;
    }
    const session = formSession.current;
    addingProducts.current.add(product.id);
    setAddingCount(addingProducts.current.size);
    setShowProductDropdown(false);
    try {
    const supabase = getClient();
    const ctx = await getCurrentContext();
    if (session !== formSession.current) return;
    const branchId = activeBranchId ?? ctx.branchId;
    // branch_stock can have multiple base rows when variant_id is NULL; sum rows instead of maybeSingle().
    const { data: branchStockRows, error: stockErr } = await supabase
      .from("branch_stock")
      .select("quantity")
      .eq("tenant_id", ctx.tenantId)
      .eq("branch_id", branchId)
      .eq("product_id", product.id)
      .is("variant_id", null);

    if (stockErr) {
      if (session !== formSession.current) return;
      toast({
        title: "Không đọc được tồn kho chi nhánh",
        description: stockErr.message,
        variant: "error",
      });
      return;
    }

    const systemStock = (branchStockRows ?? []).reduce(
      (sum, row) => sum + Number(row.quantity ?? 0),
      0,
    );

    // CEO 28/05/2026: load quy cách để cho nhập theo thùng + lẻ.
    let conversions: UOMConversion[] = [];
    let costPrice = Number(product.cost_price ?? 0);
    try {
      conversions = await getUOMConversions(product.id);
      const costs = await getFnbBranchComponentCosts(branchId, [product.id]);
      costPrice = costs.get(product.id)?.unitCost ?? costPrice;
    } catch {
      toast({ title: "Không tải được đơn vị quy đổi hoặc giá vốn", description: "Thử thêm lại mặt hàng. Chưa thay đổi tồn kho.", variant: "error" });
      return;
    }
    const best = pickBestConversion(product.unit, conversions);
    if (session !== formSession.current) return;
    const convFactor = best && best.factor > 0 ? best.factor : null;
    const convBigUnit = best ? best.fromUnit : null;
    // CEO 29/05/2026: tách tồn hệ thống thành thùng nguyên + lẻ (mặc định thực tế = hệ thống).
    const actualBig = convFactor ? Math.floor(systemStock / convFactor) : 0;
    const actualSmall = convFactor ? systemStock - actualBig * convFactor : systemStock;

    setCheckItems((items) => items.some(item => item.productId === product.id) ? items : [
      ...items,
      {
        productId: product.id,
        productCode: product.code,
        productName: product.name,
        unit: product.unit,
        costPrice,
        systemStock,
        actualStock: allowFlexibleCountUnits ? stockToInput(Math.max(0,systemStock),product.unit,preferredWeighingUnit(product.unit,conversions),conversions) ?? Math.max(0,systemStock) : systemStock,
        countUnit: allowFlexibleCountUnits ? preferredWeighingUnit(product.unit,conversions) : null,
        conversions,
        convFactor,
        convBigUnit,
        actualBig,
        actualSmall,
      },
    ]);
    setProductSearch("");
    setShowProductDropdown(false);
    setFilteredProducts([]);
    setErrors((prev) => ({ ...prev, items: "" }));
    } catch (error) {
      if (session === formSession.current) toast({title:'Không thêm được mặt hàng',description:error instanceof Error ? error.message : 'Vui lòng thử lại.',variant:'error'});
    } finally {
      if (session === formSession.current) {
        addingProducts.current.delete(product.id);
        setAddingCount(addingProducts.current.size);
      }
    }
  }

  const updateActualStock = useCallback((productId: string, actualStock: number) => {
    setCheckItems((items) =>
      items.map((item) =>
        item.productId === productId
          ? { ...item, needsCount: item.needsCount === undefined ? undefined : !Number.isFinite(actualStock), actualStock: Number.isFinite(actualStock) ? Math.max(0, actualStock) : 0 }
          : item,
      ),
    );
  }, []);

  const updateCountUnit = useCallback((productId: string, countUnit: string | null) => {
    setCheckItems((items) => items.map((item) => {
      if (item.productId !== productId) return item;
      // Keep entered precision during unit switches. Only the stock preview and
      // posting use ledger rounding; the entered weight is never an intermediate.
      if (countUnit !== null && item.countUnit !== null) {
        const actualStock=switchInputQuantity(item.actualStock,item.unit,item.countUnit,countUnit,item.conversions);
        return actualStock == null ? item : {...item,countUnit,actualStock};
      }
      const stock=item.countUnit !== null
        ? switchInputQuantity(item.actualStock,item.unit,item.countUnit,item.unit,item.conversions)
        : item.convFactor ? item.actualBig*item.convFactor+item.actualSmall : item.actualStock;
      if (stock == null || !Number.isFinite(stock)) return item;
      if (countUnit === null && item.convFactor) {
        const actualBig = Math.floor(stock / item.convFactor);
        return { ...item, countUnit, actualBig, actualSmall: stock - actualBig * item.convFactor };
      }
      if (countUnit === null) return item;
      const actualStock = inventoryCountFromStock(stock, item.unit, countUnit, item.conversions);
      return actualStock == null ? item : { ...item, countUnit, actualStock };
    }));
  }, []);

  // CEO 29/05/2026: cập nhật số đơn vị lớn (thùng).
  const updateActualBig = useCallback((productId: string, big: number) => {
    setCheckItems((items) =>
      items.map((item) =>
        item.productId === productId
          ? { ...item, actualBig: Number.isFinite(big) ? Math.max(0, big) : 0 }
          : item,
      ),
    );
  }, []);

  // Cập nhật số lẻ (đơn vị nhỏ).
  const updateActualSmall = useCallback((productId: string, small: number) => {
    setCheckItems((items) =>
      items.map((item) =>
        item.productId === productId
          ? { ...item, actualSmall: Number.isFinite(small) ? Math.max(0, small) : 0 }
          : item,
      ),
    );
  }, []);

  const removeProduct = useCallback((productId: string) => {
    setCheckItems((items) => items.filter((item) => item.productId !== productId));
  }, []);

  // KiotViet style: tổng theo TIỀN (giá trị lệch), KHÔNG cộng số lượng vì
  // các SP khác đơn vị (Lon + Cái + Kg) cộng lại vô nghĩa.
  const increaseValue = useMemo(
    () =>
      checkItems.reduce((sum, item) => {
        const d = (lineActual(item) - item.systemStock) * item.costPrice;
        return d > 0 ? sum + d : sum;
      }, 0),
    [checkItems],
  );
  const decreaseValue = useMemo(
    () =>
      checkItems.reduce((sum, item) => {
        const d = (lineActual(item) - item.systemStock) * item.costPrice;
        return d < 0 ? sum + d : sum;
      }, 0),
    [checkItems],
  );
  const netValue = increaseValue + decreaseValue;

  const increaseLines = checkItems.filter((item) => lineActual(item) > item.systemStock).length;
  const decreaseLines = checkItems.filter((item) => lineActual(item) < item.systemStock).length;

  function validate(): boolean {
    const newErrors: Record<string, string> = {};
    if (checkItems.length === 0) {
      newErrors.items = "Vui lòng thêm ít nhất một sản phẩm kiểm kho";
    }
    if (new Set(checkItems.map(item => item.productId)).size !== checkItems.length) newErrors.items = 'Mã hàng bị lặp. Chưa cân bằng kho; cần giữ một dòng thực đếm cho mỗi mã.';
    if (checkItems.some((item) => !Number.isFinite(lineActual(item)) || lineActual(item) < 0)) {
      newErrors.items = "Số thực tế phải là số không âm";
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSave() {
    if (copyLoading || copyError || addingProducts.current.size > 0) return;
    if (copySource && copySource.branchId !== activeBranchId) { setErrors({items:'Chi nhánh đã thay đổi. Đóng phiếu và sao chép lại tại đúng chi nhánh.'}); return; }
    if (checkItems.some(item => item.needsCount)) {
      setErrors({items:'Nhập số thực đếm cho tất cả mặt hàng được sao chép trước khi cân bằng kho.'}); return;
    }
    if (saveLockRef.current) return;
    if (!validate()) return;

    saveLockRef.current = true;
    setSaving(true);
    try {
      const supabase = getClient();
      const ctx = await getCurrentContext();
      const branchId = activeBranchId ?? ctx.branchId;

      const signature = JSON.stringify({ branchId, checkItems, notes: notes.trim() });
      const requestId = request.signature === signature ? request.id : crypto.randomUUID();
      setRequest({ id: requestId, signature });

      // Tồn hệ thống được máy chủ đọc lại theo đúng chi nhánh ngay lúc hoàn tất.
      // Tạo phiếu, tạo dòng và cân bằng kho cùng một giao dịch.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase.rpc as any)(
        "create_stock_operation_with_uom",
        {
          p_branch_id: branchId,
          p_kind: "inventory_check",
          p_request_id: requestId,
          p_note: notes.trim() || null,
          p_items: checkItems.map((item) => ({
            product_id: item.productId,
            quantity: item.countUnit !== null ? item.actualStock : lineActual(item),
            inputUnit: item.countUnit ?? item.unit,
            expectedFactor: operationalFactor(item.unit,item.countUnit ?? item.unit,item.conversions)?.toDecimalPlaces(12).toNumber(),
            ...(item.countUnit === null && item.convFactor && item.convBigUnit ? {parts:[
              {quantity:item.actualBig,unit:item.convBigUnit,expectedFactor:operationalFactor(item.unit,item.convBigUnit,item.conversions)?.toDecimalPlaces(12).toNumber()},
              {quantity:item.actualSmall,unit:item.unit,expectedFactor:1},
            ]} : {}),
          })),
        },
      );

      if (error) {
        if (isRpcUnavailable(error)) {
          throw new Error(
            "Chưa có migration 00256. Không thể hoàn tất kiểm kho an toàn.",
          );
        }
        throw new Error(error.message.includes("FNB_MANUAL_STOCK_GAIN_COST_REQUIRED")
          ? "Có mặt hàng chưa có giá vốn tại chi nhánh. Phiếu nháp vẫn được giữ; hãy xác nhận giá vốn đầu kỳ hoặc nhập hàng có giá vốn rồi thử lại."
          : error.message);
      }

      const result = data as {
        check_id?: string;
        code?: string;
        status?: string;
      } | null;
      if (!result?.check_id || !result.code || result.status !== "balanced") {
        throw new Error("Máy chủ trả về kết quả kiểm kho không hợp lệ.");
      }

      clearDraft();
      setCheckItems([]);
      setNotes("");
      setRequest({ id: crypto.randomUUID(), signature: "" });
      setCode(result.code);
      onOpenChange(false);
      toast({
        title: "Hoàn thành kiểm kho thành công",
        description:
          "Đã cân bằng " + result.code + " với " +
          formatNumber(checkItems.length) + " mặt hàng.",
        variant: "success",
      });
      onSuccess?.();
    } catch (err) {
      toast({
        title: "Lỗi hoàn thành kiểm kho",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      saveLockRef.current = false;
      setSaving(false);
    }
  }

  function handleOpenChange(nextOpen: boolean) {
    if (saveLockRef.current) return;
    if (!nextOpen) flushDraft();
    onOpenChange(nextOpen);
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} protectUnsavedChanges={false}>
      <DialogContent className="flex h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-[1450px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(1200px,calc(100vw-48px))] xl:max-w-[1450px] sm:rounded-2xl">
        <div className="shrink-0 border-b bg-white px-4 py-3 md:px-5">
          <DialogHeader className="gap-0 pr-10">
            <div className="flex flex-wrap items-center gap-3">
              <DialogTitle className="text-xl">Tạo phiếu kiểm kho</DialogTitle>
              {copySource && <p role="status" className="order-last basis-full text-xs text-muted-foreground">{copyLoading ? 'Đang tải danh sách và tồn hiện tại…' : `Từ ${copySource.code} · Nhập lại số thực đếm, không dùng số kiểm cũ.`}</p>}
              {copyError && <p role="alert" className="order-last basis-full text-sm text-destructive">{copyError}</p>}
              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-semibold text-blue-700">
                {"Cân bằng khi lưu"}
              </span>
              <span className="ml-auto mr-8 max-w-none whitespace-nowrap rounded-lg border bg-primary/5 px-3 py-1.5 text-sm font-bold text-primary sm:text-base">
                {code}
              </span>
            </div>
          </DialogHeader>
        </div>

        <div inert={saving || copyLoading || !!copyError} className="min-h-0 flex-1 overflow-y-auto bg-surface-container-low p-3 md:p-4">
          <div className="mx-auto flex max-w-[1380px] flex-col gap-3">
            <div className="grid gap-3 lg:grid-cols-[minmax(420px,1fr)_minmax(320px,0.75fr)]">
              <section className="rounded-lg border bg-white p-3 shadow-none">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-semibold">Sản phẩm kiểm kho</h3>
                    <p className="text-xs text-muted-foreground">
                      {allowFlexibleCountUnits ? 'Nguyên liệu, BTP và vật tư tại quán (không gồm món menu)' : 'NVL / hàng giữ tồn tại chi nhánh (không gồm món menu F&B)'}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground">{formatNumber(checkItems.length)} dòng</span>
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
                    placeholder="Tìm theo mã, tên hoặc barcode"
                    className="pl-8"
                  />
                  {showProductDropdown && productSearch && (
                    <div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border bg-popover shadow-lg">
                      {productSearchStatus === "loading" ? (
                        <div role="status" className="px-3 py-2 text-sm text-muted-foreground">
                          Đang tìm mặt hàng...
                        </div>
                      ) : productSearchStatus === "error" ? (
                        <div role="status" className="px-3 py-2 text-sm text-destructive">
                          Không tải được danh sách. Thử tìm lại.
                        </div>
                      ) : filteredProducts.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">
                          Không tìm thấy NVL / hàng giữ tồn phù hợp
                        </div>
                      ) : (
                        filteredProducts.map((product) => (
                          <button
                            key={product.id}
                            type="button"
                            className="grid w-full grid-cols-[minmax(0,1fr)_64px] gap-3 px-3 py-2 text-left text-sm hover:bg-accent"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => addProduct(product)}
                          >
                            <span className="min-w-0">
                              <span className="block truncate font-medium">{product.name}</span>
                              <span className="block truncate text-xs text-muted-foreground">
                                {product.code} · {product.unit}
                              </span>
                            </span>
                            <span className="text-right text-xs font-semibold text-primary">Thêm</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
                {errors.items && <p className="mt-1 text-xs text-destructive">{errors.items}</p>}
              </section>

              <section className="rounded-lg border bg-white p-3 shadow-none">
                <h3 className="mb-2 text-sm font-semibold">Ghi chú</h3>
                <textarea
                  className="flex min-h-[74px] w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Ví dụ: kiểm kho cuối ngày, khu vực quầy, ca kiểm..."
                  rows={3}
                />
              </section>
            </div>

            <div className="overflow-x-auto rounded-lg border bg-white shadow-none">
              <div className="hidden md:min-w-[920px] grid-cols-[minmax(180px,1fr)_48px_116px_200px_96px_120px_36px] gap-3 border-b bg-muted/50 px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:grid">
                <span>Sản phẩm</span>
                <span className="flex justify-center">ĐVT</span>
                <span className="flex justify-end">Tồn kho</span>
                <span className="flex justify-end">Thực tế (nhập)</span>
                <span className="flex justify-end">SL lệch</span>
                <span className="flex justify-end">Giá trị lệch</span>
                <span />
              </div>

              {checkItems.length === 0 ? (
                <div className="flex min-h-[320px] flex-col items-center justify-center px-4 py-10 text-center">
                  <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon name="fact_check" size={24} />
                  </div>
                  <div className="mt-3 font-semibold">Chưa có sản phẩm kiểm kho</div>
                  <div className="mt-1 max-w-md text-sm text-muted-foreground">
                    Khi cân bằng phiếu, chênh lệch dương sẽ tạo nhập điều chỉnh, chênh lệch âm sẽ tạo xuất điều chỉnh.
                  </div>
                </div>
              ) : (
                <div className="divide-y">
                  {/* CEO 04/07: NVL mới thêm hiện TRÊN CÙNG — chỉ đảo hiển thị, data giữ cũ→mới. */}
                  {[...checkItems].reverse().map(item => <InventoryCountRow key={item.productId} item={item} allowFlexibleCountUnits={allowFlexibleCountUnits} saving={saving} updateActualStock={updateActualStock} updateCountUnit={updateCountUnit} updateActualBig={updateActualBig} updateActualSmall={updateActualSmall} removeProduct={removeProduct}/>)}
                </div>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="mx-0 mb-0 shrink-0 rounded-none border-t bg-white px-4 py-3">
          <div className="mx-auto grid w-full max-w-[1380px] grid-cols-1 items-center gap-3 lg:grid-cols-[1fr_auto]">
            <div className="grid grid-cols-2 min-[360px]:grid-cols-3 gap-2 text-sm sm:grid-cols-3 xl:grid-cols-5">
              <FooterMetric label="Mặt hàng" value={formatNumber(checkItems.length)} />
              <FooterMetric
                label="Dòng lệch"
                value={`${formatNumber(increaseLines)} thừa · ${formatNumber(decreaseLines)} thiếu`}
              />
              <FooterMetric label="Giá trị thừa" value={formatCurrency(increaseValue)} tone="success" />
              <FooterMetric label="Giá trị thiếu" value={formatCurrency(decreaseValue)} tone="destructive" />
              <FooterMetric
                label="Tổng chênh lệch"
                value={`${netValue > 0 ? "+" : ""}${formatCurrency(netValue)}`}
                strong
                tone={netValue === 0 ? "default" : netValue > 0 ? "success" : "destructive"}
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" disabled={saving} onClick={() => handleOpenChange(false)}>
                Đóng, giữ nháp
              </Button>
              <Button onClick={handleSave} disabled={saving || copyLoading || !!copyError || addingCount > 0}>
                {saving && <Icon name="progress_activity" size={16} className="mr-2 animate-spin" />}
                {"Hoàn thành kiểm kho"}
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
  tone = "default",
}: {
  label: string;
  value: string;
  strong?: boolean;
  tone?: "default" | "success" | "destructive";
}) {
  const toneClass =
    tone === "success"
      ? "text-status-success"
      : tone === "destructive"
        ? "text-destructive"
        : strong
          ? "text-primary"
          : "";
  return (
    <div className="rounded-lg border bg-surface-container-lowest px-3 py-2">
      <div className="text-xs font-semibold uppercase text-muted-foreground">{label}</div>
      <div className={`mt-0.5 break-words font-bold leading-tight tabular-nums ${strong ? "text-lg" : ""} ${toneClass}`}>
        {value}
      </div>
    </div>
  );
}

interface InventoryCountRowProps {
  item: InventoryCheckLine;
  allowFlexibleCountUnits: boolean;
  saving: boolean;
  updateActualStock: (id: string, value: number) => void;
  updateCountUnit: (id: string, unit: string | null) => void;
  updateActualBig: (id: string, value: number) => void;
  updateActualSmall: (id: string, value: number) => void;
  removeProduct: (id: string) => void;
}
const InventoryCountRow = memo(function InventoryCountRow({item,allowFlexibleCountUnits,saving,updateActualStock,updateCountUnit,updateActualBig,updateActualSmall,removeProduct}: InventoryCountRowProps) {

  const actual = lineActual(item);
                    // Làm tròn + chuẩn hoá -0 → 0 (tránh hiện "-0" khi vừa đổi đơn vị).
                    const diff =
                      Math.round((actual - item.systemStock) * 10000) / 10000 || 0;
                    const diffValue = diff * item.costPrice;
                    const diffColor =
                      diff === 0
                        ? "text-muted-foreground"
                        : diff > 0
                          ? "text-status-success"
                          : "text-destructive";
                    return (
                      <div
                        key={item.productId}
                        className="grid gap-3 px-3 py-3 md:min-w-[920px] md:grid-cols-[minmax(180px,1fr)_48px_116px_200px_96px_120px_36px] md:items-center"
                      >
                        {/* Sản phẩm */}
                        <div className="min-w-0 pr-2">
                          <div className="truncate text-sm font-semibold">{item.productName}</div>
                          <div className="mt-0.5 truncate text-xs text-muted-foreground">{item.productCode}</div>
                        </div>

                        {/* ĐVT */}
                        <div className="hidden justify-center md:flex">
                          <span className="min-w-[44px] rounded-md bg-muted/50 px-2 py-1 text-center text-xs font-semibold text-muted-foreground">
                            {item.unit || "Cái"}
                          </span>
                        </div>

                        {/* Tồn kho */}
                        <div className="flex items-baseline justify-between gap-2 md:block md:text-right">
                          <span className="text-xs font-medium uppercase text-muted-foreground md:hidden">Tồn kho</span>
                          <div className="text-right">
                            <StockWithConversion variant="cell" quantity={item.systemStock} unit={item.unit} conversions={item.conversions} />
                          </div>
                        </div>

                        {/* Thực tế (nhập) */}
                        <div className="md:block">
                          <span className="mb-1 block text-xs font-medium uppercase text-muted-foreground md:hidden">
                            Thực tế (nhập)
                          </span>
                          {allowFlexibleCountUnits && <Select
                            value={item.countUnit ?? "__packaging__"}
                            onValueChange={(value) => { if (value) updateCountUnit(item.productId, value === "__packaging__" ? null : value); }}
                            disabled={saving}
                          >
                            <SelectTrigger className="mb-2 h-8 w-full text-xs" aria-label={`Đơn vị kiểm ${item.productName}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {item.convFactor && <SelectItem value="__packaging__">{item.convBigUnit} + {item.unit} lẻ</SelectItem>}
                              {getDirectConvertibleUnits(item.unit, item.conversions)
                                .filter((unit) => getDirectConversionFactor(item.unit, unit, item.conversions) != null)
                                .map((unit) => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}
                            </SelectContent>
                          </Select>}
                          {item.countUnit === null && item.convFactor ? (
                            <div className="space-y-1.5">
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <NumericInput
                                    value={item.actualBig}
                                    onChange={(value) => updateActualBig(item.productId, value ?? 0)}
                                    min={0}
                                    decimals={0}
                                    className="h-9 text-right"
                                    aria-label={`Số ${item.convBigUnit} ${item.productName}`}
                                    disabled={saving}
                                  />
                                  <div className="mt-1 text-center text-xs font-medium text-muted-foreground">
                                    {item.convBigUnit}
                                  </div>
                                </div>
                                <div>
                                  <NumericInput
                                    value={item.actualSmall}
                                    onChange={(value) => updateActualSmall(item.productId, value ?? 0)}
                                    min={0}
                                    decimals={4}
                                    className="h-9 text-right"
                                    aria-label={`Số lẻ ${item.productName}`}
                                    disabled={saving}
                                  />
                                  <div className="mt-1 text-center text-xs font-medium text-muted-foreground">
                                    {item.unit} lẻ
                                  </div>
                                </div>
                              </div>
                              <div className="text-right text-xs text-muted-foreground">
                                ={" "}
                                <b className="tabular-nums text-foreground">{formatStockQuantity(actual)}</b>{" "}
                                {item.unit}
                              </div>
                            </div>
                          ) : (
                            <div className="space-y-1.5"><NumericInput
                              value={item.needsCount ? null : item.actualStock}
                              placeholder={item.needsCount ? 'Chưa kiểm' : undefined}
                              onChange={(value) => updateActualStock(item.productId, value ?? NaN)}
                              min={0}
                              decimals={allowFlexibleCountUnits ? 8 : 4}
                              className="h-9 text-right"
                              aria-label={`Tồn thực tế ${item.productName}`}
                              disabled={saving}
                            />
                            {allowFlexibleCountUnits && <div className="text-right text-xs text-muted-foreground">
                              {item.needsCount ? 'Chưa nhập số thực đếm' : <>= <b className="tabular-nums text-foreground">{formatStockQuantity(actual)}</b> {item.unit}</>}
                            </div>}</div>
                          )}
                        </div>

                        {/* SL lệch */}
                        <div className="flex items-baseline justify-between gap-2 md:block md:text-right">
                          <span className="text-xs font-medium uppercase text-muted-foreground md:hidden">SL lệch</span>
                          <div className="text-right">
                            <span className={`text-sm font-bold tabular-nums ${diffColor}`}>
                              {item.needsCount ? '—' : `${diff > 0 ? '+' : ''}${formatStockQuantity(diff)}`}
                            </span>
                            <span className="ml-1 text-xs text-muted-foreground">{item.unit}</span>
                          </div>
                        </div>

                        {/* Giá trị lệch (tiền) */}
                        <div className="flex items-baseline justify-between gap-2 md:block md:text-right">
                          <span className="text-xs font-medium uppercase text-muted-foreground md:hidden">Giá trị lệch</span>
                          <span
                            className={`text-sm font-bold tabular-nums ${item.costPrice > 0 ? diffColor : "text-muted-foreground"}`}
                          >
                            {!item.needsCount && item.costPrice > 0 ? `${diff > 0 ? "+" : ""}${formatCurrency(diffValue)}` : "—"}
                          </span>
                        </div>

                        {/* Xóa */}
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => removeProduct(item.productId)}
                          className="justify-self-end text-muted-foreground hover:text-destructive"
                          aria-label={`Bỏ ${item.productName}`}
                        >
                          <Icon name="delete" size={14} />
                        </Button>
                      </div>
                    );

});
