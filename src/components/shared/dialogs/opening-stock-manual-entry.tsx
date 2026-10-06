"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/contexts";
import { Input } from "@/components/ui/input";
import { NumericInput } from "@/components/ui/numeric-input";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { formatCurrency } from "@/lib/format";
import { searchOpeningStockCandidates, type OpeningStockCandidate } from "@/lib/services/supabase/opening-stock";
import type { InitialStockImportRow } from "@/lib/excel/schemas";

type Line = OpeningStockCandidate & { quantity: number | null; cost: number | null; lot: string; expiry: string; note: string };
export type OpeningEntrySummary = { count: number; value: number; incomplete: number };
const rowGrid = "md:grid md:grid-cols-[minmax(0,1fr)_110px_135px_120px_44px] md:items-start md:gap-3";

export function OpeningStockManualEntry({ onPreview, busy, contextContent, onSummary }: {
  onPreview: (rows: InitialStockImportRow[]) => Promise<void>; busy: boolean;
  contextContent?: ReactNode; onSummary?: (summary: OpeningEntrySummary) => void;
}) {
  const { branches, activeBranchId } = useAuth();
  const [branchId, setBranchId] = useState(activeBranchId ?? "");
  const branch = branches.find(item => item.id === branchId);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<OpeningStockCandidate[]>([]);
  const [status, setStatus] = useState("");
  const [activeResult, setActiveResult] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [showCompleted, setShowCompleted] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);
  const count = lines.length;
  const incomplete = lines.filter(line => line.quantity === null || line.cost === null).length;
  const value = lines.reduce((sum, line) => sum + (line.quantity ?? 0) * (line.cost ?? 0), 0);
  useEffect(() => { onSummary?.({ count, value, incomplete }); }, [count, value, incomplete, onSummary]);
  useEffect(()=>{if(results[activeResult])document.getElementById(`opening-option-${results[activeResult].id}`)?.scrollIntoView?.({block:"nearest"});},[activeResult,results]);
  useEffect(() => {
    if (!branchId || !search.trim()) { setResults([]); setStatus(""); return; }
    let cancelled = false;
    setStatus("Đang tìm hàng..."); setResults([]);
    const timer = setTimeout(() => {
      void searchOpeningStockCandidates(branchId, search).then(rows => {
        if (cancelled) return;
        setResults(rows); setActiveResult(0); setStatus(rows.length ? "" : "Không tìm thấy hàng giữ tồn. Thử mã hoặc tên khác.");
      }).catch(reason => { if (!cancelled) setStatus(reason instanceof Error ? reason.message : "Không tìm được hàng."); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [branchId, search]);
  function update(id: string, patch: Partial<Line>) {
    setLines(previous => previous.map(line => line.id === id ? { ...line, ...patch } : line)); setError("");
  }
  function add(item: OpeningStockCandidate) {
    if (count >= 1000) return;
    if (lines.some(line => line.id === item.id)) { setStatus(`${item.code} đã có trong danh sách.`); return; }
    setLines(previous => [...previous, { ...item, quantity: null, cost: null, lot: "", expiry: "", note: "" }]);
    setSearch(""); setResults([]); setError(""); setShowCompleted(true);
    requestAnimationFrame(() => document.getElementById(`opening-qty-${item.id}`)?.focus());
  }
  async function preview() {
    setSubmitted(true);
    if (!branch?.code) { setError("Chọn chi nhánh nhận tồn trước khi nhập."); return; }
    if (!count) { setError("Tìm và thêm ít nhất một mã hàng."); searchRef.current?.focus(); return; }
    const invalid = lines.find(line => line.quantity === null || line.cost === null || !Number.isFinite(line.quantity) || !Number.isFinite(line.cost) || line.quantity < 0 || line.cost < 0);
    if (invalid) {
      setShowCompleted(true); setError(`${invalid.code}: nhập đủ số lượng và giá vốn. Chỉ điền 0 nếu chủ ý bằng 0.`);
      requestAnimationFrame(() => document.getElementById(`${invalid.quantity === null ? "opening-qty" : "opening-cost"}-${invalid.id}`)?.focus()); return;
    }
    setError("");
    await onPreview(lines.map(line => ({ productCode: line.code, productName: line.name, branchCode: branch.code!, unit: line.unit,
      quantity: line.quantity!, costPrice: line.cost!, lotNumber: line.lot.trim() || undefined,
      expiryDate: line.expiry ? new Date(`${line.expiry}T00:00:00+07:00`) : undefined, note: line.note.trim() || undefined })));
  }
  return <form id="opening-manual-form" onSubmit={event => { event.preventDefault(); if (!busy) void preview(); }}>
    <fieldset disabled={busy} className="min-w-0 space-y-4">
      <section aria-label="Thông tin đợt nhập" className="space-y-3">
        <h3 className="font-semibold text-primary text-sm">Thông tin đợt nhập</h3>
        <div className="space-y-1"><label htmlFor="opening-manual-branch" className="text-sm font-medium">Chi nhánh nhận tồn <span className="text-destructive">*</span></label>
          <select id="opening-manual-branch" className="h-11 w-full rounded-md border bg-background px-3 text-sm" value={branchId} disabled={busy || count > 0} onChange={event => { setBranchId(event.target.value); setSearch(""); setError(""); }}>
            <option value="">Chọn chi nhánh</option>{branches.filter(item => item.code).map(item => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}
          </select>{count > 0 && <p className="text-xs text-muted-foreground">Đang nhập cho chi nhánh này. Xóa các dòng nếu cần đổi chi nhánh.</p>}
        </div>{contextContent}
      </section>
      <section aria-label="Hàng nhập tồn" className="space-y-2 border-t pt-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-semibold text-primary text-sm">Hàng nhập tồn <span className="font-normal text-muted-foreground">· {count} mã</span></h3>
          {count > 1 && <Button type="button" variant="ghost" size="sm" onClick={() => setShowCompleted(previous => !previous)}>{showCompleted ? `Chưa đủ thông tin (${incomplete})` : "Hiện tất cả"}</Button>}
        </div>
        <div className="space-y-1"><label htmlFor="opening-manual-search" className="sr-only">Thêm hàng</label>
          <div className="relative"><Icon name="search" size={18} className="absolute left-3 top-3 text-muted-foreground pointer-events-none" />
            <Input ref={searchRef} id="opening-manual-search" className="pl-10" role="combobox" aria-autocomplete="list" aria-expanded={results.length > 0} aria-controls="opening-search-results" aria-activedescendant={results[activeResult] ? `opening-option-${results[activeResult].id}` : undefined}
              value={search} disabled={!branch?.code || busy || count >= 1000} onChange={event => setSearch(event.target.value)} placeholder="Tìm mã hoặc tên để thêm hàng..." autoComplete="off" onKeyDown={event => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "Escape" && results.length) { setResults([]); event.preventDefault(); event.stopPropagation(); return; }
                if (event.key === "Enter") event.preventDefault();
                if (!results.length) return;
                if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActiveResult(previous => (previous + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length); }
                if (event.key === "Enter") { event.preventDefault(); add(results[activeResult]); }
              }} />
          </div>{status && <p role="status" className="text-sm text-muted-foreground">{status}</p>}
          <div hidden={!results.length} id="opening-search-results" role="listbox" aria-label="Kết quả tìm hàng" className="max-h-52 overflow-auto rounded-md border shadow-sm">{results.map((item, index) => {
            const added = lines.some(line => line.id === item.id);
            return <button id={`opening-option-${item.id}`} role="option" aria-selected={index === activeResult} aria-disabled={added} type="button" key={item.id} tabIndex={-1} disabled={added || count >= 1000}
              className={`flex min-h-11 w-full items-center justify-between gap-2 border-b px-3 py-2 text-left text-sm hover:bg-primary/5 disabled:opacity-50 ${index === activeResult ? "bg-primary/5" : ""}`} onClick={() => add(item)}>
              <span><b className="text-primary">{item.code}</b><span className="block text-foreground">{item.name}</span></span><span className="shrink-0 text-muted-foreground">{item.unit} · {added ? "Đã thêm" : "+ Thêm"}</span>
            </button>;
          })}</div>
        </div>
        {count === 0 ? <div className="rounded-md border border-dashed bg-muted/20 py-6 px-4 text-center"><Icon name="inventory_2" size={24} className="mx-auto mb-2 text-primary" /><p className="text-sm font-medium">Thêm hàng để bắt đầu nhập tồn</p><p className="text-sm text-muted-foreground mt-1">Nhập lượng và giá vốn theo đơn vị tồn. Không cần file Excel.</p></div> : <div className="rounded-md border">
          <div className={`${rowGrid} hidden border-b bg-primary/5 px-3 py-2 text-xs font-semibold text-primary`} aria-hidden="true"><span>Mã / tên hàng</span><span>Số lượng</span><span>Giá vốn / đơn vị</span><span className="text-right">Thành tiền</span><span /></div>
          {lines.filter(line => showCompleted || line.quantity === null || line.cost === null).map(line => {
            const missing = submitted && (line.quantity === null || line.cost === null);
            return <div key={line.id} className={`border-b last:border-b-0 p-3 ${missing ? "bg-destructive/5" : ""}`}>
              <div className={`${rowGrid} grid grid-cols-2 gap-2`}>
                <div className="col-span-2 md:col-span-1 min-w-0 pr-10 md:pr-0 relative"><p id={`opening-product-${line.id}`} className="font-semibold text-sm leading-snug">{line.name}</p><p className="mt-0.5 text-xs text-muted-foreground"><span className="text-primary">{line.code}</span> · ĐVT: {line.unit}</p>
                  <Button type="button" size="icon" variant="ghost" className="md:hidden absolute -right-1 -top-1 text-muted-foreground hover:text-destructive" aria-label={`Xóa ${line.code}`} onClick={() => setLines(previous => previous.filter(item => item.id !== line.id))}><Icon name="close" size={18} /></Button>
                </div>
                <div><label htmlFor={`opening-qty-${line.id}`} className="text-xs font-medium md:sr-only">Số lượng ({line.unit})</label><NumericInput id={`opening-qty-${line.id}`} value={line.quantity} onChange={quantity => update(line.id, { quantity })} decimals={4} placeholder="Chưa nhập" aria-invalid={submitted && line.quantity === null} aria-describedby={`opening-product-${line.id}${missing?` opening-line-error-${line.id}`:""}`} /></div>
                <div><label htmlFor={`opening-cost-${line.id}`} className="text-xs font-medium md:sr-only">Giá vốn / {line.unit}</label><NumericInput id={`opening-cost-${line.id}`} value={line.cost} onChange={cost => update(line.id, { cost })} decimals={6} placeholder="Chưa nhập" aria-invalid={submitted && line.cost === null} aria-describedby={`opening-product-${line.id}${missing?` opening-line-error-${line.id}`:""}`} /></div>
                <p className="col-span-2 md:col-span-1 flex items-center justify-between md:justify-end min-h-8 md:min-h-11 text-sm tabular-nums"><span className="md:hidden text-muted-foreground">Thành tiền</span><b>{line.quantity !== null && line.cost !== null ? formatCurrency(line.quantity * line.cost) : "—"}</b></p>
                <Button type="button" size="icon" variant="ghost" className="hidden md:flex text-muted-foreground hover:text-destructive" aria-label={`Xóa ${line.code}`} onClick={() => setLines(previous => previous.filter(item => item.id !== line.id))}><Icon name="close" size={18} /></Button>
              </div>
              {missing && <p id={`opening-line-error-${line.id}`} className="mt-1 text-xs text-destructive">Còn thiếu {line.quantity === null && line.cost === null ? "số lượng và giá vốn" : line.quantity === null ? "số lượng" : "giá vốn"}.</p>}
              <details className="mt-1"><summary className="min-h-9 cursor-pointer text-sm text-primary content-center">Lô, hạn sử dụng, ghi chú{line.lot || line.expiry || line.note ? " · Đã bổ sung" : " (tùy chọn)"}</summary>
                <div className="grid gap-2 sm:grid-cols-2 pt-2">
                  <div><label className="text-xs font-medium" htmlFor={`opening-lot-${line.id}`}>Số lô</label><Input id={`opening-lot-${line.id}`} value={line.lot} maxLength={100} placeholder="Để trống để tạo tự động" onChange={event => update(line.id, { lot: event.target.value })} /></div>
                  <div><label className="text-xs font-medium" htmlFor={`opening-expiry-${line.id}`}>Hạn sử dụng</label><Input id={`opening-expiry-${line.id}`} type="date" value={line.expiry} onChange={event => update(line.id, { expiry: event.target.value })} /></div>
                  <div className="sm:col-span-2"><label className="text-xs font-medium" htmlFor={`opening-note-${line.id}`}>Ghi chú hàng</label><Input id={`opening-note-${line.id}`} value={line.note} maxLength={500} placeholder="Thông tin cần đối chiếu" onChange={event => update(line.id, { note: event.target.value })} /></div>
                </div>
              </details>
            </div>;
          })}
          {!showCompleted && incomplete === 0 && <p className="p-4 text-sm text-status-success">Đã điền đủ các hàng. Bấm Hiện tất cả để kiểm tra hoặc Xem trước tồn để đối chiếu.</p>}
        </div>}
        <p className="text-xs text-muted-foreground">Giá vốn cho 1 đơn vị tồn, không phải giá bán. Ô trống chưa được coi là 0.</p>
        {count >= 1000 && <p className="text-sm text-muted-foreground">Đã đủ 1.000 mã cho đợt này; chia thành đợt khác nếu cần.</p>}
      </section>
      {error && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
    </fieldset>
  </form>;
}
