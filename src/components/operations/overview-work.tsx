"use client";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import { formatDate, formatNumber } from "@/lib/format";
import { filterDates, initialFilters } from "@/lib/operations/filters";
import { compareCriteriaBySource, criterionGroup, criterionTitle } from "@/lib/operations/criterion-presentation";
import { toCreatedAtEndExclusiveIso, toCreatedAtStartIso } from "@/lib/utils/list-date-preset-range";
import type { QualityWorkspace } from "@/lib/operations/quality-contracts";
import type { QualityDestination, QualityFocus } from "./quality-overview";
import s from "./overview.module.css";

type Preset = "today" | "this_week" | "period";
type Tab = "unknown" | "all" | "overdue";
type Row = { id: string; code?: string; title: string; category?: string; group_title?: string; quality: string; original_due_at: string; current_due_at?: string | null; manager_ids?: string[] };
type Page = { rows: Row[]; total: number };
type Summary = { scope: string; pages: Record<Tab | "met", Page> };
type Props = { data: QualityWorkspace; branch: string; period: string; people: {id: string; name: string}[]; onNavigate: (view: QualityDestination, focus?: QualityFocus) => void };

export function OverviewWork({ data, branch, period, people, onNavigate }: Props) {
  const [now] = useState(() => new Date());
  const today = new Date(now.getTime() + 7 * 3600000).toISOString().slice(0, 10);
  const [selection, setSelection] = useState<{period: string; preset: Preset}>({period, preset: period === today.slice(0, 7) ? "today" : "period"});
  const preset = selection.period === period ? selection.preset : period === today.slice(0, 7) ? "today" : "period";
  const [tab, setTab] = useState<Tab>("unknown");
  const [search, setSearch] = useState("");
  const [querySearch, setQuerySearch] = useState("");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [searched, setSearched] = useState<{key: string; page?: Page; error?: string} | null>(null);
  const [failure, setFailure] = useState<{scope: string; message: string} | null>(null);
  const [retry, setRetry] = useState(0);
  const workPanel = useRef<HTMLElement>(null);
  const range = filterDates({...initialFilters("run"), preset}, period, now);
  const periodEndsOn = filterDates({...initialFilters("run"), preset: "period"}, period, now).to!;
  const periodEnded = today > periodEndsOn;
  const scope = `${branch}:${period}:${preset}:${range.from}:${range.to}`;
  const query = (kind: Tab | "met", term = "") => {
    const params = new URLSearchParams({branch, period, kind: "work", dateField: "due", offset: "0"});
    if (range.from) params.set("from", toCreatedAtStartIso(range.from)!);
    if (range.to) params.set("to", toCreatedAtEndExclusiveIso(range.to)!);
    if (kind !== "all") params.set("result", kind === "met" ? "met" : "unknown");
    if (kind === "overdue") params.set("overdue", "true");
    if (term) params.set("search", term);
    return `/api/operations/quality?${params}`;
  };
  const allUrl = query("all"), unknownUrl = query("unknown"), overdueUrl = query("overdue"), metUrl = query("met"), searchUrl = query(tab, querySearch);
  const searchKey = `${scope}:${tab}:${querySearch}`;
  useEffect(() => {
    const timer = setTimeout(() => setQuerySearch(search.trim()), 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    const controller = new AbortController();
    async function read(url: string): Promise<Page> {
      const response = await fetch(url, {cache: "no-store", signal: controller.signal});
      const value = await response.json();
      if (!response.ok) throw Error(value.error ?? "Chưa tải được công việc.");
      return value;
    }
    // Exact server totals, not a count of the first paginated list. No polling or retry loop.
    void Promise.all([read(allUrl), read(unknownUrl), read(overdueUrl)]).then(async ([all, unknown, overdue]) => {
      // Reuse a complete page; only larger lists need a fourth bounded count read.
      if (controller.signal.aborted) return;
      const metRows = all.rows.filter(row => row.quality === "met");
      const met = all.total <= all.rows.length ? {rows: metRows, total: metRows.length} : await read(metUrl);
      if (!controller.signal.aborted) { setSummary({scope, pages: {all, unknown, overdue, met}}); setFailure(null); }
    }).catch(error => {
      if (!controller.signal.aborted) setFailure({scope, message: error instanceof Error ? error.message : "Chưa tải được công việc."});
    });
    return () => controller.abort();
  }, [allUrl, unknownUrl, overdueUrl, metUrl, scope, retry]);
  useEffect(() => {
    if (!querySearch) return;
    const controller = new AbortController();
    void fetch(searchUrl, {cache: "no-store", signal: controller.signal}).then(async response => {
      const value = await response.json();
      if (!response.ok) throw Error(value.error ?? "Chưa tìm được công việc.");
      if (!controller.signal.aborted) setSearched({key: searchKey, page: value});
    }).catch(error => {
      if (!controller.signal.aborted) setSearched({key: searchKey, error: error instanceof Error ? error.message : "Chưa tìm được công việc."});
    });
    return () => controller.abort();
  }, [querySearch, searchUrl, searchKey, retry]);
  const current = summary?.scope === scope ? summary.pages : null;
  const searching = search.trim() !== querySearch;
  const error = failure?.scope === scope ? failure.message : !searching && querySearch && searched?.key === searchKey ? searched.error : null;
  const loadedPage = searching ? undefined : querySearch ? searched?.key === searchKey ? searched.page : undefined : current?.[tab];
  const page = loadedPage ? {...loadedPage, rows: [...loadedPage.rows].sort((a, b) => Date.parse(a.current_due_at ?? a.original_due_at) - Date.parse(b.current_due_at ?? b.original_due_at) || compareCriteriaBySource(a, b))} : undefined;
  const pending = current?.unknown.total, total = current?.all.total;
  const checked = total == null || pending == null ? null : Math.max(0, total - pending);
  const passed = current?.met.total;
  const failed = checked == null || passed == null ? undefined : Math.max(0, checked - passed);
  const percent = checked == null || !total ? 0 : Math.round(checked / total * 100);
  const focus = (kind: Tab = tab, row?: Row): QualityFocus => ({preset, ...(kind !== "all" ? {result: "unknown"} : {}), ...(kind === "overdue" ? {overdue: true} : {}), ...(row ? {search: row.title, taskId: row.id} : querySearch ? {search: querySearch} : {})});
  const setFilter = (next: Tab) => {setTab(next); setSearch(""); setQuerySearch("");};
  const revealFilter = (next: Tab) => {
    setFilter(next);
    workPanel.current?.scrollIntoView?.({block: "start", behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"});
  };
  const count = (value?: number) => value == null ? "—" : formatNumber(value);
  const owner = (row: Row) => row.manager_ids?.map(id => people.find(person => person.id === id)?.name ?? "Người trong phân công").join(", ") || "Chờ phân công";
  const quality = (row: Row) => row.quality === "met" ? "Đạt" : row.quality === "unmet" ? "Không đạt" : "Chưa kiểm tra";
  const periodLabel = `Tháng ${period.slice(5)}/${period.slice(0, 4)}`;
  return <>
    <div className={s.scopeBar}>
      <div><Icon name="date_range" size={18}/><span>{range.from && formatDate(`${range.from}T00:00:00+07:00`).split(" ")[0]} – {range.to && formatDate(`${range.to}T00:00:00+07:00`).split(" ")[0]}</span></div>
      <label>Khoảng công việc<select aria-label="Khoảng công việc tổng quan" value={preset} onChange={event => {setSelection({period, preset: event.target.value as Preset}); setFilter("unknown");}}><option value="today">Hôm nay</option><option value="this_week">Tuần này</option><option value="period">{periodLabel}</option></select></label>
    </div>
    <div className={s.metrics} aria-label="Tình hình cần chú ý">
      <button className={s.warningMetric} onClick={() => revealFilter("overdue")}><span>Quá hạn chưa kiểm tra<Icon name="schedule" size={19}/></span><strong>{count(current?.overdue.total)}<small> việc</small></strong><span>Trong khoảng công việc đang chọn</span></button>
      <button onClick={() => revealFilter("unknown")}><span>Cần kiểm tra<Icon name="checklist" size={19}/></span><strong>{count(pending)}<small> việc</small></strong><span>Bao gồm việc quá hạn chưa kiểm tra</span></button>
      <button onClick={() => onNavigate("issues", {periodOnly: true, state: "pending_review"})}><span>To-do chờ kiểm tra lại<Icon name="assignment_turned_in" size={19}/></span><strong>{count(data.issueSummary?.awaiting)}<small> việc</small></strong><span>Theo hạn To-do · {periodLabel}</span></button>
      <button onClick={() => onNavigate("qc", {periodOnly: true})}><span>Kết quả QC chính thức<Icon name="verified_user" size={19}/></span><strong className={s.scoreValue}>{data.score?.official && data.score.score != null ? `${formatNumber(data.score.score)} điểm` : "Chưa xác định"}</strong><span>{periodLabel} · {formatNumber(data.score?.completedAudits ?? 0)} đợt hoàn tất</span></button>
    </div>
    <div className={s.mainGrid}>
      <section ref={workPanel} className={s.workPanel} aria-label="Việc cần chú ý">
        <div className={s.panelHeading}><h3>Việc cần chú ý <span className={s.count}>{count(pending)}</span></h3><button onClick={() => onNavigate("work", focus("all"))}>Xem tất cả<Icon name="arrow_forward" size={17}/></button></div>
        <div className={s.tools}><div className={s.tabs} aria-label="Lọc nhanh công việc">{([["unknown", "Chưa kiểm tra"], ["all", "Tất cả"], ["overdue", "Quá hạn"]] as const).map(([value, label]) => <button key={value} aria-pressed={tab === value} onClick={() => setFilter(value)}>{label}</button>)}</div><label className={s.search}><Icon name="search" size={18}/><input aria-label="Tìm công việc tổng quan" placeholder="Tìm công việc…" maxLength={200} value={search} onChange={event => setSearch(event.target.value)}/></label></div>
        {error ? <div className={s.empty} role="alert">{error}<button onClick={() => setRetry(value => value + 1)}>Thử lại</button></div> : !page || search.trim() !== querySearch ? <p className={s.empty} role="status">Đang tải công việc…</p> : !page.rows.length ? <div className={s.empty}><Icon name="task_alt" size={28}/><strong>{querySearch ? "Không tìm thấy công việc" : "Không có việc trong bộ lọc này"}</strong><button onClick={() => setFilter("all")}>Xem tất cả công việc</button></div> : <>
          <div className={s.tableWrap}><table className={s.table}><thead><tr><th>Nhóm công việc</th><th>Công việc</th><th>Phụ trách</th><th>Đến hạn</th><th>Kết quả</th><th><span className={s.srOnly}>Chi tiết</span></th></tr></thead><tbody>{page.rows.slice(0, 8).map(row => <tr key={row.id}><td>{criterionGroup(row, data.groups ?? [])}</td><td><strong>{criterionTitle(row)}</strong></td><td>{owner(row)}</td><td>{formatDate(row.current_due_at ?? row.original_due_at)}</td><td><span className={s.badge} data-result={row.quality}>{quality(row)}</span></td><td><button aria-label={`Chi tiết: ${row.title}`} onClick={() => onNavigate("work", focus(tab, row))}><Icon name="arrow_forward" size={18}/></button></td></tr>)}</tbody></table></div>
          <div className={s.workCards}>{page.rows.slice(0, 8).map(row => <article key={row.id}><span className={s.group}>{criterionGroup(row, data.groups ?? [])}</span><strong>{criterionTitle(row)}</strong><span className={s.badge} data-result={row.quality}>{quality(row)}</span><p>{owner(row)}</p><div><span>{formatDate(row.current_due_at ?? row.original_due_at)}</span><button aria-label={`Chi tiết: ${row.title}`} onClick={() => onNavigate("work", focus(tab, row))}>Chi tiết<Icon name="arrow_forward" size={17}/></button></div></article>)}</div>
        </>}
        <div className={s.tableFooter}><span>{page ? `${formatNumber(Math.min(page.rows.length, 8))} / ${formatNumber(page.total)} công việc` : "Đang tải"}</span><span>Chưa kiểm tra ≠ Không đạt</span>{page && page.total > 8 && <button onClick={() => onNavigate("work", focus())}>Xem đầy đủ</button>}</div>
      </section>
      <aside className={s.sideColumn}>
        <section className={s.sidePanel} aria-label="Tiến độ kiểm tra">
          <h3>Nhịp vận hành</h3><p className={s.secondary}>{preset === "today" ? "Hôm nay" : preset === "this_week" ? "Tuần này" : periodLabel}</p>
          <div className={s.progressNumber}><strong>{checked == null ? "—" : formatNumber(checked)}<small>/{count(total)}</small></strong><span>việc đã ghi kết quả</span></div>
          <div className={s.progress} role="progressbar" aria-label="Tiến độ ghi kết quả" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={checked == null ? "Chưa tải được số liệu" : `${checked} trên ${total} công việc đã ghi kết quả`}><span style={{width: `${percent}%`}}/></div>
          <p className={s.progressCaption}>{current ? total ? `${percent}% · Còn ${count(pending)} việc chưa kiểm tra` : "Chưa có lịch công việc trong khoảng chọn" : "Đang tải số liệu…"}</p>
          <dl className={s.resultSplit} aria-label="Kết quả tự kiểm tra"><div><dt>Đạt</dt><dd>{count(passed)}</dd></div><div><dt>Không đạt</dt><dd>{count(failed)}</dd></div></dl>
          <p className={s.note}>Ghi kết quả không đồng nghĩa với đạt yêu cầu. Điểm QC được xác minh độc lập.</p>
        </section>
        <section className={s.sidePanel} aria-label="Điều kiện chốt kỳ">
          <div className={s.readinessHeading}><h3>Điều kiện chốt kỳ</h3><span className={s.badge}>{data.settlement ? "Đã chốt" : data.score?.rewardReady && periodEnded ? "Có thể xem trước" : "Chưa đủ"}</span></div>
          <ul className={s.readiness}>
            <li><Icon name={data.assignments.length ? "check_circle" : "radio_button_unchecked"} size={19}/><div><strong>Phân công công việc</strong><span>{data.assignments.length ? `${formatNumber(data.assignments.length)} công việc có phân công` : "Chưa có phân công tại chi nhánh"}</span></div></li>
            <li><Icon name={data.score?.official ? "check_circle" : "radio_button_unchecked"} size={19}/><div><strong>QC chính thức</strong><span>{data.score?.official ? "Đã có kết quả" : "Chờ đợt QC hoàn tất"}</span></div></li>
            <li><Icon name={data.score?.rewardReady ? "check_circle" : "radio_button_unchecked"} size={19}/><div><strong>Điểm và thưởng</strong><span>{data.score?.rewardReady ? "Đủ điều kiện tính thưởng" : "Còn điều kiện cần xác minh"}</span></div></li>
            <li><Icon name={periodEnded ? "check_circle" : "radio_button_unchecked"} size={19}/><div><strong>Kết thúc kỳ</strong><span>{periodEnded ? "Kỳ đánh giá đã kết thúc" : `Chờ hết ngày ${formatDate(`${periodEndsOn}T00:00:00+07:00`).split(" ")[0]}`}</span></div></li>
          </ul>
          <button onClick={() => onNavigate("report")}>Xem điều kiện chi tiết<Icon name="arrow_forward" size={17}/></button>
          <p className={s.note}>Chỉ chốt sau ngày kết thúc kỳ và khi đủ điều kiện. Công việc hằng ngày vẫn thực hiện độc lập.</p>
        </section>
      </aside>
    </div>
  </>;
}
