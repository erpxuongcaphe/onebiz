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
import { Search, Loader2 } from "lucide-react";
import { formatCurrency } from "@/lib/format";
import { useToast } from "@/lib/contexts";
import { getClient } from "@/lib/services/supabase/base";
import {
  applyManualStockMovement,
  nextEntityCode,
} from "@/lib/services/supabase/stock-adjustments";

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

// Placeholder shown in the dialog header before save. Real code is generated
// via `next_code('purchase_return')` at save time.
const PENDING_CODE_PLACEHOLDER = "THN —";

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

  useEffect(() => {
    if (open) {
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
    }
  }, [open]);

  // Live search purchase orders
  useEffect(() => {
    if (!poSearch || poSearch.length < 1) { setFilteredPOs([]); return; }
    const timer = setTimeout(async () => {
      const supabase = getClient();
      const { data } = await supabase
        .from("purchase_orders")
        .select("id, code, supplier_id, supplier_name")
        .ilike("code", `%${poSearch}%`)
        .in("status", ["completed", "partial"])
        .limit(8);
      setFilteredPOs((data ?? []).map(po => ({
        id: po.id,
        code: po.code,
        supplier_id: po.supplier_id,
        supplier_name: po.supplier_name,
      })));
    }, 300);
    return () => clearTimeout(timer);
  }, [poSearch]);

  // Load PO items when PO selected
  async function loadPOItems(poId: string) {
    const supabase = getClient();
    const { data } = await supabase
      .from("purchase_order_items")
      .select("id, product_id, product_name, unit, quantity, unit_price, total")
      .eq("purchase_order_id", poId);
    setPOItems(
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
    setPOItems(
      poItems.map((item) =>
        item.id === id ? { ...item, selected: !item.selected } : item
      )
    );
  }

  function updateReturnQty(id: string, qty: number) {
    setPOItems(
      poItems.map((item) =>
        item.id === id ? { ...item, returnQty: Math.min(Math.max(1, qty), item.quantity) } : item
      )
    );
  }

  const selectedItems = useMemo(() => poItems.filter(i => i.selected), [poItems]);

  const returnTotal = useMemo(
    () => selectedItems.reduce((sum, item) => sum + item.returnQty * item.unit_price, 0),
    [selectedItems]
  );

  function validate(): boolean {
    const newErrors: Record<string, string> = {};
    if (!selectedPO) newErrors.po = "Vui lòng chọn đơn nhập hàng";
    if (selectedItems.length === 0) newErrors.items = "Vui lòng chọn ít nhất một sản phẩm để trả";
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }

  async function handleSave() {
    if (!validate()) return;
    setSaving(true);
    try {
      const realCode = await nextEntityCode("purchase_return");
      setCode(realCode);

      await applyManualStockMovement(
        selectedItems.map((item) => ({
          productId: item.product_id,
          quantity: item.returnQty,
          type: "out",
          referenceType: "purchase_return",
          referenceId: selectedPO!.id,
          note: `${realCode} - Trả hàng nhập ${selectedPO!.code}${reason ? ` - ${reason}` : ""}${notes ? ` - ${notes}` : ""}`,
        }))
      );

      onOpenChange(false);
      toast({
        title: "Tạo phiếu trả hàng nhập thành công",
        description: `Đã tạo phiếu trả hàng nhập ${realCode}`,
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
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Tạo phiếu trả hàng nhập</DialogTitle>
          <DialogDescription>
            Mã phiếu trả: {code}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          {/* PO search */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">
              Đơn nhập hàng <span className="text-destructive">*</span>
            </label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={poSearch}
                onChange={(e) => {
                  setPOSearch(e.target.value);
                  setShowPODropdown(true);
                }}
                onFocus={() => setShowPODropdown(true)}
                onBlur={() => setTimeout(() => setShowPODropdown(false), 200)}
                placeholder="Tìm đơn nhập hàng theo mã..."
                className="pl-8"
                aria-invalid={!!errors.po}
              />
              {showPODropdown && poSearch && (
                <div className="absolute z-10 mt-1 w-full rounded-lg border bg-popover shadow-md max-h-40 overflow-y-auto">
                  {filteredPOs.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      Không tìm thấy đơn nhập hàng
                    </div>
                  ) : (
                    filteredPOs.map((po) => (
                      <button
                        key={po.id}
                        type="button"
                        className="flex w-full items-center justify-between px-3 py-2 text-sm hover:bg-accent cursor-pointer"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setSelectedPO(po);
                          setPOSearch(po.code);
                          setShowPODropdown(false);
                          loadPOItems(po.id);
                        }}
                      >
                        <span className="font-medium">{po.code}</span>
                        <span className="text-muted-foreground">{po.supplier_name}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
            {errors.po && (
              <p className="text-xs text-destructive">{errors.po}</p>
            )}
          </div>

          {/* Selected PO info */}
          {selectedPO && (
            <div className="rounded-lg border p-3 bg-muted/30 text-sm">
              <span className="text-muted-foreground">Nhà cung cấp: </span>
              <span className="font-medium">{selectedPO.supplier_name}</span>
            </div>
          )}

          {/* PO items to select for return */}
          {poItems.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Chọn sản phẩm trả <span className="text-destructive">*</span>
              </label>
              <div className="rounded-lg border overflow-hidden">
                <div className="grid grid-cols-[32px_1fr_70px_100px_100px] gap-2 px-3 py-2 bg-muted/50 text-xs font-medium text-muted-foreground">
                  <span />
                  <span>Sản phẩm</span>
                  <span className="text-center">SL nhập</span>
                  <span className="text-center">SL trả</span>
                  <span className="text-right">Đơn giá</span>
                </div>
                {poItems.map((item) => (
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

          {/* Return total */}
          {selectedItems.length > 0 && (
            <div className="space-y-3 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <span className="font-medium">Tổng tiền trả</span>
                <span className="text-lg font-semibold text-primary">
                  {formatCurrency(returnTotal)}
                </span>
              </div>
            </div>
          )}

          {/* Reason */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Lý do trả hàng</label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Nhập lý do trả hàng nhập"
            />
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">Ghi chú</label>
            <textarea
              className="flex min-h-[50px] w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ghi chú phiếu trả hàng nhập"
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
            Tạo phiếu trả
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
