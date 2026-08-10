"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/lib/contexts";
import { changeCustomerCode } from "@/lib/services/supabase/customers";
import type { Customer } from "@/lib/types";

interface ChangeCustomerCodeDialogProps {
  customer: Customer | null;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void | Promise<void>;
}

export function ChangeCustomerCodeDialog({
  customer,
  onOpenChange,
  onSuccess,
}: ChangeCustomerCodeDialogProps) {
  const { toast } = useToast();
  const [newCode, setNewCode] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!customer) return;
    setNewCode(customer.code);
    setError("");
  }, [customer]);

  const normalizedCode = newCode.trim().toUpperCase();

  function validate() {
    if (!normalizedCode) return "Mã khách hàng là bắt buộc.";
    if (normalizedCode.length > 50) return "Mã khách hàng tối đa 50 ký tự.";
    if (!/^[A-Z0-9][A-Z0-9_-]*$/.test(normalizedCode)) {
      return "Chỉ dùng chữ không dấu, số, dấu gạch ngang hoặc gạch dưới.";
    }
    if (normalizedCode === customer?.code) return "Mã mới chưa thay đổi.";
    return "";
  }

  async function handleSubmit() {
    if (!customer) return;
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setSaving(true);
    setError("");
    try {
      const result = await changeCustomerCode(customer.id, normalizedCode);
      await onSuccess?.();
      onOpenChange(false);
      toast({
        title: "Đổi mã khách hàng thành công",
        description: `${customer.name}: ${result.oldCode} → ${result.newCode}`,
        variant: "success",
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Vui lòng thử lại.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={!!customer} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Đổi mã khách hàng</DialogTitle>
          <DialogDescription>
            Chỉ thay đổi mã nhận diện của {customer?.name}. Hóa đơn và công nợ được giữ nguyên.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="customer-current-code">
              Mã hiện tại
            </label>
            <Input id="customer-current-code" value={customer?.code ?? ""} readOnly />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="customer-new-code">
              Mã mới
            </label>
            <Input
              id="customer-new-code"
              value={newCode}
              onChange={(event) => {
                setNewCode(event.target.value.toUpperCase());
                setError("");
              }}
              placeholder="VD: KHA-KLE-064"
              aria-invalid={!!error}
              autoFocus
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Hủy
          </Button>
          <Button onClick={handleSubmit} disabled={saving || !customer}>
            {saving ? "Đang đổi..." : "Đổi mã"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
