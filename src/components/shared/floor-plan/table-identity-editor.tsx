"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/lib/contexts/toast-context";

interface TableIdentityEditorProps {
  table: { tableNumber?: number; name?: string };
  onSave: (input: { tableNumber: number; name: string }) => Promise<void>;
}

export function TableIdentityEditor({ table, onSave }: TableIdentityEditorProps) {
  const { toast } = useToast();
  const [number, setNumber] = useState(String(table.tableNumber ?? ""));
  const [name, setName] = useState(table.name ?? "");
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  useEffect(() => {
    setNumber(String(table.tableNumber ?? ""));
    setName(table.name ?? "");
  }, [table.tableNumber, table.name]);

  const save = async () => {
    if (pending.current) return;
    const tableNumber = Number(number);
    if (!number.trim() || !Number.isInteger(tableNumber) || tableNumber < 1 || tableNumber > 9999) {
      toast({ title: "Số bàn phải từ 1 đến 9999", variant: "error" });
      return;
    }
    if (!name.trim()) {
      toast({ title: "Tên bàn không được để trống", variant: "error" });
      return;
    }
    pending.current = true;
    setSaving(true);
    try {
      await onSave({ tableNumber, name: name.trim() });
      toast({ title: "Đã lưu thông tin bàn", variant: "success" });
    } catch (error) {
      toast({ title: "Không lưu được thông tin bàn", variant: "error",
        description: error instanceof Error ? error.message : "Vui lòng thử lại." });
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };

  return <div className="space-y-2 border-b pb-3">
    <p className="text-sm font-semibold">Bàn đang chọn</p>
    <div className="grid grid-cols-[5rem_minmax(0,1fr)] gap-2">
    <div className="space-y-1">
      <Label htmlFor="t-number" className="text-sm">Số bàn</Label>
      <Input id="t-number" type="number" min={1} max={9999} step={1}
        value={number} disabled={saving} onChange={event => setNumber(event.target.value)} className="h-9 text-sm tabular-nums" />
    </div>
    <div className="space-y-1">
      <Label htmlFor="t-name" className="text-sm">Tên bàn</Label>
      <Input id="t-name" value={name} disabled={saving}
        onChange={event => setName(event.target.value)} className="h-9 text-sm" />
    </div>
    </div>
    <Button type="button" size="sm" className="w-full gap-1 text-sm" onClick={save}
      disabled={saving || (number === String(table.tableNumber ?? "") && name === (table.name ?? ""))}>
      <Icon name="save" size={14} />{saving ? "Đang lưu..." : "Lưu thông tin bàn"}
    </Button>
  </div>;
}
