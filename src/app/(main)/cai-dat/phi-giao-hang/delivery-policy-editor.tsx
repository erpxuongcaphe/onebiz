"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth, useToast } from "@/lib/contexts";
import { usePermissions } from "@/lib/permissions";
import { requestPageLeave, useUnsavedWork } from "@/lib/hooks/use-unsaved-work";
import { getDeliveryPricePolicy, saveDeliveryPricePolicy } from "@/lib/services/supabase/fnb-delivery-policy";
import { quoteDeliveryPrice, validateDeliveryPolicy, type DeliveryPricePolicy, type DeliveryPriceRule } from "@/lib/fnb-delivery-policy";
import { formatCurrency } from "@/lib/format";

export function DeliveryPolicySettings() {
  const { branches, currentBranch } = useAuth();
  const [selectedBranchId, setBranchId] = useState<string | null>(null);
  const branchId = selectedBranchId ?? currentBranch?.id ?? branches[0]?.id ?? "";
  return <section className="space-y-4 rounded-xl border p-4">
    <h2 className="font-semibold">Tự tính phí theo khoảng cách và giá trị bill</h2>
    <label className="block space-y-1 text-sm">Chi nhánh áp dụng
      <select aria-label="Chi nhánh áp dụng phí giao" value={branchId} className="block min-h-11 w-full rounded-md border bg-background px-3"
        onChange={e => { const id = e.target.value; requestPageLeave(() => setBranchId(id)); }}>
        {!branchId && <option value="">Chọn chi nhánh</option>}
        {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
      </select>
    </label>
    {branchId && <DeliveryPolicyLoader key={branchId} branchId={branchId} />}
  </section>;
}

function DeliveryPolicyLoader({ branchId }: { branchId: string }) {
  const { toast } = useToast();
  const { hasPermission } = usePermissions();
  const [policy, setPolicy] = useState<DeliveryPricePolicy | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const [baseline, setBaseline] = useState("");
  const dirty = !!policy && JSON.stringify(policy) !== baseline;
  useUnsavedWork(dirty);
  useEffect(() => {
    let cancelled = false;
    getDeliveryPricePolicy(branchId).then(result => {
      if (!cancelled) { setPolicy(result); setBaseline(JSON.stringify(result)); setError(""); }
    }).catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : "Không tải được cấu hình."); });
    return () => { cancelled = true; };
  }, [branchId, reload]);
  if (error) return <div role="alert" className="space-y-2 text-sm"><p>{error}</p><Button variant="outline" onClick={() => { setError(""); setReload(n => n + 1); }}>Tải lại cấu hình</Button></div>;
  if (!policy) return <p role="status">Đang tải cấu hình…</p>;
  return <DeliveryPolicyEditor policy={policy} onChange={setPolicy} disabled={!hasPermission("system.manage_branches") || saving}
    saving={saving} dirty={dirty} onSave={async () => {
      setSaving(true);
      try {
        const result = await saveDeliveryPricePolicy(branchId, policy);
        setPolicy(result); setBaseline(JSON.stringify(result));
        toast({ title: "Đã lưu chính sách giao hàng", description: result.enabled ? "Áp dụng cho đơn mới của chi nhánh này." : "Đã lưu bản cấu hình. Tự tính phí đang tắt.", variant: "success" });
      } catch (err) { toast({ title: "Chưa lưu được", description: err instanceof Error ? err.message : "Vui lòng thử lại.", variant: "error" }); }
      finally { setSaving(false); }
    }} />;
}

