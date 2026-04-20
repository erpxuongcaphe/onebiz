"use client";

import { useEffect, useState } from "react";
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
import { updateInvoice } from "@/lib/services/supabase/invoices";
import { useToast } from "@/lib/contexts";
import { formatCurrency } from "@/lib/format";
import type { Invoice } from "@/lib/types";

interface EditInvoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoice: Invoice | null;
  onSuccess?: () => void;
}

/**
 * Dialog sửa hóa đơn "nháp" (status = draft/confirmed, UI hiển thị "processing").
 *
 * Chỉ cho sửa các field "mềm": tên khách, giảm giá, phương thức thanh toán, ghi chú.
 * Line items / tổng tiền không sửa được ở đây — nếu cần đổi, user phải hủy rồi tạo mới
 * (tránh lệch phép tính công nợ / thanh toán).
 */
export function EditInvoiceDialog({
  open,
  onOpenChange,
  invoice,
  onSuccess,
}: EditInvoiceDialogProps) {
  const { toast } = useToast();
  const [customerName, setCustomerName] = useState("");
  const [discountAmount, setDiscountAmount] = useState<string>("");
  const [paymentMethod, setPaymentMethod] = useState<
    "cash" | "transfer" | "card" | "mixed"
  >("cash");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open && invoice) {
      setCustomerName(invoice.customerName ?? "");
      setDiscountAmount(String(invoice.discount ?? 0));
      setPaymentMethod("cash");
      setNote("");
      setSaving(false);
    }
  }, [open, invoice]);

  if (!invoice) return null;

  const isEditable = invoice.status === "processing";

  const handleSave = async () => {
    if (!invoice) return;
    if (!isEditable) {
      toast({
        variant: "error",
        title: "Không thể sửa",
        description:
          "Hóa đơn đã hoàn thành hoặc đã hủy không thể sửa. Vui lòng kiểm tra trạng thái.",
      });
      return;
    }

    setSaving(true);
    try {
      await updateInvoice(invoice.id, {
        customerName: customerName.trim() || "Khách lẻ",
        discountAmount: Number(discountAmount) || 0,
        paymentMethod,
        note: note.trim() || undefined,
      });
      toast({
        variant: "success",
        title: "Đã cập nhật hóa đơn",
        description: `Hóa đơn ${invoice.code} đã được cập nhật.`,
      });
      onSuccess?.();
      onOpenChange(false);
    } catch (err) {
      toast({
        variant: "error",
        title: "Lỗi cập nhật hóa đơn",
        description: err instanceof Error ? err.message : "Vui lòng thử lại.",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Sửa hóa đơn {invoice.code}</DialogTitle>
          <DialogDescription>
            Chỉ sửa được hóa đơn ở trạng thái phiếu tạm hoặc đang xử lý. Tổng
            tiền và các dòng hàng không thể sửa — nếu cần đổi, vui lòng hủy và
            tạo hóa đơn mới.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Read-only summary */}
          <div className="rounded-md border border-outline-variant bg-surface-container-low p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Mã hóa đơn</span>
              <span className="font-medium">{invoice.code}</span>
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-muted-foreground">Tổng tiền</span>
              <span className="font-semibold">
                {formatCurrency(invoice.totalAmount)}
              </span>
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-muted-foreground">Đã thu</span>
              <span>{formatCurrency(invoice.paid)}</span>
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-muted-foreground">Còn nợ</span>
              <span className={invoice.debt > 0 ? "text-error font-medium" : ""}>
                {formatCurrency(invoice.debt)}
              </span>
            </div>
          </div>

          {/* Editable fields */}
          <div className="grid gap-1.5">
            <label htmlFor="edit-invoice-customer" className="text-sm font-medium">
              Tên khách hàng
            </label>
            <Input
              id="edit-invoice-customer"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              placeholder="Khách lẻ"
              disabled={!isEditable || saving}
            />
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="edit-invoice-discount" className="text-sm font-medium">
              Giảm giá (VND)
            </label>
            <Input
              id="edit-invoice-discount"
              type="number"
              min="0"
              value={discountAmount}
              onChange={(e) => setDiscountAmount(e.target.value)}
              disabled={!isEditable || saving}
            />
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="edit-invoice-payment" className="text-sm font-medium">
              Phương thức thanh toán
            </label>
            <Select
              value={paymentMethod}
              onValueChange={(v) =>
                setPaymentMethod(v as "cash" | "transfer" | "card" | "mixed")
              }
              disabled={!isEditable || saving}
            >
              <SelectTrigger id="edit-invoice-payment">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">Tiền mặt</SelectItem>
                <SelectItem value="transfer">Chuyển khoản</SelectItem>
                <SelectItem value="card">Thẻ</SelectItem>
                <SelectItem value="mixed">Hỗn hợp</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-1.5">
            <label htmlFor="edit-invoice-note" className="text-sm font-medium">
              Ghi chú
            </label>
            <Input
              id="edit-invoice-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Ghi chú thêm..."
              disabled={!isEditable || saving}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Hủy
          </Button>
          <Button
            type="button"
            onClick={handleSave}
            disabled={!isEditable || saving}
          >
            {saving ? "Đang lưu..." : "Lưu thay đổi"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
