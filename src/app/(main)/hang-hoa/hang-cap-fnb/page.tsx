"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/shared/page-header";
import { ConfirmDialog } from "@/components/shared/dialogs/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { useAuth, useToast } from "@/lib/contexts";
import { getBranches, type BranchDetail } from "@/lib/services";
import { searchInternalSaleProducts, type InternalSaleProduct } from "@/lib/services/supabase/internal-sale-products";
import {
  getFnbSupplyBranchScope,
  listFnbSupplyCatalog,
  listFnbSupplyBomSuggestions,
  saveFnbSupplyCatalog,
  setFnbSupplyBranchScope,
  type FnbSupplyRow,
} from "@/lib/services/supabase/fnb-supply-catalog";

export default function FnbSupplyCatalogPage() {
  const { hasPermission } = useAuth();
  const { toast } = useToast();
  const canView = hasPermission("products.view");
  const canEdit = hasPermission("products.edit") && hasPermission("system.manage_branches");
  const [branches, setBranches] = useState<BranchDetail[]>([]);
  const [showOtherBranches, setShowOtherBranches] = useState(false);
  const [branchId, setBranchId] = useState("");
  const [targets, setTargets] = useState<string[]>([]);
  const [selected, setSelected] = useState<InternalSaleProduct[]>([]);
  const [search, setSearch] = useState("");
  const [matches, setMatches] = useState<InternalSaleProduct[]>([]);
  const [searchBusy, setSearchBusy] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [suggestionBusy, setSuggestionBusy] = useState(false);
  const [rows, setRows] = useState<FnbSupplyRow[]>([]);
  const [scopeEnabled, setScopeEnabled] = useState(false);
  const [scopeBusy, setScopeBusy] = useState(false);
  const [scopeError, setScopeError] = useState("");
  const [scopeConfirmation, setScopeConfirmation] = useState<boolean | null>(null);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(0);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const saveLock = useRef(false);
  const storeBranches = useMemo(
    () => branches.filter((branch) => branch.branchType === "store" || !branch.branchType),
    [branches],
  );
  const visibleBranches = showOtherBranches ? branches : storeBranches;

  function toggleOtherBranchVisibility() {
    setShowOtherBranches((showing) => {
      if (showing) {
        const storeBranchIds = new Set(storeBranches.map((branch) => branch.id));
        setTargets((ids) => ids.filter((id) => storeBranchIds.has(id)));
        setBranchId((id) => storeBranchIds.has(id) ? id : "");
      }
      return !showing;
    });
  }

  useEffect(() => {
    if (!canView) return;
    let active = true;
    getBranches().then((data) => { if (active) setBranches(data); })
      .catch(() => { if (active) setError("Không tải được chi nhánh. Vui lòng tải lại trang."); });
    return () => { active = false; };
  }, [canView]);

  useEffect(() => {
    setRows([]); setCount(0);
    if (!canView || !branchId) { setBusy(false); return; }
    const controller = new AbortController();
    setBusy(true); setError("");
    listFnbSupplyCatalog(branchId, page, controller.signal).then((data) => {
      if (!controller.signal.aborted) { setRows(data.rows); setCount(data.count); }
    }).catch(() => {
      if (!controller.signal.aborted) setError("Không tải được cấu hình. Kiểm tra quyền truy cập và migration 00386.");
    }).finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [canView, branchId, page, revision]);

  useEffect(() => {
    setScopeEnabled(false); setScopeError("");
    if (!canView || !branchId) { setScopeBusy(false); return; }
    const controller = new AbortController();
    setScopeBusy(true);
    getFnbSupplyBranchScope(branchId, controller.signal).then((scope) => {
      if (!controller.signal.aborted) setScopeEnabled(scope.enforcementEnabled);
    }).catch(() => {
      if (!controller.signal.aborted) setScopeError("Không tải được trạng thái kiểm soát SKU.");
    }).finally(() => { if (!controller.signal.aborted) setScopeBusy(false); });
    return () => controller.abort();
  }, [canView, branchId, revision]);

  useEffect(() => {
    setMatches([]); setSearchError("");
    if (!canEdit || !search.trim()) { setSearchBusy(false); return; }
    const controller = new AbortController();
    setSearchBusy(true);
    const timer = setTimeout(() => {
      searchInternalSaleProducts(search, controller.signal, true).then((data) => {
        if (!controller.signal.aborted) setMatches(data);
      }).catch(() => {
        if (!controller.signal.aborted) setSearchError("Không tải được hàng. Vui lòng tìm lại.");
      }).finally(() => { if (!controller.signal.aborted) setSearchBusy(false); });
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [canEdit, search]);

  async function save(productIds: string[], branchIds: string[], action: "add" | "remove") {
    if (saveLock.current || !canEdit) return;
    saveLock.current = true; setSaving(true);
    try {
      const changed = await saveFnbSupplyCatalog(productIds, branchIds, action);
      toast({ title: `Đã cập nhật ${changed} liên kết hàng – chi nhánh` });
      if (action === "add") { setSelected([]); setSearch(""); }
      setPage(0); setRevision((value) => value + 1);
    } catch (cause) {
      toast({ title: "Chưa lưu được cấu hình", description: cause instanceof Error ? cause.message : "Vui lòng thử lại.", variant: "error" });
    } finally { saveLock.current = false; setSaving(false); }
  }

  async function addBomSuggestions() {
    if (!branchId || !canEdit || suggestionBusy || saving) return;
    setSuggestionBusy(true);
    try {
      const suggestions = await listFnbSupplyBomSuggestions(branchId);
      const selectedIds = new Set(selected.map((product) => product.id));
      const additions = suggestions
        .filter((product) => !selectedIds.has(product.id))
        .slice(0, Math.max(0, 200 - selected.length));
      if (additions.length) {
        setSelected((items) => [
          ...items,
          ...additions.map((product) => ({ ...product, sell_price: 0, vat_rate: 0 })),
        ]);
        setTargets((ids) => ids.includes(branchId) ? ids : [...ids, branchId]);
      }
      toast({
        title: additions.length
          ? `Đã thêm ${additions.length} SKU gợi ý vào vùng chọn`
          : "Không có SKU BOM mới cần thêm",
        description: "Chưa có dữ liệu nào được lưu. Rà danh sách và bấm Thêm hàng để xác nhận.",
      });
    } catch (cause) {
      toast({
        title: "Chưa tải được gợi ý BOM",
        description: cause instanceof Error ? cause.message : "Vui lòng thử lại.",
        variant: "error",
      });
    } finally {
      setSuggestionBusy(false);
    }
  }

  async function saveScope() {
    if (scopeConfirmation === null || !branchId || !canEdit) return;
    const nextEnabled = scopeConfirmation;
    setScopeBusy(true);
    try {
      setScopeEnabled(await setFnbSupplyBranchScope(branchId, nextEnabled));
      toast({ title: nextEnabled ? "Đã bật kiểm soát SKU cấp hàng" : "Đã tắt kiểm soát SKU cấp hàng" });
      setScopeConfirmation(null);
    } catch (cause) {
      toast({ title: "Chưa cập nhật được kiểm soát SKU", description: cause instanceof Error ? cause.message : "Vui lòng thử lại.", variant: "error" });
    } finally { setScopeBusy(false); }
  }

  if (!canView) return <p className="p-6">Bạn chưa có quyền xem sản phẩm.</p>;
  return <>
    <PageHeader title="Hàng cấp cho quán" subtitle="Chọn SKU Retail được phép cấp; chỉ quán được bật mới chặn giao dịch." />
    <div className="space-y-5 p-4 md:p-6">
      {canEdit && <section className="space-y-3 border-b pb-5">
        <h2 className="text-base font-semibold">Thêm hàng vào danh sách cấp</h2>
        <Input aria-label="Tìm SKU Retail" placeholder="Tìm mã hoặc tên hàng Retail" value={search}
          disabled={saving} onChange={(event) => setSearch(event.target.value)} />
        {searchBusy && <p role="status">Đang tìm hàng...</p>}
        {searchError && <p role="alert" className="text-destructive">{searchError}</p>}
        {!searchBusy && search.trim() && !searchError && matches.length === 0 && <p>Không tìm thấy SKU Retail.</p>}
        {matches.length > 0 && <div className="max-h-56 overflow-auto divide-y border rounded-md">
          {matches.map((product) => <label key={product.id} className="flex items-center gap-3 p-3">
            <input type="checkbox" disabled={saving || (selected.length >= 200 && !selected.some((p) => p.id === product.id))}
              checked={selected.some((p) => p.id === product.id)} onChange={(event) => setSelected((items) => event.target.checked
                ? [...items, product] : items.filter((p) => p.id !== product.id))} />
            <span className="min-w-0 break-words">{product.code} · {product.name}</span>
            <span className="ml-auto shrink-0">{product.unit}</span>
          </label>)}
        </div>}
        {selected.length > 0 && <ul className="divide-y">
          {selected.map((product) => <li key={product.id} className="flex items-center gap-2 py-1">
            <span className="min-w-0 break-words">{product.code} · {product.name} · {product.unit}</span>
            <Button variant="ghost" size="sm" disabled={saving} aria-label={`Bỏ chọn ${product.code}`} title="Bỏ chọn"
              onClick={() => setSelected((items) => items.filter((p) => p.id !== product.id))}><Icon name="close" size={16} /></Button>
          </li>)}
        </ul>}
        <div className="space-y-2" role="group" aria-labelledby="fnb-supply-targets-heading">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 id="fnb-supply-targets-heading" className="text-sm font-medium">Quán nhận hàng</h3>
            <Button type="button" variant="ghost" size="sm" disabled={saving}
              aria-pressed={showOtherBranches} onClick={toggleOtherBranchVisibility}>
              <Icon name={showOtherBranches ? "visibility_off" : "visibility"} size={16} />
              {showOtherBranches ? "Ẩn chi nhánh ngoài quán" : "Hiện chi nhánh khác"}
            </Button>
          </div>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {visibleBranches.map((branch) => <label key={branch.id} className="flex items-start gap-2 text-sm">
              <input type="checkbox" disabled={saving} checked={targets.includes(branch.id)} onChange={(event) => setTargets((ids) => event.target.checked
                ? [...ids, branch.id] : ids.filter((id) => id !== branch.id))} />
              <span>{branch.code} · {branch.name}{branch.branchType !== "store" && branch.branchType ? ` (${branch.branchType})` : ""}</span>
            </label>)}
          </div>
        </div>
        <Button disabled={saving || !selected.length || !targets.length || targets.length > 100}
          onClick={() => save(selected.map((p) => p.id), targets, "add")}>
          <Icon name="add" size={16} /> {saving ? "Đang lưu..." : `Thêm ${selected.length} hàng cho ${targets.length} chi nhánh`}
        </Button>
      </section>}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold">Danh sách đã cấu hình</h2>
          <select aria-label="Quán xem cấu hình" className="min-w-0 max-w-full rounded-md border bg-background p-2 text-sm"
            value={branchId} disabled={saving} onChange={(event) => { setBranchId(event.target.value); setPage(0); }}>
            <option value="">Chọn quán</option>
            {visibleBranches.map((branch) => <option key={branch.id} value={branch.id}>{branch.code} · {branch.name}{branch.branchType !== "store" && branch.branchType ? ` (${branch.branchType})` : ""}</option>)}
          </select>
          <Button type="button" variant="ghost" size="sm" aria-pressed={showOtherBranches}
            onClick={toggleOtherBranchVisibility}>
            <Icon name={showOtherBranches ? "visibility_off" : "visibility"} size={16} />
            {showOtherBranches ? "Ẩn chi nhánh ngoài quán" : "Hiện chi nhánh khác"}
          </Button>
          <Button variant="ghost" title="Tải lại" aria-label="Tải lại" disabled={busy || !branchId}
            onClick={() => setRevision((value) => value + 1)}><Icon name="refresh" size={16} /></Button>
          {canEdit && <Button type="button" variant="outline" size="sm" disabled={!branchId || busy || saving || suggestionBusy}
            onClick={addBomSuggestions}>
            <Icon name="auto_awesome" size={16} /> {suggestionBusy ? "Đang đọc BOM..." : "Gợi ý SKU từ BOM"}
          </Button>}
        </div>
        {branchId && canEdit && <p className="text-xs text-muted-foreground">
          Gợi ý chỉ lấy SKU Retail đang có trong các BOM món F&B hoạt động và chưa nằm trong danh sách của quán này. Hệ thống không tự lưu hoặc tự bật kiểm soát.
        </p>}
        {error && <p role="alert" className="text-destructive">{error}</p>}
        {busy ? <p role="status">Đang tải cấu hình...</p> : branchId && !error && <>
          <div className="flex flex-wrap items-center justify-between gap-3 border-y py-3">
            <div>
              <h3 className="font-medium">Kiểm soát SKU cấp hàng</h3>
              <p className="text-sm text-muted-foreground">
                {scopeBusy ? "Đang tải trạng thái..." : scopeEnabled ? "Đang áp dụng cho quán này" : "Chưa áp dụng cho quán này"}
              </p>
            </div>
            {canEdit && <Button variant={scopeEnabled ? "outline" : "default"} disabled={scopeBusy || (!scopeEnabled && count === 0)}
              onClick={() => setScopeConfirmation(!scopeEnabled)}>
              {scopeEnabled ? "Tắt kiểm soát" : "Bật kiểm soát"}
            </Button>}
          </div>
          {scopeError && <p role="alert" className="text-destructive">{scopeError}</p>}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b"><tr><th className="p-2">Mã hàng</th><th className="p-2">Tên hàng</th><th className="p-2">Đơn vị</th><th className="p-2">Trạng thái</th><th /></tr></thead>
              <tbody>{rows.map((row) => <tr key={row.product_id} className="border-b">
                <td className="p-2 whitespace-nowrap">{row.products.code}</td><td className="p-2">{row.products.name}</td>
                <td className="p-2">{row.products.unit}</td><td className="p-2">{row.products.is_active ? "Đang kinh doanh" : "Ngừng kinh doanh"}</td>
                <td>{canEdit && <Button variant="ghost" disabled={saving} title="Gỡ khỏi danh sách cấp" aria-label={`Gỡ ${row.products.code}`}
                  onClick={() => save([row.product_id], [branchId], "remove")}><Icon name="close" size={16} /></Button>}</td>
              </tr>)}</tbody>
            </table>
          </div>
          {count === 0 && <p>Chưa có hàng trong danh sách cấp của chi nhánh này.</p>}
          <div className="flex items-center gap-3 text-sm">
            <span>{count} hàng · Trang {page + 1}</span>
            <Button variant="outline" aria-label="Trang trước" disabled={page === 0} onClick={() => setPage(page - 1)}><Icon name="chevron_left" size={16} /></Button>
            <Button variant="outline" aria-label="Trang sau" disabled={(page + 1) * 30 >= count} onClick={() => setPage(page + 1)}><Icon name="chevron_right" size={16} /></Button>
          </div>
        </>}
      </section>
    </div>
    <ConfirmDialog open={scopeConfirmation !== null} onOpenChange={(open) => { if (!open) setScopeConfirmation(null); }}
      title={scopeConfirmation ? "Bật kiểm soát SKU cấp hàng" : "Tắt kiểm soát SKU cấp hàng"}
      description={scopeConfirmation
        ? "Bán nội bộ chuỗi cấp vào quán này sẽ chỉ nhận SKU nằm trong danh sách đã cấu hình. Không thay đổi tồn kho, BOM, giá hoặc chứng từ hiện có."
        : "Bán nội bộ chuỗi vào quán này sẽ không còn bị giới hạn bởi danh sách SKU cấp hàng."}
      confirmLabel={scopeConfirmation ? "Bật kiểm soát" : "Tắt kiểm soát"}
      loading={scopeBusy} onConfirm={saveScope} />
  </>;
}
