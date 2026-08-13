"use client";

/**
 * Tạo vận đơn từ trang danh sách vận đơn (chọn hóa đơn trước).
 *
 * 04/08/2026 — trước đây dialog này GHI THẲNG bảng shipping_orders: không cập
 * nhật tiền hóa đơn, COD gõ tay (lệch hóa đơn), không chặn 1 hóa đơn 2 vận
 * đơn, và lấy mã từ bộ đếm 'shipping' trùng tiền tố VD với bộ đếm
 * 'shipping_order' của RPC. Giờ đi chung 1 cửa createShipmentForInvoice
 * (RPC attach_invoice_shipment_atomic) như nút "Tạo vận đơn" ở trang hóa đơn:
 *   - phí giao cộng vào tổng + công nợ hóa đơn (nếu đã hoàn tất)
 *   - COD máy chủ tự tính = tổng mới − đã thanh toán
 *   - chặn hóa đơn hủy / đã có vận đơn còn hiệu lực
 */

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
import { useToast } from "@/lib/contexts";
import { getClient, getCurrentContext } from "@/lib/services/supabase/base";
import { createShipmentForInvoice } from "@/lib/services/supabase/shipping";
import { formatCurrency } from "@/lib/format";
import { Icon } from "@/components/ui/icon";
import { ReceiverCustomerSelect } from "@/components/shared/receiver-customer-select";

interface CreateShippingOrderDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

interface SearchInvoice {
  id: string;
  code: string;
  customerName: string;
  customerId: string | null;
  customerPhone: string;
  customerAddress: string;
  /** Tổng hiện tại (đã gồm phí giao cũ nếu có) */
  total: number;
  paid: number;
  /** Phí giao đã gắn trước đó (sửa phí → RPC chỉ cộng phần chênh) */
  deliveryFee: number;
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
  const [sameAsBuyer, setSameAsBuyer] = useState(true);
  const [receiverCustomerId, setReceiverCustomerId] = useState<string | null>(null);
  const [collectionMode, setCollectionMode] = useState<"cod" | "none">("cod");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setInvoiceSearch("");
      setSelectedInvoice(null);
      setShowInvoiceDropdown(false);
      setFilteredInvoices([]);
      setSelectedPartnerId("");
      setReceiverName("");
      setReceiverPhone("");
      setReceiverAddress("");
      setShippingFee(0);
      setSameAsBuyer(true);
      setReceiverCustomerId(null);
      setCollectionMode("cod");
      setNotes("");
      setErrors({});
      setSaving(false);

