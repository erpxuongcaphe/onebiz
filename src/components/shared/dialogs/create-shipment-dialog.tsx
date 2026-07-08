"use client";

import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { NumericInput } from "@/components/ui/numeric-input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/lib/contexts";
import { getClient, getCurrentContext } from "@/lib/services/supabase/base";
import { createShipmentForInvoice } from "@/lib/services";
import { formatCurrency } from "@/lib/format";

/**
 * CEO 08/07/2026: Tạo VẬN ĐƠN cho hóa đơn/đơn đặt hàng CÓ SẴN (như KiotViet)
 * — kể cả đơn đã hoàn thành trước khi có tính năng phí giao. Service tự cộng
 * lại tiền (total/debt/nợ KH) theo phí giao nhập ở đây.
 */
export function CreateShipmentDialog({
  open,
  onOpenChange,
  invoiceId,
  invoiceCode,
  /** Prefill người nhận từ khách trên hóa đơn (sửa được). */
  defaultReceiverName,
  defaultReceiverPhone,
  /** Tổng hiện tại của đơn — hiện gợi ý "Khách cần trả sau khi thêm phí". */
  currentTotal,
  currentFee,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  invoiceId: string;
  invoiceCode: string;
  defaultReceiverName?: string;
  defaultReceiverPhone?: string;
  currentTotal?: number;
  currentFee?: number;
  onSuccess?: () => void;
}) {
  const { toast } = useToast();
  const [fee, setFee] = useState(0);
  const [receiverName, setReceiverName] = useState("");
  const [receiverPhone, setReceiverPhone] = useState("");
  const [receiverAddress, setReceiverAddress] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [partners, setPartners] = useState<{ id: string; name: string }[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFee(currentFee ?? 0);
    setReceiverName(defaultReceiverName ?? "");
    setReceiverPhone(defaultReceiverPhone ?? "");
    setReceiverAddress("");
    setPartnerId("");
    setSaving(false);
    (async () => {
      const supabase = getClient();
      const ctx = await getCurrentContext();
      const { data } = await supabase
        .from("delivery_partners")
        .select("id, name")
        .eq("tenant_id", ctx.tenantId)
        .eq("is_active", true)
        .limit(20);
      setPartners((data ?? []).map((d) => ({ id: d.id, name: d.name })));
    })();
  }, [open, currentFee, defaultReceiverName, defaultReceiverPhone]);

  // Khách cần trả sau khi áp phí mới = tổng hiện tại − phí cũ + phí mới
  const newTotal =
    currentTotal != null ? currentTotal - (currentFee ?? 0) + fee : null;

  async function handleSave() {
    if (!receiverName.trim() || !receiverPhone.trim() || !receiverAddress.trim()) {
      toast({
        title: "Thiếu thông tin",
        description: "Cần đủ người nhận + SĐT + địa chỉ giao hàng",
        variant: "error",
      });
      return;
    }
    setSaving(true);
    try {
      const ship = await createShipmentForInvoice({
        invoiceId,
        fee,
        receiverName,
        receiverPhone,
        receiverAddress,
        partnerId: partnerId || null,
      });
      onOpenChange(false);
      toast({
        title: `Đã tạo vận đơn ${ship.code}`,
        description: `Gắn vào ${invoiceCode} — phí giao ${formatCurrency(fee)}, thu hộ ${formatCurrency(ship.cod ?? 0)}`,
        variant: "success",
      });
      onSuccess?.();
    } catch (err) {
      toast({
        title: "Lỗi tạo vận đơn",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Tạo vận đơn — {invoiceCode}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Input
              value={receiverName}
              onChange={(e) => setReceiverName(e.target.value)}
              placeholder="Người nhận"
              aria-label="Người nhận"
            />
            <Input
              value={receiverPhone}
              onChange={(e) => setReceiverPhone(e.target.value)}
              placeholder="SĐT người nhận"
              aria-label="SĐT người nhận"
            />
          </div>
          <Input
            value={receiverAddress}
            onChange={(e) => setReceiverAddress(e.target.value)}
            placeholder="Địa chỉ giao hàng"
            aria-label="Địa chỉ giao hàng"
          />
          <Select
            value={partnerId || null}
            onValueChange={(v) => setPartnerId(v ?? "")}
            items={partners.map((p) => ({ value: p.id, label: p.name }))}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Đối tác giao hàng (tùy chọn)">
                {(v) => partners.find((p) => p.id === v)?.name ?? "Đối tác giao hàng (tùy chọn)"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {partners.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Phí giao hàng (thu của khách)
            </label>
            <NumericInput
              value={fee}
              onChange={(v) => setFee(Math.max(0, v ?? 0))}
              min={0}
              decimals={0}
              className="text-right"
              placeholder="0"
              aria-label="Phí giao hàng"
            />
          </div>
          {newTotal != null && (
            <p className="text-sm text-muted-foreground">
              Khách cần trả sau khi thêm phí:{" "}
              <strong className="text-foreground">{formatCurrency(newTotal)}</strong>
            </p>
          )}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Đóng
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Đang tạo..." : "Tạo vận đơn"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
