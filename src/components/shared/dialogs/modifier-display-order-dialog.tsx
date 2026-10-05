"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { moveModifierId } from "@/lib/modifier-display-order";
import { saveModifierDisplayOrder } from "@/lib/services/supabase/modifier-groups";
import { useToast } from "@/lib/contexts";

interface Props {
  kind: "groups" | "options";
  parentId?: string;
  title: string;
  rows: { id: string; name: string; sortOrder: number }[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}

export function ModifierDisplayOrderDialog({ kind, parentId, title, rows, onClose, onSaved }: Props) {
  const { toast } = useToast();
  const [ids, setIds] = useState(() => rows.map(row => row.id));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const names = new Map(rows.map(row => [row.id, row.name]));
  const changed = ids.some((id, index) => id !== rows[index]?.id);
  async function save() {
    if (lock.current || !changed) return;
    lock.current = true;
    setSaving(true);
    setError(null);
    try {
      await saveModifierDisplayOrder(kind, parentId ?? null, rows, ids);
      onClose();
      try {
        await onSaved();
      } catch {
        toast({ variant: "warning", title: "Thứ tự đã lưu", description: "Chưa tải lại được danh sách. Tải lại trang để xem thứ tự mới." });
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không lưu được thứ tự. Vui lòng thử lại.");
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}>
    <DialogContent className="flex max-h-[90dvh] flex-col sm:max-w-lg">
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>
        {kind === 'groups' ? 'Các món và nhóm hàng chọn Theo thứ tự chung sẽ tự dùng thứ tự này.' : 'Mọi món dùng nhóm này sẽ dùng chung thứ tự lựa chọn.'}
        {' '}Đưa lên/xuống để xem trước, rồi lưu. Giá, công thức và mặc định chọn giữ nguyên.
      </DialogDescription></DialogHeader>
      <ol className="min-h-0 overflow-y-auto divide-y rounded-md border" aria-label="Thứ tự hiển thị">
        {ids.map((id, index) => <li key={id} className="flex items-center gap-2 px-3 py-1">
          <span className="w-5 text-sm tabular-nums text-muted-foreground">{index + 1}</span>
          <span className="min-w-0 flex-1 text-sm font-medium">{names.get(id)}</span>
          <Button type="button" variant="ghost" className="size-11 shrink-0 p-0" disabled={saving || index === 0}
            aria-label={`Đưa ${names.get(id)} lên`} onClick={() => setIds(previous => moveModifierId(previous, id, -1))}><Icon name="arrow_upward" size={18} /></Button>
          <Button type="button" variant="ghost" className="size-11 shrink-0 p-0" disabled={saving || index === ids.length - 1}
            aria-label={`Đưa ${names.get(id)} xuống`} onClick={() => setIds(previous => moveModifierId(previous, id, 1))}><Icon name="arrow_downward" size={18} /></Button>
        </li>)}
      </ol>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <DialogFooter><Button variant="outline" disabled={saving} onClick={onClose}>Hủy</Button>
        <Button disabled={saving || !changed} onClick={() => void save()}>{saving ? 'Đang lưu…' : 'Lưu thứ tự'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