/** Pure form also used by the local verification fixture. */
export function DeliveryPolicyEditor({ policy, onChange, disabled = false, saving = false, dirty = true, onSave }: {
  policy: DeliveryPricePolicy; onChange: (p: DeliveryPricePolicy) => void; disabled?: boolean; saving?: boolean; dirty?: boolean; onSave: () => void;
}) {
  const [meters, setMeters] = useState("1000");
  const [amount, setAmount] = useState("50000");
  const invalid = validateDeliveryPolicy(policy);
  const preview = quoteDeliveryPrice({ ...policy, enabled: true }, meters.trim() && amount.trim() ? Number(meters) : undefined, Number(amount), Number(amount));
  function edit(id: string, patch: Partial<DeliveryPriceRule>) { onChange({ ...policy, rules: policy.rules.map(r => r.id === id ? { ...r, ...patch } : r) }); }
  return <div className="space-y-4">
    <fieldset disabled={disabled} className="space-y-4 disabled:opacity-70">
      <label className="flex min-h-11 items-center gap-3 text-sm font-medium"><input type="checkbox" checked={policy.enabled} onChange={e => onChange({ ...policy, enabled: e.target.checked })} />Bật tự tính phí cho đơn mới</label>
      <label className="block space-y-1 text-sm">Giá trị bill dùng xét phí (chưa gồm phí giao, tiền tip)
        <select aria-label="Cơ sở tính giá trị bill" value={policy.amountBasis} onChange={e => onChange({ ...policy, amountBasis: e.target.value as DeliveryPricePolicy["amountBasis"] })} className="block min-h-11 w-full rounded-md border bg-background px-3">
          <option value="before_discount">Tiền món trước giảm giá</option><option value="after_discount">Tiền món sau tất cả giảm giá</option>
        </select>
      </label>
      <p className="text-sm text-muted-foreground">Mỗi khoảng tính từ mốc đầu đến dưới mốc cuối. Ví dụ: từ 500 đến dưới 1.000 m; bill từ 50.000đ nghĩa là đúng 50.000đ đã đủ điều kiện. Để trống mốc cuối nếu không giới hạn.</p>
      {policy.rules.map((r, i) => <div key={r.id} className="space-y-3 rounded-lg border p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={r.enabled} onChange={e => edit(r.id, { enabled: e.target.checked })} />Mức {i + 1} · {r.enabled ? "Đang bật" : "Đang tắt"}</label>
          <Button variant="outline" size="sm" onClick={() => onChange({ ...policy, rules: policy.rules.filter(x => x.id !== r.id) })} aria-label={`Xóa mức ${i + 1}`}>Xóa mức</Button>
        </div>
        <label className="block space-y-1 text-sm">Tên mức phí<Input value={r.name} maxLength={120} onChange={e => edit(r.id, { name: e.target.value })} placeholder="Ví dụ: 1–3 km, bill từ 50.000đ" /></label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {([
            ["fromMeters", "Khoảng cách từ (m)", false], ["toMeters", "Đến dưới (m)", true],
            ["fromAmount", "Giá trị bill từ (đ)", false], ["toAmount", "Đến dưới (đ)", true],
            ["fee", "Phí khách trả (đ), nhập 0 để miễn phí", false],
          ] as const).map(([field, title, optional]) => <label key={field} className="block space-y-1 text-sm">{title}
            <Input type="number" min={0} step={1} inputMode="numeric" value={r[field] === null || Number.isNaN(r[field]) ? "" : r[field]}
              placeholder={optional ? "Không giới hạn" : "0"} onChange={e => edit(r.id, { [field]: e.target.value === "" ? optional ? null : NaN : Number(e.target.value) })} />
          </label>)}
        </div>
      </div>)}
      <Button variant="outline" disabled={policy.rules.length >= 100} onClick={() => onChange({ ...policy, rules: [...policy.rules, {
        id: crypto.randomUUID(), name: "", fromMeters: 0, toMeters: null, fromAmount: 0, toAmount: null, fee: 0, enabled: true,
      }] })}>+ Thêm mức giao hàng</Button>
    </fieldset>
    {invalid && <p role="alert" className="text-sm text-status-error">{invalid}</p>}
    <section className="space-y-3 rounded-lg bg-muted/40 p-3" aria-label="Tính thử phí giao">
      <h3 className="text-sm font-semibold">Tính thử trước khi lưu</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-sm">Khoảng cách thử (m)<Input type="number" min={0} value={meters} onChange={e => setMeters(e.target.value)} /></label>
        <label className="text-sm">Giá trị bill thử (đ)<Input type="number" min={0} value={amount} onChange={e => setAmount(e.target.value)} /></label>
      </div>
      <p role="status" className="text-sm">{preview ? `${preview.name}: ${formatCurrency(preview.fee)}đ${preview.fee === 0 ? " · Miễn phí giao hàng" : ""}` : "Chưa có mức phù hợp. Đơn ngoài các khoảng đã cấu hình sẽ cần kiểm tra, không tự miễn phí."}</p>
    </section>
    <Button disabled={disabled || saving || !dirty || !!invalid} onClick={onSave}>{saving ? "Đang lưu…" : "Lưu chính sách giao hàng"}</Button>
    <p className="text-xs text-muted-foreground">Chỉ người có quyền quản lý chi nhánh được lưu. Đơn đã gửi giữ phí đã chốt. Quản lý tài khoản người giao tại Cài đặt → Người dùng; chọn người giao ngay trên đơn POS.</p>
  </div>;
}
