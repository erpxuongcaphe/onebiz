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
import { Search, Loader2 } from "lucide-react";
import { useToast } from "@/lib/contexts";
import { getClient, getCurrentContext } from "@/lib/services/supabase/base";
import { nextEntityCode } from "@/lib/services/supabase/stock-adjustments";
import type { Database } from "@/lib/supabase/types";

type ShippingOrderInsert = Database["public"]["Tables"]["shipping_orders"]["Insert"];

interface CreateShippingOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

interface SearchInvoice {
  id: string;
  code: string;
  customerName: string;
}

interface SearchPartner {
  id: string;
  name: string;
}

export function CreateShippingOrderDialog({
  open,
  onOpenChange,
  onSuccess,
}: CreateShippingOrderDialogProps) {
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [selectedInvoice, setSelectedInvoice] = useState<SearchInvoice | null>(null);
  const [showInvoiceDropdown, setShowInvoiceDropdown] = useState(false);
  const [filteredInvoices, setFilteredInvoices] = useState<SearchInvoice[]>([]);
  const [partners, setPartners] = useState<SearchPartner[]>([]);
  const [selectedPartnerId, setSelectedPartnerId] = useState("");
  const [receiverName, setReceiverName] = useState("");
  const [receiverPhone, setReceiverPhone] = useState("");
  const [receiverAddress, setReceiverAddress] = useState("");
  const [shippingFee, setShippingFee] = useState(0);
  const [codAmount, setCodAmount] = useState(0);
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      nextEntityCode("shipping").then((c) => setCode(c)).catch(() => setCode(`VD${Date.now()}`));
      setInvoiceSearch("");
      setSelectedInvoice(null);
      setShowInvoiceDropdown(false);
      setFilteredInvoices([]);
      setSelectedPartnerId("");
      setReceiverName("");
      setReceiverPhone("");
      setReceiverAddress("");
      setShippingFee(0);
      setCodAmount(0);
      setNotes("");
      setErrors({});
      setSaving(false);

      // Load delivery partners
      (async () => {
        const supabase = getClient();
        const { data } = await supabase
          .from("delivery_partners")
          .select("id, name")
          .eq("is_active", true)
          .order("name")
          .limit(50);
        setPartners((data ?? []).map((p) => ({ id: p.id, name: p.name })));
      })();
    }
  }, [open]);

  // Live search invoices
  useEffect(() => {
    if (!invoiceSearch || invoiceSearch.length < 1) {
      setFilteredInvoices([]);
      return;
    }
    const timer = setTimeout(async () => {
      const supabase = getClient();
      const { data } = await supabase
        .from("invoices")
        .select("id, code, customer_name")
        .ilike("code", `%${invoiceSearch}%`)
        .limit(8);
      setFilteredInvoices(
        (data ?? []).map((inv) => ({
          id: inv.id,
          code: inv.code,
          customerName: inv.customer_name,
        }))
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [invoiceSearch]);

  function validate(): boolean {
    const newErrors: Record<string, string> = {};
    if (!selectedInvoice) newErrors.invoice = "Vui lòng chọn hóa đơn";
    if (!receiverName.trim()) newErrors.receiverName = "Vui lòng nhập tên người nhận";
    if (!receiverPhone.trim()) newErrors.receiverPhone = "Vui lòng nhập số điện thoại";
    if (!receiverAddress.trim()) newErrors.receiverAddress = "Vui lòng nhập địa chỉ";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    try {
      const supabase = getClient();
      const ctx = await getCurrentContext();

      const { error: insertErr } = await supabase
        .from("shipping_orders")
        .insert({
          tenant_id: ctx.tenantId,
          invoice_id: selectedInvoice!.id,
          partner_id: selectedPartnerId || null,
          code,
          status: "pending" as const,
          shipping_fee: shippingFee,
          cod_amount: codAmount,
          receiver_name: receiverName.trim(),
          receiver_phone: receiverPhone.trim(),
          receiver_address: receiverAddress.trim(),
          note: notes || null,
        } satisfies ShippingOrderInsert);

      if (insertErr) throw new Error(insertErr.message);

      onOpenChange(false);
      toast({
        title: "Tạo vận đơn thành công",
        description: `Đã tạo vận đơn ${code}`,
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
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Tạo vận đơn</DialogTitle>
          <DialogDescription>
            Mã vận đơn: {code}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Invoice search */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Hóa đơn <span className="text-destructive">*</span>
            </label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={invoiceSearch}
                onChange={(e) => {
                  setInvoiceSearch(e.target.value);
                  setShowInvoiceDropdown(true);
                }}
                onFocus={() => setShowInvoiceDropdown(true)}
                onBlur={() => setTimeout(() => setShowInvoiceDropdown(false), 200)}
                placeholder="Tìm hóa đơn theo mã..."
                className="pl-8"
                aria-invalid={!!errors.invoice}
              />
              {showInvoiceDropdown && invoiceSearch && (
                <div className="absolute z-10 mt-1 w-full rounded-lg border bg-popover shadow-md max-h-40 overflow-y-auto">
                  {filteredInvoices.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      Không tìm thấy hóa đơn
                    </div>
                  ) : (
                    filteredInvoices.map((inv) => (
                      <button
                        key={inv.id}
                        type="button"
                        className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-accent cursor-pointer"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setSelectedInvoice(inv);
                          setInvoiceSearch(inv.code);
                          setShowInvoiceDropdown(false);
                          if (!receiverName) setReceiverName(inv.customerName);
                        }}
                      >
                        <span className="font-medium">{inv.code}</span>
                        <span className="text-muted-foreground">{inv.customerName}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            {errors.invoice && (
              <p className="text-xs text-destructive">{errors.invoice}</p>
            )}
          </div>

          {/* Partner select */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Đối tác giao hàng</label>
            <select
              value={selectedPartnerId}
              onChange={(e) => setSelectedPartnerId(e.target.value)}
              className="flex h-9 w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="">-- Chọn đối tác --</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Receiver info */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Người nhận <span className="text-destructive">*</span>
              </label>
              <Input
                value={receiverName}
                onChange={(e) => setReceiverName(e.target.value)}
                placeholder="Tên người nhận"
                aria-invalid={!!errors.receiverName}
              />
              {errors.receiverName && (
                <p className="text-xs text-destructive">{errors.receiverName}</p>
              )}
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Điện thoại <span className="text-destructive">*</span>
              </label>
              <Input
                value={receiverPhone}
                onChange={(e) => setReceiverPhone(e.target.value)}
                placeholder="Số điện thoại"
                aria-invalid={!!errors.receiverPhone}
              />
              {errors.receiverPhone && (
                <p className="text-xs text-destructive">{errors.receiverPhone}</p>
              )}
            </div>
          </div>

          {/* Address */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Địa chỉ <span className="text-destructive">*</span>
            </label>
            <Input
              value={receiverAddress}
              onChange={(e) => setReceiverAddress(e.target.value)}
              placeholder="Địa chỉ giao hàng"
              aria-invalid={!!errors.receiverAddress}
            />
            {errors.receiverAddress && (
              <p className="text-xs text-destructive">{errors.receiverAddress}</p>
            )}
          </div>

          {/* Fees */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Phí vận chuyển</label>
              <Input
                type="number"
                value={shippingFee}
                onChange={(e) => setShippingFee(Number(e.target.value) || 0)}
                placeholder="0"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Thu hộ (COD)</label>
              <Input
                type="number"
                value={codAmount}
                onChange={(e) => setCodAmount(Number(e.target.value) || 0)}
                placeholder="0"
              />
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Ghi chú</label>
            <textarea
              className="flex min-h-[50px] w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ghi chú vận đơn"
              rows={2}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Tạo vận đơn
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
