"use client";

/**
 * SplitBillDialog — Two modes:
 *  1. "Tách theo món" — Checkbox to select items → move to new bill
 *  2. "Chia đều" — Input N → split equally
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import { Icon } from "@/components/ui/icon";

export interface SplitItem {
  id: string;
  name: string;
  quantity: number;
  unitPrice: number;
}

interface SplitBillDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: SplitItem[];
  onSplitByItems: (itemIds: string[]) => Promise<void>;
  onSplitEqually: (numberOfWays: number) => Promise<void>;
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
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [numberOfWays, setNumberOfWays] = useState(2);
  const [loading, setLoading] = useState(false);

  const toggleItem = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSplitItems = async () => {
    if (selectedIds.size === 0) return;
    setLoading(true);
    try {
      await onSplitByItems(Array.from(selectedIds));
      setSelectedIds(new Set());
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  const handleSplitEqual = async () => {
    if (numberOfWays < 2) return;
    setLoading(true);
    try {
      await onSplitEqually(numberOfWays);
      onOpenChange(false);
    } finally {
      setLoading(false);
    }
  };

  const selectedTotal = items
    .filter((i) => selectedIds.has(i.id))
    .reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);

  const totalAll = items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
  const perPerson = numberOfWays > 0 ? Math.ceil(totalAll / numberOfWays) : 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Icon name="content_cut" className="text-primary" />
            Tách bill
          </DialogTitle>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex gap-1 bg-muted/50 p-1 rounded-lg">
          <button
            type="button"
            onClick={() => setActiveTab("items")}
            className={cn(
              "flex-1 px-3 py-1.5 rounded text-sm font-medium transition-colors",
              activeTab === "items" ? "bg-card shadow-sm" : "text-muted-foreground"
            )}
          >
            <Icon name="content_cut" size={14} className="inline mr-1" />
            Tách theo món
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("equal")}
            className={cn(
              "flex-1 px-3 py-1.5 rounded text-sm font-medium transition-colors",
              activeTab === "equal" ? "bg-card shadow-sm" : "text-muted-foreground"
            )}
          >
            <Icon name="group" size={14} className="inline mr-1" />
            Chia đều
          </button>
        </div>

        {/* Tab content */}
        <div className="py-2">
          {activeTab === "items" && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                Chọn các món muốn tách sang bill mới:
              </p>
              <div className="max-h-64 overflow-y-auto space-y-1">
                {items.map((item) => (
                  <label
                    key={item.id}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2 rounded-md cursor-pointer transition-colors",
                      selectedIds.has(item.id) ? "bg-primary-fixed border border-primary-fixed" : "bg-muted/30 hover:bg-muted/50"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={selectedIds.has(item.id)}
                      onChange={() => toggleItem(item.id)}
                      className="rounded"
                    />
                    <span className="flex-1 text-sm font-medium">{item.quantity}x {item.name}</span>
                    <span className="text-sm text-muted-foreground">
                      {formatCurrency(item.unitPrice * item.quantity)}
                    </span>
                  </label>
                ))}
              </div>
              {selectedIds.size > 0 && (
                <div className="text-sm font-medium text-right">
                  Bill mới: {formatCurrency(selectedTotal)}
                </div>
              )}
            </div>
          )}

          {activeTab === "equal" && (
            <div className="space-y-3">
              <p className="text-xs text-muted-foreground">
                Chia bill đều cho N người — mỗi người thanh toán riêng:
              </p>
              <div>
                <Label>Số người</Label>
                <Input
                  type="number"
                  min={2}
                  max={items.length}
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
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Mỗi người:</span>
                  <span className="font-bold text-lg">{formatCurrency(perPerson)}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Hủy
          </Button>
          {activeTab === "items" ? (
            <Button onClick={handleSplitItems} disabled={selectedIds.size === 0 || loading}>
              {loading && <Icon name="progress_activity" size={16} className="mr-1 animate-spin" />}
              Tách {selectedIds.size} món
            </Button>
          ) : (
            <Button onClick={handleSplitEqual} disabled={numberOfWays < 2 || loading}>
              {loading && <Icon name="progress_activity" size={16} className="mr-1 animate-spin" />}
              Chia {numberOfWays} phần
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
