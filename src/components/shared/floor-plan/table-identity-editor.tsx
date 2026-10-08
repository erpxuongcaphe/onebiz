"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/lib/contexts/toast-context";
import { composeTableCode, suggestZonePrefix } from "@/lib/fnb/table-label";

interface TableIdentityEditorProps {
  table: { tableNumber?: number; name?: string };
  zoneName?: string;
  onSave: (input: { tableNumber: number; name: string }) => Promise<void>;
}

export function TableIdentityEditor({ table, zoneName = "", onSave }: TableIdentityEditorProps) {
  const { toast } = useToast();
  const [number, setNumber] = useState(String(table.tableNumber ?? ""));
  const [name, setName] = useState(table.name ?? "");
  const existingCode = table.name?.match(/^([A-Z][A-Z0-9_-]{0,7})\s+(\d+)$/i);
  const [prefix, setPrefix] = useState(existingCode?.[1] ?? suggestZonePrefix(zoneName));
  const [ordinal, setOrdinal] = useState(existingCode?.[2] ?? String(table.tableNumber ?? ""));
  const [saving, setSaving] = useState(false);
  const pending = useRef(false);
  useEffect(() => {
    setNumber(String(table.tableNumber ?? ""));
    setName(table.name ?? "");
    const code = table.name?.match(/^([A-Z][A-Z0-9_-]{0,7})\s+(\d+)$/i);
    setPrefix(code?.[1] ?? suggestZonePrefix(zoneName));
    setOrdinal(code?.[2] ?? String(table.tableNumber ?? ""));
  }, [table.tableNumber, table.name, zoneName]);

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
    <div className="grid grid-cols-2 gap-2">
      <div className="space-y-1">
        <Label htmlFor="t-prefix" className="text-sm">Ký hiệu khu vực</Label>
        <Input id="t-prefix" value={prefix} maxLength={8} disabled={saving} placeholder="TN, NS"
          onChange={event => { const value = event.target.value.toUpperCase(); setPrefix(value); setName(composeTableCode(value, ordinal)); }} className="h-9 text-sm uppercase" />
      </div>
      <div className="space-y-1">
        <Label htmlFor="t-ordinal" className="text-sm">Số bàn trong khu</Label>
        <Input id="t-ordinal" value={ordinal} disabled={saving} inputMode="numeric" maxLength={4}
          onChange={event => { setOrdinal(event.target.value); setName(composeTableCode(prefix, event.target.value)); }} className="h-9 text-sm tabular-nums" />
      </div>
    </div>
    <p className="break-words text-base font-semibold" aria-live="polite">{name || "Mã bàn chưa hợp lệ"}</p>
    <details className="text-sm">
      <summary className="cursor-pointer py-1 text-muted-foreground">Thông tin khác</summary>
    <div className="space-y-1">
      <Label htmlFor="t-name" className="text-sm">Tên / mã bàn</Label>
      <Input id="t-name" value={name} disabled={saving} maxLength={50}
        placeholder="TN 01, NS 01"
        onChange={event => setName(event.target.value)} className="h-9 text-sm" />
    </div>
    <div className="space-y-1">
      <Label htmlFor="t-number" className="text-sm">Số thứ tự nội bộ</Label>
      <Input id="t-number" type="number" min={1} max={9999} step={1}
        value={number} disabled={saving} onChange={event => setNumber(event.target.value)} className="h-9 text-sm tabular-nums" />
    </div>
    </details>
    <Button type="button" size="sm" className="w-full gap-1 text-sm" onClick={save}
      disabled={saving || (number === String(table.tableNumber ?? "") && name === (table.name ?? ""))}>
      <Icon name="save" size={14} />{saving ? "Đang lưu..." : "Lưu thông tin bàn"}
    </Button>
  </div>;
}
