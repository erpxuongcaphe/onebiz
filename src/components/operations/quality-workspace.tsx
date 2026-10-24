"use client";
import { UserBranchContext, UserPicker } from "./user-picker";
import { filterPeople } from "@/lib/operations/people-filters";
import { WorkingImport } from "./working-import";
import { WorkingLibrary } from "./working-library";
import { OperationsHistoryPanel } from "./history";
import { ScheduleReview } from "./schedule-review";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { Workspace, Run } from "@/lib/operations/contracts";
import { categories, priorities } from "@/lib/operations/contracts";
import { formatDate, formatShortDate, formatNumber } from "@/lib/format";
import {
  datePresets,
  filterDates,
  initialFilters,
} from "@/lib/operations/filters";
import {
  toCreatedAtStartIso,
  toCreatedAtEndExclusiveIso,
} from "@/lib/utils/list-date-preset-range";
import type {
  QualityAction,
  QualityAudit,
  QualityIssue,
  QualityLine,
  QualityWorkspace as QualityData,
} from "@/lib/operations/quality-contracts";
import { requestPageLeave } from "@/lib/hooks/use-unsaved-work";
import { Icon } from "@/components/ui/icon";
import { QualityEditorDialog, type QualityEditor } from "./quality-editor";
import { Field, SelectField, vnToday } from "./quality-fields";
import { CatalogImport } from "./quality-settings";
import { QualityBusinessSetup } from "./quality-business-setup";
import { QualityFilters } from "./quality-filters";
import { QualityOverview, type QualityFocus, type QualityDestination } from "./quality-overview";
import { QualityReport } from "./quality-report";
import { SetupNavigation, type SetupSection } from "./setup-navigation";
import { compareCriteriaBySource, criterionGroup, criterionTitle } from "@/lib/operations/criterion-presentation";
import s from "./quality.module.css";

const views = [
  { key: "overview", label: "Tổng quan quản lý", icon: "dashboard" },
  { key: "work", label: "Tự kiểm tra", icon: "fact_check" },
  { key: "issues", label: "To-do & phối hợp", icon: "checklist" },
  { key: "qc", label: "QC độc lập", icon: "verified_user" },
  { key: "report", label: "Điểm & thưởng", icon: "monitoring" },
  { key: "settings", label: "Thiết lập vận hành", icon: "tune" },
] as const;
type View = (typeof views)[number]["key"];
const statusNames: Record<string, string> = {
  unknown: "Chưa kiểm tra",
  met: "Đạt",
  unmet: "Không đạt",
  pending: "Mới",
  in_progress: "Đang xử lý",
  pending_review: "Chờ kiểm tra lại",
  done: "Đã đóng",
  canceled: "Hủy do ghi nhầm",
  draft: "Nháp",
  completed: "Đã hoàn tất",
  approved: "Đã duyệt",
  excluded: "Ngoài phạm vi",
};
const freq = {
    once: "Một lần",
  daily: "Hàng ngày",
  weekly: "Hàng tuần",
  monthly: "Hàng tháng",
    quarterly: "Hằng quý",
    yearly: "Hằng năm",
  event: "Phát sinh",
};
function Badge({ value }: { value: string }) {
  return (
    <span className={`${s.badge} ${s[value] ?? ""}`}>
      {statusNames[value] ?? value}
    </span>
  );
}
function CorrectionHistory({ line, people }: { line: QualityLine; people: Workspace["people"] }) {
  if (!line.corrections?.length) return null;
  return (
    <details className={s.section}>
      <summary>Đính chính ({line.corrections.length}) · Kết quả hiện tại: <Badge value={line.corrections[0].after_data.result} /></summary>
      {line.corrections.map((correction) => (
        <article key={correction.id} className={s.section}>
          <p><Badge value={correction.before_data.result} /> → <Badge value={correction.after_data.result} /></p>
          <p>{people.find((person) => person.id === correction.actor_id)?.name ?? "Người dùng OneBiz"} · {formatDate(correction.created_at)}</p>
          <p>{correction.reason}</p>
          <p>Minh chứng: {correction.evidence}</p>
        </article>
      ))}
    </details>
  );
}

