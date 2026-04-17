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
import { useToast } from "@/lib/contexts";
import { createCashTransaction } from "@/lib/services";
import { Icon } from "@/components/ui/icon";

interface CreateCashTransactionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  defaultType?: "receipt" | "payment";
}

const receiptCategories = [
  { label: "Thu tiền khách hàng", value: "customer_payment" },
  { label: "Thu tiền mặt", value: "cash_collection" },
  { label: "Thu khác", value: "other_receipt" },
];

const paymentCategories = [
  { label: "Chi trả NCC", value: "supplier_payment" },
  { label: "Chi phí vận chuyển", value: "shipping" },
  { label: "Chi phí thuê kho", value: "warehouse_rent" },
  { label: "Chi phí khác", value: "other_expense" },
];

function generateTransactionCode(type: "receipt" | "payment") {
  const prefix = type === "receipt" ? "PT" : "PC";
  const num = Math.floor(Math.random() * 99999) + 1;
  return `${prefix}${String(num).padStart(5, "0")}`;
}

export function CreateCashTransactionDialog({
  open,
  onOpenChange,
  onSuccess,
  defaultType = "receipt",
}: CreateCashTransactionDialogProps) {
  const { toast } = useToast();
  const [type, setType] = useState<"receipt" | "payment">(defaultType);
  const [code, setCode] = useState("");
  const [amount, setAmount] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [method, setMethod] = useState("cash");
  const [category, setCategory] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setType(defaultType);
      setCode(generateTransactionCode(defaultType));
      setAmount("");
      setCounterparty("");
      setMethod("cash");
      setCategory("");
      setNote("");
      setErrors({});
    }
  }, [open, defaultType]);

  function handleTypeChange(newType: "receipt" | "payment") {
    setType(newType);
    setCode(generateTransactionCode(newType));
    setCategory("");
  }

  const categories = type === "receipt" ? receiptCategories : paymentCategories;

  function validate(): boolean {
    const newErrors: Record<string, string> = {};
    if (!amount.trim() || isNaN(Number(amount)) || Number(amount) <= 0)
      newErrors.amount = "Số tiền không hợp lệ";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    try {
      await createCashTransaction({
        code,
        type,
        category: category || "other",
        amount: Number(amount),
        counterparty: counterparty || "",
        paymentMethod: method as "cash" | "transfer" | "card",
        note: note || undefined,
      });
      onOpenChange(false);
      toast({
        title: type === "receipt" ? "Tạo phiếu thu thành công" : "Tạo phiếu chi thành công",
        description: `Đã tạo ${type === "receipt" ? "phiếu thu" : "phiếu chi"} ${code}`,
        variant: "success",
      });
      onSuccess?.();
    } catch (err) {
      toast({
        title: "Lỗi tạo phiếu",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {type === "receipt" ? "Tạo phiếu thu" : "Tạo phiếu chi"}
          </DialogTitle>
          <DialogDescription>
            Điền thông tin phiếu. Các trường có dấu * là bắt buộc.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Type toggle */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Loại phiếu</label>
            <div className="flex rounded-lg border p-0.5">
              <button
                type="button"
                className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer ${
                  type === "receipt"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => handleTypeChange("receipt")}
              >
                Phiếu thu
              </button>
              <button
                type="button"
                className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors cursor-pointer ${
                  type === "payment"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                onClick={() => handleTypeChange("payment")}
              >
                Phiếu chi
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Mã phiếu</label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Số tiền <span className="text-destructive">*</span>
            </label>
            <Input
              type="number"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              aria-invalid={!!errors.amount}
            />
            {errors.amount && (
              <p className="text-xs text-destructive">{errors.amount}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              {type === "receipt" ? "Người nộp" : "Người nhận"}
            </label>
            <Input
              value={counterparty}
              onChange={(e) => setCounterparty(e.target.value)}
              placeholder={
                type === "receipt"
                  ? "Nhập tên người nộp"
                  : "Nhập tên người nhận"
              }
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Phương thức</label>
            <Select value={method} onValueChange={(v) => setMethod(v ?? "cash")}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Tiền mặt</SelectItem>
                <SelectItem value="transfer">Chuyển khoản</SelectItem>
                <SelectItem value="card">Thẻ</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Danh mục</label>
            <Select value={category} onValueChange={(v) => setCategory(v ?? "")}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Chọn danh mục" />
              </SelectTrigger>
              <SelectContent>
                {categories.map((cat) => (
                  <SelectItem key={cat.value} value={cat.value}>
                    {cat.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Ghi chú</label>
            <textarea
              className="flex min-h-[60px] w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ghi chú thêm"
              rows={2}
            />
          </div>
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
