"use client";

/**
 * SplitBillDialog — Two modes:
 *  1. "Tách theo món" — Checkbox to select items → move to new bill
 *  2. "Chia đều" — Input N → split equally
 */

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogBody,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatCurrency, formatNumber } from "@/lib/format";
import { Icon } from "@/components/ui/icon";

export interface SplitQuantitySelection {
  itemId: string;
  quantity: number;
  expectedQuantity: number;
}

export interface SplitItem {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
  detail?: string;
}

interface SplitBillDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: SplitItem[];
  onSplitByItems: (selection: SplitQuantitySelection[], requestId: string) => Promise<boolean>;
  onSplitEqually: (numberOfWays: number) => Promise<boolean>;
}

type Tab = "items" | "equal";

export function SplitBillDialog({
  open,
  onOpenChange,
  items,
  onSplitByItems,
  onSplitEqually,
}: SplitBillDialogProps) {
  const [activeTab, setActiveTab] = useState<Tab>("items");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const requestRef = useRef<{ key: string; id: string } | null>(null);
  const [numberOfWays, setNumberOfWays] = useState(2);
  const [loading, setLoading] = useState(false);
  const [submitError, setSubmitError] = useState(false);
  const submitLock = useRef(false);
  const itemIdentity = items.map(item => `${item.id}:${item.quantity}:${item.unitPrice}`).join("|");
  useEffect(() => {
    if (open && !submitLock.current) {
      setQuantities({});
      requestRef.current = null;
      setSubmitError(false);
      setNumberOfWays(2);
      setActiveTab("items");
    }
  }, [open, itemIdentity]);
  const validNumberOfWays = Number.isInteger(numberOfWays) && numberOfWays >= 2
    && numberOfWays <= Math.min(10, items.length);

  const selectedIds = new Set(items.filter(item => (quantities[item.id] ?? 0) !== 0).map(item => item.id));
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const selectedQuantity = items.reduce((sum, item) => sum + (quantities[item.id] ?? 0), 0);
  const validSelection = selectedQuantity > 0 && selectedQuantity < totalQuantity
    && items.every(item => Number.isInteger(quantities[item.id] ?? 0) && (quantities[item.id] ?? 0) >= 0 && (quantities[item.id] ?? 0) <= item.quantity);
  const changeQuantity = (id: string, quantity: number) => setQuantities(previous => ({ ...previous, [id]: quantity }));
  const toggleItem = (id: string) => changeQuantity(id, selectedIds.has(id) ? 0 : 1);

  const handleSplitItems = async () => {
    if (!validSelection || submitLock.current) return;
    submitLock.current = true;
    setLoading(true);
    setSubmitError(false);
    try {
      const selection = items.filter(item => selectedIds.has(item.id)).map(item => ({ itemId: item.id, quantity: quantities[item.id], expectedQuantity: item.quantity }));
      const key = JSON.stringify(selection);
      if (requestRef.current?.key !== key) requestRef.current = { key, id: crypto.randomUUID() };
      if (!(await onSplitByItems(selection, requestRef.current.id))) {
        setSubmitError(true);
        return;
      }
      setQuantities({});
      requestRef.current = null;
      onOpenChange(false);
    } catch {
      setSubmitError(true);
    } finally {
      submitLock.current = false;
      setLoading(false);
    }
  };

  const handleSplitEqual = async () => {
    if (!validNumberOfWays || submitLock.current) return;
    submitLock.current = true;
    setLoading(true);
    setSubmitError(false);
    try {
      if (!(await onSplitEqually(numberOfWays))) {
        setSubmitError(true);
        return;
      }
      onOpenChange(false);
    } catch {
      setSubmitError(true);
    } finally {
      submitLock.current = false;
      setLoading(false);
    }
  };

  const selectedTotal = items
    .filter((i) => selectedIds.has(i.id))
    .reduce((sum, i) => sum + i.unitPrice * quantities[i.id], 0);

  const totalAll = items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
  const previewBills = validNumberOfWays ? Array.from({ length: numberOfWays }, (_,index) =>
    items.reduce((sum,item,row) => sum + (row % numberOfWays === index ? item.quantity * item.unitPrice : 0),0)
  ) : [];

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!loading) onOpenChange(nextOpen);
    }}>
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="content_cut" className="text-primary" />
            Tách bill
          </DialogTitle>
          <DialogDescription>Giữ món trên bill đang mở và chuyển món đã chọn sang bill mới.</DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-3">
        {/* Tabs */}
        <div className="flex gap-1 bg-muted/50 p-1 rounded-lg">
          <button
            type="button"
            disabled={loading}
            onClick={() => setActiveTab("items")}
            className={cn(
              "flex-1 px-3 py-2 rounded text-sm font-medium transition-colors",
              activeTab === "items" ? "bg-card shadow-none" : "text-muted-foreground"
            )}
          >
            <Icon name="content_cut" size={14} className="inline mr-1" />
            Tách theo món
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => setActiveTab("equal")}
            className={cn(
              "flex-1 px-3 py-2 rounded text-sm font-medium transition-colors",
              activeTab === "equal" ? "bg-card shadow-none" : "text-muted-foreground"
            )}
          >
            <Icon name="group" size={14} className="inline mr-1" />
            Chia nhiều bill
          </button>
        </div>

        {/* Tab content */}
        <div className="py-2">
          {activeTab === "items" && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Chọn món và số lượng chuyển sang bill mới. Mặc định tách 1; món còn lại giữ trên bill đang mở:
              </p>
              <div className="space-y-1">
                {items.map((item) => (
                  <div
                    key={item.id}
                    className={cn(
                      "flex flex-wrap items-center gap-3 px-3 py-2 rounded-lg transition-colors",
                      selectedIds.has(item.id) ? "bg-primary-fixed border border-primary-fixed" : "bg-muted/30 hover:bg-muted/50"
                    )}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Chọn ${item.name}`}
                      disabled={loading}
                      checked={selectedIds.has(item.id)}
                      onChange={() => toggleItem(item.id)}
                      className="rounded"
                    />
                    {/* 06/08: tên món cắt được — TIỀN thì không (shrink-0 + tabular-nums). */}
                    <span className="flex-1 min-w-0 text-sm font-medium"><span className="block break-words">{formatNumber(item.quantity)}x {item.name}</span>{item.detail && <span className="block text-xs font-normal text-muted-foreground">{item.detail}</span>}</span>
                    <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                      {formatCurrency(item.unitPrice * item.quantity)}
                    </span>
                    {selectedIds.has(item.id) && <div className="flex w-full flex-wrap items-center gap-2 border-t border-primary/10 pt-2">
                      <span className="text-xs">Số lượng tách</span>
                      <Button type="button" variant="outline" size="icon" className="h-10 w-10" aria-label={`Giảm số lượng tách ${item.name}`} disabled={loading || quantities[item.id] <= 1} onClick={() => changeQuantity(item.id, quantities[item.id] - 1)}>−</Button>
                      <Input type="number" inputMode="numeric" min={1} max={item.quantity} step={1} aria-label={`Số lượng tách ${item.name}`} aria-invalid={!Number.isInteger(quantities[item.id]) || quantities[item.id] < 1 || quantities[item.id] > item.quantity} value={Number.isNaN(quantities[item.id]) ? "" : quantities[item.id]} disabled={loading} onChange={event => changeQuantity(item.id, event.target.value === "" ? NaN : Number(event.target.value))} className="h-10 w-16 text-center" />
                      <Button type="button" variant="outline" size="icon" className="h-10 w-10" aria-label={`Tăng số lượng tách ${item.name}`} disabled={loading || quantities[item.id] >= item.quantity} onClick={() => changeQuantity(item.id, quantities[item.id] + 1)}>+</Button>
                      <span className="text-xs text-muted-foreground">/ {formatNumber(item.quantity)} · Còn lại: {formatNumber(Math.max(0,item.quantity - (quantities[item.id] || 0)))}</span>
                      <span className="ml-auto text-sm font-semibold tabular-nums">{formatCurrency(item.unitPrice * (quantities[item.id] || 0))}đ</span>
                    </div>}
                  </div>
                ))}
              </div>
              {selectedQuantity >= totalQuantity && <p role="alert" className="text-sm text-destructive">Giữ lại ít nhất 1 món trên bill cũ. Nếu chuyển toàn bộ, dùng Chuyển bàn.</p>}
              {selectedIds.size > 0 && (
                <div className="text-sm font-medium text-right">
                  Giá trị món chọn: {formatCurrency(Number.isFinite(selectedTotal) ? selectedTotal : 0)}đ · trước giảm giá
                </div>
              )}
            </div>
          )}

          {activeTab === "equal" && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Phân các dòng món lần lượt sang nhiều bill. Mỗi dòng giữ nguyên số lượng; tiền các bill có thể khác nhau.
              </p>
              <div>
                <Label htmlFor="split-number-of-bills">Số bill</Label>
                <Input
                  type="number"
                  id="split-number-of-bills"
                  min={2}
                  max={Math.min(10, items.length)}
                  step={1}
                  disabled={loading}
                  value={numberOfWays}
                  onChange={(e) => setNumberOfWays(Number(e.target.value) || 2)}
                  className="mt-1 w-32"
                />
              </div>
              <div className="bg-muted/50 rounded-lg p-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tổng:</span>
                  <span className="font-medium">{formatCurrency(totalAll)}</span>
                </div>
                {previewBills.map((value,index) => <div key={index} className="flex justify-between gap-3"><span className="text-muted-foreground">Bill {index+1}{index===0 ? " (đang mở)" : " (mới)"}:</span><span className="font-semibold text-primary tabular-nums">{formatCurrency(value)}đ</span></div>)}
                <p className="text-xs text-muted-foreground">Giá trị món trước giảm giá. Giảm giá của bill sẽ được phân bổ theo giá trị món.</p>
              </div>
            </div>
          )}
        </div>

        {submitError && <p role="alert" className="text-sm text-destructive">Chưa xác nhận được kết quả tách bill. Kiểm tra danh sách đơn trước khi thử lại.</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" disabled={loading} onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          {activeTab === "items" ? (
            <Button onClick={handleSplitItems} disabled={!validSelection || loading}>
              {loading && <Icon name="progress_activity" size={16} className="mr-1 animate-spin" />}
              Tách {selectedIds.size} món
            </Button>
          ) : (
            <Button onClick={handleSplitEqual} disabled={!validNumberOfWays || loading}>
              {loading && <Icon name="progress_activity" size={16} className="mr-1 animate-spin" />}
              Chia {numberOfWays} phần
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
