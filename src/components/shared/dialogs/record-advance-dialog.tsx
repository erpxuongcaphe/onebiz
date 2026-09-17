"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/lib/contexts";
import { formatCurrency } from "@/lib/format";
import {
  recordCustomerAdvance,
  recordSupplierAdvance,
} from "@/lib/services/supabase/payments";
import { getCustomers, getSuppliers } from "@/lib/services/supabase";

interface RecordAdvanceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  mode: "customer" | "supplier";
  partyId?: string;
  partyName?: string;
  branchId?: string | null;
}

interface PartyOption {
  id: string;
  code?: string;
  name: string;
  phone?: string;
}

const METHODS = [
  { value: "cash", label: "Tiền mặt" },
  { value: "transfer", label: "Chuyển khoản" },
  { value: "card", label: "Thẻ" },
  { value: "ewallet", label: "Ví điện tử" },
] as const;

export function RecordAdvanceDialog({
  open,
  onOpenChange,
  onSuccess,
  mode,
  partyId,
  partyName,
  branchId,
}: RecordAdvanceDialogProps) {
  const { toast } = useToast();
  const [amount, setAmount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState<
    "cash" | "transfer" | "card" | "ewallet"
  >("transfer");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [partySearch, setPartySearch] = useState("");
  const [selectedParty, setSelectedParty] = useState<PartyOption | null>(null);
  const [partyOptions, setPartyOptions] = useState<PartyOption[]>([]);
  const [searchingParty, setSearchingParty] = useState(false);
  const isCustomer = mode === "customer";

  useEffect(() => {
    if (!open) return;
    setAmount(0);
    setPaymentMethod("transfer");
    setNote("");
    setErrors({});
    setSaving(false);
    setSelectedParty(
      partyId && partyName ? { id: partyId, name: partyName } : null,
    );
    setPartySearch(partyName ?? "");
    setPartyOptions([]);
  }, [open, partyId, partyName]);

  useEffect(() => {
    if (!open || selectedParty || partySearch.trim().length < 1) {
      setPartyOptions([]);
      setSearchingParty(false);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(async () => {
      setSearchingParty(true);
      try {
        const params = {
          page: 0,
          pageSize: 8,
          search: partySearch.trim(),
          filters: {},
          sortBy: "name",
          sortOrder: "asc" as const,
        };
        const result = isCustomer
          ? await getCustomers(params)
          : await getSuppliers(params);
        if (!cancelled) {
          setPartyOptions(
            result.data.map((party) => ({
              id: party.id,
              code: party.code,
              name: party.name,
              phone: party.phone ?? undefined,
            })),
          );
        }
      } catch {
        if (!cancelled) setPartyOptions([]);
      } finally {
        if (!cancelled) setSearchingParty(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [isCustomer, open, partySearch, selectedParty]);

  async function handleSave() {
    const nextErrors: Record<string, string> = {};
    if (!branchId)
      nextErrors.branch = "Hãy chọn một chi nhánh cụ thể trước khi ghi nhận.";
    if (!selectedParty) {
      nextErrors.party = isCustomer
        ? "Hãy chọn khách hàng nhận tiền cọc"
        : "Hãy chọn nhà cung cấp nhận tiền ứng trước";
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      nextErrors.amount = "Số tiền phải lớn hơn 0";
    }
    if (note.trim().length < 3) {
      nextErrors.note = "Nhập lý do để đối soát khoản trả trước";
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || !branchId || !selectedParty)
      return;

    setSaving(true);
    try {
      const record = isCustomer ? recordCustomerAdvance : recordSupplierAdvance;
      const result = await record({
        partyId: selectedParty.id,
        branchId,
        amount,
        paymentMethod,
        note: note.trim(),
      });
      toast({
        title: isCustomer
          ? "Đã ghi nhận khách trả trước"
          : "Đã ghi nhận ứng trước NCC",
        description: `${result.cashCode} — ${formatCurrency(result.advanceAmount)}. Số dư được theo dõi riêng theo chi nhánh.`,
        variant: "success",
      });
      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      toast({
        title: "Không ghi nhận được tiền trả trước",
        description:
          error instanceof Error ? error.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon
              name={isCustomer ? "savings" : "account_balance_wallet"}
              size={19}
            />
            {isCustomer ? "Khách thanh toán trước" : "Ứng trước nhà cung cấp"}
          </DialogTitle>
          <DialogDescription>
            Khoản này được treo riêng theo đối tượng và chi nhánh, không làm âm
            hóa đơn hoặc phiếu nhập.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {errors.branch && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {errors.branch}
            </p>
          )}
          <div className="space-y-1.5">
            <label htmlFor="advance-party" className="text-sm font-medium">
              {isCustomer ? "Khách hàng" : "Nhà cung cấp"}{" "}
              <span className="text-destructive">*</span>
            </label>
            {selectedParty ? (
              <div className="flex min-h-10 items-center justify-between gap-3 rounded-md border bg-muted/30 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {selectedParty.name}
                  </p>
                  {selectedParty.code && (
                    <p className="text-xs text-muted-foreground">
                      {selectedParty.code}
                    </p>
                  )}
                </div>
                {!partyId && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setSelectedParty(null);
                      setPartySearch("");
                    }}
                  >
                    Đổi
                  </Button>
                )}
              </div>
            ) : (
              <div className="relative">
                <Input
                  id="advance-party"
                  value={partySearch}
                  onChange={(event) => {
                    setPartySearch(event.target.value);
                    if (errors.party)
                      setErrors((current) => ({ ...current, party: "" }));
                  }}
                  autoComplete="off"
                  placeholder={
                    isCustomer
                      ? "Tìm theo mã, tên hoặc SĐT khách hàng"
                      : "Tìm theo mã, tên hoặc SĐT nhà cung cấp"
                  }
                  aria-invalid={Boolean(errors.party)}
                />
                {partySearch.trim() && (
                  <div className="absolute z-50 mt-1 max-h-52 w-full overflow-y-auto rounded-md border bg-popover shadow-lg">
                    {searchingParty ? (
                      <div className="flex items-center gap-2 px-3 py-2 text-sm text-muted-foreground">
                        <Icon
                          name="progress_activity"
                          size={15}
                          className="animate-spin"
                        />
                        Đang tìm...
                      </div>
                    ) : partyOptions.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-muted-foreground">
                        Không tìm thấy đối tượng phù hợp
                      </div>
                    ) : (
                      partyOptions.map((party) => (
                        <button
                          key={party.id}
                          type="button"
                          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-accent"
                          onClick={() => {
                            setSelectedParty(party);
                            setPartySearch(party.name);
                            setPartyOptions([]);
                            setErrors((current) => ({ ...current, party: "" }));
                          }}
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium">
                              {party.name}
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              {party.code}
                            </span>
                          </span>
                          {party.phone && (
                            <span className="shrink-0 text-xs text-muted-foreground">
                              {party.phone}
                            </span>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}
            {errors.party && (
              <p className="text-xs text-destructive">{errors.party}</p>
            )}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="advance-amount" className="text-sm font-medium">
              Số tiền <span className="text-destructive">*</span>
            </label>
            <Input
              id="advance-amount"
              type="number"
              min={0}
              step={1000}
              inputMode="numeric"
              value={amount || ""}
              onChange={(event) => {
                setAmount(Number(event.target.value) || 0);
                if (errors.amount)
                  setErrors((current) => ({ ...current, amount: "" }));
              }}
              aria-invalid={Boolean(errors.amount)}
              placeholder="Nhập số tiền trả trước"
            />
            {errors.amount && (
              <p className="text-xs text-destructive">{errors.amount}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium">Hình thức</label>
            <Select
              value={paymentMethod}
              onValueChange={(value) =>
                setPaymentMethod(
                  value as "cash" | "transfer" | "card" | "ewallet",
                )
              }
              items={[...METHODS]}
            >
              <SelectTrigger className="w-full">
                <SelectValue>
                  {(value) =>
                    METHODS.find((item) => item.value === value)?.label ?? ""
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {METHODS.map((method) => (
                  <SelectItem key={method.value} value={method.value}>
                    {method.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <label htmlFor="advance-note" className="text-sm font-medium">
              Lý do <span className="text-destructive">*</span>
            </label>
            <Input
              id="advance-note"
              value={note}
              onChange={(event) => {
                setNote(event.target.value);
                if (errors.note)
                  setErrors((current) => ({ ...current, note: "" }));
              }}
              aria-invalid={Boolean(errors.note)}
              placeholder={
                isCustomer
                  ? "VD: Khách đặt cọc đơn tháng 9"
                  : "VD: Ứng trước lô nguyên liệu tháng 9"
              }
            />
            {errors.note && (
              <p className="text-xs text-destructive">{errors.note}</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Hủy
          </Button>
          <Button onClick={handleSave} disabled={saving || !branchId}>
            {saving && (
              <Icon
                name="progress_activity"
                size={16}
                className="mr-2 animate-spin"
              />
            )}
            {isCustomer ? "Ghi nhận tiền cọc" : "Ghi nhận ứng trước"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
