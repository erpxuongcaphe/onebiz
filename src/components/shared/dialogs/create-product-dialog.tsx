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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/lib/contexts";
import { createProduct, updateProduct, getProductCategoriesAsync } from "@/lib/services";
import { nextGroupCode } from "@/lib/services/supabase/base";
import { Icon } from "@/components/ui/icon";
import type { Product } from "@/lib/types";

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
  const [hasBom, setHasBom] = useState(false);
  // Kênh bán — chỉ áp dụng cho SKU. NVL luôn null.
  const [channel, setChannel] = useState<ProductChannel>("fnb");
  const [barcode, setBarcode] = useState("");
  const [description, setDescription] = useState("");
  const [allowSale, setAllowSale] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

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
      setHasBom(!!initialData.hasBom);
      setChannel((initialData.channel as ProductChannel) || "fnb");
      setBarcode("");
      setDescription("");
      setAllowSale(true);
      setErrors({});
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
      setHasBom(false);
      setChannel("fnb");
      setBarcode("");
      setDescription("");
      setAllowSale(true);
      setErrors({});
    }
  }, [open, initialData]);

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
    return Object.keys(e).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    try {
      if (isEdit && initialData) {
        // EDIT — giữ nguyên code/productType, không đổi groupCode. Chỉ update các field được phép sửa.
        await updateProduct(initialData.id, {
          name,
          channel: scope === "sku" ? channel : undefined,
          categoryId,
          unit: stockUnit || purchaseUnit || initialData.unit || "Cái",
          purchaseUnit: purchaseUnit || undefined,
          stockUnit: stockUnit || undefined,
          sellUnit: sellUnit || undefined,
          shelfLifeDays: shelfLifeDays ? Number(shelfLifeDays) : undefined,
          barcode: barcode || undefined,
          sellPrice: scope === "sku" ? Number(sellPrice) : 0,
          costPrice: Number(costPrice) || 0,
          description: description || undefined,
          allowSale: scope === "sku" ? allowSale : false,
        });
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
        code,
        name,
        productType: scope,
        // NVL không có kênh bán (nội bộ). SKU bắt buộc fnb hoặc retail.
        channel: scope === "sku" ? channel : undefined,
        hasBom: scope === "sku" ? hasBom : false,
        groupCode: selectedCategory!.code,
        categoryId,
        unit: stockUnit || purchaseUnit || "Cái",
        purchaseUnit: purchaseUnit || undefined,
        stockUnit: stockUnit || undefined,
        sellUnit: sellUnit || undefined,
        shelfLifeDays: shelfLifeDays ? Number(shelfLifeDays) : undefined,
        barcode: barcode || undefined,
        sellPrice: scope === "sku" ? Number(sellPrice) : 0,
        costPrice: Number(costPrice) || 0,
        stock: Number(initialStock) || 0,
        description: description || undefined,
        allowSale: scope === "sku" ? allowSale : false,
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

        <div className="grid gap-4 py-2">
          <div className="flex justify-center">
            <div className="flex h-24 w-24 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/30 text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors">
              <div className="flex flex-col items-center gap-1">
                <Icon name="add_photo_alternate" size={24} />
                <span className="text-xs">Ảnh</span>
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
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
            {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
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
              {selectedCategory?.code && (
                <p className="text-xs text-muted-foreground">
                  Mã sẽ là: {scope === "nvl" ? "NVL" : "SKU"}-{selectedCategory.code}-XXX
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

          {/* UOM 3 đơn vị */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">ĐVT mua</label>
              <Input
                value={purchaseUnit}
                onChange={(e) => setPurchaseUnit(e.target.value)}
                placeholder="thùng, bao..."
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                ĐVT kho <span className="text-muted-foreground">(chuẩn)</span>
              </label>
              <Input
                value={stockUnit}
                onChange={(e) => setStockUnit(e.target.value)}
                placeholder="lon, gói, kg..."
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">ĐVT bán</label>
              <Input
                value={sellUnit}
                onChange={(e) => setSellUnit(e.target.value)}
                placeholder="thùng, lốc..."
                disabled={scope === "nvl"}
              />
            </div>
          </div>

          {/* Pricing */}
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Giá vốn</label>
              <Input
                type="number"
                value={costPrice}
                onChange={(e) => setCostPrice(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Giá bán
                {scope === "sku" && <span className="text-destructive"> *</span>}
              </label>
              <Input
                type="number"
                value={sellPrice}
                onChange={(e) => setSellPrice(e.target.value)}
                placeholder="0"
                disabled={scope === "nvl"}
                aria-invalid={!!errors.sellPrice}
              />
              {errors.sellPrice && (
                <p className="text-xs text-destructive">{errors.sellPrice}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                {isEdit ? "Tồn kho hiện tại" : "Tồn kho ban đầu"}
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
                  Điều chỉnh tồn qua Kiểm kho / Nhập xuất kho.
                </p>
              )}
            </div>
          </div>

          {/* Shelf life */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">HSD mặc định (ngày)</label>
              <Input
                type="number"
                value={shelfLifeDays}
                onChange={(e) => setShelfLifeDays(e.target.value)}
                placeholder="VD: 365"
              />
            </div>
            {scope === "sku" && (
              <div className="space-y-1.5 flex flex-col justify-end">
                <label className="flex items-center gap-2 text-sm font-medium cursor-pointer pb-2">
                  <Checkbox
                    checked={hasBom}
                    onCheckedChange={(c) => setHasBom(!!c)}
                  />
                  Có công thức sản xuất (BOM)
                </label>
                <p className="text-xs text-muted-foreground -mt-1">
                  Bật nếu SKU này tự sản xuất từ NVL
                </p>
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Mô tả</label>
            <textarea
              className="flex min-h-[60px] w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Mô tả sản phẩm"
              rows={2}
            />
          </div>

          {scope === "sku" && (
            <div className="flex items-center gap-2">
              <Checkbox
                checked={allowSale}
                onCheckedChange={(checked) => setAllowSale(!!checked)}
              />
              <label className="text-sm font-medium cursor-pointer">
                Cho phép bán
              </label>
            </div>
          )}
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