      // Load delivery partners
      (async () => {
        const supabase = getClient();
        const ctx = await getCurrentContext();
        const { data } = await supabase
          .from("delivery_partners")
          .select("id, name")
          .eq("tenant_id", ctx.tenantId)
          .eq("is_active", true)
          .order("name")
          .limit(50);
        setPartners((data ?? []).map((p) => ({ id: p.id, name: p.name })));
      })();
    }
  }, [open]);

  // Live search invoices — bỏ hóa đơn hủy (RPC cũng chặn, lọc sớm đỡ bực)
  useEffect(() => {
    if (!invoiceSearch || invoiceSearch.length < 1) {
      setFilteredInvoices([]);
      return;
    }
    const timer = setTimeout(async () => {
      const supabase = getClient();
      const ctx = await getCurrentContext();
      const { data } = await supabase
        .from("invoices")
        .select("id, code, customer_id, customer_name, total, paid, delivery_fee, customers(phone, address)")
        .ilike("code", `%${invoiceSearch}%`)
        .eq("tenant_id", ctx.tenantId)
        .neq("status", "cancelled")
        .limit(8);
      setFilteredInvoices(
        (data ?? []).map((inv) => {
          const customer = inv.customers as { phone?: string | null; address?: string | null } | null;
          return {
          id: inv.id,
          code: inv.code,
          customerId: inv.customer_id ?? null,
          customerName: inv.customer_name,
          customerPhone: customer?.phone ?? "",
          customerAddress: customer?.address ?? "",
          total: Number(inv.total ?? 0),
          paid: Number(inv.paid ?? 0),
          deliveryFee: Number(inv.delivery_fee ?? 0),
          };
        })
      );
    }, 300);
    return () => clearTimeout(timer);
  }, [invoiceSearch]);

  // COD xem trước, đúng công thức RPC: tổng mới = tổng cũ + (phí mới − phí cũ);
  // COD = tổng mới − đã thanh toán. Số chốt vẫn do máy chủ tính.
  const codPreview = selectedInvoice && collectionMode === "cod"
    ? Math.max(
        0,
        selectedInvoice.total +
          (shippingFee - selectedInvoice.deliveryFee) -
          selectedInvoice.paid,
      )
    : 0;

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
      const shipment = await createShipmentForInvoice({
        invoiceId: selectedInvoice!.id,
        fee: shippingFee,
        receiverName: receiverName.trim(),
        receiverPhone: receiverPhone.trim(),
        receiverAddress: receiverAddress.trim(),
        partnerId: selectedPartnerId || null,
        note: notes || null,
        collectionMode,
        receiverCustomerId,
      });

      onOpenChange(false);
      toast({
        title: "Tạo vận đơn thành công",
        description: `Đã tạo vận đơn ${shipment.code} cho hóa đơn ${selectedInvoice!.code}`,
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
            Chọn hóa đơn, người nhận và cách thu tiền.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Invoice search */}
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Hóa đơn <span className="text-destructive">*</span>
            </label>
            <div className="relative">
              <Icon name="search" size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={invoiceSearch}
                onChange={(e) => {
                  setInvoiceSearch(e.target.value);
                  setSelectedInvoice(null);
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
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-sm hover:bg-accent cursor-pointer"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setSelectedInvoice(inv);
                          setInvoiceSearch(inv.code);
                          setShowInvoiceDropdown(false);
                          if (inv.deliveryFee > 0) setShippingFee(inv.deliveryFee);
                          if (sameAsBuyer) {
                            setReceiverCustomerId(inv.customerId);
                            setReceiverName(inv.customerName);
                            setReceiverPhone(inv.customerPhone);
                            setReceiverAddress(inv.customerAddress);
                          }
                        }}
                      >
                        <span className="font-medium">{inv.code}</span>
                        <span className="min-w-0 flex-1 truncate text-right text-muted-foreground">
                          {inv.customerName}
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">
                          {formatCurrency(inv.total)}
                        </span>
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
          <div className="space-y-2">
            <label className="text-sm font-medium">Đối tác giao hàng</label>
            <select
              value={selectedPartnerId}
              onChange={(e) => setSelectedPartnerId(e.target.value)}
              className="flex h-8 w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm transition-colors outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="">-- Chọn đối tác --</option>
              {partners.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {partners.length === 0 && (
              <p className="text-xs text-muted-foreground">
                Chưa có đối tác nào — khai báo ở Danh mục → Đối tác giao hàng để
                đối chiếu được tiền thu hộ.
              </p>
            )}
          </div>

          {/* Receiver info */}
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm font-medium">Người nhận</span>
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={sameAsBuyer}
                onChange={(e) => {
                  const checked = e.target.checked;
                  setSameAsBuyer(checked);
                  setReceiverCustomerId(checked ? selectedInvoice?.customerId ?? null : null);
                  if (checked && selectedInvoice) {
                    setReceiverName(selectedInvoice.customerName);
                    setReceiverPhone(selectedInvoice.customerPhone);
                    setReceiverAddress(selectedInvoice.customerAddress);
                  }
                }}
              />
              Giống người mua
            </label>
          </div>
          {!sameAsBuyer && (
            <ReceiverCustomerSelect
              onSelect={(customer) => {
                setReceiverCustomerId(customer.id);
                setReceiverName(customer.name);
                setReceiverPhone(customer.phone);
                setReceiverAddress(customer.address ?? "");
              }}
            />
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Người nhận <span className="text-destructive">*</span>
              </label>
              <Input
                value={receiverName}
                onChange={(e) => { setReceiverName(e.target.value); setSameAsBuyer(false); setReceiverCustomerId(null); }}
                placeholder="Tên người nhận"
                aria-invalid={!!errors.receiverName}
              />
              {errors.receiverName && (
                <p className="text-xs text-destructive">{errors.receiverName}</p>
              )}
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">
                Điện thoại <span className="text-destructive">*</span>
              </label>
              <Input
                value={receiverPhone}
                onChange={(e) => { setReceiverPhone(e.target.value); setSameAsBuyer(false); setReceiverCustomerId(null); }}
                placeholder="Số điện thoại"
                aria-invalid={!!errors.receiverPhone}
              />
              {errors.receiverPhone && (
                <p className="text-xs text-destructive">{errors.receiverPhone}</p>
              )}
            </div>
          </div>

          {/* Address */}
          <div className="space-y-2">
            <label className="text-sm font-medium">
              Địa chỉ <span className="text-destructive">*</span>
            </label>
            <Input
              value={receiverAddress}
              onChange={(e) => { setReceiverAddress(e.target.value); setSameAsBuyer(false); setReceiverCustomerId(null); }}
              placeholder="Địa chỉ giao hàng"
              aria-invalid={!!errors.receiverAddress}
            />
            {errors.receiverAddress && (
              <p className="text-xs text-destructive">{errors.receiverAddress}</p>
            )}
          </div>

          {/* Phí giao + COD tự tính */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <label className="text-sm font-medium">Phí giao thu khách</label>
              <Input
                type="number"
                min={0}
                value={shippingFee}
                onChange={(e) => setShippingFee(Math.max(0, Number(e.target.value) || 0))}
                placeholder="0"
              />
              <p className="text-xs text-muted-foreground">
                Cộng vào tổng hóa đơn và công nợ (nếu đã hoàn tất).
              </p>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Thu tiền</label>
              <select
                value={collectionMode}
                onChange={(e) => setCollectionMode(e.target.value as "cod" | "none")}
                className="mb-2 flex h-8 w-full rounded-lg border border-input bg-transparent px-3 text-sm"
              >
                <option value="cod">Thu khi giao</option>
                <option value="none">Không thu</option>
              </select>
              <div className="flex h-8 w-full items-center rounded-lg border border-input bg-muted/50 px-3 text-sm tabular-nums">
                {selectedInvoice ? formatCurrency(codPreview) : "Chọn hóa đơn trước"}
              </div>
              {selectedInvoice && (
                <p className="text-xs text-muted-foreground">
                  = tổng {formatCurrency(selectedInvoice.total + (shippingFee - selectedInvoice.deliveryFee))} − đã thu{" "}
                  {formatCurrency(selectedInvoice.paid)}
                </p>
              )}
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Ghi chú</label>
            <textarea
              className="flex min-h-[50px] w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
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
          <Button onClick={handleSave} disabled={saving || !selectedInvoice}>
            {saving && <Icon name="progress_activity" size={16} className="mr-2 animate-spin" />}
            Tạo vận đơn
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
