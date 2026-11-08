"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { useAuth } from "@/lib/contexts";
import { cashDateTimeInput, formatCashTime } from "@/lib/cash-time";
import { formatNumber } from "@/lib/format";
import { cashCategoryLabel } from "@/lib/utils/cash-book-labels";
import { usePermissions } from "@/lib/permissions/use-permission";
import {
  CASH_JOURNAL_COMPANY, CASH_JOURNAL_EXPORT, CASH_JOURNAL_SELF_SPEND, JOURNAL_COLUMNS,
  exportCashJournal, getCashJournal, journalCells,
  type JournalFilters, type JournalKind, type JournalResult, type JournalRow, type JournalSort,
} from "@/lib/services/supabase/cash-journal";
import styles from "./journal.module.css";
import { SpendQueue, SpendReview } from "./spend-review";
import { PERMISSIONS } from "@/lib/permissions/constants";

function initialFilters(): JournalFilters {
  const to = cashDateTimeInput().slice(0, 10);
  return { from: to.slice(0, 8) + "01", to, search: "", branch: "", kind: "",
    account: "", category: "", sort: "day", desc: true, page: 1 };
}

type LoadState = { key: string; data?: JournalResult; error?: string };
const moneyKeys = new Set(["receipt", "payment", "net"]);
const cellText = (key: string, value: string | number) =>
  typeof value === "number" && moneyKeys.has(key) ? formatNumber(value) : value === "" ? "—" : value;

export default function CashJournalPage() {
  const { user } = useAuth();
  const { hasAny, hasPermission, isLoading, loadError, retry } = usePermissions();
  if (isLoading) return <p className="p-4" role="status">Đang kiểm tra quyền...</p>;
  if (loadError) return <div className="p-4" role="alert">Không tải được quyền truy cập. <Button onClick={() => void retry?.()}>Thử lại</Button></div>;
  if (!user || !hasAny([CASH_JOURNAL_COMPANY, CASH_JOURNAL_SELF_SPEND])) {
    return <p className="p-4" role="alert">Bạn không có quyền xem Nhật ký thu chi.</p>;
  }
  const company = hasPermission(CASH_JOURNAL_COMPANY);
  const canExport = company && hasPermission(CASH_JOURNAL_EXPORT);
  const canSubmit = company && hasPermission(PERMISSIONS.FINANCE_SUBMIT_CASH_SPEND_REVIEW);
  const canApprove = company && hasPermission(PERMISSIONS.FINANCE_APPROVE_CASH_SPEND_REVIEW);
  return <Journal key={`${user.id}:${user.tenantId}:${company}:${canExport}:${canSubmit}:${canApprove}`}
    company={company} canExport={canExport} canSubmit={canSubmit} canApprove={canApprove} />;
}