function Table({
  heads,
  rows,
  mobile,
}: {
  heads: string[];
  rows: ReactNode[];
  mobile: ReactNode[];
}) {
  return (
    <>
      <div className={`${s.tableScroll} ${s.responsive}`}>
        <table className={s.table}>
          <thead>
            <tr>
              {heads.map((h) => (
                <th key={h} className={h === "Trọng số" ? s.numeric : undefined}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>{rows}</tbody>
        </table>
      </div>
      <div className={s.mobileList}>{mobile}</div>
    </>
  );
}

export function QualityWorkspace({
  workspace,
  branch: initialBranch,
  period: calendarPeriod,
  assessmentPeriod,
  onAssessmentPeriodChange,
  configuration,
  focus,
  onNavigate,
  onLegacySettings,
  onConfigurationRefresh,
  initialView = "work",
}: {
  workspace: Workspace;
  onConfigurationRefresh?: () => void;
  branch: string;
  period: string;
  assessmentPeriod?: string;
  onAssessmentPeriodChange?: (period: string) => void;
  configuration?: ReactNode | ((data: QualityData, section?: "standards" | "members", onAssign?: (familyId: string) => void) => ReactNode);
  focus?: QualityFocus;
  onNavigate?: (view: QualityDestination, focus?: QualityFocus) => void;
  onLegacySettings: () => void;
  initialView?: View;
}) {
  const period = assessmentPeriod || calendarPeriod;
  const view = initialView;
  const [branch, setBranch] = useState(initialBranch);
  const [storedData, setData] = useState<
    (QualityData & { scopeKey: string }) | null
  >(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [setup, setSetup] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<QualityEditor | null>(null);
  const [selectedAudit, setSelectedAudit] = useState<QualityAudit | null>(null);
  const [workMode, setWorkMode] = useState("scheduled");
  const [setupSection, setSetupSection] = useState<SetupSection>(workspace.isCeo ? "library" : "branch");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [state, setState] = useState(focus?.state ?? "");
  const [category, setCategory] = useState("");
  const [priority, setPriority] = useState("");
  const [assignee, setAssignee] = useState("");
  const [operator, setOperator] = useState("");
  const [department, setDepartment] = useState("");
  const [frequency, setFrequency] = useState("");
  const [result, setResult] = useState(focus?.result ?? "");
  const [mine, setMine] = useState(false);
  const [overdue, setOverdue] = useState(focus?.overdue ?? false);
  const [offset, setOffset] = useState(0);
  const [dates, setDates] = useState(() => ({
    ...initialFilters("todo"),
    preset: (initialView === "work" && !focus && calendarPeriod === vnToday().slice(0,7) ? "today" : initialView === "issues" && !focus?.periodOnly
      ? "all"
      : "period") as keyof typeof datePresets,
    dateField: initialView === "qc" ? "created" : "due",
  }));
  const [revision, setRevision] = useState(0);
  const active = useRef<AbortController | null>(null);
  const lock = useRef(false);
  const pending = useRef<{ body: string; id: string } | null>(null);
  const [scope, setScope] = useState(`${branch}:${period}`);
  if (scope !== `${branch}:${period}`) {
    setScope(`${branch}:${period}`);
    setData(null);
    setSelectedAudit(null);
    setEditor(null);
    setOffset(0);
    if(view === "work") {
      setDates(previous => ({...previous,preset:calendarPeriod === vnToday().slice(0,7) && !focus ? "today" : "period",dateField:"due"}));
      setOverdue(false);
    }
  }
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (initialView !== "qc") return;
    const id = new URLSearchParams(window.location.search).get("audit");
    if (
      id &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        id,
      )
    )
      setSelectedAudit({
        id,
        title: "Đợt QC",
        period,
        state: "draft",
        auditor_id: "",
        created_at: "",
        completed_at: null,
        rule_id: null,
        version: 0,
      });
  }, [initialView, period]);
  const reset = () => {
    setSearch("");
    setState("");
    setCategory("");
    setPriority("");
    setAssignee("");
    setOperator("");
    setDepartment("");
    setFrequency("");
    setResult("");
    setMine(false);
    setOverdue(false);
    setOffset(0);
    setDates({
      ...initialFilters("todo"),
      preset: view === "work" && calendarPeriod === vnToday().slice(0,7) ? "today" : view === "issues" ? "all" : "period",
      dateField: view === "qc" || view === "work" && workMode === "adhoc" ? "created" : "due",
    });
  };
  let params = "",
    filterError = "";
  try {
    const customRange = dates.preset === "period" && period.startsWith("custom:");
    const range: { from?: string; to?: string } = customRange ? {} : filterDates(dates, calendarPeriod);
    const q = new URLSearchParams({
      branch,
      period,
      kind: view === "work" && workMode === "adhoc" ? "adhoc" : view,
      search: debouncedSearch,
      state,
      category,
      priority,
      frequency,
      result,
      mine: String(mine),
      overdue: String(overdue),
      periodRange: String(customRange),
      dateField: dates.dateField,
      offset: String(offset),
    });
    for (const [key, value] of Object.entries({
      assignee,
      operator,
      department,
      entity: selectedAudit?.id ?? "",
    }))
      if (value) q.set(key, value);
    if (range.from) q.set("from", toCreatedAtStartIso(range.from)!);
    if (range.to) q.set("to", toCreatedAtEndExclusiveIso(range.to)!);
    params = q.toString();
  } catch (e) {
    filterError = e instanceof Error ? e.message : "Khoảng ngày không hợp lệ.";
  }
  const data = storedData?.scopeKey === params ? storedData : null;
  useEffect(() => {
    if (
      data?.audit &&
      data.audit.id === selectedAudit?.id &&
      (data.audit.version !== selectedAudit.version ||
        data.audit.state !== selectedAudit.state)
    )
      setSelectedAudit(data.audit);
  }, [data?.audit, selectedAudit]);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      if (!params) return;
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/operations/quality?${params}`, {
          cache: "no-store",
          signal,
        });
        const body = await response.json();
        if (signal?.aborted) return;
        if (!response.ok) {
          setSetup(!!body.setupRequired);
          throw Error(body.error);
        }
        setSetup(false);
        setData({ ...body, scopeKey: params });
      } catch (e) {
        if (!signal?.aborted) {
          setError(e instanceof Error ? e.message : "Không tải được dữ liệu.");
          setData(null);
        }
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [params],
  );
  useEffect(() => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setData(null);
    void load(controller.signal);
    return () => controller.abort();
  }, [load, revision]);
  async function send(
    action: QualityAction,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    if (lock.current) return false;
    lock.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const full = { ...payload, branchId: branch };
      const body = JSON.stringify({ action, payload: full });
      if (pending.current?.body !== body)
        pending.current = { body, id: crypto.randomUUID() };
      const response = await fetch("/api/operations/quality", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          payload: full,
          requestId: pending.current.id,
        }),
      });
      const b = await response.json();
      if (!response.ok) throw Error(b.error);
      pending.current = null;
      setEditor(null);
      setNotice("Đã lưu. Lịch sử cũ được giữ nguyên.");
      setRevision((r) => r + 1);
      return true;
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Chưa lưu được. Nội dung đang nhập vẫn được giữ.",
      );
      return false;
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  const name = (id: string | null) =>
    workspace.people.find((p) => p.id === id)?.name ?? "Chờ nhận việc";
  const edit = (e: QualityEditor) => {
    setError("");
    setEditor(e);
  };
  const q = data?.score;
  const selectedRows = data?.rows ?? [];
  const runs = (view === "work" && workMode === "scheduled" ? [...selectedRows] : []) as unknown as (Run & {
    category: keyof typeof categories;
    group_title?: string | null;
    family_id: string;
    code?: string;
    frequency: keyof typeof freq;
    manager_ids: string[];
    checks: {
      id: string;
      result: string;
      actor_id: string;
      created_at: string;
    }[];
  })[];
  runs.sort((a,b)=>Date.parse(a.current_due_at??a.original_due_at)-Date.parse(b.current_due_at??b.original_due_at)
    || compareCriteriaBySource(a,b));
  const catalog = [...(data?.catalog ?? [])].sort(compareCriteriaBySource);
  const issues = selectedRows as unknown as QualityIssue[];
  const audits = selectedRows as unknown as QualityAudit[];
  const lines = selectedRows as unknown as QualityLine[];
  function issueActions(i: QualityIssue) {
    const responsible = data?.can.work && i.assignee_id === workspace.userId;
    const processing =
      i.operator_id === workspace.userId ||
      i.collaborators.includes(workspace.userId) ||
      responsible;
    return (
      <div className={s.actions}>
        <button
          type="button"
          onClick={() => edit({ kind: "issue_detail", issue: i })}
        >
          Chi tiết
        </button>
        {!["done", "canceled"].includes(i.state) && (
          <>
            {processing && ["pending", "in_progress"].includes(i.state) && (
              <button
                disabled={busy}
                onClick={() => edit({ kind: "issue_update", issue: i })}
              >
                {i.state === "pending" ? "Nhận việc" : "Báo đã xử lý"}
              </button>
            )}
            {responsible && (
              <>
                <button onClick={() => edit({ kind: "recheck", issue: i })}>
                  Kiểm tra lại
                </button>
                <button
                  title="Đổi người chịu trách nhiệm hoặc deadline"
                  onClick={() => edit({ kind: "issue_assign", issue: i })}
                >
                  <Icon name="edit_calendar" size={18} />
                </button>
              </>
            )}
          </>
        )}
        {i.state === "done" && data?.can.work && (
          <button
            onClick={() =>
              edit({ kind: "issue", recurrenceOf: i.id, title: i.title })
            }
          >
            Báo tái phát
          </button>
        )}
      </div>
    );
  }
  return (
    <div className={s.root}>
      {!workspace.branches.length && <SelectField label="Chi nhánh có công việc được phân công" options={data?.relatedBranches ?? [{id:branch,name:"Chi nhánh được phân công"}]} value={branch} onChange={next => {if(next)requestPageLeave(()=>setBranch(next));}}/>}
      {error && !editor && (
        <div className={s.alert} role="alert">
          {error}
          {setup && (
            <button onClick={onLegacySettings}>Về thiết lập Hub hiện có</button>
          )}
        </div>
      )}
      {notice && (
        <p role="status" className={s.success}>
          {notice}
        </p>
      )}
      {data && (
        <>
          {onAssessmentPeriodChange && ["qc", "report"].includes(view) && <div className={s.heading}>
            <SelectField label="Kỳ đánh giá QC và thưởng" value={period} onChange={(next) => requestPageLeave(() => onAssessmentPeriodChange(next))} options={[{id:calendarPeriod,name:`Tháng ${calendarPeriod.slice(5)}/${calendarPeriod.slice(0,4)}`},...(data.periods ?? []).map((item) => ({id:item.key,name:`${item.title} · ${formatShortDate(item.starts_on)} – ${formatShortDate(item.ends_on)}${item.closed ? " · Đã chốt" : ""}`}))]} />
            {data.can.manage && <button onClick={() => edit({kind:"period"})}><Icon name="date_range" size={17}/>Thêm kỳ đánh giá</button>}
          </div>}
          {view === "report" && (
            <div className={s.metrics}>
              <div>
                <span>QC chính thức</span>
                <strong>
                  {q?.score === null ? "—" : formatNumber(q?.score)}
                </strong>
                <small>{q?.completedAudits ?? 0} đợt hoàn tất</small>
              </div>
              <div>
                <span>Điểm trừ / cộng</span>
                <strong>
                  {formatNumber(q?.deductions)} / +{formatNumber(q?.bonus)}
                </strong>
              </div>
              <div>
                <span>Thưởng QC {data.settlement ? "đã chốt" : "dự kiến"}</span>
                <strong>
                  {q?.rewardCents == null
                    ? "—"
                    : formatNumber(q.rewardCents / 100)}
                </strong>
                <small>Đồng · chưa tạo phiếu chi</small>
              </div>
              <div>
                <span>Vi phạm loại thưởng</span>
                <strong>{q?.critical ? "Có" : "Không"}</strong>
                <small>
                  {q?.official
                    ? "Theo sổ điểm QC"
                    : "Chưa có kết quả chính thức"}
                </small>
              </div>
            </div>
          )}
          <div className={s.heading}>
            <h2>
              {selectedAudit
                ? selectedAudit.title
                : views.find((v) => v.key === view)?.label}
            </h2>
            <div className={s.actions}>
              {view === "work" && data.can.work && <button onClick={() => edit({kind:"adhoc"})}><Icon name="add" size={17}/>Tự kiểm tra phát sinh</button>}
              {view === "issues" && data.can.work && (
                <button
                  className={s.primary}
                  onClick={() => edit({ kind: "issue" })}
                >
                  <Icon name="add" size={17} />
                  To-do
                </button>
              )}
              {view === "qc" && !selectedAudit && data.can.qc && (
                <button
                  className={s.primary}
                  onClick={() => edit({ kind: "qc_create" })}
                >
                  <Icon name="add" size={17} />
                  Tạo đợt QC
                </button>
              )}
              {selectedAudit && (
                <>
                  <button
                    onClick={() => {
                      setSelectedAudit(null);
                      setOffset(0);
                    }}
                  >
                    Danh sách đợt QC
                  </button>
                  {(data.audit ?? selectedAudit).state === "draft" &&
                    selectedAudit.auditor_id === workspace.userId &&
                    data.can.qc && (
                      <button
                        className={s.primary}
                        disabled={busy}
                        onClick={() =>
                          void send("qc_complete", {
                            id: selectedAudit.id,
                            version: (data.audit ?? selectedAudit).version,
                          })
                        }
                      >
                        Hoàn tất QC
                      </button>
                    )}
                </>
              )}
              {view === "settings" && data.can.manage && setupSection === "reward" && (
                <>
                  <button onClick={() => edit({ kind: "rule" })}>
                    Chính sách mới
                  </button>
                </>
              )}
              {view === "report" && data.can.close && !data.settlement && (
                <button
                  disabled={!q?.rewardReady || busy}
                  onClick={() => edit({ kind: "settle" })}
                >
                  Chốt kỳ
                </button>
              )}
              <button
                aria-label="Tải lại danh sách"
                title="Tải lại"
                disabled={loading || busy}
                onClick={() =>
                  requestPageLeave(() => setRevision((r) => r + 1))
                }
              >
                <Icon name="refresh" size={18} />
              </button>
            </div>
          </div>
        </>
      )}
      {data && view === "overview" && onNavigate && <QualityOverview data={data} onNavigate={onNavigate}/>}
      {data && view === "work" && !data.can.work && <p className={s.scopeNotice}>Bạn đang xem kết quả của chi nhánh. Chỉ quản lý được phân công và có quyền ghi kết quả mới có thể tự kiểm tra.</p>}
      {data && view === "issues" && !data.can.work && <p className={s.scopeNotice}>Bạn đang xem To-do trong phạm vi được phép. Quyền tạo To-do và xử lý công việc được thiết lập tại Người và quyền.</p>}
      {data && view === "qc" && !data.can.qc && <p className={s.scopeNotice}>Bạn có thể xem các đợt QC. Để tạo và ghi kết quả, cần được phân công quyền QC độc lập tại chi nhánh; quyền quản trị không tự thay thế quyền QC.</p>}
      {["work", "issues", "qc"].includes(view) && (
        <>
        {view === "work" && <div className={s.actions} role="group" aria-label="Loại tự kiểm tra"><button aria-pressed={workMode === "scheduled"} onClick={() => {setWorkMode("scheduled");reset();setDates(value=>({...value,dateField:"due"}));}}>Theo lịch</button><button aria-pressed={workMode === "adhoc"} onClick={() => {setWorkMode("adhoc");reset();setDates(value=>({...value,dateField:"created"}));}}>Phát sinh ngoài lịch</button></div>}
        {view === "work" && workMode === "scheduled" && <div className={s.quickDates} role="group" aria-label="Xem công việc theo thời gian">
          {([['today','Hôm nay'],['this_week','Tuần này'],['period','Trong kỳ']] as const).map(([preset,label]) => <button key={preset} type="button" aria-pressed={dates.preset === preset && !overdue} onClick={() => { setDates(previous => ({...previous,preset,dateField:'due'})); setOverdue(false); setOffset(0); }}>{label}</button>)}
          <button type="button" aria-pressed={overdue && dates.preset === 'all'} onClick={() => {setDates(previous => ({...previous,preset:'all',dateField:'due'}));setOverdue(true);setOffset(0);}}>Việc trễ hạn</button>
        </div>}
        <QualityFilters activeCount={[state, category, priority, assignee, operator, department, frequency, result, mine, overdue, dates.preset !== "all", search.trim()].filter(Boolean).length}>
          <div className={s.filterGrid}>
            <Field label="Tìm công việc / vấn đề">
              {(id) => (
                <input
                  id={id}
                  type="search"
                  maxLength={200}
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setOffset(0);
                  }}
                />
              )}
            </Field>
            {(view === "work" || selectedAudit) && (
              <SelectField
                label="Kết quả"
                options={{
                  unknown: "Chưa kiểm tra",
                  met: "Đạt",
                  unmet: "Không đạt",
                }}
                value={result}
                onChange={(v) => {
                  setResult(v);
                  setOffset(0);
                }}
              />
            )}
            {(view === "issues" || (view === "qc" && !selectedAudit)) && (
              <SelectField
                label="Trạng thái"
                options={
                  view === "issues"
                    ? {
                        pending: "Mới",
                        in_progress: "Đang xử lý",
                        pending_review: "Chờ kiểm tra lại",
                        done: "Đã đóng",
                        canceled: "Đã hủy",
                      }
                    : { draft: "Nháp", completed: "Đã hoàn tất" }
                }
                value={state}
                onChange={(v) => {
                  setState(v);
                  setOffset(0);
                }}
              />
            )}
            {view === "work" && workMode === "scheduled" && <SelectField label="Nhóm công việc" options={data?.groups?.some(group=>group.active)?Object.fromEntries(data.groups.filter(group => group.active).map(group => [`group:${group.id}`,group.title])):categories} value={category} onChange={next => {setCategory(next);setOffset(0);}}/>}
            <SelectField
              label="Khoảng thời gian"
              allowEmpty={false}
              options={datePresets}
              value={dates.preset}
              onChange={(v) => {
                setDates((d) => ({
                  ...d,
                  preset: v as keyof typeof datePresets,
                }));
                setOffset(0);
              }}
            />
            {dates.preset === "custom" && (
              <>
                <Field label="Từ ngày">
                  {(id) => (
                    <input
                      id={id}
                      type="date"
                      value={dates.from}
                      onChange={(e) => {
                        setDates((d) => ({ ...d, from: e.target.value }));
                        setOffset(0);
                      }}
                    />
                  )}
                </Field>
                <Field label="Đến hết ngày">
                  {(id) => (
                    <input
                      id={id}
                      type="date"
                      value={dates.to}
                      onChange={(e) => {
                        setDates((d) => ({ ...d, to: e.target.value }));
                        setOffset(0);
                      }}
                    />
                  )}
                </Field>
              </>
            )}
          </div>
          <details className={s.filterExtra}>
            <summary>Thêm tiêu chí lọc</summary>
            <div className={s.filterGrid}>
              <UserPicker
                label={view === "qc" ? "Người QC" : "Quản lý phụ trách"}
                options={filterPeople(workspace,data)}
                value={assignee}
                onChange={(v) => {
                  setAssignee(v);
                  setOffset(0);
                }}
              />
              {view === "issues" && (
              <SelectField
                  label="Phân loại To-do"
                  options={categories}
                  value={category}
                  onChange={(v) => {
                    setCategory(v);
                    setOffset(0);
                  }}
                />
              )}
              {view === "work" && workMode !== "adhoc" && (
                <SelectField
                  label="Tần suất"
                  options={freq}
                  value={frequency}
                  onChange={(v) => {
                    setFrequency(v);
                    setOffset(0);
                  }}
                />
              )}
              {view === "issues" && (
                <>
                  <SelectField
                    label="Mức độ"
                    options={priorities}
                    value={priority}
                    onChange={(v) => {
                      setPriority(v);
                      setOffset(0);
                    }}
                  />
                  <UserPicker
                    label="Người xử lý"
                    options={filterPeople(workspace,data)}
                    value={operator}
                    onChange={(v) => {
                      setOperator(v);
                      setOffset(0);
                    }}
                  />
                  <SelectField
                    label="Bộ phận"
                    options={(data?.departments ?? []).map((v) => ({
                      id: v.id,
                      name: v.title,
                    }))}
                    value={department}
                    onChange={(v) => {
                      setDepartment(v);
                      setOffset(0);
                    }}
                  />
                </>
              )}
              <SelectField
                label="Lọc theo ngày"
                allowEmpty={false}
                options={
                  view === "work" && workMode === "adhoc" ? {created:"Ngày ghi nhận"} : view === "work"
                    ? {
                        due: "Ngày đến hạn",
                        checked: "Ngày tự kiểm tra",
                        completed: "Ngày đạt",
                      }
                    : view === "qc"
                      ? { created: "Ngày tạo" }
                      : {
                          due: "Deadline",
                          created: "Ngày tạo",
                          completed: "Ngày đóng",
                        }
                }
                value={dates.dateField}
                onChange={(v) => {
                  setDates((d) => ({ ...d, dateField: v }));
                  setOffset(0);
                }}
              />
            </div>
          </details>
          <div className={s.actions}>
            {view !== "qc" && (
              <>
                <label className={s.check}>
                  <input
                    type="checkbox"
                    checked={mine}
                    onChange={(e) => {
                      setMine(e.target.checked);
                      setOffset(0);
                    }}
                  />
                  Liên quan đến tôi
                </label>
                {workMode !== "adhoc" && <label className={s.check}>
                  <input
                    type="checkbox"
                    checked={overdue}
                    onChange={(e) => {
                      setOverdue(e.target.checked);
                      setOffset(0);
                    }}
                  />
                  {view === "work" ? "Trễ hạn gốc" : "Quá hạn"}
                </label>}
              </>
            )}
            <button onClick={reset}>Bỏ bộ lọc</button>
          </div>
        </QualityFilters>
        </>
      )}
      {filterError && (
        <p role="alert" className={s.alert}>
          {filterError}
        </p>
      )}
      {loading && <p role="status">Đang tải…</p>}
      {data && !loading && !filterError && (
        <>
          {view === "work" && workMode === "adhoc" && <Table heads={["Công việc", "Ngày ghi nhận", "Người kiểm tra", "Kết quả", "Ghi chú"]} rows={selectedRows.map(row => <tr key={String(row.id)}><td>{String((row.standard_snapshot as {title:string}).title)}</td><td>{formatDate(String(row.created_at))}</td><td>{name(String(row.actor_id))}</td><td><Badge value={String(row.result)}/></td><td>{String(row.note ?? "")}</td></tr>)} mobile={selectedRows.map(row => <article className={s.mobileItem} key={String(row.id)}><h3>{String((row.standard_snapshot as {title:string}).title)}</h3><Badge value={String(row.result)}/><p>{name(String(row.actor_id))} · {formatDate(String(row.created_at))}</p><p>{String(row.note ?? "")}</p></article>)}/>}
          {view === "work" && workMode !== "adhoc" && (
            <Table
              heads={[
                "Nhóm công việc",
                "Công việc",
                "Tần suất / đến hạn",
                "Người được phân công",
                "Kết quả hiện tại",
                "Lần kiểm tra",
                "Thao tác",
              ]}
              rows={runs.map((r) => (
                <tr key={r.id}>
                  <td className={s.groupCell}>{criterionGroup(r,data.groups ?? [])}</td>
                  <td>
                    <strong>{criterionTitle(r)}</strong>
                    <details className={s.requirement}><summary>Yêu cầu cần đạt</summary>{r.criteria.map(criterion => <p key={criterion.id}>{criterion.title}</p>)}</details>
                  </td>
                  <td>
                    {freq[r.frequency]}
                    <p>{formatDate(r.current_due_at ?? r.original_due_at)}</p>
                    {r.current_due_at && <small>Hạn gốc: {formatDate(r.original_due_at)}</small>}
                  </td>
                  <td>{r.manager_ids.map(name).join(", ")}</td>
                  <td>
                    <Badge value={r.quality} />
                    {r.had_failure && (
                      <p className={s.muted}>Có lịch sử chưa đạt</p>
                    )}
                  </td>
                  <td>
                    {r.checks.length
                      ? `${name(r.checks[0].actor_id)} · ${formatDate(r.checks[0].created_at)}`
                      : "Chưa kiểm tra"}
                  </td>
                  <td>
                    {workspace.isCeo && r.state === "pending" && r.quality === "unknown" && !r.checks.length && <ScheduleReview mode="move" run={r} branch={branch} busy={busy} onSaved={() => setRevision(v => v + 1)}/>}
                    {data.can.work &&
                      r.manager_ids.includes(workspace.userId) && (
                        <button onClick={() => edit({ kind: "check", run: r })}>
                          <Icon name="check_circle" size={16}/> Ghi kết quả
                        </button>
                      )}
                    {!(data.can.work && r.manager_ids.includes(workspace.userId)) && <span className={s.muted}>{!data.can.work ? "Chỉ xem · cần quyền quản lý để ghi kết quả" : "Không được phân công việc này"}</span>}
                  </td>
                </tr>
              ))}
              mobile={runs.map((r) => (
                <article className={s.mobileItem} key={r.id}>
                  <p className={s.groupLabel}><span>Nhóm công việc</span>{criterionGroup(r,data.groups ?? [])}</p>
                  <h3>{criterionTitle(r)}</h3>
                  <details className={s.requirement}><summary>Yêu cầu cần đạt</summary>{r.criteria.map(criterion => <p key={criterion.id}>{criterion.title}</p>)}</details>
                  <Badge value={r.quality} />
                  <p>
                    {freq[r.frequency]} · {formatDate(r.current_due_at ?? r.original_due_at)}
                  </p>
                  {r.current_due_at && <p>Hạn gốc: {formatDate(r.original_due_at)}</p>}
                  {workspace.isCeo && r.state === "pending" && r.quality === "unknown" && !r.checks.length && <ScheduleReview mode="move" run={r} branch={branch} busy={busy} onSaved={() => setRevision(v => v + 1)}/>}
                  <p className={s.muted}>
                    {r.manager_ids.map(name).join(", ")}
                  </p>
                  {data.can.work &&
                    r.manager_ids.includes(workspace.userId) && (
                      <button onClick={() => edit({ kind: "check", run: r })}>
                        <Icon name="check_circle" size={16}/> Ghi kết quả
                      </button>
                    )}
                  {!(data.can.work && r.manager_ids.includes(workspace.userId)) && <p className={s.muted}>{!data.can.work ? "Chỉ xem · cần quyền quản lý để ghi kết quả" : "Không được phân công việc này"}</p>}
                  </article>
              ))}
            />
          )}
          {view === "issues" && (
            <Table
              heads={[
                "Vấn đề",
                "Phân loại / mức độ",
                "Trách nhiệm / xử lý",
                "Deadline",
                "Tình trạng",
                "Thao tác",
              ]}
              rows={issues.map((i) => (
                <tr key={i.id}>
                  <td>
                    <strong>{i.title}</strong>
                    <p className={s.muted}>{formatDate(i.created_at)}</p>
                  </td>
                  <td>
                    {categories[i.category as keyof typeof categories]}
                    <p>{priorities[i.priority as keyof typeof priorities]}</p>
                  </td>
                  <td>
                    {name(i.assignee_id)}
                    <p className={s.muted}>{name(i.operator_id)}</p>
                  </td>
                  <td>
                    {formatDate(i.due_at)}
                    {i.completed_at && (
                      <p
                        className={
                          Date.parse(i.completed_at) >
                          Date.parse(i.original_due_at)
                            ? s.overdue
                            : s.muted
                        }
                      >
                        {Date.parse(i.completed_at) >
                        Date.parse(i.original_due_at)
                          ? "Hoàn thành trễ"
                          : "Đúng hạn"}
                      </p>
                    )}
                  </td>
                  <td>
                    <Badge value={i.state} />
                  </td>
                  <td>{issueActions(i)}</td>
                </tr>
              ))}
              mobile={issues.map((i) => (
                <article className={s.mobileItem} key={i.id}>
                  <h3>{i.title}</h3>
                  <Badge value={i.state} />
                  <p>
                    {name(i.assignee_id)} · {formatDate(i.due_at)}
                  </p>
                  <p className={s.muted}>
                    {priorities[i.priority as keyof typeof priorities]}
                  </p>
                  {issueActions(i)}
                </article>
              ))}
            />
          )}
          {view === "qc" && !selectedAudit && (
            <Table
              heads={[
                "Đợt QC",
                "Người QC",
                "Ngày tạo",
                "Trạng thái",
                "Thao tác",
              ]}
              rows={audits.map((a) => (
                <tr key={a.id}>
                  <td>
                    {a.title}
                    <p className={s.muted}>{a.period}</p>
                  </td>
                  <td>{name(a.auditor_id)}</td>
                  <td>{formatDate(a.created_at)}</td>
                  <td>
                    <Badge value={a.state} />
                  </td>
                  <td>
                    <button
                      onClick={() => {
                        setSelectedAudit(a);
                        setOffset(0);
                        setState("");
                      }}
                    >
                      Mở đợt
                    </button>
                  </td>
                </tr>
              ))}
              mobile={audits.map((a) => (
                <article className={s.mobileItem} key={a.id}>
                  <h3>{a.title}</h3>
                  <Badge value={a.state} />
                  <p>
                    {name(a.auditor_id)} · {formatDate(a.created_at)}
                  </p>
                  <button
                    onClick={() => {
                      setSelectedAudit(a);
                      setOffset(0);
                      setState("");
                    }}
                  >
                    Mở đợt
                  </button>
                </article>
              ))}
            />
          )}
          {view === "qc" && selectedAudit && (
            <Table
              heads={[
                "Tiêu chuẩn",
                "Loại điểm",
                "Trọng số",
                "Kết quả QC gốc",
                "Minh chứng",
                "Thao tác",
              ]}
              rows={lines.map((l) => (
                <tr key={l.id}>
                  <td>
                    {l.item_snapshot.title}
                    <p className={s.muted}>{l.item_snapshot.code}</p>
                  </td>
                  <td>
                    {l.item_snapshot.score_type === "bonus" ? "Cộng" : "Trừ"}
                  </td>
                  <td className={s.numeric}>
                    {formatNumber(l.item_snapshot.weight)}
                  </td>
                  <td>
                    <Badge value={l.result} />
                    <CorrectionHistory line={l} people={workspace.people} />
                  </td>
                  <td>{l.evidence || l.note || "—"}</td>
                  <td>
                    {(data.audit ?? selectedAudit).state === "draft" &&
                      data.can.qc &&
                      selectedAudit.auditor_id === workspace.userId && (
                        <button
                          onClick={() => edit({ kind: "qc_line", line: l })}
                        >
                          Ghi kết quả
                        </button>
                      )}
                    {(data.audit ?? selectedAudit).state === "completed" &&
                      data.can.correct &&
                      (!data.settlement || data.can.close) && (
                        <button
                          onClick={() => edit({ kind: "qc_correct", line: l })}
                        >
                          Đính chính
                        </button>
                      )}
                  </td>
                </tr>
              ))}
              mobile={lines.map((l) => (
                <article className={s.mobileItem} key={l.id}>
                  <h3>{l.item_snapshot.title}</h3>
                  <Badge value={l.result} />
                  <CorrectionHistory line={l} people={workspace.people} />
                  <p>
                    {l.item_snapshot.score_type === "bonus" ? "Cộng" : "Trừ"}{" "}
                    {formatNumber(l.item_snapshot.weight)} điểm
                  </p>
                  {(data.audit ?? selectedAudit).state === "draft" &&
                    data.can.qc &&
                    selectedAudit.auditor_id === workspace.userId && (
                      <button
                        onClick={() => edit({ kind: "qc_line", line: l })}
                      >
                        Ghi kết quả
                      </button>
                    )}
                  {(data.audit ?? selectedAudit).state === "completed" &&
                    data.can.correct &&
                    (!data.settlement || data.can.close) && (
                      <button
                        onClick={() => edit({ kind: "qc_correct", line: l })}
                      >
                        Đính chính
                      </button>
                    )}
                </article>
              ))}
            />
          )}
          {["work", "issues", "qc", "report"].includes(view) && (
            <>
              {!selectedRows.length && view !== "report" && (
                <p className={s.empty}>
                  Chưa có hồ sơ phù hợp bộ lọc trong phạm vi được phép.
                </p>
              )}
              <div className={s.pagination}>
                <span>
                  {formatNumber(data.total)} {view === "work" && workMode !== "adhoc" ? "lượt thực hiện" : "hồ sơ"} · trang {offset / 50 + 1}
                </span>
                <button
                  disabled={offset === 0}
                  onClick={() => setOffset((o) => Math.max(0, o - 50))}
                >
                  Trước
                </button>
                <button
                  disabled={offset + 50 >= data.total}
                  onClick={() => setOffset((o) => o + 50)}
                >
                  Sau
                </button>
              </div>
            </>
          )}
          {view === "settings" && (
            <>
              <SetupNavigation value={setupSection} onChange={setSetupSection} data={data} isCeo={workspace.isCeo && data.can.manage}/>
              {setupSection === "library" && workspace.isCeo && data.can.manage && <WorkingLibrary workspace={workspace} onApplied={() => { if (onConfigurationRefresh) onConfigurationRefresh(); else setRevision((current) => current + 1); }}/>}
              {setupSection === "branch" && configuration && <section className={s.section}><h3>Công việc đang áp dụng tại chi nhánh</h3>{typeof configuration === "function" ? configuration(data,"standards",data.can.manage ? familyId => edit({ kind: "assignment", familyId }) : undefined) : configuration}</section>}
              {setupSection === "history" && <section className={s.section}><OperationsHistoryPanel branch={branch} period={period}/></section>}
              <section className={s.section} hidden={setupSection !== "people"}>
                {setupSection === "people" && typeof configuration === "function" && configuration(data,"members")}
                <h3>Phân công và phòng ban</h3>
                <div className={s.actions}>
                  {data.can.manage && (
                    <>
                      <button onClick={() => edit({ kind: "department" })}>
                        Thêm bộ phận
                      </button>
                      <button onClick={() => edit({ kind: "assignment" })}>
                          Phân công theo công việc
                      </button>
                      {workspace.isCeo && (
                        <a href="/he-thong/users">Quyền tài khoản OneBiz</a>
                      )}
                      {workspace.isCeo && (
                        <button onClick={() => edit({ kind: "qc_grant" })}>
                          Cấp / thu hồi QC, kế toán
                        </button>
                      )}
                    </>
                  )}
                  {!configuration && <button onClick={onLegacySettings}>
                    Mẫu công việc và quyền Hub
                  </button>}
                </div>
                {data.departments.map((d) => (
                  <p key={d.id}>
                    {d.title} · {d.members.map(name).join(", ")} ·{" "}
                    {d.active ? "Hoạt động" : "Ngừng"}
                    {data.can.manage && (
                      <button
                        onClick={() =>
                          edit({ kind: "department", department: d })
                        }
                      >
                        Sửa
                      </button>
                    )}
                  </p>
                ))}
                {data.grants.map((g) => (
                  <p key={g.user_id}>
                    {name(g.user_id)} ·{" "}
                    {g.active
                      ? [
                          g.can_audit ? "QC" : "",
                          g.can_correct ? "Đính chính" : "",
                          g.can_accounting ? "Kế toán" : "",
                        ]
                          .filter(Boolean)
                          .join(", ")
                      : "Đã thu hồi"}
                  </p>
                ))}
                {!!data.assignments.length && <div className={s.assignmentSummary}>
                  <span>Đã phân công quản lý cho {formatNumber(data.assignments.length)} công việc.</span>
                  <button type="button" onClick={() => requestPageLeave(() => setSetupSection("branch"))}>Xem công việc chi nhánh<Icon name="arrow_forward" size={16}/></button>
                </div>}
              </section>
              <section className={s.section} hidden={setupSection !== "qc"}>
                <h3>Nhóm tiêu chuẩn QC</h3>
                {data.can.manage && <button onClick={() => edit({kind:"group"})}>Thêm nhóm QC</button>}
                {(data.groups ?? []).map((group) => <p key={group.id}>{group.title} · {group.active ? "Hoạt động" : "Ngừng"}{data.can.manage && <button onClick={() => edit({kind:"group",group})}>Sửa nhóm</button>}</p>)}
              </section>
              <section className={s.section} hidden={setupSection !== "qc"}>
                <h3>Tiêu chí QC theo công việc</h3>
                {data.can.manage && <button onClick={() => edit({kind:"catalog"})}>Thêm tiêu chuẩn QC</button>}
                <Table
                  heads={["Công việc", "Nhóm công việc", "Loại điểm", "Trọng số", "Hiệu lực", ...(data.can.manage ? ["Thao tác"] : [])]}
                  rows={catalog.map((c) => (
                        <tr key={c.id}>
                          <td>
                            <strong>{criterionTitle(c)}</strong>
                            <details className={s.requirement}><summary>Yêu cầu cần đạt</summary>{c.criteria.map(criterion => <p key={criterion.id}>{criterion.title}</p>)}</details>
                            <details className={s.requirement}><summary>Mã tiêu chuẩn</summary><code>{c.code}</code></details>
                          </td>
                          <td className={s.groupCell}>{criterionGroup(c,data.groups ?? [])}</td>
                          <td>{c.score_type === "bonus" ? "Cộng" : "Trừ"}</td>
                          <td className={s.numeric}>{formatNumber(c.weight)}</td>
                          <td className={s.dateCell}>{formatShortDate(c.effective_from)}{c.ends_on&&<p>Dùng đến {formatShortDate(c.ends_on)}</p>}</td>
                          {data.can.manage && <td className={s.catalogAction}><button onClick={() => edit({kind:"catalog",item:c})}>Sửa bằng phiên bản mới</button></td>}
                        </tr>
                      ))}
                  mobile={catalog.map(c => <article className={s.mobileItem} key={c.id}>
                    <h3>{criterionTitle(c)}</h3>
                    <p className={s.groupLabel}><span>Nhóm công việc</span>{criterionGroup(c,data.groups ?? [])}</p>
                    <details className={s.requirement}><summary>Yêu cầu cần đạt</summary>{c.criteria.map(criterion => <p key={criterion.id}>{criterion.title}</p>)}</details>
                    <p>{c.score_type === "bonus" ? "Cộng" : "Trừ"} {formatNumber(c.weight)} điểm · Hiệu lực {formatShortDate(c.effective_from)}</p>
                    {c.ends_on && <p>Dùng đến {formatShortDate(c.ends_on)}</p>}
                    <details className={s.requirement}><summary>Mã tiêu chuẩn</summary><code>{c.code}</code></details>
                    {data.can.manage && <button onClick={() => edit({kind:"catalog",item:c})}>Sửa bằng phiên bản mới</button>}
                  </article>)}
                />
              </section>
              {data.can.manage && setupSection === "qc" && (
                <details className={s.section}><summary>Nhập và quản lý danh mục nâng cao</summary>
                <CatalogImport
                  workspace={workspace}
                  catalog={data.catalog}
                  groups={data.groups}
                  busy={busy}
                  onImport={(rows) => send("catalog_import", { rows })}
                />
                {workspace.isCeo && <WorkingImport workspace={workspace} onImported={() => { if(onConfigurationRefresh) onConfigurationRefresh(); else setRevision(current => current + 1); }}/>}
                </details>
              )}
              <section className={s.section} hidden={setupSection !== "reward"}>
                <h3>Chính sách QC và thưởng tách riêng</h3>
                {!data.rules.length && <p className={s.scopeNotice}>Chưa có chính sách được lưu. Tạo bản nháp, kiểm tra quy tắc tính điểm, điều kiện loại thưởng và phân bổ quỹ trước khi duyệt. Công việc hằng ngày vẫn được thực hiện độc lập.</p>}
                {data.rules.map((r) => (
                  <div key={r.id} className={s.section}>
                    <strong>{r.title}</strong> <Badge value={r.state} />
                    <p>
                      Hiệu lực: {formatShortDate(r.effective_from)} · QC:{" "}
                      {r.config.qcFundCents === null
                        ? "Chưa cấu hình"
                        : formatNumber(r.config.qcFundCents / 100)}{" "}
                      đồng · Kinh doanh:{" "}
                      {r.config.businessFundCents === null
                        ? "Chưa cấu hình"
                        : formatNumber(r.config.businessFundCents / 100)}{" "}
                      đồng
                    </p>
                    <div className={s.actions}>
                      {data.can.manage && (
                        <>
                          <button
                            disabled={busy}
                            onClick={() =>
                              edit({ kind: "rule", rule: r.config })
                            }
                          >
                            Tạo phiên bản từ bản này
                          </button>
                          {r.state === "draft" && (
                            <button
                              disabled={busy}
                              onClick={() =>
                                void send("rule_approve", { id: r.id })
                              }
                            >
                              Duyệt áp dụng
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </section>
            </>
          )}
          {view === "report" && (
            <QualityBusinessSetup data={data} period={period} busy={busy} onSave={send} commandError={error} branch={workspace.branches.find(item=>item.id===branch)}/>
          )}
          {view === "report" && (
            <QualityReport
              data={data}
              workspace={workspace}
              branch={branch}
              period={period}
              busy={busy}
              onEdit={edit}
              onSave={send}
            />
          )}
        </>
      )}
      {editor && data && (
        <UserBranchContext.Provider value={branch}><QualityEditorDialog
          key={JSON.stringify(editor)}
          editor={editor}
          workspace={workspace}
          quality={data}
          branch={branch}
          period={period}
          busy={busy}
          error={error}
          onClose={() => {
            if (!busy) {
              setEditor(null);
              setError("");
            }
          }}
          onSave={send}
        /></UserBranchContext.Provider>
      )}
    </div>
  );
}
