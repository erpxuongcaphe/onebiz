"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { loadFnbMenuOrder, saveFnbMenuOrder, moveMenuEntry, type FnbMenuOrder } from "@/lib/services/supabase/fnb-menu-order";

export function FnbMenuOrderDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (next: FnbMenuOrder) => Promise<void> }) {
  const [original, setOriginal] = useState<FnbMenuOrder | null>(null);
  const [draft, setDraft] = useState<FnbMenuOrder | null>(null);
  const [kind, setKind] = useState<"categories" | "products">("categories");
  const [category, setCategory] = useState<string>("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    loadFnbMenuOrder().then(data => { if (active) { setOriginal(data); setDraft(data); setCategory(data.categories[0]?.id ?? ""); } }).catch(err => { if (active) setError(err instanceof Error ? err.message : "Không tải được thực đơn."); });
    return () => { active = false; };
  }, []);
  const visible = draft ? kind === "categories" ? draft.categories : draft.products.filter(row => (row.category_id ?? "") === category) : [];
  const dirty = Boolean(draft && original && (draft.categories.some((row, i) => row.id !== original.categories[i]?.id) || draft.products.some((row, i) => row.id !== original.products[i]?.id)));
  const save = async () => {
    if (!draft || !original || saving) return;
    setSaving(true); setError("");
    try { await saveFnbMenuOrder(original, draft); await onSaved(draft); onClose(); }
    catch (err) { setError(err instanceof Error ? err.message : "Không lưu được. Vui lòng thử lại."); }
    finally { setSaving(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}>
    <DialogContent showCloseButton={false} className="flex max-h-[90dvh] flex-col gap-2 sm:max-w-xl">
      <div className="flex items-center justify-between gap-2"><DialogTitle className="text-lg">Sắp xếp thực đơn POS</DialogTitle><button type="button" disabled={saving} onClick={onClose} aria-label="Đóng sắp xếp" className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-muted"><Icon name="close" /></button></div>
      <DialogDescription>Thứ tự dùng chung cho các chi nhánh. Di chuyển bằng nút lên/xuống, rồi lưu. Danh sách gồm cả món bị ẩn ở quán này; nhóm dùng chung với bán lẻ cũng đổi thứ tự nhóm.</DialogDescription>
      <div className="flex gap-1 rounded-lg bg-primary/5 p-1" role="group" aria-label="Loại sắp xếp">{(["categories", "products"] as const).map(value => <button type="button" key={value} disabled={saving} aria-pressed={kind === value} onClick={() => setKind(value)} className={"min-h-11 flex-1 rounded-md px-3 text-sm font-semibold " + (kind === value ? "bg-primary text-primary-foreground" : "text-foreground")}>{value === "categories" ? "Danh mục" : "Món trong danh mục"}</button>)}</div>
      {kind === "products" && <label className="flex items-center gap-2 text-sm font-medium">Danh mục<select value={category} disabled={saving} onChange={event => setCategory(event.target.value)} className="min-h-11 min-w-0 flex-1 rounded-lg border bg-background px-2 text-base">{draft?.categories.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}<option value="">Chưa phân nhóm</option></select></label>}
      {error && <p role="alert" className="rounded-lg bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
      <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border" aria-busy={!draft && !error}>
        {!draft && !error && <p className="p-3">Đang tải thực đơn…</p>}
        {draft && visible.length === 0 && <p className="p-3 text-muted-foreground">Chưa có món trong danh mục này.</p>}
        {visible.map((row, index) => <div key={row.id} className="flex items-center gap-2 border-b px-2 last:border-b-0"><span className="w-7 shrink-0 text-center text-sm tabular-nums text-muted-foreground">{index + 1}</span><span className="min-w-0 flex-1 py-1 text-base font-medium">{row.name}</span>{(["up", "down"] as const).map(direction => <button type="button" key={direction} aria-label={(direction === "up" ? "Đưa lên: " : "Đưa xuống: ") + row.name} disabled={saving || (direction === "up" ? index === 0 : index === visible.length - 1)} onClick={() => setDraft(current => current ? { ...current, [kind]: moveMenuEntry(current[kind], row.id, direction, kind === "products" ? entry => entry.category_id : undefined) } : current)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-primary hover:bg-primary/10 disabled:text-muted-foreground/40"><Icon name={direction === "up" ? "arrow_upward" : "arrow_downward"} size={20} /></button>)}</div>)}
      </div>
      <div className="flex justify-end gap-2 border-t pt-2"><button type="button" disabled={saving} onClick={onClose} className="min-h-11 rounded-lg border px-4 text-sm font-semibold">Hủy</button><button type="button" disabled={!dirty || saving} onClick={() => void save()} className="min-h-11 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50">{saving ? "Đang lưu…" : "Lưu thứ tự"}</button></div>
    </DialogContent>
  </Dialog>;
}