function Journal({ company, canExport, canSubmit, canApprove }: {
  company: boolean; canExport: boolean; canSubmit: boolean; canApprove: boolean;
}) {
  const [filters, setFilters] = useState(initialFilters);
  const [searchDraft, setSearchDraft] = useState("");
  const [dateDraft, setDateDraft] = useState(() => ({ from: filters.from, to: filters.to }));
  const [dateError, setDateError] = useState("");
  const [draft, setDraft] = useState<Pick<JournalFilters,"kind"|"account"|"category"> | null>(null);
  const [detail, setDetail] = useState<JournalRow | null>(null);
  const [review, setReview] = useState<string | null>(null);
  const [showQueue, setShowQueue] = useState(false);
  const [state, setState] = useState<LoadState | null>(null);
  const [revision, setRevision] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const exportRef = useRef<AbortController | null>(null);
  const key = JSON.stringify([filters, revision]);
  const received = state?.key === key ? state.data : undefined;
  const scopeMismatch = received && received.scope !== (company ? "company" : "self_spend");
  const data = scopeMismatch ? undefined : received;
  const error = scopeMismatch ? "Phạm vi quyền đã thay đổi. Vui lòng mở lại Nhật ký thu chi."
    : state?.key === key ? state.error : undefined;
  const busy = !data && !error;
  const options = state?.data?.scope === (company ? "company" : "self_spend") ? state.data : undefined;

  function cancelExport() {
    exportRef.current?.abort();
    exportRef.current = null;
    setExporting(false);
    setExportError("");
  }

  useEffect(() => {
    const controller = new AbortController();
    void getCashJournal(filters, controller.signal).then(
      data => { if (!controller.signal.aborted) setState({ key, data }); },
      error => { if (!controller.signal.aborted) setState({ key, error: error.message }); },
    );
    return () => controller.abort();
  }, [filters, key]);

  useEffect(() => {
    if (searchDraft.trim() === filters.search) return;
    const timer = window.setTimeout(() => {
      setFilters(prev => ({ ...prev, search: searchDraft.trim(), page: 1 }));
    }, 260);
    return () => window.clearTimeout(timer);
  }, [searchDraft, filters.search]);

  useEffect(() => () => exportRef.current?.abort(), []);

  function update(patch: Partial<JournalFilters>) {
    cancelExport();
    setFilters(prev => ({ ...prev, ...patch, page: patch.page ?? 1 }));
    setDetail(null);
  }

  function submitDates(event: FormEvent) {
    event.preventDefault();
    const days = (Date.parse(dateDraft.to) - Date.parse(dateDraft.from)) / 86_400_000;
    if (!Number.isFinite(days) || days < 0 || days > 365) {
      setDateError("Chọn kỳ từ 1 đến 366 ngày.");
      return;
    }
    setDateError("");
    update({ ...dateDraft, account: "", category: "" });
  }

  async function download() {
    if (!canExport || !data?.totals.count || data.scope !== "company" || exporting) return;
    const controller = new AbortController();
    exportRef.current = controller;
    setExporting(true);
    setExportError("");
    try {
      const full = await getCashJournal(filters, controller.signal, true);
      if (!controller.signal.aborted) {
        await exportCashJournal(full, filters, { shouldSave: () => !controller.signal.aborted });
      }
    } catch (error) {
      if (!controller.signal.aborted) setExportError(error instanceof Error ? error.message : "Không xuất được Excel.");
    } finally {
      if (!controller.signal.aborted) setExporting(false);
    }
  }

  const activeCount = Number(Boolean(filters.kind)) + Number(Boolean(filters.account)) + Number(Boolean(filters.category));
  const pages = data ? Math.max(1, Math.ceil(data.totals.count / data.pageSize)) : 1;
  const columns = company ? JOURNAL_COLUMNS : JOURNAL_COLUMNS.filter(col => col.key !== "receipt" && col.key !== "net");
  function sortBy(sort: JournalSort) { update({ sort, desc: filters.sort === sort ? !filters.desc : sort === "day" }); }

  return (
    <section className={styles.journal} aria-labelledby="journal-title">
      <header className={styles.header}>
        <div><h1 id="journal-title">Nhật ký thu chi</h1>
          <span className={styles.muted}>{company ? "ĐVT: đồng" : "Chi tại quán · ĐVT: đồng"}</span></div>
        <div className={styles.actions}>
        {canApprove && <Button size="sm" variant="outline" onClick={() => setShowQueue(true)}>Chờ tôi duyệt</Button>}
        {canExport && <Button size="sm" onClick={() => void download()} disabled={exporting || busy || !data?.totals.count || searchDraft.trim() !== filters.search}>
          <Icon name="download" size={16} />{exporting ? "Đang xuất..." : "Xuất Excel"}
        </Button>}
        </div>
      </header>
      <div className={styles.tools}>
        <form className={styles.dates} onSubmit={submitDates} aria-label="Kỳ báo cáo">
          <label>Từ ngày<input type="date" required value={dateDraft.from} onChange={e => setDateDraft(prev => ({ ...prev, from: e.target.value }))} /></label>
          <label>Đến ngày<input type="date" required value={dateDraft.to} onChange={e => setDateDraft(prev => ({ ...prev, to: e.target.value }))} /></label>
          <Button variant="outline" size="sm" type="submit" disabled={dateDraft.from === filters.from && dateDraft.to === filters.to}>Áp dụng</Button>
        </form>
        <div className={styles.find}>
          <input type="search" aria-label="Tìm phiếu" placeholder="Tìm mã phiếu, nội dung..." value={searchDraft} maxLength={160} onChange={e => { cancelExport(); setSearchDraft(e.target.value); }} />
          <select aria-label="Chi nhánh" value={filters.branch} onChange={e => update({ branch: e.target.value, account: "", category: "" })}>
            <option value="">{company ? "Tất cả chi nhánh" : "Chi nhánh được giao"}</option>
            {options?.branches.map(b => <option key={b.id} value={b.id}>{b.label}</option>)}
          </select>
          <Button variant="outline" size="sm" onClick={() => setDraft({ kind: filters.kind, account: filters.account, category: filters.category })}>
            <Icon name="filter_alt" size={16} /> Lọc{activeCount > 0 ? ` (${activeCount})` : ""}
          </Button>
        </div>
      </div>
      {dateError && <p className={styles.error} role="alert">{dateError}</p>}
      {exportError && <p className={styles.error} role="alert">{exportError}</p>}
      {error && <div className={styles.error} role="alert">{error} <Button size="sm" variant="outline" onClick={() => setRevision(v => v + 1)}>Thử lại</Button></div>}
      {busy && <p className={styles.empty} role="status">Đang tải nhật ký...</p>}
      {data && (
        <>
          <div className={styles.totals} aria-label="Tổng theo bộ lọc">
            {company && <div data-tone="receipt"><span>Thu</span><strong>{formatNumber(data.totals.receipt)}</strong></div>}
            <div data-tone="payment"><span>Chi</span><strong>{formatNumber(data.totals.payment)}</strong></div>
            {company && <div data-tone="net"><span>Tổng</span><strong>{formatNumber(data.totals.net)}</strong></div>}
            <div><span>Số phiếu</span><strong>{formatNumber(data.totals.count)}</strong></div>
          </div>
          {data.rows.length ? (
            <>
              <div className={styles.tableWrap} tabIndex={0} role="region" aria-label="Bảng Nhật ký thu chi">
                <table className={styles.table}>
                  <thead><tr>{columns.map(({ key, header }) => (
                    <th key={key} scope="col" className={moneyKeys.has(key) ? styles.amount : undefined}
                      aria-sort={filters.sort === key ? filters.desc ? "descending" : "ascending" : undefined}>
                      {key === "stt" ? header : <button onClick={() => sortBy(key)} title={key === "net" ? "Tổng = Thu − Chi" : undefined}>{header}<Icon aria-hidden="true" name={filters.sort === key ? filters.desc ? "arrow_downward" : "arrow_upward" : "unfold_more"} size={14} /></button>}
                    </th>
                  ))}</tr></thead>
                  <tbody>{data.rows.map(row => {
                    const cells = journalCells(row);
                    return <tr key={row.id}>{columns.map(({ key }) => (
                      <td key={key} className={moneyKeys.has(key) ? styles.amount : undefined}>
                        {key === "code" ? <button className={styles.link} onClick={() => setDetail(row)}>{row.code}</button>
                          : key === "note" ? <span className={styles.note}>{cellText(key, cells[key])}</span> : cellText(key, cells[key])}
                      </td>
                    ))}</tr>;
                  })}</tbody>
                  <tfoot><tr>{columns.map(({ key }) => <td key={key} className={moneyKeys.has(key) ? styles.amount : undefined}>
                    {key === "note" ? "Tổng theo bộ lọc" : key === "receipt" || key === "payment" || key === "net" ? formatNumber(data.totals[key]) : null}
                  </td>)}</tr></tfoot>
                </table>
              </div>
              <div className={styles.mobile}>
                <div className={styles.mobileSort}>
                  <select aria-label="Sắp xếp theo" value={filters.sort} onChange={e => update({ sort: e.target.value as JournalSort, desc: e.target.value === "day" })}>
                    {columns.filter(col => col.key !== "stt").map(col => <option key={col.key} value={col.key}>{col.header}</option>)}
                  </select>
                  <Button size="icon-sm" variant="outline" title={filters.desc ? "Giảm dần" : "Tăng dần"}
                    aria-label={filters.desc ? "Đổi sang tăng dần" : "Đổi sang giảm dần"} onClick={() => update({ desc: !filters.desc })}>
                    <Icon name={filters.desc ? "arrow_downward" : "arrow_upward"} size={16} />
                  </Button>
                </div>
                <ul>{data.rows.map(row => (
                  <li key={row.id}><button type="button" onClick={() => setDetail(row)}>
                    <span className={styles.rowIdentity}>
                      <strong>{row.stt}. {row.code}</strong><span className={styles.note}>{row.note || journalCells(row).category}</span>
                      <small>{journalCells(row).day} · {row.branch}</small>
                    </span>
                    <strong className={styles.rowValue} data-type={row.payment ? "payment" : "receipt"}>{formatNumber(company ? row.net : row.payment)}</strong>
                    <Icon name="chevron_right" size={16} />
                  </button></li>
                ))}</ul>
              </div>
            </>
          ) : <p className={styles.empty}>{data.scope === "self_spend" ? "Không có khoản tự chi đã xác nhận trong bộ lọc." : "Không có phiếu trong bộ lọc."}</p>}
          {pages > 1 || filters.page > 1 ? <nav className={styles.paging} aria-label="Phân trang Nhật ký thu chi">
            <Button variant="outline" size="icon-sm" aria-label="Trang trước" disabled={filters.page <= 1} onClick={() => update({ page: filters.page - 1 })}><Icon name="chevron_left" size={16} /></Button>
            <span>Trang {filters.page} / {pages}</span>
            <Button variant="outline" size="icon-sm" aria-label="Trang sau" disabled={filters.page >= pages} onClick={() => update({ page: filters.page + 1 })}><Icon name="chevron_right" size={16} /></Button>
          </nav> : null}
        </>
      )}

      <Dialog open={draft !== null} onOpenChange={open => { if (!open) setDraft(null); }}>
        <DialogContent className={styles.dialog}>
          <DialogTitle>Bộ lọc phát sinh</DialogTitle>
          {draft && <form className={styles.filterForm} onSubmit={e => { e.preventDefault(); update(draft); setDraft(null); }}>
            {company && <label>Loại phiếu<select value={draft.kind} onChange={e => setDraft({ ...draft, kind: e.target.value as JournalKind })}>
              <option value="">Tất cả loại phiếu</option><option value="receipt">Thu</option><option value="payment">Chi</option>
            </select></label>}
            <label>Nguồn tiền<select value={draft.account} onChange={e => setDraft({ ...draft, account: e.target.value })}>
              <option value="">Tất cả nguồn tiền</option>{options?.accounts.map(a => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select></label>
            <label>Khoản mục<select value={draft.category} onChange={e => setDraft({ ...draft, category: e.target.value })}>
              <option value="">Tất cả khoản mục</option>{options?.categories.map(a => <option key={a.id} value={a.id}>{a.id === a.label ? cashCategoryLabel(a.label) : a.label}</option>)}
            </select></label>
            <div className={styles.actions}>
              <Button type="button" size="sm" variant="outline" onClick={() => setDraft({ kind: "", account: "", category: "" })}>Đặt lại</Button>
              <Button type="submit" size="sm">Áp dụng</Button>
            </div>
          </form>}
        </DialogContent>
      </Dialog>

      <Dialog open={detail !== null} onOpenChange={open => { if (!open) setDetail(null); }}>
        <DialogContent className={styles.dialog}>
          <DialogTitle>{detail?.code}</DialogTitle>
          <DialogDescription>Chi tiết phiếu · ĐVT: đồng</DialogDescription>
          {detail && <dl className={styles.detail}>
            {columns.map(({ key, header }) => <div key={key}><dt>{header}</dt><dd>{cellText(key, journalCells(detail)[key])}</dd></div>)}
            <div><dt>Mã thu chi</dt><dd>{detail.category_code ?? "—"}</dd></div>
            <div><dt>Thời điểm thực thu/chi</dt><dd>{formatCashTime(detail.occurred_at)}</dd></div>
            {detail.payment > 0 && <div><dt>Đơn vị thực chi</dt><dd>{detail.payer ?? "Chưa xác nhận"}</dd></div>}
          </dl>}
          {company && detail && detail.payment > 0 && <Button size="sm" variant="outline" onClick={() => {
            setReview(detail.id); setDetail(null);
          }}>Hồ sơ đơn vị thực chi</Button>}
        </DialogContent>
      </Dialog>
      {showQueue && <SpendQueue close={() => setShowQueue(false)} select={id => { setShowQueue(false); setReview(id); }} />}
      {review && <SpendReview key={review} cashId={review} branches={options?.branches ?? []}
        canSubmit={canSubmit} canApprove={canApprove} close={() => setReview(null)} onChange={() => {
          cancelExport(); setRevision(v => v + 1);
        }} />}
    </section>
  );
}
