"use client";
import { useEffect, useState } from "react";
import { useBranchFilter } from "@/lib/contexts";
import { usePermissions } from "@/lib/permissions/use-permission";
import { getMoneyAccounts, getMoneyAccountWorkspace, type MoneyAccount } from "@/lib/services/supabase/money-accounts";
import { cashDateTimeInput } from "@/lib/cash-time";
import { formatShortDate } from "@/lib/format";
import { queryLocalList } from "@/lib/local-list-query";
import { exportToExcel } from "@/lib/utils/export";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MoneyAccountEditor } from "./money-account-editor";
import { MoneyAccountList } from "./money-account-list";
import { hasOpeningBalance, moneyAccountKinds } from "./money-account-display";

const emptyRows: MoneyAccount[] = [];
const accountColumns = [
  { header: "Chi nhánh", key: "branch", width: 30 },
  { header: "Mã", key: "code", width: 20 },
  { header: "Tên quỹ / tài khoản", key: "name", width: 32 },
  { header: "Loại", key: "kindLabel", width: 20 },
  { header: "Ngân hàng / đơn vị", key: "bank_name", width: 28 },
  { header: "Số tài khoản", key: "account_number", width: 25 },
  { header: "Chủ tài khoản", key: "account_holder", width: 30 },
  { header: "Trạng thái", key: "statusLabel", width: 20 },
  { header: "Ngày bắt đầu số dư", key: "opening_date", width: 22 },
  { header: "Số dư khai báo", key: "opening_amount", width: 22 },
];
const balanceColumns = [
  ...accountColumns,
  { header: "Từ ngày", key: "from", width: 18 },
  { header: "Đến ngày", key: "to", width: 18 },
  { header: "Số dư đầu kỳ", key: "opening_balance", width: 22 },
  { header: "Thu trong kỳ", key: "receipts", width: 22 },
  { header: "Chi trong kỳ", key: "payments", width: 22 },
  { header: "Số dư cuối kỳ", key: "closing_balance", width: 22 },
];

export default function MoneyAccountsPage() {
  const { activeBranchId, branchLabel, isReady } = useBranchFilter();
  return <MoneyAccountWorkspace key={activeBranchId || "no-branch"} branchId={activeBranchId || null} branchLabel={branchLabel} isReady={isReady} />;
}

