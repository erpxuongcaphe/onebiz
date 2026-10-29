"use client";

import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { OperationalQuantityInput } from "@/components/shared/operational-quantity-input";
import { formatCurrency, formatStockQuantity } from "@/lib/format";
import type { UOMConversion } from "@/lib/types";

/** A quantity-entry aid. Cart, pricing, promotions and posting retain their canonical unit contract. */
export function PosUnitQuantityDialog({ name, unit, quantity, unitPrice, conversions, onClose, onApply }: {
  name: string; unit: string; quantity: number; unitPrice: number; conversions: UOMConversion[];
  onClose: () => void; onApply: (quantity: number) => void;
}) {
  const [nextQuantity, setNextQuantity] = useState(quantity);
  const valid = Number.isFinite(nextQuantity) && nextQuantity > 0;
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="sm:max-w-md">
      <DialogHeader><DialogTitle>Số lượng · {name}</DialogTitle><DialogDescription>Chọn đơn vị nhập. Giỏ hàng và hóa đơn hiển thị theo {unit}.</DialogDescription></DialogHeader>
      <OperationalQuantityInput label={`Số lượng ${name}`} quantity={nextQuantity} unit={unit} conversions={conversions} onChange={setNextQuantity} />
      <div className="rounded-md bg-muted/40 p-3 text-sm tabular-nums">
        <p>{valid ? formatStockQuantity(nextQuantity) : "—"} {unit} × {formatCurrency(unitPrice)} / {unit}</p>
        <p className="mt-1 font-semibold">Thành tiền: {valid ? formatCurrency(nextQuantity * unitPrice) : "—"}</p>
      </div>
      <DialogFooter><Button variant="outline" onClick={onClose}>Hủy</Button><Button disabled={!valid} onClick={() => { onApply(nextQuantity); onClose(); }}>Áp dụng</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
