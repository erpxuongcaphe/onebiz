"use client";

import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { layoutContent, moveLayoutRow, rankMenuRows, type FnbPosLayout } from "@/lib/fnb-pos-layout";
import { loadFnbLayoutEditor, saveFnbPosLayout, type LayoutCategory, type LayoutProduct } from "@/lib/services/supabase/fnb-pos-layout";

type Row = LayoutCategory | LayoutProduct;
const iconClass = "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-primary hover:bg-primary/10 disabled:text-muted-foreground/40";

export function FnbMenuOrderDialog({ branchId, branchName, onClose, onSaved }: {
  branchId: string; branchName: string; onClose: () => void; onSaved: (layout: FnbPosLayout) => void;
}) {
  const [original, setOriginal] = useState<FnbPosLayout | null>(null);
  const [draft, setDraft] = useState<FnbPosLayout | null>(null);
  const [catalog, setCatalog] = useState<{ categories: LayoutCategory[]; products: LayoutProduct[] }>({ categories: [], products: [] });
  const [kind, setKind] = useState<"categories" | "products">("products");
  const [category, setCategory] = useState("");
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [dragging, setDragging] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const drag = useRef<{ id: string; target: string } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [announcement, setAnnouncement] = useState("");
  useEffect(() => {
    let active = true;
    loadFnbLayoutEditor(branchId).then(data => {
      if (!active) return;
      const resolved = { ...data.layout,
        categoryIds: rankMenuRows(data.categories, data.layout.categoryIds).map(row => row.id),
        productIds: rankMenuRows(data.products, data.layout.productIds).map(row => row.id),
        hiddenIds: data.layout.hiddenIds.filter(id => data.products.some(row => row.id === id)),
      };
      setCatalog(data); setOriginal(resolved); setDraft(resolved); setCategory(resolved.categoryIds[0] ?? "");
    }).catch(err => { if (active) setError(err instanceof Error ? err.message : "Không tải được thực đơn."); });
    return () => { active = false; };
  }, [branchId]);
  const categories = draft ? rankMenuRows(catalog.categories, draft.categoryIds) : [];
  const products = draft ? rankMenuRows(catalog.products, draft.productIds) : [];
  const hidden = new Set(draft?.hiddenIds ?? []);
  const visible: Row[] = kind === "categories" ? categories : products.filter(row =>
    (adding ? hidden.has(row.id) : !hidden.has(row.id) && (row.category_id ?? "") === category) &&
    row.name.toLocaleLowerCase("vi").includes(search.trim().toLocaleLowerCase("vi")));
  const dirty = Boolean(draft && original && layoutContent(draft) !== layoutContent(original));
  const move = (from: string, to: string) => {
    if (!draft || from === to || saving || adding) return;
    const changed = moveLayoutRow(visible, from, to);
    const replacement = new Map(visible.map((row, index) => [row.id, changed[index].id]));
    const key = kind === "categories" ? "categoryIds" : "productIds";
    setDraft({ ...draft, [key]: draft[key].map(id => replacement.get(id) ?? id) });
    setAnnouncement(`Đã di chuyển ${visible.find(row => row.id === from)?.name ?? "món"}`);
  };
  const save = async () => {
    if (!draft || !original || saving) return;
    setSaving(true); setError("");
    try { const saved = await saveFnbPosLayout(branchId, original, draft); onSaved(saved); onClose(); }
    catch (err) { setError(err instanceof Error ? err.message : "Không lưu được bố trí."); }
    finally { setSaving(false); }
  };
  return <Dialog open trackFormChanges={false} hasUnsavedChanges={dirty} onOpenChange={open => { if (!open && !saving) onClose(); }}>
    <DialogContent showCloseButton={false} className="flex max-h-[92dvh] flex-col gap-2 p-3 sm:max-w-2xl sm:p-4">
      <div className="flex items-center gap-1">
        <div className="min-w-0 flex-1"><DialogTitle className="text-base">Chỉnh thực đơn</DialogTitle><DialogDescription className="truncate text-xs">{branchName} · Chỉ áp dụng tại chi nhánh này</DialogDescription></div>
        <button type="button" disabled={!draft || saving} title="Lấy thứ tự mẫu dùng chung" aria-label="Lấy thứ tự mẫu dùng chung" className={iconClass}
          onClick={() => { if (draft) { setDraft({ ...draft, categoryIds: catalog.categories.map(row => row.id), productIds: catalog.products.map(row => row.id), hiddenIds: [] }); setAnnouncement("Đã lấy bố trí mẫu. Bấm lưu để áp dụng tại chi nhánh này."); } }}><Icon name="content_copy" /></button>
        <button type="button" data-dialog-close disabled={saving} onClick={onClose} title="Hủy" aria-label="Hủy" className={iconClass}><Icon name="close" /></button>
        <button type="button" disabled={!dirty || saving} onClick={() => void save()} title="Lưu bố trí" aria-label="Lưu bố trí" className={iconClass + " bg-primary/10"}><Icon name={saving ? "progress_activity" : "check"} className={saving ? "animate-spin" : ""} /></button>
      </div>
      <div className="flex gap-1 rounded-lg bg-muted p-1" role="group" aria-label="Loại sắp xếp">
        {(["categories", "products"] as const).map(value => <button key={value} type="button" disabled={saving} aria-pressed={kind === value} onClick={() => { setKind(value); setAdding(false); setSearch(""); }}
          className={"min-h-11 flex-1 rounded-md px-2 text-sm font-medium " + (kind === value ? "bg-primary text-primary-foreground" : "")}>{value === "categories" ? "Danh mục" : "Món"}</button>)}
      </div>
      {kind === "products" && <div className="flex items-center gap-1">
        {adding ? <input aria-label="Tìm món thêm lại" placeholder="Tìm món thêm lại…" value={search} onChange={event => setSearch(event.target.value)} className="h-11 min-w-0 flex-1 rounded-lg border bg-background px-3 text-base" /> :
          <select aria-label="Danh mục" value={category} disabled={saving} onChange={event => setCategory(event.target.value)} className="h-11 min-w-0 flex-1 rounded-lg border bg-background px-2 text-base">{categories.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}<option value="">Chưa phân nhóm</option></select>}
        <button type="button" disabled={!draft || saving} aria-pressed={adding} title={adding ? "Về danh sách món" : "Thêm món vào bố trí"} aria-label={adding ? "Về danh sách món" : "Thêm món vào bố trí"} onClick={() => { setAdding(!adding); setSearch(""); }} className={iconClass}><Icon name={adding ? "arrow_back" : "add"} /></button>
      </div>}
      {error && <p role="alert" className="rounded-lg bg-destructive/10 p-2 text-sm text-destructive">{error}</p>}
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto rounded-lg border" aria-label="Danh sách bố trí" aria-busy={!draft && !error}>
        {!draft && !error && <p className="p-3 text-sm">Đang tải…</p>}
        {draft && !visible.length && <p className="p-3 text-sm text-muted-foreground">{adding ? "Không có món cần thêm lại. Món mới đủ điều kiện bán sẽ tự xuất hiện." : "Chưa có món. Bấm + để thêm lại món đã bỏ khỏi bố trí."}</p>}
        {visible.map((row, index) => <div key={row.id} data-layout-row={row.id} className={"flex min-h-12 items-center gap-1 border-b px-1 last:border-b-0 " + (target === row.id ? "bg-primary/10 ring-1 ring-inset ring-primary" : "") + (dragging === row.id ? " opacity-60" : "")}>
          {!adding && <button type="button" disabled={saving} aria-label={`Kéo để di chuyển: ${row.name}`} title="Kéo để di chuyển" className={iconClass + " touch-none cursor-grab text-muted-foreground"}
            onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = { id: row.id, target: row.id }; setDragging(row.id); }}
            onPointerMove={event => { if (!drag.current) return; const el = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-layout-row]"); const id = el?.dataset.layoutRow; if (id && visible.some(item => item.id === id)) { drag.current.target = id; setTarget(id); } const bounds = listRef.current?.getBoundingClientRect(); if (bounds && listRef.current) { if (event.clientY < bounds.top + 40) listRef.current.scrollTop -= 12; if (event.clientY > bounds.bottom - 40) listRef.current.scrollTop += 12; } }}
            onPointerUp={() => { if (drag.current) move(drag.current.id, drag.current.target); drag.current = null; setDragging(null); setTarget(null); }}
            onPointerCancel={() => { drag.current = null; setDragging(null); setTarget(null); }}><Icon name="drag_indicator" /></button>}
          <span className="min-w-0 flex-1 py-1 text-sm font-medium">{row.name}</span>
          {!adding && (["up", "down"] as const).map(direction => <button key={direction} type="button" title={direction === "up" ? "Đưa lên" : "Đưa xuống"} aria-label={`${direction === "up" ? "Đưa lên" : "Đưa xuống"}: ${row.name}`} disabled={saving || (direction === "up" ? index === 0 : index === visible.length - 1)} className={iconClass}
            onClick={() => move(row.id, visible[index + (direction === "up" ? -1 : 1)].id)}><Icon name={direction === "up" ? "arrow_upward" : "arrow_downward"} size={18} /></button>)}
          {kind === "products" && <button type="button" disabled={saving} title={adding ? "Thêm vào bố trí" : "Bỏ khỏi bố trí"} aria-label={`${adding ? "Thêm vào bố trí" : "Bỏ khỏi bố trí"}: ${row.name}`} className={iconClass}
            onClick={() => { if (draft) setDraft({ ...draft, hiddenIds: adding ? draft.hiddenIds.filter(id => id !== row.id) : [...draft.hiddenIds, row.id] }); }}><Icon name={adding ? "add" : "remove"} /></button>}
        </div>)}
      </div>
      <p className="text-xs text-muted-foreground">Kéo tay nắm hoặc dùng ↑↓. Dấu − chỉ bỏ khỏi bố trí; không ngừng bán món.</p>
      <span role="status" className="sr-only">{announcement}</span>
    </DialogContent>
  </Dialog>;
}
