"use client";
import { useEffect, useState } from "react";
import { useAuth, useToast } from "@/lib/contexts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SettingsSwitch } from "@/components/shared/settings-toggle";
import { isOwnerRole } from "@/lib/types/auth";
import { DEFAULT_FNB_METHODS, FNB_TENDERS, normalizeFnbMethods, type FnbMethodPreferences } from "@/lib/fnb-payment-methods";
import { getFnbPaymentMethods, saveFnbPaymentMethods } from "@/lib/services/supabase/fnb-payment-methods";
import { useUnsavedSnapshot } from "@/lib/hooks/use-unsaved-work";
const labels = { cash: "Tiền mặt", transfer: "Chuyển khoản", card: "Thẻ" };
export function FnbPaymentMethodSettings() {
  const { user, currentBranch } = useAuth();
  const { toast } = useToast();
  const branchId = currentBranch?.id;
  const canEdit = isOwnerRole(user?.role) || user?.role === "admin";
  const [methods, setMethods] = useState<FnbMethodPreferences>(DEFAULT_FNB_METHODS);
  const [readyBranch, setReadyBranch] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [saving, setSaving] = useState(false);
  const markSaved = useUnsavedSnapshot(methods, !!branchId && readyBranch === branchId);
  useEffect(() => {
    if (!branchId) return;
    let active = true;
    setReadyBranch(null); setError("");
    getFnbPaymentMethods(branchId).then(value => {
      if (active) { setMethods(value); setReadyBranch(branchId); }
    }).catch(err => { if (active) setError(err instanceof Error ? err.message : "Chưa đọc được cấu hình."); });
    return () => { active = false; };
  }, [branchId, retry]);
  async function save() {
    if (!branchId || readyBranch !== branchId || !canEdit || saving) return;
    const target = branchId;
    setSaving(true);
    try {
      await saveFnbPaymentMethods(target, methods);
      markSaved(methods);
      toast({ title: "Đã lưu phương thức thanh toán FnB", description: "POS đọc cài đặt mới khi mở lại cửa sổ thanh toán.", variant: "success" });
    } catch (err) { toast({ title: "Chưa lưu được", description: err instanceof Error ? err.message : "Vui lòng thử lại.", variant: "error" }); }
    finally { setSaving(false); }
  }
  return <Card>
    <CardHeader><CardTitle>Phương thức trên POS FnB</CardTitle><CardDescription>{currentBranch?.name || "Chọn chi nhánh trên thanh đầu trang"} · Hỗn hợp tự hiện khi bật từ hai phương thức.</CardDescription></CardHeader>
    <CardContent className="space-y-3">
      {error && <p role="alert" className="text-sm text-destructive">{error} <Button variant="outline" onClick={() => setRetry(value => value + 1)}>Thử lại</Button></p>}
      {branchId && !error && readyBranch !== branchId && <p role="status" className="text-sm text-muted-foreground">Đang tải…</p>}
      <fieldset disabled={!canEdit || saving || !branchId || readyBranch !== branchId} className="grid gap-3 sm:grid-cols-3">
        {FNB_TENDERS.map(key => <label key={key} className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm">
          {labels[key]}<SettingsSwitch label={labels[key]} checked={methods[key]} onCheckedChange={checked => {
            try { setMethods(normalizeFnbMethods({ ...methods, [key]: checked })); }
            catch (err) { toast({ title: err instanceof Error ? err.message : "Cần bật một phương thức.", variant: "error" }); }
          }} />
        </label>)}
      </fieldset>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">Cài riêng theo chi nhánh; giữ nguyên lịch sử thanh toán. {canEdit ? "" : "Chủ cửa hàng hoặc admin được thay đổi."}</p>
        {canEdit && <Button disabled={saving || !branchId || readyBranch !== branchId} onClick={save}>{saving ? "Đang lưu…" : "Lưu phương thức FnB"}</Button>}
      </div>
    </CardContent>
  </Card>;
}