function MoneyAccountWorkspace({ branchId, branchLabel, isReady }: {
  branchId: string | null; branchLabel: string; isReady: boolean;
}) {
  const { hasPermission } = usePermissions();
  const canRead = hasPermission("finance.view_cash_book");
  const canManage = hasPermission("finance.create_transaction") && hasPermission("finance.void_transaction");
  const today = cashDateTimeInput().slice(0, 10);
  const [view, setView] = useState<"accounts" | "balances">("accounts");
  const [period, setPeriod] = useState({ from: `${today.slice(0, 7)}-01`, to: today });
  const [draftFrom, setDraftFrom] = useState(period.from);
  const [draftTo, setDraftTo] = useState(period.to);
  const [revision, setRevision] = useState(0);
  const [search, setSearch] = useState("");
  const [kind, setKind] = useState("all");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("code");
  const [onlyMissingOpening, setOnlyMissingOpening] = useState(false);
  const [edit, setEdit] = useState<MoneyAccount | null | undefined>();
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [result, setResult] = useState<{ key: string; accounts: MoneyAccount[]; unassigned: number; error: string }>();
  const requestKey = `${branchId}:${view}:${view === "balances" ? `${period.from}:${period.to}` : ""}:${revision}`;

  useEffect(() => {
    if (!isReady || !branchId || !canRead) return;
    let active = true;
    const request = view === "accounts"
      ? getMoneyAccounts(branchId).then(accounts => ({ accounts, unassigned_count: 0 }))
      : getMoneyAccountWorkspace(branchId, period.from, period.to);
    request.then(data => {
      if (active) setResult({ key: requestKey, accounts: data.accounts, unassigned: data.unassigned_count, error: "" });
    }).catch(error => {
      if (active) setResult({ key: requestKey, accounts: [], unassigned: 0, error: error instanceof Error ? error.message : "Không tải được tài khoản tiền." });
    });
    return () => { active = false; };
  }, [isReady, branchId, canRead, view, period.from, period.to, requestKey]);

  const loaded = result?.key === requestKey;
  const loading = Boolean(isReady && branchId && canRead && !loaded);
  const usable = isReady && branchId !== null && canRead && loaded && !result.error;
  const rows = usable ? result.accounts : emptyRows;
  const filtered = queryLocalList(rows, {
    search, searchText: r => `${r.code} ${r.name} ${moneyAccountKinds[r.kind]} ${r.bank_name || ""} ${r.account_number || ""} ${r.account_holder || ""}`,
    matches: r => (kind === "all" || r.kind === kind) && (status === "all" || r.active === (status === "active")) && (!onlyMissingOpening || !hasOpeningBalance(r)),
    sortValue: r => sort === "name" ? r.name : sort === "bank" ? r.bank_name || "" : r.code, direction: "asc",
  });
  const hasFilters = Boolean(search || kind !== "all" || status !== "all" || onlyMissingOpening);
  const invalidDraft = !draftFrom || !draftTo || draftFrom > draftTo;
  const unknownBalances = rows.filter(r => r.opening_balance == null || r.closing_balance == null).length;
  const resetFilters = () => { setSearch(""); setKind("all"); setStatus("all"); setOnlyMissingOpening(false); };
  const exportRows = async () => {
    if (exporting || loading || !usable || !filtered.length) return;
    setExporting(true); setExportError("");
    try {
      await exportToExcel(filtered.map(r => ({ ...r, branch: branchLabel, kindLabel: moneyAccountKinds[r.kind], statusLabel: r.active ? "Đang dùng" : "Ngừng dùng", from: period.from, to: period.to })),
        view === "accounts" ? accountColumns : balanceColumns,
        view === "accounts" ? `Danh-sach-tai-khoan-${today}` : `So-du-tai-khoan-${period.from}-${period.to}`, { financialTable: true });
    } catch (error) { setExportError(error instanceof Error ? error.message : "Không xuất được danh sách."); }
    finally { setExporting(false); }
  };
  const summaries = [
    ["Tổng tài khoản", rows.length], ["Đang sử dụng", rows.filter(r => r.active).length],
    ["Tài khoản ngân hàng", rows.filter(r => r.kind === "bank").length],
    ["Chưa khai báo số dư", rows.filter(r => !hasOpeningBalance(r)).length],
  ] as const;
  const selectClass = "h-10 w-full min-w-0 rounded-md border bg-background px-3 text-base sm:text-sm";
  const content = <div className="space-y-4">
    <div className="rounded-lg border bg-card p-4 space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-[minmax(16rem,1fr)_10rem_10rem_10rem]">
        <label className="col-span-2 lg:col-span-1 space-y-1.5 text-sm"><span>Tìm tài khoản</span>
          <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Mã, tên, ngân hàng, số hoặc chủ tài khoản" className="text-base sm:text-sm" disabled={loading} />
        </label>
        <label className="space-y-1.5 text-sm"><span>Loại nguồn tiền</span><select className={selectClass} value={kind} onChange={event => setKind(event.target.value)} disabled={loading}>
          <option value="all">Tất cả loại</option>{Object.entries(moneyAccountKinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select></label>
        <label className="space-y-1.5 text-sm"><span>Trạng thái</span><select className={selectClass} value={status} onChange={event => setStatus(event.target.value)} disabled={loading}>
          <option value="all">Tất cả trạng thái</option><option value="active">Đang dùng</option><option value="inactive">Ngừng dùng</option>
        </select></label>
        <label className="col-span-2 lg:col-span-1 space-y-1.5 text-sm"><span>Sắp xếp</span><select className={selectClass} value={sort} onChange={event => setSort(event.target.value)} disabled={loading}>
          <option value="code">Theo mã</option><option value="name">Theo tên</option><option value="bank">Theo ngân hàng</option>
        </select></label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyMissingOpening} onChange={event => setOnlyMissingOpening(event.target.checked)} disabled={loading} />Chưa khai báo số dư ban đầu</label>
        <div className="flex items-center gap-3 text-sm text-muted-foreground"><span role="status">{usable ? `${filtered.length} / ${rows.length} tài khoản` : loading ? "Đang tải…" : ""}</span>{hasFilters && <Button variant="ghost" size="sm" onClick={resetFilters}>Xóa lọc</Button>}</div>
      </div>
    </div>
    {!isReady ? <p role="status" className="p-8 text-center text-muted-foreground">Đang xác định chi nhánh…</p>
      : !canRead ? <p className="rounded-lg border p-6">Bạn chưa có quyền xem tài khoản tiền.</p>
      : !branchId ? <p className="rounded-lg border p-6">Chọn một chi nhánh ở thanh trên để quản lý tài khoản tiền.</p>
      : loading ? <p role="status" className="rounded-lg border p-10 text-center text-muted-foreground">Đang tải {view === "accounts" ? "danh sách tài khoản" : "số dư và thu chi"}…</p>
      : result?.error ? <div role="alert" className="rounded-lg border border-destructive/30 p-6 text-destructive"><p>{result.error}</p><Button className="mt-3" variant="outline" onClick={() => setRevision(v => v + 1)}>Thử tải lại</Button></div>
      : !filtered.length ? <div className="rounded-lg border bg-card p-8 text-center space-y-3"><Icon name="account_balance_wallet" size={32} className="mx-auto text-muted-foreground" /><h2 className="font-semibold">{rows.length ? "Không có tài khoản phù hợp" : "Chưa có quỹ hoặc tài khoản tiền"}</h2><p className="text-sm text-muted-foreground">{rows.length ? "Thử đổi từ khóa hoặc bỏ bớt điều kiện lọc." : "Tạo thông tin nguồn tiền trước; ngày và số dư ban đầu có thể bổ sung sau."}</p>{rows.length ? <Button variant="outline" onClick={resetFilters}>Bỏ điều kiện lọc</Button> : canManage && <Button onClick={() => setEdit(null)}>Tạo tài khoản đầu tiên</Button>}</div>
      : <MoneyAccountList rows={filtered} balances={view === "balances"} canManage={canManage} onEdit={setEdit} />}
  </div>;

  return <div className="min-w-0 space-y-5 p-4 sm:p-6">
    <header className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
      <div className="space-y-1"><h1 className="text-2xl font-semibold tracking-tight">Quỹ & tài khoản tiền</h1><p className="text-sm text-muted-foreground">Quản lý nơi giữ tiền, thông tin ngân hàng và theo dõi thu chi theo tài khoản.</p><p className="text-sm font-medium">Chi nhánh: {branchLabel}</p></div>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => setRevision(v => v + 1)} disabled={loading || !branchId || !canRead || !isReady}><Icon name="refresh" size={18} />Tải lại</Button>
        {hasPermission("reports.export") && <Button variant="outline" onClick={exportRows} disabled={loading || exporting || !usable || !filtered.length}><Icon name="download" size={18} />{exporting ? "Đang chuẩn bị…" : "Xuất Excel"}</Button>}
        {canManage && <Button onClick={() => setEdit(null)} disabled={!branchId || !isReady}><Icon name="add" size={18} />Thêm tài khoản</Button>}
      </div>
    </header>
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4" aria-label="Tổng quan danh mục tài khoản">
      {summaries.map(([label, value]) => <div key={label} className="rounded-lg border bg-card px-4 py-3"><p className="text-xs sm:text-sm text-muted-foreground">{label}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{usable ? value : "—"}</p></div>)}
    </div>
    {exportError && <p role="alert" className="text-sm text-destructive">{exportError}</p>}
    <Tabs value={view} onValueChange={value => { if (value === "accounts" || value === "balances") { setView(value); setExportError(""); } }} className="gap-5">
      <TabsList variant="line" className="w-full justify-start border-b h-auto min-h-11"><TabsTrigger value="accounts" className="flex-none px-3 py-3">Danh sách tài khoản</TabsTrigger><TabsTrigger value="balances" className="flex-none px-3 py-3">Số dư & thu chi</TabsTrigger></TabsList>
      <TabsContent value="accounts" className="space-y-4">{view === "accounts" && content}</TabsContent>
      <TabsContent value="balances" className="space-y-4">{view === "balances" && <>
        <div className="rounded-lg border bg-card p-4 space-y-3"><div><h2 className="font-semibold">Số dư & thu chi theo kỳ</h2><p className="mt-1 text-sm text-muted-foreground">Đang xem: {formatShortDate(period.from)} – {formatShortDate(period.to)} · Đơn vị: đồng.</p></div>
          <form className="flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); if (!invalidDraft) { setPeriod({ from: draftFrom, to: draftTo }); setRevision(value => value + 1); } }}>
            <label className="min-w-0 flex-1 basis-36 space-y-1.5 text-sm"><span>Từ ngày</span><Input type="date" value={draftFrom} onChange={event => setDraftFrom(event.target.value)} /></label>
            <label className="min-w-0 flex-1 basis-36 space-y-1.5 text-sm"><span>Đến ngày</span><Input type="date" value={draftTo} onChange={event => setDraftTo(event.target.value)} /></label>
            <Button type="submit" disabled={loading || invalidDraft || !branchId || !canRead}>Xem số dư</Button>
          </form>
          {invalidDraft && <p role="alert" className="text-sm text-destructive">Chọn đủ ngày bắt đầu và kết thúc; ngày bắt đầu không được sau ngày kết thúc.</p>}
        </div>
        {usable && (result.unassigned > 0 || unknownBalances > 0) && <div className="rounded-lg border border-amber-300 bg-amber-50/50 p-4 text-sm space-y-1 dark:bg-amber-950/20" role="status">
          {result.unassigned > 0 && <p>{result.unassigned} phiếu trong kỳ của chi nhánh chưa gắn tài khoản, chưa nằm trong số dư dưới đây.</p>}
          {unknownBalances > 0 && <p>Chưa xác định số dư cho {unknownBalances} tài khoản trong kỳ này. Kiểm tra ngày bắt đầu và số dư ban đầu.</p>}
        </div>}
        {content}
      </>}</TabsContent>
    </Tabs>
    {edit !== undefined && branchId && isReady && canRead && canManage && <MoneyAccountEditor key={edit?.id || "new"} account={edit} branchId={branchId} onClose={() => setEdit(undefined)} onSaved={() => { setEdit(undefined); setRevision(v => v + 1); }} />}
  </div>;
}
