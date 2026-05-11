"use client";

import { useState, useEffect, useMemo, useRef } from "react";
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
import { completeSupplierReturn } from "@/lib/services/supabase/purchase-entries";
import { Icon } from "@/components/ui/icon";

interface CreatePurchaseReturnDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

interface POResult {
  id: string;
  code: string;
  supplier_id: string;
  supplier_name: string;
}

interface POLineItem {
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

type SupplierReturnPaymentMethod = "cash" | "transfer" | "card";

const SUPPLIER_RETURN_PAYMENT_METHODS: Array<{
  value: SupplierReturnPaymentMethod;
  label: string;
  icon: string;
}> = [
  { value: "cash", label: "Tiền mặt", icon: "payments" },
  { value: "transfer", label: "Chuyển khoản", icon: "account_balance" },
  { value: "card", label: "Thẻ", icon: "credit_card" },
];

const PENDING_CODE_PLACEHOLDER = "Tự tạo khi lưu";

export function CreatePurchaseReturnDialog({
  open,
  onOpenChange,
  onSuccess,
}: CreatePurchaseReturnDialogProps) {
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [poSearch, setPOSearch] = useState("");
  const [showPODropdown, setShowPODropdown] = useState(false);
  const [filteredPOs, setFilteredPOs] = useState<POResult[]>([]);
  const [selectedPO, setSelectedPO] = useState<POResult | null>(null);
  const [poItems, setPOItems] = useState<POLineItem[]>([]);
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<SupplierReturnPaymentMethod>("cash");
  const saveLockRef = useRef(false);

  useEffect(() => {
    if (!open) return;

    setCode(PENDING_CODE_PLACEHOLDER);
    setPOSearch("");
    setShowPODropdown(false);
    setFilteredPOs([]);
    setSelectedPO(null);
    setPOItems([]);
    setReason("");
    setNotes("");
    setErrors({});
    setSaving(false);
    setPaymentMethod("cash");
  }, [open]);

  useEffect(() => {
    if (!poSearch || poSearch.length < 1) {
      setFilteredPOs([]);
      return;
    }

    const timer = setTimeout(async () => {
      const supabase = getClient();
      const ctx = await getCurrentContext();
      const { data } = await supabase
        .from("purchase_orders")
        .select("id, code, supplier_id, supplier_name")
        .ilike("code", `%${poSearch}%`)
        .eq("tenant_id", ctx.tenantId)
        .in("status", ["completed", "partial"])
        .limit(8);

      setFilteredPOs((data ?? []).map((po) => ({
        id: po.id,
        code: po.code,
        supplier_id: po.supplier_id,
        supplier_name: po.supplier_name,
      })));
    }, 300);

    return () => clearTimeout(timer);
  }, [poSearch]);

  async function loadPOItems(poId: string) {
    const supabase = getClient();
    const { data } = await supabase
      .from("purchase_order_items")
      .select("id, product_id, product_name, unit, quantity, unit_price, total")
      .eq("purchase_order_id", poId);

    setPOItems(
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
    setPOItems(
      poItems.map((item) =>
        item.id === id ? { ...item, selected: !item.selected } : item,
      ),
    );
  }

  function updateReturnQty(id: string, qty: number) {
    setPOItems(
      poItems.map((item) =>
        item.id === id
          ? { ...item, returnQty: Math.min(Math.max(0.01, qty), item.quantity) }
          : item,
      ),
    );
  }

  const selectedItems = useMemo(() => poItems.filter((item) => item.selected), [poItems]);

  const returnTotal = useMemo(
    () => selectedItems.reduce((sum, item) => sum + item.returnQty * item.unit_price, 0),
    [selectedItems],
  );

  const returnQuantity = useMemo(
    () => selectedItems.reduce((sum, item) => sum + item.returnQty, 0),
    [selectedItems],
  );

  function validate(): boolean {
    const newErrors: Record<string, string> = {};
    if (!selectedPO) newErrors.po = "Vui lòng chọn đơn nhập hàng";
    if (selectedItems.length === 0) newErrors.items = "Vui lòng chọn ít nhất một sản phẩm để trả";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSave() {
    if (saveLockRef.current) return;
    if (!validate()) return;

    saveLockRef.current = true;
    setSaving(true);
    try {
      const { returnCode } = await completeSupplierReturn({
        purchaseOrderId: selectedPO!.id,
        purchaseOrderCode: selectedPO!.code,
        supplierId: selectedPO!.supplier_id,
        supplierName: selectedPO!.supplier_name,
        items: selectedItems.map((item) => ({
          productId: item.product_id,
          productName: item.product_name,
          unit: item.unit,
          quantity: item.returnQty,
          unitPrice: item.unit_price,
        })),
        reason: reason || undefined,
        note: notes || undefined,
        paymentMethod,
      });
      setCode(returnCode);

      onOpenChange(false);
      toast({
        title: "Tạo phiếu trả hàng nhập thành công",
        description: `Đã tạo phiếu trả hàng nhập ${returnCode}`,
        variant: "success",
      });
      onSuccess?.();
    } catch (err) {
      toast({
        title: "Lỗi tạo phiếu trả hàng nhập",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      saveLockRef.current = false;
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-[1450px] flex-col gap-0 overflow-hidden p-0 sm:max-w-[1450px] sm:rounded-2xl">
        <div className="shrink-0 border-b bg-white px-4 py-3 md:px-5">
          <DialogHeader className="gap-0 pr-10">
            <div className="flex flex-wrap items-center gap-3">
              <DialogTitle className="text-xl">Tạo phiếu trả hàng nhập</DialogTitle>
              <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700">
                Xuất trả NCC
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
                  <h3 className="text-sm font-semibold">Đơn nhập hàng</h3>
                  {selectedPO && (
                    <span className="max-w-[180px] truncate rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                      {selectedPO.supplier_name}
                    </span>
                  )}
                </div>
                <div className="relative">
                  <Icon name="search" size={16} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={poSearch}
                    onChange={(e) => {
                      setPOSearch(e.target.value);
                      setShowPODropdown(true);
                    }}
                    onFocus={() => setShowPODropdown(true)}
                    onBlur={() => setTimeout(() => setShowPODropdown(false), 200)}
                    placeholder="Tìm đơn nhập hàng theo mã"
                    className="pl-8"
                    aria-invalid={!!errors.po}
                  />
                  {showPODropdown && poSearch && (
                    <div className="absolute z-30 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border bg-popover shadow-lg">
                      {filteredPOs.length === 0 ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">
                          Không tìm thấy đơn nhập hàng
                        </div>
                      ) : (
                        filteredPOs.map((po) => (
                          <button
                            key={po.id}
                            type="button"
                            className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-accent"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => {
                              setSelectedPO(po);
                              setPOSearch(po.code);
                              setShowPODropdown(false);
                              loadPOItems(po.id);
                            }}
                          >
                            <span className="font-semibold">{po.code}</span>
                            <span className="truncate text-muted-foreground">{po.supplier_name}</span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
                {errors.po && <p className="mt-1 text-xs text-destructive">{errors.po}</p>}
              </section>

              <section className="rounded-xl border bg-white p-3 shadow-sm">
                <h3 className="mb-2 text-sm font-semibold">Nhà cung cấp hoàn bằng</h3>
                <div className="grid grid-cols-3 gap-2">
                  {SUPPLIER_RETURN_PAYMENT_METHODS.map((method) => (
                    <button
                      key={method.value}
                      type="button"
                      onClick={() => setPaymentMethod(method.value)}
                      className={`flex min-h-10 items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-semibold transition ${
                        paymentMethod === method.value
                          ? "border-primary bg-primary-fixed text-primary shadow-sm"
                          : "border-border bg-background hover:bg-muted"
                      }`}
                    >
                      <Icon name={method.icon} size={15} />
                      <span className="truncate">{method.label}</span>
                    </button>
                  ))}
                </div>
              </section>
            </div>

            <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
              <div className="hidden grid-cols-[40px_minmax(300px,1fr)_90px_110px_120px_140px_150px] gap-2 border-b bg-muted/50 px-3 py-2 text-xs font-semibold uppercase text-muted-foreground md:grid">
                <span />
                <span>Sản phẩm</span>
                <span className="flex justify-center">ĐVT</span>
                <span className="flex justify-end">SL nhập</span>
                <span className="flex justify-end">SL trả</span>
                <span className="flex justify-end">Đơn giá</span>
                <span className="flex justify-end">Thành tiền</span>
              </div>

              {poItems.length === 0 ? (
                <div className="flex min-h-[300px] flex-col items-center justify-center px-4 py-10 text-center">
                  <div className="flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon name="assignment_return" size={24} />
                  </div>
                  <div className="mt-3 font-semibold">Chưa chọn đơn nhập</div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    Chọn đơn nhập đã hoàn thành để lấy danh sách hàng có thể trả.
                  </div>
                </div>
              ) : (
                <div className="divide-y">
                  {poItems.map((item) => (
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
                  placeholder="VD: hàng lỗi, sai quy cách, trả lại nhà cung cấp..."
                  className="mt-2"
                />
              </section>
              <section className="rounded-xl border bg-white p-3 shadow-sm">
                <label className="text-sm font-medium">Ghi chú</label>
                <textarea
                  className="mt-2 flex min-h-[52px] w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Ví dụ: biên bản trả hàng, người nhận, chứng từ kèm theo..."
                  rows={2}
                />
              </section>
            </div>
          </div>
        </div>

        <DialogFooter className="mx-0 mb-0 shrink-0 rounded-none border-t bg-white px-4 py-3">
          <div className="mx-auto grid w-full max-w-[1380px] grid-cols-1 items-center gap-3 lg:grid-cols-[1fr_auto]">
            <div className="grid gap-2 text-sm sm:grid-cols-3 xl:grid-cols-4">
              <FooterMetric label="Dòng chọn" value={formatNumber(selectedItems.length)} />
              <FooterMetric label="Tổng SL trả" value={formatNumber(returnQuantity)} />
              <FooterMetric label="Tổng tiền trả" value={formatCurrency(returnTotal)} strong />
              <FooterMetric
                label="Hoàn NCC"
                value={SUPPLIER_RETURN_PAYMENT_METHODS.find((m) => m.value === paymentMethod)?.label ?? "Tiền mặt"}
              />
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
