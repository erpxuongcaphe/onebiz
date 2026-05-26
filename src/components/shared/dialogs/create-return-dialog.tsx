"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NumericInput } from "@/components/ui/numeric-input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { formatCurrency, formatNumber } from "@/lib/format";
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

type RefundPaymentMethod = "cash" | "transfer" | "card";

const REFUND_PAYMENT_METHODS: Array<{
  value: RefundPaymentMethod;
  label: string;
  icon: string;
}> = [
  { value: "cash", label: "Tiền mặt", icon: "payments" },
  { value: "transfer", label: "Chuyển khoản", icon: "account_balance" },
  { value: "card", label: "Thẻ", icon: "credit_card" },
];

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
  const [refundMode, setRefundMode] = useState<"full" | "partial" | "debt_only">("full");
  const [partialRefund, setPartialRefund] = useState(0);
  const [refundPaymentMethod, setRefundPaymentMethod] = useState<RefundPaymentMethod>("cash");

  useEffect(() => {
    if (!open) return;

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
    setRefundPaymentMethod("cash");
  }, [open]);

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
        .select("id, code, customer_id, customer_name")
        .ilike("code", `%${invoiceSearch}%`)
        .eq("tenant_id", ctx.tenantId)
        .eq("status", "completed")
        .limit(8);

      setFilteredInvoices((data ?? []).map((inv) => ({
        id: inv.id,
        code: inv.code,
        customer_id: inv.customer_id,
        customer_name: inv.customer_name,
      })));
    }, 300);

    return () => clearTimeout(timer);
  }, [invoiceSearch]);

  async function loadInvoiceItems(invoiceId: string) {
    const supabase = getClient();
    const { data } = await supabase
      .from("invoice_items")
      .select("id, product_id, product_name, unit, quantity, unit_price, total")
      .eq("invoice_id", invoiceId);

    setInvoiceItems(
      (data ?? []).map((item) => ({
        id: item.id,
        product_id: item.product_id,
        product_name: item.product_name,
        unit: item.unit,
        quantity: Number(item.quantity ?? 0),
        unit_price: Number(item.unit_price ?? 0),
        total: Number(item.total ?? 0),
        selected: false,
        returnQty: Number(item.quantity ?? 0),
      })),
    );
  }

  function toggleItem(id: string) {
    setInvoiceItems(
      invoiceItems.map((item) =>
        item.id === id ? { ...item, selected: !item.selected } : item,
      ),
    );
  }

  function updateReturnQty(id: string, qty: number) {
    setInvoiceItems(
      invoiceItems.map((item) =>
        item.id === id
          ? { ...item, returnQty: Math.min(Math.max(0.01, qty), item.quantity) }
          : item,
      ),
    );
  }

  const selectedItems = useMemo(() => invoiceItems.filter((item) => item.selected), [invoiceItems]);

  const returnTotal = useMemo(
    () => selectedItems.reduce((sum, item) => sum + item.returnQty * item.unit_price, 0),
    [selectedItems],
  );

  const returnQuantity = useMemo(
    () => selectedItems.reduce((sum, item) => sum + item.returnQty, 0),
    [selectedItems],
  );

  const effectiveRefund = useMemo(() => {
    if (refundMode === "full") return returnTotal;
    if (refundMode === "debt_only") return 0;
    return Math.max(0, Math.min(returnTotal, partialRefund));
  }, [refundMode, returnTotal, partialRefund]);

  const debtCredit = returnTotal - effectiveRefund;
  const refundPaymentMethodLabel = useMemo(
    () => REFUND_PAYMENT_METHODS.find((m) => m.value === refundPaymentMethod)?.label ?? "Tiền mặt",
    [refundPaymentMethod],
  );

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
          .insert(selectedItems.map((item) => ({
            return_id: salesReturn.id,
            product_id: item.product_id,
            product_name: item.product_name,
            unit: item.unit,
            quantity: item.returnQty,
            unit_price: item.unit_price,
            total: item.returnQty * item.unit_price,
          } satisfies ReturnItemInsert)));
        if (itemsErr) throw new Error(itemsErr.message);

        await completeReturn({
          returnId: salesReturn.id,
          returnCode,
          invoiceCode: selectedInvoice!.code,
          customerId: selectedInvoice!.customer_id,
          customerName: selectedInvoice!.customer_name,
          items: selectedItems.map((item) => ({
            productId: item.product_id,
            productName: item.product_name,
            quantity: item.returnQty,
            unitPrice: item.unit_price,
          })),
          refundAmount: effectiveRefund,
          refundPaymentMethod,
          totalAmount: returnTotal,
        });
      }

      onOpenChange(false);
      const descParts: string[] = [];
      if (effectiveRefund > 0) {
        descParts.push(`hoàn ${formatCurrency(effectiveRefund)} qua ${refundPaymentMethodLabel.toLowerCase()}`);
      }
      if (debtCredit > 0) {
        descParts.push(`trừ ${formatCurrency(debtCredit)} công nợ`);
      }
      toast({
        title: "Tạo phiếu trả hàng thành công",
        description: `${returnCode} - ${descParts.join(", ") || "đã nhập kho"}`,
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
      <DialogContent className="flex h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-[1450px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[min(1200px,calc(100vw-48px))] xl:max-w-[1450px] sm:rounded-2xl">
        <div className="shrink-0 border-b bg-white px-4 py-3 md:px-5">
          <DialogHeader className="gap-0 pr-10">
            <div className="flex flex-wrap items-center gap-3">
              <DialogTitle className="text-xl">Tạo phiếu trả hàng</DialogTitle>
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-700">
                Nhập lại kho
              </span>
              <span className="ml-auto mr-8 max-w-none whitespace-nowrap rounded-lg border bg-primary/5 px-3 py-1.5 text-sm font-bold text-primary sm:text-base">
                {code}
              </span>
            </div>
          </DialogHeader>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto bg-surface-container-low p-3 md:p-4">
          <div className="mx-auto flex max-w-[1380px] flex-col gap-3">
            <div className="grid gap-3 lg:grid-cols-[minmax(360px,0.9fr)_minmax(420px,1.1fr)]">
              <section className="rounded-xl border bg-white p-3 shadow-sm">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">Hóa đơn gốc</h3>
                  {selectedInvoice && (
                    <span className="max-w-[180px] truncate rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                      {selectedInvoice.customer_name}
                    </span>
                  )}
                </div>
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
                    placeholder="Tìm hóa đơn theo mã"
                    className="pl-8"
                    aria-invalid={!!errors.invoice}
                  />
                  {showInvoiceDropdown && invoiceSearch && (
                    <div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border bg-popover shadow-lg">
                      {filteredInvoices.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">
                          Không tìm thấy hóa đơn
                        </div>
                      ) : (
                        filteredInvoices.map((inv) => (
                          <button
                            key={inv.id}
                            type="button"
                            className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setSelectedInvoice(inv);
                              setInvoiceSearch(inv.code);
                              setShowInvoiceDropdown(false);
                              loadInvoiceItems(inv.id);
                            }}
                          >
                            <span className="font-semibold">{inv.code}</span>
                            <span className="truncate text-muted-foreground">{inv.customer_name}</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
                {errors.invoice && <p className="mt-1 text-xs text-destructive">{errors.invoice}</p>}
              </section>

              <section className="rounded-xl border bg-white p-3 shadow-sm">
                <h3 className="mb-2 text-sm font-semibold">Hoàn tiền / công nợ</h3>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { value: "full" as const, label: "Hoàn đủ", icon: "payments" },
                    { value: "partial" as const, label: "Một phần", icon: "pie_chart" },
                    { value: "debt_only" as const, label: "Công nợ", icon: "account_balance_wallet" },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        setRefundMode(opt.value);
                        if (opt.value === "partial" && partialRefund === 0) {
                          setPartialRefund(Math.round(returnTotal / 2));
                        }
                      }}
                      className={`flex min-h-10 items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-semibold transition ${
                        refundMode === opt.value
                          ? "border-primary bg-primary-fixed text-primary shadow-sm"
                          : "border-border bg-background hover:bg-muted"
                      }`}
                    >
                      <Icon name={opt.icon} size={15} />
                      <span className="truncate">{opt.label}</span>
                    </button>
                  ))}
                </div>
                {refundMode === "partial" && (
                  <NumericInput
                    value={partialRefund}
                    onChange={(value) => setPartialRefund(Math.max(0, value ?? 0))}
                    min={0}
                    max={returnTotal}
                    decimals={2}
                    className="mt-2 h-8 text-right"
                    aria-label="Số tiền hoàn"
                  />
                )}
                {effectiveRefund > 0 && (
                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {REFUND_PAYMENT_METHODS.map((method) => (
                      <button
                        key={method.value}
                        type="button"
                        onClick={() => setRefundPaymentMethod(method.value)}
                        className={`flex min-h-9 items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-medium transition ${
                          refundPaymentMethod === method.value
                            ? "border-primary bg-primary-fixed text-primary shadow-sm"
                            : "border-border bg-background hover:bg-muted"
                        }`}
                      >
                        <Icon name={method.icon} size={15} />
                        <span className="truncate">{method.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </section>
            </div>

            <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
              <div className="hidden grid-cols-[40px_minmax(300px,1fr)_90px_110px_120px_140px_150px] gap-2 border-b bg-muted/50 px-3 py-2 text-xs font-semibold uppercase text-muted-foreground md:grid">
                <span />
                <span>Sản phẩm</span>
                <span className="flex justify-center">ĐVT</span>
                <span className="flex justify-end">SL mua</span>
                <span className="flex justify-end">SL trả</span>
                <span className="flex justify-end">Đơn giá</span>
                <span className="flex justify-end">Thành tiền</span>
              </div>

              {invoiceItems.length === 0 ? (
                <div className="flex min-h-[300px] flex-col items-center justify-center px-4 py-10 text-center">
                  <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon name="assignment_return" size={24} />
                  </div>
                  <div className="mt-3 font-semibold">Chưa chọn hóa đơn</div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    Chọn hóa đơn đã hoàn thành để lấy danh sách hàng có thể trả.
                  </div>
                </div>
              ) : (
                <div className="divide-y">
                  {invoiceItems.map((item) => (
                    <div
                      key={item.id}
                      className="grid gap-2 px-3 py-2.5 md:grid-cols-[40px_minmax(300px,1fr)_90px_110px_120px_140px_150px] md:items-center"
                    >
                      <Checkbox
                        checked={item.selected}
                        onCheckedChange={() => toggleItem(item.id)}
                        aria-label={`Chọn ${item.product_name}`}
                      />
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold">{item.product_name}</div>
                      </div>
                      <div className="flex justify-center">
                        <span className="min-w-[64px] rounded-md bg-muted/50 px-2 py-1 text-center text-xs font-semibold text-muted-foreground">
                          {item.unit || "Cái"}
                        </span>
                      </div>
                      <div className="text-right text-sm tabular-nums text-muted-foreground">
                        {formatNumber(item.quantity)}
                      </div>
                      <NumericInput
                        value={item.returnQty}
                        onChange={(value) => updateReturnQty(item.id, value ?? 0.01)}
                        min={0.01}
                        max={item.quantity}
                        decimals={2}
                        disabled={!item.selected}
                        className="h-8 text-right"
                        aria-label={`Số lượng trả ${item.product_name}`}
                      />
                      <div className="text-right text-sm tabular-nums">
                        {formatCurrency(item.unit_price)}
                      </div>
                      <div className="text-right text-sm font-bold tabular-nums text-primary">
                        {formatCurrency(item.returnQty * item.unit_price)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {errors.items && <p className="text-xs text-destructive">{errors.items}</p>}

            <div className="grid gap-3 lg:grid-cols-2">
              <section className="rounded-xl border bg-white p-3 shadow-sm">
                <label className="text-sm font-medium">Lý do trả hàng</label>
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="VD: khách trả hàng, sai món, lỗi sản phẩm..."
                  className="mt-2"
                />
              </section>
              <section className="rounded-xl border bg-white p-3 shadow-sm">
                <label className="text-sm font-medium">Ghi chú</label>
                <textarea
                  className="mt-2 flex min-h-[52px] w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Ví dụ: tình trạng hàng trả, nhân viên xác nhận, chứng từ kèm theo..."
                  rows={2}
                />
              </section>
            </div>
          </div>
        </div>

        <DialogFooter className="mx-0 mb-0 shrink-0 rounded-none border-t bg-white px-4 py-3">
          <div className="mx-auto grid w-full max-w-[1380px] grid-cols-1 items-center gap-3 lg:grid-cols-[1fr_auto]">
            <div className="grid gap-2 text-sm sm:grid-cols-3 xl:grid-cols-5">
              <FooterMetric label="Dòng chọn" value={formatNumber(selectedItems.length)} />
              <FooterMetric label="Tổng SL trả" value={formatNumber(returnQuantity)} />
              <FooterMetric label="Tổng tiền trả" value={formatCurrency(returnTotal)} strong />
              <FooterMetric label="Hoàn tiền" value={formatCurrency(effectiveRefund)} />
              <FooterMetric label="Trừ công nợ" value={formatCurrency(debtCredit)} />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Hủy
              </Button>
              <Button onClick={handleSave} disabled={saving}>
                {saving && <Icon name="progress_activity" size={16} className="mr-2 animate-spin" />}
                Tạo phiếu trả
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
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-surface-container-lowest px-3 py-2">
      <div className="text-[11px] font-semibold uppercase text-muted-foreground">{label}</div>
      <div className={`mt-0.5 break-words font-bold leading-tight tabular-nums ${strong ? "text-lg text-primary" : ""}`}>
        {value}
      </div>
    </div>
  );
}
