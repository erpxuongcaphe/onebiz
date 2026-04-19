"use client";

import { useState, useEffect, useMemo } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { formatCurrency } from "@/lib/format";
import { useToast } from "@/lib/contexts";
import { getClient, getCurrentContext } from "@/lib/services/supabase/base";
import { nextEntityCode } from "@/lib/services/supabase/stock-adjustments";
import { completeReturn } from "@/lib/services/supabase/returns-completion";
import type { Database } from "@/lib/supabase/types";
import { Icon } from "@/components/ui/icon";

type SalesReturnInsert = Database["public"]["Tables"]["sales_returns"]["Insert"];
type ReturnItemInsert = Database["public"]["Tables"]["return_items"]["Insert"];

interface CreateReturnDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

interface InvoiceResult {
  id: string;
  code: string;
  customer_id: string | null;
  customer_name: string;
}

interface InvoiceLineItem {
  id: string;
  product_id: string;
  product_name: string;
  unit: string;
  quantity: number;
  unit_price: number;
  total: number;
  selected: boolean;
  returnQty: number;
}

// Code generation moved to nextEntityCode("sales_return") in handleSave

export function CreateReturnDialog({
  open,
  onOpenChange,
  onSuccess,
}: CreateReturnDialogProps) {
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [showInvoiceDropdown, setShowInvoiceDropdown] = useState(false);
  const [filteredInvoices, setFilteredInvoices] = useState<InvoiceResult[]>([]);
  const [selectedInvoice, setSelectedInvoice] = useState<InvoiceResult | null>(null);
  const [invoiceItems, setInvoiceItems] = useState<InvoiceLineItem[]>([]);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  // Partial-refund state: default to full cashback; user can lower it.
  // refundMode:
  //   "full" → refundAmount = returnTotal (cashback toàn bộ)
  //   "partial" → refundAmount user-set, remainder credits customer debt
  //   "debt_only" → refundAmount = 0, all credits customer debt
  const [refundMode, setRefundMode] = useState<"full" | "partial" | "debt_only">("full");
  const [partialRefund, setPartialRefund] = useState(0);

  useEffect(() => {
    if (open) {
      setCode("TH...");
      setInvoiceSearch("");
      setShowInvoiceDropdown(false);
      setFilteredInvoices([]);
      setSelectedInvoice(null);
      setInvoiceItems([]);
      setReason("");
      setNotes("");
      setErrors({});
      setSaving(false);
      setRefundMode("full");
      setPartialRefund(0);
    }
  }, [open]);

  // Live search invoices
  useEffect(() => {
    if (!invoiceSearch || invoiceSearch.length < 1) { setFilteredInvoices([]); return; }
    const timer = setTimeout(async () => {
      const supabase = getClient();
      const { data } = await supabase
        .from("invoices")
        .select("id, code, customer_id, customer_name")
        .ilike("code", `%${invoiceSearch}%`)
        .eq("status", "completed")
        .limit(8);
      setFilteredInvoices((data ?? []).map(inv => ({
        id: inv.id,
        code: inv.code,
        customer_id: inv.customer_id,
        customer_name: inv.customer_name,
      })));
    }, 300);
    return () => clearTimeout(timer);
  }, [invoiceSearch]);

  // Load invoice items when invoice selected
  async function loadInvoiceItems(invoiceId: string) {
    const supabase = getClient();
    const { data } = await supabase
      .from("invoice_items")
      .select("id, product_id, product_name, unit, quantity, unit_price, total")
      .eq("invoice_id", invoiceId);
    setInvoiceItems(
      (data ?? []).map(item => ({
        id: item.id,
        product_id: item.product_id,
        product_name: item.product_name,
        unit: item.unit,
        quantity: item.quantity,
        unit_price: item.unit_price,
        total: item.total,
        selected: false,
        returnQty: item.quantity,
      }))
    );
  }

  function toggleItem(id: string) {
    setInvoiceItems(
      invoiceItems.map((item) =>
        item.id === id ? { ...item, selected: !item.selected } : item
      )
    );
  }

  function updateReturnQty(id: string, qty: number) {
    setInvoiceItems(
      invoiceItems.map((item) =>
        item.id === id ? { ...item, returnQty: Math.min(Math.max(1, qty), item.quantity) } : item
      )
    );
  }

  const selectedItems = useMemo(() => invoiceItems.filter(i => i.selected), [invoiceItems]);

  const returnTotal = useMemo(
    () => selectedItems.reduce((sum, item) => sum + item.returnQty * item.unit_price, 0),
    [selectedItems]
  );

  // Derive actual cash refund from mode + user input.
  // Clamp to [0, returnTotal] to prevent cashier overpayment.
  const effectiveRefund = useMemo(() => {
    if (refundMode === "full") return returnTotal;
    if (refundMode === "debt_only") return 0;
    return Math.max(0, Math.min(returnTotal, partialRefund));
  }, [refundMode, returnTotal, partialRefund]);

  const debtCredit = returnTotal - effectiveRefund;

  function validate(): boolean {
    const newErrors: Record<string, string> = {};
    if (!selectedInvoice) newErrors.invoice = "Vui lòng chọn hóa đơn gốc";
    if (selectedItems.length === 0) newErrors.items = "Vui lòng chọn ít nhất một sản phẩm để trả";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    try {
      const supabase = getClient();
      const ctx = await getCurrentContext();

      // Generate monotonic return code via next_code RPC
      const returnCode = await nextEntityCode("sales_return", { tenantId: ctx.tenantId });
      setCode(returnCode);

      const { data: salesReturn, error: returnErr } = await supabase
        .from("sales_returns")
        .insert({
          tenant_id: ctx.tenantId,
          branch_id: ctx.branchId,
          code: returnCode,
          invoice_id: selectedInvoice!.id,
          customer_id: selectedInvoice!.customer_id,
          customer_name: selectedInvoice!.customer_name,
          status: "completed" as const,
          total: returnTotal,
          refunded: effectiveRefund,
          reason: reason || null,
          note: notes || null,
          created_by: ctx.userId,
        } satisfies SalesReturnInsert)
        .select("id")
        .single();

      if (returnErr) throw new Error(returnErr.message);

      if (salesReturn && selectedItems.length > 0) {
        const { error: itemsErr } = await supabase
          .from("return_items")
          .insert(selectedItems.map(item => ({
            return_id: salesReturn.id,
            product_id: item.product_id,
            product_name: item.product_name,
            unit: item.unit,
            quantity: item.returnQty,
            unit_price: item.unit_price,
            total: item.returnQty * item.unit_price,
          } satisfies ReturnItemInsert)));
        if (itemsErr) throw new Error(itemsErr.message);

        // Complete return: increment stock + create cash refund payment (if any) + credit debt
        await completeReturn({
          returnId: salesReturn.id,
          returnCode,
          invoiceCode: selectedInvoice!.code,
          customerId: selectedInvoice!.customer_id,
          customerName: selectedInvoice!.customer_name,
          items: selectedItems.map(item => ({
            productId: item.product_id,
            productName: item.product_name,
            quantity: item.returnQty,
            unitPrice: item.unit_price,
          })),
          refundAmount: effectiveRefund,
          totalAmount: returnTotal,
        });
      }

      onOpenChange(false);
      const descParts: string[] = [];
      if (effectiveRefund > 0)
        descParts.push(`hoàn ${formatCurrency(effectiveRefund)} tiền mặt`);
      if (debtCredit > 0)
        descParts.push(`trừ ${formatCurrency(debtCredit)} công nợ`);
      toast({
        title: "Tạo phiếu trả hàng thành công",
        description: `${returnCode} — ${descParts.join(", ") || "đã nhập kho"}`,
        variant: "success",
      });
      onSuccess?.();
    } catch (err) {
      toast({
        title: "Lỗi tạo phiếu trả hàng",
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
          <DialogTitle>Tạo phiếu trả hàng</DialogTitle>
          <DialogDescription>
            Mã phiếu trả: {code}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* Invoice search */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Hóa đơn gốc <span className="text-destructive">*</span>
            </label>
            <div className="relative">
              <Icon name="search" size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
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
                          loadInvoiceItems(inv.id);
                        }}
                      >
                        <span className="font-medium">{inv.code}</span>
                        <span className="text-muted-foreground">{inv.customer_name}</span>
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

          {/* Selected invoice info */}
          {selectedInvoice && (
            <div className="rounded-lg border p-3 bg-muted/30 text-sm">
              <span className="text-muted-foreground">Khách hàng: </span>
              <span className="font-medium">{selectedInvoice.customer_name}</span>
            </div>
          )}

          {/* Invoice items to select for return */}
          {invoiceItems.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Chọn sản phẩm trả <span className="text-destructive">*</span>
              </label>
              <div className="rounded-lg border overflow-hidden">
                <div className="grid grid-cols-[32px_1fr_70px_100px_100px] gap-2 px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground">
                  <span />
                  <span>Sản phẩm</span>
                  <span className="text-center">SL mua</span>
                  <span className="text-center">SL trả</span>
                  <span className="text-right">Đơn giá</span>
                </div>
                {invoiceItems.map((item) => (
                  <div
                    key={item.id}
                    className="grid grid-cols-[32px_1fr_70px_100px_100px] gap-2 items-center px-3 py-2 border-t"
                  >
                    <Checkbox
                      checked={item.selected}
                      onCheckedChange={() => toggleItem(item.id)}
                    />
                    <span className="text-sm truncate">{item.product_name}</span>
                    <span className="text-sm text-center text-muted-foreground">{item.quantity}</span>
                    <Input
                      type="number"
                      min={1}
                      max={item.quantity}
                      value={item.returnQty}
                      onChange={(e) => updateReturnQty(item.id, Number(e.target.value) || 1)}
                      className="h-7 text-center px-1"
                      disabled={!item.selected}
                    />
                    <span className="text-sm text-right">{formatCurrency(item.unit_price)}</span>
                  </div>
                ))}
              </div>
              {errors.items && (
                <p className="text-xs text-destructive">{errors.items}</p>
              )}
            </div>
          )}

          {/* Return total + refund mode */}
          {selectedItems.length > 0 && (
            <div className="space-y-3 rounded-xl border p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium">Tổng tiền trả</span>
                <span className="text-lg font-semibold text-primary">
                  {formatCurrency(returnTotal)}
                </span>
              </div>

              {/* Refund mode selector */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Hình thức hoàn tiền
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  {[
                    { value: "full" as const, label: "Hoàn đủ tiền mặt", icon: "payments" },
                    { value: "partial" as const, label: "Hoàn một phần", icon: "pie_chart" },
                    { value: "debt_only" as const, label: "Khấu trừ công nợ", icon: "account_balance_wallet" },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        setRefundMode(opt.value);
                        if (opt.value === "partial" && partialRefund === 0) {
                          // Default partial to half for convenience
                          setPartialRefund(Math.round(returnTotal / 2));
                        }
                      }}
                      className={`flex flex-col items-center justify-center gap-1 rounded-lg border-2 p-2 text-xs font-medium transition press-scale-sm ${
                        refundMode === opt.value
                          ? "border-primary bg-primary-fixed text-primary"
                          : "border-transparent bg-surface-container hover:bg-surface-container-high"
                      }`}
                    >
                      <Icon name={opt.icon} size={18} />
                      <span className="leading-tight text-center">{opt.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Partial refund amount input */}
              {refundMode === "partial" && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">
                    Số tiền hoàn bằng tiền mặt
                  </label>
                  <Input
                    type="number"
                    min={0}
                    max={returnTotal}
                    value={partialRefund}
                    onChange={(e) =>
                      setPartialRefund(Math.max(0, Number(e.target.value) || 0))
                    }
                    className="text-right font-mono"
                  />
                </div>
              )}

              {/* Breakdown preview */}
              <div className="rounded-lg bg-surface-container-low p-2.5 text-xs space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Hoàn tiền mặt:</span>
                  <span className="font-mono font-semibold text-status-success">
                    {formatCurrency(effectiveRefund)}
                  </span>
                </div>
                {debtCredit > 0 && (
                  <div className="flex items-center justify-between">
                    <span className="text-muted-foreground">
                      Khấu trừ công nợ KH:
                    </span>
                    <span className="font-mono font-semibold text-status-info">
                      {formatCurrency(debtCredit)}
                    </span>
                  </div>
                )}
                {debtCredit > 0 && !selectedInvoice?.customer_id && (
                  <p className="text-[10px] text-status-warning mt-1">
                    ⚠ Khách vãng lai không có công nợ — chỉ hoàn tiền mặt có ý nghĩa
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Reason */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Lý do trả hàng</label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Nhập lý do trả hàng"
            />
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Ghi chú</label>
            <textarea
              className="flex min-h-[50px] w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ghi chú phiếu trả"
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
            Tạo phiếu trả
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
