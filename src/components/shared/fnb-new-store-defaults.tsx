"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { getFnbNewStoreDefault, saveFnbNewStoreDefault, type FnbNewStoreDefault } from "@/lib/services/supabase/fnb-new-store-defaults";

export function FnbNewStoreDefaults({ branches }: { branches: { id: string; name: string; branchType?: string }[] }) {
  const [saved, setSaved] = useState<FnbNewStoreDefault | null>(null);
  const [draft, setDraft] = useState<FnbNewStoreDefault>({ enabled: false, templateBranchId: null });
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const lock = useRef(false);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    let active = true;
    setBusy(true); setError("");
    getFnbNewStoreDefault().then(value => { if (active) { setSaved(value); setDraft(value); } })
      .catch(cause => { if (active) { setSaved(null); setError(cause instanceof Error ? cause.message : "Chưa tải được cấu hình."); } })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; mounted.current = false; };
  }, [reload]);
  const dirty = saved && (saved.enabled !== draft.enabled || (draft.enabled && saved.templateBranchId !== draft.templateBranchId));
  async function save() {
    if (lock.current || busy || !saved || !dirty) return;
    lock.current = true; setBusy(true); setError(""); setMessage("");
    try {
      const value = await saveFnbNewStoreDefault(draft);
      if (mounted.current) { setSaved(value); setDraft(value); setMessage("Đã lưu. Chỉ áp dụng cho cửa hàng tạo mới; chi nhánh và tồn hiện có giữ nguyên."); }
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : "Chưa lưu được cấu hình.");
    } finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  return <details className="min-w-0 rounded-md border p-3 text-sm">
    <summary className="min-h-10 cursor-pointer content-center font-medium">Mặc định quán mới <span className="font-normal">· {busy ? "Đang tải" : saved ? saved.enabled ? "Đang bật" : "Đang tắt" : "Chưa tải được"}</span></summary>
    <div className="space-y-3 pt-2">
      <p className="text-foreground">Cửa hàng mới tự có sổ giá vốn F&B riêng và danh mục cấp hàng từ quán mẫu. Không chép tồn, công thức hoặc giá vốn; không áp dụng cho kho/xưởng/văn phòng.</p>
      <fieldset disabled={busy || !saved} className="space-y-2">
        <label className="flex min-h-10 items-center gap-2"><input type="checkbox" checked={draft.enabled} onChange={event => { setDraft(old => ({ ...old, enabled: event.target.checked })); setMessage(""); }} />Tự thiết lập cho cửa hàng tạo mới</label>
        {draft.enabled && <label className="block space-y-1"><span>Quán mẫu danh mục cấp hàng</span>
          <select className="min-h-11 w-full min-w-0 max-w-full rounded-md border bg-background px-2 text-base xl:text-sm" value={draft.templateBranchId ?? ""} onChange={event => { setDraft(old => ({ ...old, templateBranchId: event.target.value || null })); setMessage(""); }}>
            <option value="">Chọn quán đã cấu hình</option>{branches.filter(branch => branch.branchType === "store").map(branch => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select></label>}
        <Button type="button" size="sm" className="min-h-10" disabled={!dirty || (draft.enabled && !draft.templateBranchId)} onClick={() => void save()}>{busy ? "Đang lưu..." : "Lưu mặc định quán mới"}</Button>
      </fieldset>
      {message && <p role="status" className="text-foreground">{message}</p>}
      {error && <div role="alert" className="space-y-1 text-destructive"><p>{error}</p><Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => { setMessage(""); setReload(value => value + 1); }}>Tải lại trạng thái</Button></div>}
    </div>
  </details>;
}
