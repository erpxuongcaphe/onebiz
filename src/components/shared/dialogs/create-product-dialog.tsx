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
import { ImagePlus } from "lucide-react";
import { useToast } from "@/lib/contexts";

interface CreateProductDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

const productCategories = [
  { label: "Đồ uống", value: "drinks" },
  { label: "Thực phẩm", value: "food" },
  { label: "Nguyên liệu", value: "ingredients" },
  { label: "Phụ kiện", value: "accessories" },
  { label: "Khác", value: "other" },
];

function generateProductCode() {
  const num = Math.floor(Math.random() * 99999) + 1;
  return `SP${String(num).padStart(6, "0")}`;
}

export function CreateProductDialog({
  open,
  onOpenChange,
  onSuccess,
}: CreateProductDialogProps) {
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("");
  const [sellPrice, setSellPrice] = useState("");
  const [costPrice, setCostPrice] = useState("");
  const [initialStock, setInitialStock] = useState("");
  const [unit, setUnit] = useState("");
  const [weight, setWeight] = useState("");
  const [description, setDescription] = useState("");
  const [barcode, setBarcode] = useState("");
  const [allowSale, setAllowSale] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (open) {
      setCode(generateProductCode());
      setName("");
      setCategory("");
      setSellPrice("");
      setCostPrice("");
      setInitialStock("");
      setUnit("");
      setWeight("");
      setDescription("");
      setBarcode("");
      setAllowSale(true);
      setErrors({});
    }
  }, [open]);

  function validate(): boolean {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = "Tên hàng là bắt buộc";
    if (!sellPrice.trim() || isNaN(Number(sellPrice)) || Number(sellPrice) <= 0)
      newErrors.sellPrice = "Giá bán không hợp lệ";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  function handleSave() {
    if (!validate()) return;
    console.log("Tạo sản phẩm:", {
      code,
      name,
      category,
      sellPrice: Number(sellPrice),
      costPrice: Number(costPrice) || 0,
      initialStock: Number(initialStock) || 0,
      unit,
      weight: Number(weight) || 0,
      description,
      barcode,
      allowSale,
    });
    onOpenChange(false);
    toast({
      title: "Tạo hàng hóa thành công",
      description: `Đã thêm sản phẩm ${name} (${code})`,
      variant: "success",
    });
    onSuccess?.();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Thêm hàng hóa mới</DialogTitle>
          <DialogDescription>
            Điền thông tin sản phẩm. Các trường có dấu * là bắt buộc.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Image upload placeholder */}
          <div className="flex justify-center">
            <div className="flex h-24 w-24 cursor-pointer items-center justify-center rounded-lg border-2 border-dashed border-muted-foreground/30 text-muted-foreground hover:border-primary/50 hover:text-primary transition-colors">
              <div className="flex flex-col items-center gap-1">
                <ImagePlus className="h-6 w-6" />
                <span className="text-xs">Ảnh</span>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Mã hàng</label>
              <Input value={code} onChange={(e) => setCode(e.target.value)} />
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

          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Tên hàng <span className="text-destructive">*</span>
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nhập tên hàng hóa"
              aria-invalid={!!errors.name}
            />
            {errors.name && (
              <p className="text-xs text-destructive">{errors.name}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Nhóm hàng</label>
            <Select value={category} onValueChange={(v) => setCategory(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Chọn nhóm hàng" />
              </SelectTrigger>
              <SelectContent>
                {productCategories.map((cat) => (
                  <SelectItem key={cat.value} value={cat.value}>
                    {cat.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Giá bán <span className="text-destructive">*</span>
              </label>
              <Input
                type="number"
                value={sellPrice}
                onChange={(e) => setSellPrice(e.target.value)}
                placeholder="0"
                aria-invalid={!!errors.sellPrice}
              />
              {errors.sellPrice && (
                <p className="text-xs text-destructive">{errors.sellPrice}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Giá vốn</label>
              <Input
                type="number"
                value={costPrice}
                onChange={(e) => setCostPrice(e.target.value)}
                placeholder="0"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Tồn kho ban đầu</label>
              <Input
                type="number"
                value={initialStock}
                onChange={(e) => setInitialStock(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Đơn vị tính</label>
              <Input
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="Cái, hộp, kg..."
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Trọng lượng</label>
              <Input
                type="number"
                value={weight}
                onChange={(e) => setWeight(e.target.value)}
                placeholder="gram"
              />
            </div>
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

          <div className="flex items-center gap-2">
            <Checkbox
              checked={allowSale}
              onCheckedChange={(checked) => setAllowSale(!!checked)}
            />
            <label className="text-sm font-medium cursor-pointer">
              Cho phép bán
            </label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button onClick={handleSave}>Lưu</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
