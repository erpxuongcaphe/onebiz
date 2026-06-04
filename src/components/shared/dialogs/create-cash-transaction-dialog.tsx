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
import {
  createCashTransaction,
  getCustomers,
  getSuppliers,
  getOpenInvoicesByCustomer,
  getOpenPurchasesBySupplier,
  recordInvoicePayment,
  recordPurchasePayment,
} from "@/lib/services";
import type {
  OpenInvoiceLine,
  OpenPurchaseLine,
} from "@/lib/services/supabase/payments";
import { Icon } from "@/components/ui/icon";
import { formatCurrency } from "@/lib/format";

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

  // CEO 03/06/2026 — Sprint 3 (E1): khi category là payment KH/NCC, mở thêm
  // dropdown chọn party + reference doc để gọi recordInvoicePayment /
  // recordPurchasePayment thay vì createCashTransaction → giúp update debt
  // chính xác (không phải gõ counterparty tự do).
  const [parties, setParties] = useState<{ id: string; code: string; name: string; debt: number }[]>([]);
  const [selectedPartyId, setSelectedPartyId] = useState<string>("");
  const [refDocs, setRefDocs] = useState<(OpenInvoiceLine | OpenPurchaseLine)[]>([]);
  const [selectedRefId, setSelectedRefId] = useState<string>("");
  const [loadingParties, setLoadingParties] = useState(false);
  const [loadingRefs, setLoadingRefs] = useState(false);

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
      setParties([]);
      setSelectedPartyId("");
      setRefDocs([]);
      setSelectedRefId("");
    }
  }, [open, defaultType]);

  // Load party list khi user chọn category payment
  useEffect(() => {
    if (!open) return;
    if (category !== "customer_payment" && category !== "supplier_payment") {
      setParties([]);
      setSelectedPartyId("");
      setRefDocs([]);
      setSelectedRefId("");
      return;
    }
    let cancelled = false;
    setLoadingParties(true);
    const fetcher =
      category === "customer_payment"
        ? getCustomers({ page: 0, pageSize: 1000, filters: { debt: "has_debt" } })
        : getSuppliers({ page: 0, pageSize: 1000, filters: { debt: "has_debt" } });
    fetcher
      .then((res) => {
        if (cancelled) return;
        setParties(
          res.data
            .filter((p) => (p.currentDebt ?? 0) > 0)
            .map((p) => ({
              id: p.id,
              code: p.code,
              name: p.name,
              debt: p.currentDebt ?? 0,
            })),
        );
      })
      .catch(() => !cancelled && setParties([]))
      .finally(() => !cancelled && setLoadingParties(false));
    return () => {
      cancelled = true;
    };
  }, [open, category]);

  // Khi chọn party → load chứng từ còn nợ + auto-fill counterparty
  useEffect(() => {
    if (!selectedPartyId) {
      setRefDocs([]);
      setSelectedRefId("");
      return;
    }
    const party = parties.find((p) => p.id === selectedPartyId);
    if (party) setCounterparty(party.name);
    let cancelled = false;
    setLoadingRefs(true);
    const fetcher =
      category === "customer_payment"
        ? getOpenInvoicesByCustomer(selectedPartyId)
        : getOpenPurchasesBySupplier(selectedPartyId);
    fetcher
      .then((rows) => {
        if (cancelled) return;
        setRefDocs(rows);
      })
      .catch(() => !cancelled && setRefDocs([]))
      .finally(() => !cancelled && setLoadingRefs(false));
    return () => {
      cancelled = true;
    };
  }, [selectedPartyId, category, parties]);

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
      // CEO 03/06/2026 — Sprint 3 (E1): nếu user chọn category payment KH/NCC
      // VÀ chọn 1 chứng từ cụ thể → gọi recordInvoicePayment/recordPurchasePayment
      // (atomic, audit log, update debt). Còn lại fall back createCashTransaction
      // (phiếu thu/chi không link reference — chỉ để ghi nhận thu/chi khác).
      if (
        category === "customer_payment" &&
        selectedRefId &&
        type === "receipt"
      ) {
        await recordInvoicePayment({
          referenceId: selectedRefId,
          amount: Number(amount),
          paymentMethod: method as "cash" | "transfer" | "card" | "ewallet",
          note: note || undefined,
        });
      } else if (
        category === "supplier_payment" &&
        selectedRefId &&
        type === "payment"
      ) {
        await recordPurchasePayment({
          referenceId: selectedRefId,
          amount: Number(amount),
          paymentMethod: method as "cash" | "transfer" | "card" | "ewallet",
          note: note || undefined,
        });
      } else {
        await createCashTransaction({
          code,
          type,
          category: category || "other",
          amount: Number(amount),
          counterparty: counterparty || "",
          paymentMethod: method as "cash" | "transfer" | "card",
          note: note || undefined,
        });
      }
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
          <div className="space-y-2">
            <label className="text-sm font-medium">Loại phiếu</label>
            <div className="flex rounded-lg border p-0.5">
              <button
                type="button"
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors cursor-pointer ${
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
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors cursor-pointer ${
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

          <div className="space-y-2">
            <label className="text-sm font-medium">Mã phiếu</label>
            <Input value={code} onChange={(e) => setCode(e.target.value)} />
          </div>

          <div className="space-y-2">
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

          <div className="space-y-2">
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

          <div className="space-y-2">
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

          <div className="space-y-2">
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

          {/* CEO 03/06/2026 — Sprint 3 (E1): conditional party + ref dropdowns
              khi category là payment KH/NCC. */}
          {(category === "customer_payment" || category === "supplier_payment") && (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">
                  {category === "customer_payment" ? "Khách hàng" : "Nhà cung cấp"}{" "}
                  <span className="text-destructive">*</span>
                </label>
                <Select
                  value={selectedPartyId}
                  onValueChange={(v) => setSelectedPartyId(v ?? "")}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue
                      placeholder={
                        loadingParties
                          ? "Đang tải..."
                          : parties.length === 0
                            ? "Không có đối tượng nào nợ"
                            : `Chọn (${parties.length})`
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {parties.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        <span className="font-medium">{p.name}</span>
                        <span className="text-xs text-muted-foreground ml-2">
                          {p.code} · nợ {formatCurrency(p.debt)}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {selectedPartyId && (
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    {category === "customer_payment" ? "Hoá đơn" : "Phiếu nhập"}
                  </label>
                  <Select
                    value={selectedRefId}
                    onValueChange={(v) => setSelectedRefId(v ?? "")}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue
                        placeholder={
                          loadingRefs
                            ? "Đang tải..."
                            : refDocs.length === 0
                              ? "Không có chứng từ nợ"
                              : `Chọn (${refDocs.length})`
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {refDocs.map((d) => (
                        <SelectItem key={d.id} value={d.id}>
                          <span className="font-mono">{d.code}</span>
                          <span className="text-xs text-muted-foreground ml-2">
                            nợ {formatCurrency(d.debt)} · {d.ageDays}d
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">
                    Chọn chứng từ để hệ thống tự cập nhật công nợ + ghi audit log.
                    Không chọn → tạo phiếu thu/chi thường (không update debt).
                  </p>
                </div>
              )}
            </>
          )}

          <div className="space-y-2">
            <label className="text-sm font-medium">Ghi chú</label>
            <textarea
              className="flex min-h-[60px] w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
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
