"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { SettingsToggle } from "@/components/shared/settings-toggle";
import { PageHeader } from "@/components/shared/page-header";
import { useAuth, useToast } from "@/lib/contexts";
import { isOwnerRole } from "@/lib/types/auth";
import { isRequireBomForSku, setRequireBomForSku } from "@/lib/services/supabase/tenant-settings";
import { branchSaleStockPolicy, listSaleCostShortfalls, type SaleCostShortfall } from "@/lib/services/supabase/branch-stock-policy";
import { formatNumber } from "@/lib/format";

export default function CaiDatKhoHangPage() {
  const { user, currentBranch } = useAuth(); const { toast } = useToast();
  const branchId = currentBranch?.id;
  const activeBranch = useRef(branchId);
  const canEdit = isOwnerRole(user?.role) || user?.role === "admin";
  const [readyBranch, setReadyBranch] = useState<string>();
  const [saving, setSaving] = useState(false); const [allow, setAllow] = useState(false);
  const [requireBom, setRequireBom] = useState(false); const [rows, setRows] = useState<SaleCostShortfall[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    activeBranch.current = branchId;
    if (!branchId) return;
    let active = true;
    Promise.all([branchSaleStockPolicy(branchId), isRequireBomForSku(), listSaleCostShortfalls(branchId)])
      .then(([policy, bom, shortfalls]) => {
        if (!active) return;
        setAllow(policy); setRequireBom(bom); setRows(shortfalls); setError(""); setReadyBranch(branchId);
      }).catch((err) => { if (active) setError(err instanceof Error ? err.message : "Không tải được cài đặt."); });
    return () => { active = false; };
  }, [branchId]);
  async function save(kind: "stock" | "bom", value: boolean) {
    if (!canEdit || !branchId || saving || readyBranch !== branchId) return;
    const target = branchId; setSaving(true);
    try {
      if (kind === "stock") await branchSaleStockPolicy(target, value); else await setRequireBomForSku(value);
      if (activeBranch.current !== target) return;
      if (kind === "stock") setAllow(value); else setRequireBom(value);
      toast({ variant: "success", title: "Đã lưu cài đặt", description: kind === "stock" ? `${currentBranch?.name}: ${value ? "cho phép bán thiếu tồn" : "chặn bán thiếu tồn"}.` : "Đã lưu quy tắc công thức chung." });
    } catch (err) { toast({ variant: "error", title: "Chưa lưu được", description: err instanceof Error ? err.message : "Vui lòng thử lại." }); }
    finally { setSaving(false); }
  }
  return <div className="space-y-5">
    <PageHeader title="Kho & công thức" subtitle="Quy tắc tồn kho khi bán hàng" />
    <section className="rounded-xl border bg-card p-4 md:p-5 space-y-4">
      <div><p className="text-xs text-muted-foreground">Chi nhánh đang cài đặt</p><h2 className="font-semibold text-primary">{currentBranch?.name ?? "Chọn chi nhánh trên thanh đầu trang"}</h2></div>
      {!canEdit && <p className="text-sm text-muted-foreground">Chỉ chủ sở hữu hoặc quản trị được thay đổi quy tắc.</p>}
      {error ? <p role="alert" className="text-sm text-destructive">{error} Tải lại trang để thử lại.</p> : readyBranch !== branchId || !branchId ? <p className="text-sm text-muted-foreground">{branchId ? "Đang tải…" : "Chưa chọn chi nhánh."}</p> : <>
        <SettingsToggle label="Cho phép bán khi không đủ tồn kho" checked={allow} disabled={!canEdit || saving} onCheckedChange={(v) => void save("stock", v)} description="Áp dụng riêng cho chi nhánh này. Khi bật, POS vẫn thanh toán và trừ đủ nguyên liệu theo công thức; phần thiếu xuống tồn âm." />
        <div className="rounded-lg bg-muted/40 px-3 py-2 text-sm text-muted-foreground">{allow ? "Đang cho phép bán thiếu tồn. Nhập bù đúng số lượng thực nhận; không cần duyệt thêm từng bill." : "Đang chặn bán thiếu tồn. POS sẽ báo nguyên liệu thiếu trước khi hoàn tất thanh toán."}</div>
        <p className="text-xs text-muted-foreground">Giá vốn lấy theo chi nhánh. Phần thiếu được ghi nhận để đối chiếu khi nhập bù; chưa có giá vốn sẽ được đánh dấu chưa đầy đủ trên báo cáo.</p>
      </>}
    </section>
    {readyBranch === branchId && rows.length > 0 && <section className="rounded-xl border bg-card p-4 space-y-3">
      <h2 className="font-semibold">Phần thiếu tồn hoặc giá vốn cần đối chiếu</h2>
      <p className="text-xs text-muted-foreground">Tối đa 100 lần thiếu gần nhất. Xem tồn thực tế tại <Link className="text-primary underline" href="/hang-hoa/ton-kho">Tồn kho</Link>; xem đối chiếu giá vốn tại Lịch sử thao tác.</p>
      <div className="max-h-72 overflow-auto"><table className="w-full text-sm"><thead><tr className="text-left text-muted-foreground"><th className="py-2">Nguyên liệu</th><th className="text-right">Chưa đối chiếu</th><th className="pl-3">Giá vốn</th></tr></thead><tbody>{rows.map(row => <tr key={row.id} className="border-t"><td className="py-2">{row.products?.name}<span className="block text-xs text-muted-foreground">{row.products?.code}</span></td><td className="text-right">{formatNumber(row.pending_quantity)} {row.products?.unit}</td><td className="pl-3 text-xs">{row.cost_known ? "Tạm tính theo giá đã có" : "Chưa có giá vốn"}</td></tr>)}</tbody></table></div>
    </section>}
    <details className="rounded-xl border bg-card p-4"><summary className="cursor-pointer font-semibold">Công thức — áp dụng chung doanh nghiệp</summary>
      <div className="pt-4"><SettingsToggle label="Bắt buộc có công thức trước khi bán" checked={requireBom} disabled={!canEdit || saving || readyBranch !== branchId} onCheckedChange={(v) => void save("bom", v)} description="Chặn món được đánh dấu có công thức nhưng chưa thiết lập công thức. Không tự thêm ly/nắp vào công thức." /></div>
    </details>
  </div>;
}
