"use client";

import { Input } from "@/components/ui/input";
import { requestPageLeave } from "@/lib/hooks/use-unsaved-work";

import Link from "next/link";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useId,
  cloneElement,
  isValidElement,
  type FormEvent,
  type ReactElement,
} from "react";
import { Icon } from "@/components/ui/icon";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { formatNumber, formatDate } from "@/lib/format";
import {
  categories,
  priorities,
  states,
  type Criterion,
  type Run,
  type Todo,
  type Workspace,
  type Observation,
  type Standard,
} from "@/lib/operations/contracts";
import {
  parseMoneyUS,
  summarizeOperations,
  previewAllocatedRewards,
} from "@/lib/operations/policy";
import styles from "./workspace.module.css";
import { RevenueExcel } from "./revenue-excel";
import { ONEBIZ_REVENUE_DEFINITION } from "@/lib/operations/revenue-import";
import { referenceCriteria } from "@/lib/operations/reference-criteria";
import { readClosedPeriod } from "@/lib/operations/closed-period";
import { OperationsHistory } from "./history";
import { EvidenceFiles } from "./evidence-files";
import { OperationsInbox } from "./inbox";
import { PeriodAdjustments, type AdjustedPeriod } from "./period-adjustments";
import {
  rewardPolicyFromForm,
  applyCriterionReference,
  validateCriteria,
  type Frequency,
} from "@/lib/operations/configuration";
import { ConfigurationReview } from "./configuration-review";
import { OperationsFilteredList } from "./filtered-list";
import { OperationsFilterBar } from "./filter-bar";
import { filterParams, initialFilters, matchesConfiguration } from "@/lib/operations/filters";
import { OperationsTodoPicker } from "./todo-picker";
import { canProposeStandard, canProposeRevision, initialMineFilters } from "@/lib/operations/standard-permissions";
import { MeasurementPicker } from "./measurement-picker";
import { OperationsMktLinks } from "./mkt-links";

const tabs = [
  { key: "work", label: "Công việc", icon: "fact_check" },
  { key: "todo", label: "To-do", icon: "checklist" },
  { key: "review", label: "Xác minh", icon: "verified_user" },
  { key: "kpi", label: "KPI & thưởng", icon: "monitoring" },
  { key: "settings", label: "Thiết lập", icon: "tune" },
] as const;
type Tab = (typeof tabs)[number]["key"];
type Editor = {
  kind:
    | "standard"
    | "standard_details"
    | "request_standard_changes"
    | "event"
    | "todo"
    | "result"
    | "verify"
    | "transfer"
    | "todo_update"
    | "member"
    | "target"
    | "revenue"
    | "policy"
    | "comment"
    | "close_period";
  standard?: Standard;
  proposal?: boolean;
  policy?: Workspace["policies"][number];
  run?: Run;
  todo?: Todo;
};
function localDateTime(value: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Ho_Chi_Minh",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(value))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Ho_Chi_Minh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const money = (v: FormDataEntryValue | null) => {
  const result = parseMoneyUS(String(v ?? ""));
  if (result === null)
    throw new Error(
      "Số tiền phải đúng dạng 1,234.56, tối đa hai số thập phân.",
    );
  return result;
};
function Badge({ value }: { value: string }) {
  return (
    <span className={`${styles.badge} ${styles[value] ?? ""}`}>
      {states[value] ?? value}
    </span>
  );
}
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  const id = useId();
  const control =
    isValidElement(children) &&
    typeof children.type === "string" &&
    ["input", "select", "textarea"].includes(children.type);
  return (
    <label className={styles.field} htmlFor={control ? id : undefined}>
      <span id={`${id}-label`}>{label}</span>
      {control
        ? cloneElement(
            children as ReactElement<{
              id?: string;
              "aria-labelledby"?: string;
            }>,
            { id, "aria-labelledby": `${id}-label` },
          )
        : children}
    </label>
  );
}
function Empty({ label }: { label: string }) {
  return <p className={styles.empty}>{label}</p>;
}
const blankCriterion = (): Criterion => ({
  id: crypto.randomUUID(),
  title: "",
  kind: "boolean",
  operator: "eq",
  threshold: 1,
  samples: 1,
  critical: false,
  evidenceRequired: false,
});

export default function OperationsWorkspace() {
  const [tab, setTab] = useState<Tab>("work");
  const [branch, setBranch] = useState("");
  const [period, setPeriod] = useState("");
  const [data, setData] = useState<Workspace | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [editor, setEditor] = useState<Editor | null>(null);
  const [search, setSearch] = useState("");
  const [mineFilters, setMineFilters] = useState(initialMineFilters);
  const mineTab = tab === "todo" ? "todo" : tab === "review" ? "review" : "work";
  const onlyMine = mineFilters[mineTab];
  const setOnlyMine = (value: boolean) => setMineFilters(previous => ({ ...previous, [mineTab]: value }));
  const [workFilters, setWorkFilters] = useState(() => initialFilters("run"));
  const [todoFilters, setTodoFilters] = useState(() => initialFilters("todo"));
  const [reviewFilters, setReviewFilters] = useState(() => ({ ...initialFilters("run"), verification: "pending_review" }));
  const [notice, setNotice] = useState("");
  const [adjustedPeriod, setAdjustedPeriod] = useState<AdjustedPeriod | null>(
    null,
  );
  const generation = useRef(0);
  const scheduleAttempts = useRef(new Set<string>());
  const saving = useRef(false);
  const pendingCommand = useRef<{ body: string; requestId: string } | null>(
    null,
  );
  useEffect(() => {
    setPeriod(today().slice(0, 7));
    const params = new URLSearchParams(window.location.search);
    const selected = params.get("branch");
    if (selected && /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(selected))
      setBranch(selected);
    if (params.get("view") === "todo") {
      setTab("todo");
      setSearch((params.get("search") ?? "").slice(0, 200));
    }
  }, []);
  const load = useCallback(async () => {
    if (!period) return;
    const request = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const response = await fetch(
        `/api/operations?period=${period}${branch ? `&branch=${branch}` : ""}`,
        { cache: "no-store" },
      );
      const result = await response.json();
      if (request !== generation.current) return;
      if (!response.ok) throw new Error(result.error);
      setData(result);
      if (!branch && result.branches.length) setBranch(result.branches[0].id);
      if (!result.branches.length && result.todos.length) setTab("todo");
    } catch (e) {
      if (request === generation.current) {
        setError(e instanceof Error ? e.message : "Không tải được dữ liệu.");
        setData(null);
      }
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [branch, period]);
  useEffect(() => {
    const counter = generation;
    setData(null);
    void load();
    return () => {
      counter.current++;
    };
  }, [load]);
  const availableBranches = data?.branches;
  const currentUserId = data?.userId;
  useEffect(() => {
    const scope = availableBranches?.find((item) => item.id === branch);
    if (
      !scope?.capabilities.some((cap) =>
        ["work", "approve_policy"].includes(cap),
      )
    )
      return;
    const key = `${currentUserId}:${branch}:${today()}`;
    if (scheduleAttempts.current.has(key)) return;
    scheduleAttempts.current.add(key);
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch("/api/operations", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "ensure_schedule",
            requestId: crypto.randomUUID(),
            payload: { branchId: branch },
          }),
          signal: controller.signal,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        if (result.result?.generated > 0) await load();
      } catch (error) {
        if (!controller.signal.aborted)
          setError(
            error instanceof Error
              ? error.message
              : "Chưa tạo được lịch công việc.",
          );
      }
    })();
    return () => controller.abort();
  }, [currentUserId, branch, availableBranches, load]);
  const send = async (action: string, payload: Record<string, unknown>) => {
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const scopedPayload = { branchId: branch, ...payload };
      const body = JSON.stringify({ action, payload: scopedPayload });
      if (pendingCommand.current?.body !== body)
        pendingCommand.current = { body, requestId: crypto.randomUUID() };
      const response = await fetch("/api/operations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          payload: scopedPayload,
          requestId: pendingCommand.current.requestId,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      pendingCommand.current = null;
      setEditor(null);
      setNotice("Đã lưu.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Không lưu được.");
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  const caps = data?.branches.find((b) => b.id === branch)?.capabilities ?? [];
  const can = (cap: string) => caps.includes(cap);
  const name = (id: string) =>
    data?.people.find((p) => p.id === id)?.name ??
    "Tài khoản chưa được hiển thị";
  const managers =
    data?.people.filter((p) =>
      data.members.some(
        (m) => m.user_id === p.id && m.member_role === "manager" && m.active,
      ),
    ) ?? [];
  const selectedFilters = tab === "todo" ? todoFilters : tab === "review" ? reviewFilters : workFilters;
  let listParams: string | null = null;
  try { listParams = filterParams(selectedFilters, period); } catch { /* The filter bar reports invalid dates. */ }
  const summary = useMemo(() => {
    if (!data || !period) return null;
    const [year, month] = period.split("-").map(Number);
    const from = `${period}-01T00:00:00+07:00`;
    const next =
      new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10) +
      "T00:00:00+07:00";
    return summarizeOperations(
      data.runs.map((r) => ({
        id: r.id,
        originalDueAt: r.original_due_at,
        quality: r.quality,
        metAt: r.met_at,
        verified: !!r.verified_at,
        exemptionApproved: false,
      })),
      from,
      next,
      new Date().toISOString(),
    );
  }, [data, period]);
  const revenue = data?.revenues.find((r) => r.state === "approved");
  const target = data?.targets[0];
  const policy = data?.policies
    .filter((p) => p.state === "approved" && p.effective_from <= `${period}-01`)
    .sort((a, b) => b.effective_from.localeCompare(a.effective_from))[0];
  const rewards =
    policy && data
      ? previewAllocatedRewards(
          { ...policy.config, state: "approved" },
          new Map(
            (policy.config.allocations ?? []).map(({ userId }) => {
              const ownRuns = data.runs.filter(
                (run) => run.assignee_id === userId,
              );
              const [year, month] = period.split("-").map(Number);
              const own = summarizeOperations(
                ownRuns.map((run) => ({
                  id: run.id,
                  originalDueAt: run.original_due_at,
                  quality: run.quality,
                  metAt: run.met_at,
                  verified: !!run.verified_at,
                  exemptionApproved: false,
                })),
                `${period}-01T00:00:00+07:00`,
                new Date(Date.UTC(year, month, 1)).toISOString().slice(0, 10) +
                  "T00:00:00+07:00",
                new Date().toISOString(),
              );
              return [
                userId,
                {
                  operationsBps:
                    own.onTimePercent === null
                      ? null
                      : Math.round(own.onTimePercent * 100),
                  businessBps:
                    revenue && target && target.amount_cents > 0
                      ? Math.round(
                          (revenue.amount_cents / target.amount_cents) * 10000,
                        )
                      : null,
                  fullyVerified: own.due > 0 && own.verified === own.due,
                  criticalFailure: ownRuns.some((run) => run.critical_failure),
                },
              ];
            }),
          ),
        )
      : [];
  const rewardsReady =
    rewards.length > 0 &&
    rewards.every((item) => item.result.state === "calculated");
  const rewardTotal = rewards.reduce(
    (total, item) =>
      total +
      (item.result.state === "calculated" ? item.result.amountCents : 0),
    0,
  );
  const closed = data?.periods[0];
  const effectiveClosed =
    adjustedPeriod?.periodId === closed?.id ? adjustedPeriod : null;
  const closedSnapshot = closed
    ? readClosedPeriod(
        effectiveClosed ? effectiveClosed.snapshot : closed.snapshot,
      )
    : null;
  const displayedRewards = closed
    ? (closedSnapshot?.rewards ?? []).map((item) => ({
        userId: item.userId,
        shareBps: "shareBps" in item ? item.shareBps : 0,
        result: item,
      }))
    : rewards;

  return (
    <main className={styles.root}>
      <header className={styles.header}>
        <Link href="/hub" className={styles.brand}>
          ONEBIZ<span>.</span>
          <small>Hub</small>
        </Link>
        <nav>
          <Link href="/hub" aria-current="page">
            Vận hành
          </Link>
          <Link href="/mkt">MKT</Link>
          <Link href="https://onebiz.com.vn/">ERP</Link>
        </nav>
        <div className={styles.scope}>
          <OperationsInbox />
          <select
            aria-label="Chi nhánh"
            title={data?.branches.find((b) => b.id === branch)?.name}
            value={branch}
            onChange={(e) => {
              const next = e.target.value;
              requestPageLeave(() => { setEditor(null); setBranch(next); });
            }}
          >
            {data?.branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <input
            aria-label="Kỳ đánh giá"
            type="month"
            value={period}
            onChange={(e) => {
              const next = e.target.value;
              requestPageLeave(() => { setEditor(null); setPeriod(next); });
            }}
          />
          <button
            type="button"
            title="Tải lại"
            aria-label="Tải lại"
            disabled={loading || busy}
            onClick={() => requestPageLeave(() => load())}
          >
            <Icon name="refresh" size={17} />
          </button>
        </div>
      </header>
      <div className={styles.layout}>
        <aside className={styles.nav}>
          {tabs.filter(item => !data || data.isCeo || data.branches.length > 0 || item.key === "todo").map(({ key, label, icon }) => (
            <button
              type="button"
              key={key}
              aria-current={tab === key ? "page" : undefined}
              onClick={() => {
                const finish = () => { setTab(key); setSearch(""); };
                if (key === tab) finish(); else requestPageLeave(finish);
              }}
            >
              <Icon name={icon} size={19} />
              <span>{label}</span>
            </button>
          ))}
        </aside>
        <section className={styles.content} aria-busy={loading}>
          <div className={styles.title}>
            <h1>{tabs.find((t) => t.key === tab)?.label}</h1>
            {data?.periods.length ? (
              <span className={styles.lock}>
                <Icon name="lock" size={14} />
                Đã chốt kỳ
              </span>
            ) : null}
          </div>
          {error && (
            <div role="alert" className={styles.error}>
              {error}
              {error.includes("đăng nhập") && (
                <Link href="/dang-nhap?redirect=%2Fhub">Đăng nhập OneBiz</Link>
              )}
            </div>
          )}
          {notice && (
            <p role="status" className={styles.notice}>
              {notice}
            </p>
          )}
          {loading && !data && <Empty label="Đang tải dữ liệu…" />}
          {data && (
            <>
              <div className={styles.metrics}>
                <div>
                  <span>Đạt đúng hạn</span>
                  <strong>
                    {summary?.onTimePercent == null
                      ? "—"
                      : `${formatNumber(summary.onTimePercent)}%`}
                  </strong>
                  <small>
                    {summary?.onTime}/{summary?.due} công việc đến hạn
                  </small>
                </div>
                <div>
                  <span>Hoàn thành trễ</span>
                  <strong>{summary?.late}</strong>
                  <small>Giữ kết quả đúng kỳ gốc</small>
                </div>
                <div>
                  <span>Chờ xác minh</span>
                  <strong>
                    {
                      data.runs.filter(
                        (r) =>
                          !r.verified_at &&
                          (r.quality !== "unknown" ||
                            Date.parse(r.original_due_at) <= Date.now()),
                      ).length
                    }
                  </strong>
                </div>
                <div>
                  <span>To-do quá hạn</span>
                  <strong>
                    {formatNumber(
                      data.todosOverdue ??
                        data.todos.filter(
                          (t) =>
                            !["done", "canceled"].includes(t.state) &&
                            Date.parse(t.due_at) < Date.now(),
                        ).length,
                    )}
                  </strong>
                </div>
              </div>
              {(tab === "work" || tab === "todo" || tab === "review") && (
                <div className={styles.toolbar}>
                  <input
                    type="search"
                    aria-label="Tìm công việc"
                    placeholder="Tìm công việc"
                    maxLength={200}
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <label>
                    <input
                      type="checkbox"
                      checked={onlyMine}
                      onChange={(e) => setOnlyMine(e.target.checked)}
                    />
                    Của tôi
                  </label>
                  {tab === "todo" && (can("work") || can("approve_policy")) && (
                    <button
                      className={styles.primary}
                      onClick={() => setEditor({ kind: "todo" })}
                    >
                      <Icon name="add" size={16} />
                      To-do
                    </button>
                  )}
                </div>
              )}
              {(tab === "work" || tab === "todo" || tab === "review") && <OperationsFilterBar
                kind={tab === "todo" ? "todo" : "run"} value={selectedFilters}
                onChange={tab === "todo" ? setTodoFilters : tab === "review" ? setReviewFilters : setWorkFilters}
                people={data.people} standards={data.standards} period={period} />}
              {tab === "work" && (
                <OperationsFilteredList<Run> kind="run" branch={branch} search={search} onlyMine={onlyMine} params={listParams} revision={data}
                  renderItem={(r) => (
                    <article key={r.id} className={styles.row}>
                      <div>
                        <h2>{r.title}</h2>
                        <p>
                          {name(r.assignee_id)} ·{" "}
                          {formatDate(r.original_due_at)}
                        </p>
                      </div>
                      <div className={styles.rowStatus}>
                        <Badge value={r.quality} />
                        {r.met_at && (
                          <Badge
                            value={
                              Date.parse(r.met_at) >
                              Date.parse(r.original_due_at)
                                ? "Hoàn thành trễ"
                                : "done"
                            }
                          />
                        )}
                        {r.verified_at && (
                          <Icon name="verified_user" size={16} aria-label="Đã xác minh" />
                        )}
                        {r.had_failure && (
                          <Badge value="Đã ghi nhận chưa đạt" />
                        )}
                      </div>
                      <div className={styles.actions}>
                        {r.assignee_id === data.userId &&
                          r.state !== "done" &&
                          (!data.periods.length ||
                            r.state === "transferred") && (
                            <>
                              <button
                                disabled={localDateTime(r.original_due_at).slice(0, 7) !== period}
                                title={localDateTime(r.original_due_at).slice(0, 7) !== period ? "Chọn đúng kỳ của công việc để ghi kết quả." : undefined}
                                onClick={() =>
                                  setEditor({ kind: "result", run: r })
                                }
                              >
                                <Icon name="fact_check" size={16} />
                                Kết quả
                              </button>
                              <button
                                title="Chuyển To-do"
                                disabled={
                                  r.state !== "pending" || !!data.periods.length || localDateTime(r.original_due_at).slice(0, 7) !== period
                                }
                                aria-label="Chuyển To-do"
                                onClick={() =>
                                  setEditor({ kind: "transfer", run: r })
                                }
                              >
                                <Icon name="arrow_forward" size={16} />
                              </button>
                            </>
                          )}
                      </div>
                    </article>
                  )} />
              )}
              {tab === "todo" && (
                <OperationsFilteredList<Todo>
                  kind="todo"
                  branch={branch}
                  search={search}
                  onlyMine={onlyMine}
                  params={listParams}
                  revision={data}
                  renderItem={(t) => (
                    <article key={t.id} className={styles.row}>
                      <div>
                        <h2>{t.title}</h2>
                        <p>
                          {categories[t.category as keyof typeof categories]} ·{" "}
                          {name(t.assignee_id)} · {formatDate(t.due_at)}
                        </p>
                        <small>
                          {priorities[t.priority as keyof typeof priorities]}
                          {t.completed_at &&
                          Date.parse(t.completed_at) > Date.parse(t.due_at)
                            ? " · Hoàn thành trễ"
                            : ""}
                        </small>
                        <OperationsMktLinks
                          todoId={t.id}
                          canLink={
                            !["done", "canceled"].includes(t.state) &&
                            (t.assignee_id === data.userId ||
                              can("approve_policy"))
                          }
                        />
                      </div>
                      <Badge value={t.state} />
                      <div className={styles.actions}>
                        <button
                          onClick={() =>
                            setEditor({ kind: "comment", todo: t })
                          }
                        >
                          Phối hợp
                        </button>
                        {!["done", "canceled"].includes(t.state) &&
                          (t.assignee_id === data.userId ||
                            can("cancel_todo")) && (
                            <button
                              onClick={() =>
                                setEditor({ kind: "todo_update", todo: t })
                              }
                            >
                              Cập nhật
                            </button>
                          )}
                      </div>
                    </article>
                  )}
                />
              )}
              {tab === "review" && (
                <>
                  <OperationsFilteredList<Run> kind="run" branch={branch} search={search} onlyMine={onlyMine} params={listParams} revision={data}
                      renderItem={(r) => (
                        <article className={styles.row} key={r.id}>
                          <div>
                            <h2>{r.title}</h2>
                            <p>
                              {name(r.assignee_id)} ·{" "}
                              {formatDate(r.original_due_at)}
                            </p>
                          </div>
                          <Badge value={r.quality} />
                          {can("verify") &&
                            r.assignee_id !== data.userId &&
                            !data.periods.length && !r.verified_at && (
                              <button
                                disabled={localDateTime(r.original_due_at).slice(0, 7) !== period}
                                title={localDateTime(r.original_due_at).slice(0, 7) !== period ? "Chọn đúng kỳ của công việc để xác minh." : undefined}
                                onClick={() =>
                                  setEditor({ kind: "verify", run: r })
                                }
                              >
                                <Icon name="verified_user" size={16} />
                                Xác minh
                              </button>
                            )}
                        </article>
                      )} />
                  <h2 className={styles.sectionTitle}>Lịch sử</h2>
                  <div className={styles.list}>
                    {data.audit.map((a) => (
                      <div className={styles.audit} key={a.id}>
                        <span>{name(a.actor_id)}</span>
                        <span>{actionLabel(a.action)}</span>
                        <time>{formatDate(a.created_at)}</time>
                        {a.reason && <small>{a.reason}</small>}
                      </div>
                    ))}
                  </div>
                </>
              )}
              {tab === "kpi" && (
                <>
                  {closed && (
                    <p role="status">
                      {closedSnapshot
                        ? `Kết quả đã chốt ngày ${formatDate(closed.closed_at)}${effectiveClosed?.revision ? ` · Phiên bản điều chỉnh ${effectiveClosed.revision}` : ""}. Số liệu dưới đây lấy từ bản đã duyệt, không tính lại.`
                        : "Không đọc được bản chốt kỳ. Chưa hiển thị số liệu thay thế; vui lòng liên hệ người quản trị."}
                    </p>
                  )}
                  <div className={styles.toolbar}>
                    {can("approve_policy") && !data.periods.length && (
                      <button onClick={() => setEditor({ kind: "target" })}>
                        <Icon name="add" size={16} />
                        Chỉ tiêu
                      </button>
                    )}
                    {(can("work") || can("approve_policy")) &&
                      !data.periods.length && (
                        <button onClick={() => setEditor({ kind: "revenue" })}>
                          <Icon name="add" size={16} />
                          Doanh thu ngoài
                        </button>
                      )}
                    {can("close_period") && !data.periods.length && (
                      <button
                        onClick={() => setEditor({ kind: "close_period" })}
                      >
                        <Icon name="lock" size={16} />
                        Chốt kỳ
                      </button>
                    )}
                  </div>
                  <div className={styles.metrics}>
                    <div>
                      <span>Chỉ tiêu kinh doanh</span>
                      <strong>
                        {closed
                          ? closedSnapshot
                            ? formatNumber(
                                closedSnapshot.target.amount_cents / 100,
                              )
                            : "—"
                          : target
                            ? formatNumber(target.amount_cents / 100)
                            : "—"}
                      </strong>
                      <small>
                        {closed
                          ? closedSnapshot?.target.definition.label
                          : target?.definition.label}
                      </small>
                    </div>
                    <div>
                      <span>Doanh thu đã duyệt</span>
                      <strong>
                        {closed
                          ? closedSnapshot
                            ? formatNumber(
                                closedSnapshot.revenue.amount_cents / 100,
                              )
                            : "—"
                          : revenue
                            ? formatNumber(revenue.amount_cents / 100)
                            : "—"}
                      </strong>
                      <small>
                        {closed
                          ? closedSnapshot?.revenue.source_name
                          : revenue?.source_name}
                      </small>
                    </div>
                    <div>
                      <span>
                        {closed ? "Thưởng đã chốt" : "Thưởng dự kiến"}
                      </span>
                      <strong>
                        {closed
                          ? closedSnapshot?.complete
                            ? formatNumber(closedSnapshot.totalCents / 100)
                            : "—"
                          : rewardsReady
                            ? formatNumber(rewardTotal / 100)
                            : "—"}
                      </strong>
                      <small>
                        {closed
                          ? closedSnapshot?.policy.title
                          : policy
                            ? rewardsReady
                              ? policy.title
                              : "Chưa đủ dữ liệu hoặc chưa xác minh đầy đủ"
                            : "Chưa có chính sách áp dụng"}
                      </small>
                    </div>
                  </div>
                  {displayedRewards.map((item) => (
                    <p key={item.userId}>
                      {data.people.find((person) => person.id === item.userId)
                        ?.name ?? "Quản lý"}{" "}
                      · {formatNumber(item.shareBps / 100)}%:{" "}
                      {item.result.state === "calculated"
                        ? formatNumber(item.result.amountCents / 100)
                        : item.result.reason}
                    </p>
                  ))}
                  <OperationsHistory
                    branch={branch}
                    period={period}
                    people={data.people}
                  />
                  {closed && (
                    <PeriodAdjustments
                      periodId={closed.id}
                      original={closed.snapshot}
                      canPropose={can("work") || can("close_period")}
                      canApprove={can("close_period")}
                      isCeo={data.isCeo}
                      userId={data.userId}
                      onChange={setAdjustedPeriod}
                    />
                  )}
                  <h2 className={styles.sectionTitle}>Nguồn doanh thu</h2>
                  <div className={styles.list}>
                    {data.revenues.map((r) => (
                      <article className={styles.row} key={r.id}>
                        <div>
                          <h2>{r.source_name}</h2>
                          <p>
                            {r.definition.label} · {r.evidence}
                          </p>
                        </div>
                        <strong className={styles.numeric}>
                          {formatNumber(r.amount_cents / 100)}
                        </strong>
                        <Badge value={r.state} />
                        {r.state === "pending" &&
                          can("verify") &&
                          !data.periods.length && (
                            <button
                              disabled={busy}
                              onClick={() => {
                                const reason = window.prompt(
                                  "Lý do xác nhận / thay thế nguồn doanh thu",
                                );
                                if (reason)
                                  void send("approve_revenue", {
                                    id: r.id,
                                    reason,
                                  });
                              }}
                            >
                              <Icon name="check" size={16} />
                              Duyệt
                            </button>
                          )}
                      </article>
                    ))}
                  </div>
                </>
              )}
              {tab === "kpi" &&
                data.branches.find((b) => b.id === branch) &&
                !data.periods.length &&
                (can("work") || can("approve_policy")) && (
                  <div className={styles.excel}>
                    <RevenueExcel
                      branch={data.branches.find((b) => b.id === branch)!}
                      definition={target?.definition.label ?? ""}
                      period={period}
                      busy={busy}
                      onSave={send}
                    />
                    {can("approve_policy") &&
                      target?.definition.label ===
                        ONEBIZ_REVENUE_DEFINITION && (
                        <button
                          disabled={busy}
                          onClick={() =>
                            void send("onebiz_revenue", { period })
                          }
                        >
                          <Icon name="refresh" size={16} />
                          Lấy doanh thu OneBiz FnB
                        </button>
                      )}
                  </div>
                )}
              {tab === "settings" && (
                <SettingsView
                  data={data}
                  canConfigure={can("approve_policy")}
                  canPropose={canProposeStandard(data, branch)}
                  canManageMembers={can("manage_members")}
                  busy={busy}
                  onEdit={setEditor}
                  onSave={send}
                />
              )}
            </>
          )}
        </section>
      </div>
      <Dialog
        open={!!editor}
        onOpenChange={(open) => {
          if (!open && !busy) setEditor(null);
        }}
      >
        <DialogContent
          className={`${styles.dialog} ${editor?.kind === "standard" || editor?.kind === "standard_details" || editor?.kind === "policy" ? styles.configurationDialog : ""}`}
          showCloseButton={false}
        >
          <DialogTitle className={styles.dialogTitle}>
            {editor?.proposal ? "Đề xuất Standard Working" : editor ? actionLabel(editor.kind) : ""}
            <button
              disabled={busy}
              title="Đóng"
              aria-label="Đóng"
              onClick={() => setEditor(null)}
            >
              <Icon name="close" size={18} />
            </button>
          </DialogTitle>
          {editor && data && (
            <EditorForm
              key={`${editor.kind}:${editor.run?.id ?? editor.todo?.id ?? "new"}`}
              editor={editor}
              branch={branch}
              data={data}
              managers={managers}
              busy={busy}
              error={error}
              onSave={send}
            />
          )}
        </DialogContent>
      </Dialog>
    </main>
  );
}

function actionLabel(action: string) {
  return (
    (
      {
        standard: "Standard Working",
        standard_details: "Chi tiết Standard Working",
        common_standard: "Mẫu chung các chi nhánh",
        event: "Công việc theo sự kiện",
        approve_standard: "Duyệt Standard Working",
        propose_standard: "Đề xuất Standard Working",
        request_standard_changes: "Yêu cầu sửa đề xuất",
        generate: "Tạo lịch công việc",
        result: "Ghi nhận kết quả",
        verify: "Xác minh kết quả",
        todo: "Tạo To-do",
        transfer: "Chuyển sang To-do",
        todo_update: "Cập nhật To-do",
        member: "Phân công chi nhánh",
        target: "Chỉ tiêu kinh doanh",
        revenue: "Doanh thu ngoài OneBiz",
        approve_revenue: "Duyệt doanh thu",
        policy: "Chính sách thưởng",
        approve_policy: "Duyệt chính sách",
        comment: "Phối hợp công việc",
        close_period: "Chốt kỳ đánh giá",
      } as Record<string, string>
    )[action] ?? "Cập nhật"
  );
}

function SettingsView({
  data,
  canConfigure,
  canPropose,
  canManageMembers,
  busy,
  onEdit,
  onSave,
}: {
  data: Workspace;
  canConfigure: boolean;
  canPropose: boolean;
  canManageMembers: boolean;
  busy: boolean;
  onEdit: (editor: Editor) => void;
  onSave: (action: string, payload: Record<string, unknown>) => Promise<void>;
}) {
  const [target, setTarget] = useState<"standards" | "policies" | "members">("standards");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState(() => initialFilters("settings"));
  const name = (id: string) =>
    data.people.find((p) => p.id === id)?.name ??
    "Tài khoản chưa được hiển thị";
  const matches = (item: Parameters<typeof matchesConfiguration>[0]) => {
    try { return matchesConfiguration(item, filters, search, data.period); } catch { return false; }
  };
  const standards = data.standards.filter(matches);
  const policies = data.policies.filter(matches);
  const members = data.members.filter(member => matches({ ...member, title: name(member.user_id) }));
  return (
    <>
      <div className={styles.toolbar}>
        {((canConfigure && data.isCeo) || canPropose) && (
          <button onClick={() => onEdit({ kind: "standard", proposal: canPropose })}>
            <Icon name="add" size={16} />
            {canPropose ? "Đề xuất công việc" : "Standard Working"}
          </button>
        )}
        {canConfigure && (
          <>
            <button onClick={() => onEdit({ kind: "policy" })}>
              <Icon name="add" size={16} />
              Chính sách thưởng
            </button>
            <button
              disabled={busy}
              onClick={() => void onSave("generate", { until: today() })}
            >
              <Icon name="refresh" size={16} />
              Tạo lịch đến hôm nay
            </button>
          </>
        )}
        {canManageMembers && (
          <button onClick={() => onEdit({ kind: "member" })}>
            <Icon name="add" size={16} />
            Phân công
          </button>
        )}
      </div>
      <div className={styles.toolbar}>
        <label className={styles.field}><span>Danh mục thiết lập</span><select aria-label="Danh mục thiết lập" value={target} onChange={event => { setTarget(event.target.value as typeof target); setFilters(initialFilters("settings")); setSearch(""); }}><option value="standards">Standard Working</option><option value="policies">Chính sách thưởng</option><option value="members">Phân công chi nhánh</option></select></label>
        <label className={styles.field}><span>Tìm trong thiết lập</span><input aria-label="Tìm trong thiết lập" type="search" maxLength={200} value={search} onChange={event => setSearch(event.target.value)} placeholder={target === "members" ? "Tên tài khoản" : "Tên mẫu hoặc chính sách"} /></label>
      </div>
      <OperationsFilterBar kind="settings" settingsTarget={target} value={filters} onChange={setFilters} people={data.people} period={data.period} />
      {target === "standards" && <>
      <h2 className={styles.sectionTitle}>Standard Working · {formatNumber(standards.length)}</h2>
      <div className={styles.list}>
        {standards.map((s) => (
          <article className={styles.row} key={s.id}>
            <div>
              <h2>{s.title}</h2>
              <p>
                {name(s.assignee_id)} ·{" "}
                {
                  (
                    {
                      daily: "Hàng ngày",
                      weekly: "Hàng tuần",
                      monthly: "Hàng tháng",
                      event: "Theo sự kiện",
                    } as Record<string, string>
                  )[s.frequency]
                }{" "}
                · {s.criteria.length} tiêu chí
              </p>
            </div>
            <Badge value={s.status === "pending" ? "pending_approval" : s.status} />
            <button onClick={() => onEdit({ kind: "standard_details", standard: s })}><Icon name="search" size={16} />Xem chi tiết</button>
            {s.review_note && <p className={styles.notice}>CEO yêu cầu sửa: {s.review_note}</p>}
            {canConfigure &&
              s.status === "approved" &&
              s.frequency === "event" && (
                <button
                  disabled={busy}
                  onClick={() => onEdit({ kind: "event", standard: s })}
                >
                  <Icon name="add" size={16} />
                  Tạo lần thực hiện
                </button>
              )}
            {((canConfigure && data.isCeo && s.status !== "pending") || (canPropose && canProposeRevision(s, data.userId))) && (
              <button
                disabled={busy}
                onClick={() => onEdit({ kind: "standard", standard: s, proposal: canPropose })}
              >
                <Icon name="add" size={16} />
                {canPropose ? s.status === "changes_requested" ? "Sửa và gửi lại" : "Đề xuất thay đổi" : "Phiên bản mới"}
              </button>
            )}
            {["draft", "pending"].includes(s.status) && canConfigure && data.isCeo && (
              <button
                disabled={busy}
                onClick={() => void onSave("approve_standard", { id: s.id })}
              >
                <Icon name="check" size={16} />
                Duyệt áp dụng
              </button>
            )}
            {s.status === "pending" && canConfigure && data.isCeo && (
              <button disabled={busy} onClick={() => onEdit({ kind: "request_standard_changes", standard: s })}>
                <Icon name="edit" size={16} />Yêu cầu sửa
              </button>
            )}
          </article>
        ))}
      </div>
      {!standards.length && <Empty label="Không có mẫu phù hợp với bộ lọc." />}
      </>}
      {target === "policies" && <>
      <h2 className={styles.sectionTitle}>Chính sách thưởng · {formatNumber(policies.length)}</h2>
      <div className={styles.list}>
        {policies.map((p) => (
          <article className={styles.row} key={p.id}>
            <div>
              <h2>{p.title}</h2>
              <p>
                Từ {formatDate(`${p.effective_from}T00:00:00+07:00`)} ·{" "}
                {formatNumber(p.config.operationsWeightBps / 100)}% vận hành /{" "}
                {formatNumber(p.config.businessWeightBps / 100)}% kinh doanh
              </p>
            </div>
            <Badge value={p.state} />
            {canConfigure && (
              <button
                disabled={busy}
                onClick={() => onEdit({ kind: "policy", policy: p })}
              >
                <Icon name="add" size={16} />
                Phiên bản mới
              </button>
            )}
            {p.state === "draft" && canConfigure && (
              <button
                disabled={busy}
                onClick={() => void onSave("approve_policy", { id: p.id })}
              >
                <Icon name="check" size={16} />
                Duyệt
              </button>
            )}
          </article>
        ))}
      </div>
      {!policies.length && <Empty label="Không có chính sách phù hợp với bộ lọc." />}
      </>}
      {target === "members" && <>
      <h2 className={styles.sectionTitle}>Phân công chi nhánh · {formatNumber(members.length)}</h2>
      {members.map((m) => (
        <div className={styles.audit} key={m.user_id}>
          <span>{name(m.user_id)}</span>
          <span>
            {m.member_role === "manager"
              ? "Quản lý"
              : m.member_role === "reviewer"
                ? "Xác minh"
                : "Phối hợp"}
          </span>
          <span>{m.active ? "Đang áp dụng" : "Ngừng áp dụng"}</span>
        </div>
      ))}
      {!members.length && <Empty label="Không có phân công phù hợp với bộ lọc." />}
      </>}
    </>
  );
}

function EditorForm({
  editor,
  branch,
  data,
  managers,
  busy,
  error,
  onSave,
}: {
  editor: Editor;
  branch: string;
  data: Workspace;
  managers: Workspace["people"];
  busy: boolean;
  error: string;
  onSave: (action: string, payload: Record<string, unknown>) => Promise<void>;
}) {
  const [criteria, setCriteria] = useState<Criterion[]>(
    editor.standard?.criteria ?? [blankCriterion()],
  );
  const [commonScope, setCommonScope] = useState(
    !editor.proposal && editor.standard?.scope === "common",
  );
  const [correction, setCorrection] = useState(false);
  const [formError, setFormError] = useState("");
  const [todoState, setTodoState] = useState(editor.todo?.state ?? "pending");
  const [existingTodo, setExistingTodo] = useState<Todo | null>(null);
  const [recordKey] = useState(() => crypto.randomUUID());
  const memberCaps = data.branches.find((b) => b.id === branch)?.capabilities ?? [];
  const eligibleMembers = data.people.filter((person) => data.isCeo || (
    person.id !== data.userId && !data.members.some((member) => member.user_id === person.id &&
      ((member.member_role === "manager" && !memberCaps.includes("work")) ||
        member.capabilities?.some((cap) => cap === "manage_members" || !memberCaps.includes(cap))))
  ));
  const [memberUserId, setMemberUserId] = useState(() => eligibleMembers[0]?.id ?? "");
  const selectedMember = data.members.find((member) => member.user_id === memberUserId);
  const [frequency, setFrequency] = useState<Frequency>(
    (editor.standard?.frequency as Frequency) ?? "daily",
  );
  const formRef = useRef<HTMLFormElement>(null);
  const [formSnapshot, setFormSnapshot] = useState<FormData | null>(null);
  const [tiers, setTiers] = useState([
    ...(editor.policy?.config.tiers ?? [
      { minimumScoreBps: 8000, payoutBps: 5000 },
      { minimumScoreBps: 9500, payoutBps: 10000 },
    ]),
  ]);
  const updateCriterion = (index: number, patch: Partial<Criterion>) =>
    setCriteria((old) =>
      old.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    );
  const isConfiguration =
    editor.kind === "standard" || editor.kind === "policy";
  useEffect(() => {
    if (isConfiguration && formRef.current)
      setFormSnapshot(new FormData(formRef.current));
  }, [isConfiguration, criteria, tiers, frequency, commonScope]);
  const configurationErrors =
    editor.kind === "standard" ? validateCriteria(criteria) : [];
  if (editor.kind === "policy" && formSnapshot) {
    try {
      rewardPolicyFromForm(formSnapshot, managers, tiers, recordKey);
    } catch (error) {
      configurationErrors.push(
        error instanceof Error ? error.message : "Chính sách chưa hợp lệ.",
      );
    }
  }
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (editor.kind === "standard_details") return;
    setFormError("");
    const f = new FormData(event.currentTarget);
    const text = (key: string) => String(f.get(key) ?? "");
    const number = (key: string) => Number(text(key));
    let payload: Record<string, unknown> = {};
    try {
      if (editor.kind === "event")
        payload = {
          standardId: editor.standard!.id,
          eventKey: recordKey,
          dueAt: `${text("dueAt")}:00+07:00`,
        };
      if (editor.kind === "standard") {
        const issues = validateCriteria(criteria);
        if (issues.length) throw new Error(issues.join(" "));
        payload = {
          title: text("title"),
          description: text("description"),
          assigneeId: text("assigneeId"),
          frequency: text("frequency"),
          dayNumber: ["weekly", "monthly"].includes(frequency)
            ? number("dayNumber")
            : 1,
          dueTime: text("dueTime"),
          effectiveFrom: text("effectiveFrom"),
          criteria,
          scope: commonScope ? "common" : "branch",
          ...(editor.standard
            ? {
                ...(editor.proposal ? { sourceId: editor.standard.id } : {}),
                familyId: editor.standard.family_id,
                revision: editor.standard.revision + 1,
              }
            : {}),
          ...(commonScope && !editor.standard
            ? {
                assignments: data.branches
                  .filter((item) => f.has(`branch-${item.id}`))
                  .map((item) => ({
                    branchId: item.id,
                    assigneeId: text(`manager-${item.id}`),
                  })),
              }
            : {}),
        };
      }
      if (editor.kind === "result" || editor.kind === "verify") {
        const observations: Observation[] =
          editor.kind === "verify" && !correction
            ? editor.run!.observations
            : editor.run!.criteria.flatMap((c) =>
                Array.from({ length: c.samples }, (_, i) => ({
                  criterionId: c.id,
                  slot: String(i + 1),
                  value: number(`value:${c.id}:${i}`),
                  evidence: text(`evidence:${c.id}:${i}`),
                  ...(text(`measuredAt:${c.id}:${i}`)
                    ? {
                        measuredAt: `${text(`measuredAt:${c.id}:${i}`)}:00+07:00`,
                      }
                    : {}),
                  ...(text(`measurementId:${c.id}:${i}`)
                    ? {
                        measurementId: text(`measurementId:${c.id}:${i}`),
                        measuredAt: text(`sourceMeasuredAt:${c.id}:${i}`),
                      }
                    : {}),
                  ...(c.kind === "percent"
                    ? {
                        numerator: number(`numerator:${c.id}:${i}`),
                        denominator: number(`denominator:${c.id}:${i}`),
                      }
                    : {}),
                })),
              );
        payload = {
          id: editor.run!.id,
          version: editor.run!.version,
          observations,
          note: text("note"),
          ...(editor.kind === "verify" ? { correction } : {}),
        };
      }
      if (editor.kind === "todo" || editor.kind === "transfer")
        payload = {
          title: text("title"),
          description: text("description"),
          assigneeId: editor.run?.assignee_id ?? text("assigneeId"),
          category: text("category"),
          priority: text("priority"),
          dueAt: existingTodo
            ? existingTodo.due_at
            : `${text("dueAt")}:00+07:00`,
          collaborators: f.getAll("collaborators"),
          runId: editor.run?.id,
          version: editor.run?.version,
          ...(existingTodo ? { todoId: existingTodo.id } : {}),
        };
      if (editor.kind === "todo_update")
        payload = {
          id: editor.todo!.id,
          version: editor.todo!.version,
          state: todoState,
          title: text("title"),
          description: text("description"),
          assigneeId: text("assigneeId"),
          category: text("category"),
          priority: text("priority"),
          dueAt: `${text("dueAt")}:00+07:00`,
          collaborators: f.getAll("collaborators"),
          resolution: text("resolution"),
          waitingNote: text("waitingNote"),
          followUpAt: text("followUpAt")
            ? `${text("followUpAt")}:00+07:00`
            : null,
          reason: text("reason"),
        };
      if (editor.kind === "comment")
        payload = {
          id: editor.todo!.id,
          branchId: editor.todo!.branch_id,
          note: text("note"),
        };
      if (editor.kind === "member")
        payload = {
          userId: text("userId"),
          memberRole: text("memberRole"),
          capabilities: f.getAll("capabilities"),
          active: text("active") === "true",
        };
      if (editor.kind === "target")
        payload = {
          period: data.period,
          amountCents: money(f.get("amount")),
          definition: { label: text("onebizDefinition") || text("definition") },
          reason: text("reason"),
        };
      if (editor.kind === "revenue")
        payload = {
          period: data.period,
          amountCents: money(f.get("amount")),
          definition: data.targets[0]?.definition ?? {
            label: text("definition"),
          },
          source: "manual",
          sourceName: text("sourceName"),
          evidence: text("evidence"),
          sourceKey: recordKey,
          note: text("note"),
        };
      if (editor.kind === "policy") {
        const config = rewardPolicyFromForm(f, managers, tiers, recordKey);
        payload = {
          title: text("title"),
          effectiveFrom: text("effectiveFrom"),
          config,
        };
      }
      if (editor.kind === "close_period")
        payload = { period: data.period, reason: text("reason") };
      if (editor.kind === "request_standard_changes")
        payload = { id: editor.standard!.id, revision: editor.standard!.revision, reason: text("reason") };
      await onSave(
        editor.kind === "standard" && editor.proposal ? "propose_standard" : editor.kind === "standard" && commonScope && !editor.standard
          ? "common_standard"
          : editor.kind,
        payload,
      );
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Thông tin chưa hợp lệ.");
    }
  };
  const managerSelect = (
    <select
      name="assigneeId"
      required
      defaultValue={
        editor.standard?.assignee_id ??
        editor.run?.assignee_id ??
        managers[0]?.id
      }
    >
      {managers.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name}
        </option>
      ))}
    </select>
  );
  return (
    <form
      ref={formRef}
      className={styles.form}
      onSubmit={submit}
      onChange={() => {
        if (isConfiguration && formRef.current)
          setFormSnapshot(new FormData(formRef.current));
      }}
    >
      <div
        className={
          isConfiguration ? styles.configurationLayout : styles.simpleLayout
        }
      >
        {isConfiguration && (
          <nav className={styles.configurationNav} aria-label="Mục cấu hình">
            <span>
              {editor.kind === "standard"
                ? "Tiêu chuẩn công việc"
                : "Chính sách thưởng"}
            </span>
            {(editor.kind === "standard"
              ? [
                  ["information", "Công việc & lịch"],
                  ["criteria", "Tiêu chí kết quả"],
                ]
              : [
                  ["information", "Chính sách"],
                  ["weights", "Điểm & điều kiện"],
                  ["allocations", "Phân bổ quản lý"],
                  ["tiers", "Bậc thưởng"],
                ]
            ).map(([key, label], index) => (
              <button
                key={key}
                type="button"
                onClick={() =>
                  formRef.current
                    ?.querySelector(`[data-section="${key}"]`)
                    ?.scrollIntoView({ behavior: "smooth", block: "start" })
                }
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                {label}
              </button>
            ))}
          </nav>
        )}
        <div className={styles.formBody}>
          {(formError || error) && (
            <p role="alert" className={styles.error}>
              {formError || error}
            </p>
          )}
          {editor.kind === "request_standard_changes" && <>
            <h3>{editor.standard!.title}</h3>
            <Field label="Nội dung cần sửa"><textarea name="reason" required maxLength={2000} rows={4} /></Field>
          </>}
          {editor.kind === "standard_details" && <>
            <h3>{editor.standard!.title}</h3>
            <p>{editor.standard!.description}</p>
            <dl className={styles.standardDetails}>
              <div><dt>Quản lý phụ trách</dt><dd>{data.people.find(person => person.id === editor.standard!.assignee_id)?.name ?? "Tài khoản OneBiz"}</dd></div>
              <div><dt>Phiên bản</dt><dd>{formatNumber(editor.standard!.revision)}</dd></div>
              <div><dt>Phạm vi</dt><dd>{editor.standard!.scope === "branch" ? "Đặc thù chi nhánh" : "Công việc chung"}</dd></div>
              <div><dt>Tần suất</dt><dd>{({daily:"Hàng ngày",weekly:"Hàng tuần",monthly:"Hàng tháng",event:"Theo sự kiện"} as Record<string,string>)[editor.standard!.frequency]}</dd></div>
              <div><dt>Ngày bắt đầu</dt><dd>{formatDate(`${editor.standard!.effective_from}T00:00:00+07:00`)}</dd></div>
              <div><dt>Giờ hạn (Việt Nam)</dt><dd>{editor.standard!.due_time.slice(0,5)}{editor.standard!.frequency === "weekly" ? ` · ${["Thứ Hai","Thứ Ba","Thứ Tư","Thứ Năm","Thứ Sáu","Thứ Bảy","Chủ Nhật"][editor.standard!.day_number-1]}` : editor.standard!.frequency === "monthly" ? ` · Ngày ${editor.standard!.day_number}` : ""}</dd></div>
            </dl>
            <h3>Tiêu chí kết quả</h3>
            {editor.standard!.criteria.map(criterion => <section key={criterion.id} className={styles.standardCriterion}>
              <h4>{criterion.title}</h4><p>{criterion.measurementScope || "Theo phạm vi công việc"}</p>
              <p>{({eq:"Bằng",lte:"Không vượt quá",gte:"Tối thiểu",lt:"Nhỏ hơn"} as Record<string,string>)[criterion.operator]} {criterion.kind === "boolean" ? criterion.threshold === 1 ? "Có" : "Không" : formatNumber(criterion.threshold)}{criterion.kind === "percent" ? "%" : criterion.kind === "duration" ? " phút" : ""} · {formatNumber(criterion.samples)} lần kiểm tra</p>
              {!!criterion.measurementTimes?.length && <p>Giờ kiểm tra: {criterion.measurementTimes.join(", ")}</p>}
              <p>{criterion.evidenceRequired ? "Bắt buộc minh chứng" : "Không bắt buộc minh chứng"} · {criterion.critical ? "Tiêu chí trọng yếu" : "Tiêu chí thông thường"}</p>
              {criterion.ratioBasis && <p>Cách xác định tỷ lệ: {criterion.ratioBasis}</p>}
            </section>)}
            {editor.standard!.review_note && <p className={styles.notice}>CEO yêu cầu sửa: {editor.standard!.review_note}</p>}
          </>}
          {editor.kind === "event" && (
            <>
              <h3>{editor.standard!.title}</h3>
              <Field label="Deadline (giờ Việt Nam)">
                <Input name="dueAt" type="datetime-local" required />
              </Field>
            </>
          )}
          {editor.kind === "standard" && (
            <>
              <h3
                className={styles.configurationHeading}
                data-section="information"
              >
                Công việc & lịch thực hiện
              </h3>
              <Field label="Công việc">
                <input
                  name="title"
                  required
                  maxLength={200}
                  defaultValue={editor.standard?.title}
                />
              </Field>
              <Field label="Kết quả cần đạt">
                <textarea
                  name="description"
                  rows={2}
                  defaultValue={editor.standard?.description}
                />
              </Field>
              <div className={styles.formGrid}>
                <Field label="Phạm vi">
                  <select
                    value={commonScope ? "common" : "branch"}
                    disabled={!!editor.standard || editor.proposal}
                    onChange={(event) =>
                      setCommonScope(event.target.value === "common")
                    }
                  >
                    <option value="branch">Đặc thù chi nhánh</option>
                    <option value="common">Công việc chung</option>
                  </select>
                </Field>
                {(!commonScope || editor.standard) && (
                  <Field label="Quản lý phụ trách">{managerSelect}</Field>
                )}
                <Field label="Tần suất">
                  <select
                    name="frequency"
                    value={frequency}
                    onChange={(event) =>
                      setFrequency(event.target.value as Frequency)
                    }
                  >
                    <option value="daily">Hàng ngày</option>
                    <option value="weekly">Hàng tuần</option>
                    <option value="monthly">Hàng tháng</option>
                    <option value="event">Theo sự kiện</option>
                  </select>
                </Field>
                {frequency === "weekly" && (
                  <Field label="Ngày trong tuần">
                    <select
                      name="dayNumber"
                      defaultValue={Math.min(
                        editor.standard?.day_number ?? 1,
                        7,
                      )}
                    >
                      {[
                        "Thứ Hai",
                        "Thứ Ba",
                        "Thứ Tư",
                        "Thứ Năm",
                        "Thứ Sáu",
                        "Thứ Bảy",
                        "Chủ Nhật",
                      ].map((label, index) => (
                        <option key={label} value={index + 1}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </Field>
                )}
                {frequency === "monthly" && (
                  <Field label="Ngày trong tháng">
                    <input
                      name="dayNumber"
                      type="number"
                      min={1}
                      max={31}
                      defaultValue={editor.standard?.day_number ?? 1}
                      required
                    />
                  </Field>
                )}
                <Field
                  label={
                    frequency === "event"
                      ? "Giờ hạn mặc định (Việt Nam)"
                      : "Giờ hạn (Việt Nam)"
                  }
                >
                  <input
                    type="time"
                    name="dueTime"
                    defaultValue={
                      editor.standard?.due_time.slice(0, 5) ?? "17:00"
                    }
                    required
                  />
                </Field>
                <Field label="Ngày áp dụng">
                  <Input
                    type="date"
                    name="effectiveFrom"
                    min={today()}
                    defaultValue={today()}
                    required
                  />
                </Field>
              </div>
              {commonScope &&
                !editor.standard &&
                data.branches.map((item) => (
                  <div className={styles.formGrid} key={item.id}>
                    <label>
                      <input
                        type="checkbox"
                        name={`branch-${item.id}`}
                        defaultChecked={item.id === data.branches[0]?.id}
                      />
                      {item.name}
                    </label>
                    <Field label="Quản lý phụ trách">
                      <select
                        name={`manager-${item.id}`}
                        defaultValue={managers[0]?.id}
                      >
                        {data.people.map((person) => (
                          <option key={person.id} value={person.id}>
                            {person.name}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                ))}
              <h3
                className={styles.configurationHeading}
                data-section="criteria"
              >
                Tiêu chí kết quả
              </h3>
              {criteria.map((c, i) => (
                <fieldset key={c.id} className={styles.criterion}>
                  <legend>Tiêu chí {i + 1}</legend>
                  <Field label="Tiêu chí trong bộ KPI">
                    <select
                      defaultValue=""
                      onChange={(event) => {
                        const reference = referenceCriteria.find(
                          (item) => item.criterion.id === event.target.value,
                        );
                        if (reference)
                          updateCriterion(
                            i,
                            applyCriterionReference(c, reference.criterion),
                          );
                      }}
                    >
                      <option value="">Tự thiết lập</option>
                      {referenceCriteria.map((item) => (
                        <option
                          key={item.criterion.id}
                          value={item.criterion.id}
                        >
                          {item.group} · {item.criterion.title}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Tên tiêu chí">
                    <input
                      required
                      value={c.title}
                      onChange={(e) =>
                        updateCriterion(i, { title: e.target.value })
                      }
                    />
                  </Field>
                  <Field label="Phạm vi kiểm tra">
                    <input
                      maxLength={300}
                      value={c.measurementScope ?? ""}
                      onChange={(e) =>
                        updateCriterion(i, { measurementScope: e.target.value })
                      }
                      placeholder="Ví dụ: khu vực quầy và kho chi nhánh"
                    />
                  </Field>
                  <label className={styles.checkLabel}>
                    <input
                      type="checkbox"
                      checked={!!c.measurementTimes?.length}
                      onChange={(event) =>
                        updateCriterion(i, {
                          measurementTimes: event.target.checked
                            ? Array.from({ length: c.samples }, () => "")
                            : undefined,
                        })
                      }
                    />
                    Giờ kiểm tra cố định (Việt Nam)
                  </label>
                  {!!c.measurementTimes?.length && (
                    <div className={styles.formGrid}>
                      {Array.from({ length: c.samples }, (_, slot) => (
                        <Field
                          key={slot}
                          label={`Giờ kiểm tra lần ${slot + 1}`}
                        >
                          <input
                            type="time"
                            required
                            value={c.measurementTimes?.[slot] ?? ""}
                            onChange={(event) =>
                              updateCriterion(i, {
                                measurementTimes: Array.from(
                                  { length: c.samples },
                                  (_, index) =>
                                    index === slot
                                      ? event.target.value
                                      : (c.measurementTimes?.[index] ?? ""),
                                ),
                              })
                            }
                          />
                        </Field>
                      ))}
                    </div>
                  )}
                  {c.kind === "percent" && (
                    <Field label="Cơ sở tính tỷ lệ">
                      <input
                        maxLength={300}
                        value={c.ratioBasis ?? ""}
                        onChange={(e) =>
                          updateCriterion(i, { ratioBasis: e.target.value })
                        }
                        placeholder="Ví dụ: giá trị hao hụt / giá trị nhập, cùng kỳ"
                      />
                    </Field>
                  )}
                  <div className={styles.formGrid}>
                    <Field label="Loại kết quả">
                      <select
                        value={c.kind}
                        onChange={(e) =>
                          updateCriterion(i, {
                            kind: e.target.value as Criterion["kind"],
                            ...(e.target.value === "boolean"
                              ? { operator: "eq", threshold: 1 }
                              : {}),
                          })
                        }
                      >
                        <option value="boolean">Có / Không</option>
                        <option value="number">Số lượng</option>
                        <option value="percent">Tỷ lệ %</option>
                        <option value="duration">Thời gian (phút)</option>
                      </select>
                    </Field>
                    <Field label="Điều kiện">
                      <select
                        value={c.operator}
                        onChange={(e) =>
                          updateCriterion(i, {
                            operator: e.target.value as Criterion["operator"],
                          })
                        }
                      >
                        <option value="eq">Bằng</option>
                        {c.kind !== "boolean" && (
                          <>
                            <option value="lte">Không vượt quá</option>
                            <option value="lt">Nhỏ hơn</option>
                            <option value="gte">Tối thiểu</option>
                          </>
                        )}
                      </select>
                    </Field>
                    <Field label="Mức cần đạt">
                      {c.kind === "boolean" ? (
                        <select
                          value={c.threshold}
                          onChange={(event) =>
                            updateCriterion(i, {
                              threshold: Number(event.target.value),
                            })
                          }
                        >
                          <option value={1}>Có / Đạt</option>
                          <option value={0}>Không / Chưa đạt</option>
                        </select>
                      ) : (
                        <input
                          type="number"
                          step="any"
                          required
                          value={c.threshold}
                          onChange={(e) =>
                            updateCriterion(i, {
                              threshold: Number(e.target.value),
                            })
                          }
                        />
                      )}
                    </Field>
                    <Field label="Số lần kiểm tra">
                      <input
                        type="number"
                        min={1}
                        max={50}
                        required
                        value={c.samples}
                        onChange={(e) =>
                          updateCriterion(i, {
                            samples: Number(e.target.value),
                            ...(c.measurementTimes?.length
                              ? {
                                  measurementTimes: Array.from(
                                    {
                                      length: Math.max(
                                        0,
                                        Math.min(50, Number(e.target.value)),
                                      ),
                                    },
                                    (_, index) =>
                                      c.measurementTimes?.[index] ?? "",
                                  ),
                                }
                              : {}),
                          })
                        }
                      />
                    </Field>
                  </div>
                  <div className={styles.toolbar}>
                    <label>
                      <input
                        type="checkbox"
                        checked={c.critical}
                        onChange={(e) =>
                          updateCriterion(i, { critical: e.target.checked })
                        }
                      />
                      Lỗi nghiêm trọng
                    </label>
                    <label>
                      <input
                        type="checkbox"
                        checked={c.evidenceRequired}
                        onChange={(e) =>
                          updateCriterion(i, {
                            evidenceRequired: e.target.checked,
                          })
                        }
                      />
                      Bắt buộc minh chứng
                    </label>
                    {criteria.length > 1 && (
                      <button
                        type="button"
                        title="Xóa tiêu chí"
                        onClick={() =>
                          setCriteria((old) =>
                            old.filter((_, index) => index !== i),
                          )
                        }
                      >
                        <Icon name="close" size={16} />
                      </button>
                    )}
                  </div>
                </fieldset>
              ))}
              <button
                type="button"
                disabled={criteria.length >= 30}
                onClick={() => setCriteria((old) => [...old, blankCriterion()])}
              >
                <Icon name="add" size={16} />
                Tiêu chí
              </button>
            </>
          )}
          {(editor.kind === "result" || editor.kind === "verify") && (
            <RunResults
              editor={editor}
              correction={correction}
              onCorrection={setCorrection}
            />
          )}
          {(editor.kind === "todo" || editor.kind === "transfer") && (
            <>
              {editor.kind === "transfer" && (
                <OperationsTodoPicker
                  branch={branch}
                  value={existingTodo}
                  onChange={setExistingTodo}
                />
              )}
              {existingTodo ? (
                <p>
                  Giữ nguyên người phụ trách, hạn hoàn thành và tình trạng của
                  To-do đang có.
                </p>
              ) : (
                <>
                  <Field label="Nội dung">
                    <input
                      name="title"
                      required
                      maxLength={200}
                      defaultValue={editor.run?.title}
                    />
                  </Field>
                  <Field label="Phần cần xử lý / lý do chuyển">
                    <textarea
                      name="description"
                      rows={3}
                      required={editor.kind === "transfer"}
                    />
                  </Field>
                  <TodoFields
                    data={data}
                    managers={managers}
                    assigneeId={editor.run?.assignee_id}
                  />
                </>
              )}
            </>
          )}
          {editor.kind === "todo_update" && (
            <>
              <Field label="Nội dung">
                <input
                  name="title"
                  required
                  maxLength={200}
                  defaultValue={editor.todo!.title}
                />
              </Field>
              <Field label="Chi tiết">
                <textarea
                  name="description"
                  defaultValue={editor.todo!.description}
                />
              </Field>
              <TodoFields data={data} managers={managers} todo={editor.todo} />
              <Field label="Tình trạng">
                <select
                  value={todoState}
                  onChange={(e) => setTodoState(e.target.value)}
                >
                  {[
                    "pending",
                    "in_progress",
                    "waiting",
                    "done",
                    "canceled",
                  ].map((s) => (
                    <option value={s} key={s}>
                      {states[s]}
                    </option>
                  ))}
                </select>
              </Field>
              {todoState === "waiting" && (
                <>
                  <Field label="Nội dung đang chờ">
                    <textarea name="waitingNote" required />
                  </Field>
                  <Field label="Hẹn kiểm tra lại (Việt Nam)">
                    <Input type="datetime-local" name="followUpAt" required />
                  </Field>
                </>
              )}
              {todoState === "done" && (
                <Field label="Kết quả xử lý">
                  <textarea name="resolution" required />
                </Field>
              )}
              <Field label="Lý do điều chỉnh / hủy">
                <textarea name="reason" required={todoState === "canceled"} />
              </Field>
            </>
          )}
          {editor.kind === "member" && (
            <>
              <Field label="Tài khoản OneBiz">
                <select name="userId" required value={memberUserId}
                  onChange={(event) => setMemberUserId(event.target.value)}>
                  {!eligibleMembers.length && <option value="">Không có tài khoản phù hợp</option>}
                  {eligibleMembers.map((p) => (
                    <option key={p.id} value={p.id}
                    >
                      {p.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Vai trò">
                <select name="memberRole" key={`role-${memberUserId}`} defaultValue={selectedMember?.member_role ?? (memberCaps.includes("work") ? "manager" : "reviewer")}>
                  <option value="manager" disabled={!memberCaps.includes("work")}>Quản lý</option>
                  <option value="reviewer">Xác minh</option>
                  <option value="coordinator">Phối hợp</option>
                </select>
              </Field>
              <Field label="Áp dụng">
                <select name="active" key={`active-${memberUserId}`} defaultValue={String(selectedMember?.active ?? true)}>
                  <option value="true">Đang áp dụng</option>
                  <option value="false">Ngừng áp dụng</option>
                </select>
              </Field>
              {[
                ["verify", "Xác minh"],
                ["close_period", "Chốt kỳ"],
                ["cancel_todo", "Hủy To-do"],
                ["approve_policy", "Duyệt tiêu chuẩn và chính sách"],
                ...(data.isCeo ? [["manage_members", "Phân công người trong chi nhánh"]] : []),
              ].map(([key, label]) => (
                <label key={`${memberUserId}-${key}`}>
                  <input type="checkbox" name="capabilities" value={key}
                    defaultChecked={selectedMember?.capabilities?.includes(key) ?? false}
                    disabled={!memberCaps.includes(key)} />
                  {label}
                </label>
              ))}
            </>
          )}
          {(editor.kind === "target" || editor.kind === "revenue") && (
            <>
              <Field label="Số tiền (VND)">
                <input
                  name="amount"
                  inputMode="decimal"
                  required
                  placeholder="1,234,567.89"
                />
              </Field>
              <Field label="Định nghĩa doanh thu">
                <textarea
                  name="definition"
                  required
                  defaultValue={data.targets[0]?.definition.label}
                  readOnly={editor.kind === "revenue" && !!data.targets[0]}
                />
              </Field>
              {editor.kind === "target" && (
                <Field label="Lấy từ báo cáo OneBiz FnB">
                  <select name="onebizDefinition">
                    <option value="">
                      Nguồn ngoài, theo định nghĩa đã nhập
                    </option>
                    <option value={ONEBIZ_REVENUE_DEFINITION}>
                      OneBiz: sau giảm giá, gồm thuế, trừ trả; ngày tạo
                    </option>
                  </select>
                </Field>
              )}
              {editor.kind === "revenue" ? (
                <>
                  <Field label="Nguồn báo cáo">
                    <input name="sourceName" required />
                  </Field>
                  <Field label="Chứng từ / tài liệu đối chiếu">
                    <input name="evidence" required maxLength={1000} />
                  </Field>
                  <Field label="Ghi chú">
                    <textarea name="note" />
                  </Field>
                </>
              ) : (
                <Field label="Lý do thiết lập / thay đổi">
                  <textarea name="reason" required />
                </Field>
              )}
            </>
          )}
          {editor.kind === "policy" && (
            <>
              <h3
                className={styles.configurationHeading}
                data-section="information"
              >
                Thông tin chính sách
              </h3>
              <Field label="Tên chính sách">
                <input
                  name="title"
                  required
                  defaultValue={editor.policy?.title}
                />
              </Field>
              <Field label="Ngày áp dụng">
                <Input
                  type="date"
                  name="effectiveFrom"
                  min={today()}
                  defaultValue={today()}
                  required
                />
              </Field>
              <h3
                className={styles.configurationHeading}
                data-section="weights"
              >
                Điểm & điều kiện thưởng
              </h3>
              <div className={styles.formGrid}>
                {[
                  [
                    "opsWeight",
                    "Trọng số vận hành (%)",
                    editor.policy
                      ? editor.policy.config.operationsWeightBps / 100
                      : 60,
                  ],
                  [
                    "businessWeight",
                    "Trọng số kinh doanh (%)",
                    editor.policy
                      ? editor.policy.config.businessWeightBps / 100
                      : 40,
                  ],
                  [
                    "minOps",
                    "Vận hành tối thiểu (%)",
                    editor.policy
                      ? editor.policy.config.minimumOperationsBps / 100
                      : 80,
                  ],
                  [
                    "minBusiness",
                    "Kinh doanh tối thiểu (%)",
                    editor.policy
                      ? editor.policy.config.minimumBusinessBps / 100
                      : 80,
                  ],
                  [
                    "maxBusiness",
                    "Giới hạn đóng góp kinh doanh (%)",
                    editor.policy
                      ? editor.policy.config.maximumBusinessContributionBps /
                        100
                      : 100,
                  ],
                ].map(([key, label, value]) => (
                  <Field key={key} label={String(label)}>
                    <input
                      name={String(key)}
                      type="number"
                      min={0}
                      max={key === "maxBusiness" ? 1000 : 100}
                      step="0.01"
                      defaultValue={value}
                      required
                    />
                  </Field>
                ))}
                {[
                  [
                    "base",
                    "Quỹ thưởng cơ sở (VND)",
                    editor.policy
                      ? formatNumber(editor.policy.config.baseCents / 100)
                      : "1,000,000",
                  ],
                  [
                    "cap",
                    "Trần thưởng (VND)",
                    editor.policy
                      ? formatNumber(editor.policy.config.capCents / 100)
                      : "1,000,000",
                  ],
                  [
                    "round",
                    "Làm tròn đến (VND)",
                    editor.policy
                      ? formatNumber(editor.policy.config.roundingCents / 100)
                      : "1,000",
                  ],
                ].map(([key, label, value]) => (
                  <Field key={key} label={label}>
                    <input
                      name={key}
                      defaultValue={value}
                      required
                      inputMode="decimal"
                    />
                  </Field>
                ))}
              </div>
              <label>
                <input
                  name="verify"
                  type="checkbox"
                  defaultChecked={
                    editor.policy?.config.requireFullVerification ?? true
                  }
                />
                Bắt buộc xác minh đầy đủ
              </label>
              <label>
                <input
                  name="critical"
                  type="checkbox"
                  defaultChecked={
                    editor.policy?.config.blockCriticalFailure ?? true
                  }
                />
                Không thưởng khi có lỗi nghiêm trọng
              </label>
              <h3
                className={styles.configurationHeading}
                data-section="allocations"
              >
                Phân bổ quỹ cho quản lý
              </h3>
              {managers.map((manager, index) => (
                <Field key={manager.id} label={`${manager.name} (%)`}>
                  <input
                    name={`share-${manager.id}`}
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    required
                    defaultValue={
                      editor.policy
                        ? (editor.policy.config.allocations?.find(
                            (item) => item.userId === manager.id,
                          )?.shareBps ?? 0) / 100
                        : index === 0
                          ? 100
                          : 0
                    }
                  />
                </Field>
              ))}
              <h3 className={styles.configurationHeading} data-section="tiers">
                Bậc thưởng
              </h3>
              {tiers.map((t, i) => (
                <div key={i} className={styles.formGrid}>
                  <Field label="Điểm tối thiểu (%)">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      step="0.01"
                      value={t.minimumScoreBps / 100}
                      onChange={(e) =>
                        setTiers((old) =>
                          old.map((x, j) =>
                            j === i
                              ? {
                                  ...x,
                                  minimumScoreBps: Math.round(
                                    Number(e.target.value) * 100,
                                  ),
                                }
                              : x,
                          ),
                        )
                      }
                    />
                  </Field>
                  <Field label="Tỷ lệ quỹ thưởng (%)">
                    <input
                      type="number"
                      min={0}
                      max={1000}
                      step="0.01"
                      value={t.payoutBps / 100}
                      onChange={(e) =>
                        setTiers((old) =>
                          old.map((x, j) =>
                            j === i
                              ? {
                                  ...x,
                                  payoutBps: Math.round(
                                    Number(e.target.value) * 100,
                                  ),
                                }
                              : x,
                          ),
                        )
                      }
                    />
                  </Field>
                  <button
                    type="button"
                    onClick={() =>
                      setTiers((old) => old.filter((_, j) => j !== i))
                    }
                    title="Xóa bậc"
                  >
                    <Icon name="close" size={16} />
                  </button>
                </div>
              ))}
              <button
                type="button"
                disabled={tiers.length >= 30}
                onClick={() =>
                  setTiers((old) => [
                    ...old,
                    { minimumScoreBps: 10000, payoutBps: 10000 },
                  ])
                }
              >
                <Icon name="add" size={16} />
                Bậc thưởng
              </button>
            </>
          )}
          {editor.kind === "comment" && (
            <>
              <h3>{editor.todo!.title}</h3>
              <p>{editor.todo!.description}</p>
              <p>
                Người phụ trách:{" "}
                {data.people.find(
                  (person) => person.id === editor.todo!.assignee_id,
                )?.name ?? "Quản lý"}{" "}
                · Deadline: {formatDate(editor.todo!.due_at)}
              </p>
              {data.audit
                .filter(
                  (entry) =>
                    entry.entity_id === editor.todo!.id &&
                    entry.action === "comment",
                )
                .slice()
                .reverse()
                .map((entry) => (
                  <p key={entry.id}>
                    <strong>
                      {data.people.find(
                        (person) => person.id === entry.actor_id,
                      )?.name ?? "Người phối hợp"}
                    </strong>{" "}
                    · {formatDate(entry.created_at)}
                    <br />
                    {entry.after_data?.note}
                  </p>
                ))}
              <Field label="Nội dung phối hợp">
                <textarea name="note" required rows={4} />
              </Field>
            </>
          )}
          {editor.todo &&
            (editor.kind === "comment" || editor.kind === "todo_update") && (
              <EvidenceFiles entity={editor.todo.id} kind="todo" canUpload />
            )}
          {editor.kind === "close_period" && (
            <>
              <p>
                Kỳ {data.period}. Kết quả, doanh thu, chỉ tiêu và chính sách
                được lưu cố định sau khi chốt.
              </p>
              <Field label="Nội dung xác nhận chốt kỳ">
                <textarea name="reason" required rows={3} />
              </Field>
            </>
          )}
        </div>
        {isConfiguration && (
          <ConfigurationReview
            kind={editor.kind as "standard" | "policy"}
            form={formSnapshot}
            criteria={criteria}
            frequency={frequency}
            managers={managers}
            tiers={tiers}
            version={recordKey}
            issues={configurationErrors}
          />
        )}
      </div>
      <footer className={styles.formFooter}>
        {isConfiguration && (
          <span className={styles.footerState} role="status">
            {configurationErrors.length
              ? "Còn thông tin cần kiểm tra"
              : editor.proposal ? "Đề xuất · Chờ CEO duyệt trước khi áp dụng" : "Bản nháp · Chưa áp dụng"}
          </span>
        )}
        {editor.kind !== "standard_details" && <button
          className={styles.primary}
          type="submit"
          disabled={busy || configurationErrors.length > 0}
        >
          {busy
            ? "Đang lưu…"
            : editor.proposal ? "Gửi CEO duyệt" : editor.kind === "request_standard_changes" ? "Gửi yêu cầu sửa" : editor.kind === "standard" || editor.kind === "policy"
              ? "Lưu bản nháp"
              : "Lưu"}
        </button>}
      </footer>
    </form>
  );
}

function TodoFields({
  data,
  managers,
  todo,
  assigneeId,
}: {
  data: Workspace;
  managers: Workspace["people"];
  todo?: Todo;
  assigneeId?: string;
}) {
  const parts = todo
    ? new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Ho_Chi_Minh",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).formatToParts(new Date(todo.due_at))
    : [];
  const get = (key: string) => parts.find((p) => p.type === key)?.value;
  const deadline = todo
    ? `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`
    : "";
  return (
    <>
      <div className={styles.formGrid}>
        <Field label="Người chịu trách nhiệm">
          <select
            name="assigneeId"
            required
            defaultValue={
              todo?.assignee_id ??
              assigneeId ??
              managers.find((p) => p.id === data.userId)?.id ??
              managers[0]?.id
            }
          >
            {managers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Deadline (Việt Nam)">
          <Input
            name="dueAt"
            type="datetime-local"
            defaultValue={deadline}
            required
          />
        </Field>
        <Field label="Phân loại">
          <select name="category" defaultValue={todo?.category}>
            {Object.entries(categories).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Mức độ">
          <select name="priority" defaultValue={todo?.priority}>
            {Object.entries(priorities).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <Field label="Người phối hợp">
        <select
          name="collaborators"
          multiple
          defaultValue={todo?.collaborators}
        >
          {data.people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Field>
    </>
  );
}

function RunResults({
  editor,
  correction,
  onCorrection,
}: {
  editor: Editor;
  correction: boolean;
  onCorrection: (value: boolean) => void;
}) {
  const run = editor.run!;
  const [imported, setImported] = useState<Record<string, Observation>>({});
  return (
    <>
      <h3>{run.title}</h3>
      <EvidenceFiles
        entity={run.id}
        kind="run"
        canUpload={editor.kind === "result" || correction}
      />
      {editor.kind === "verify" && (
        <label>
          <input
            type="checkbox"
            checked={correction}
            onChange={(event) => onCorrection(event.target.checked)}
          />
          Điều chỉnh kết quả khi xác minh
        </label>
      )}
      {run.criteria.map((c) => (
        <fieldset key={c.id} className={styles.criterion}>
          <legend>{c.title}</legend>
          <small>
            {c.operator === "eq"
              ? "Bằng"
              : c.operator === "lt"
                ? "Nhỏ hơn"
                : c.operator === "lte"
                  ? "Không vượt quá"
                  : "Tối thiểu"}{" "}
            {formatNumber(c.threshold)}
            {c.kind === "percent" ? "%" : c.kind === "duration" ? " phút" : ""}
            {c.critical ? " · Lỗi nghiêm trọng" : ""}
          </small>
          {c.measurementScope && <p>{c.measurementScope}</p>}
          {c.ratioBasis && <p>{c.ratioBasis}</p>}
          {Array.from({ length: c.samples }, (_, i) => {
            const previous =
              imported[`${c.id}:${i}`] ??
              run.observations.find(
                (o) => o.criterionId === c.id && o.slot === String(i + 1),
              );
            return (
              <div
                key={`${i}:${previous?.measurementId ?? "manual"}`}
                className={styles.formGrid}
              >
                {editor.kind === "verify" && !correction ? (
                  <Field label={`Lần kiểm tra ${i + 1}`}>
                    <span>
                      {previous
                        ? formatNumber(previous.value)
                        : "Chưa ghi nhận"}
                      {previous?.evidence ? ` · ${previous.evidence}` : ""}
                    </span>
                  </Field>
                ) : c.kind === "percent" ? (
                  <>
                    <Field label={`Lần ${i + 1} · Tử số`}>
                      <input
                        name={`numerator:${c.id}:${i}`}
                        defaultValue={previous?.numerator}
                        type="number"
                        min={0}
                        step="any"
                        required
                      />
                    </Field>
                    <Field label="Mẫu số">
                      <input
                        name={`denominator:${c.id}:${i}`}
                        defaultValue={previous?.denominator}
                        type="number"
                        min="0.000001"
                        step="any"
                        required
                      />
                    </Field>
                  </>
                ) : (
                  <Field label={`Lần kiểm tra ${i + 1}`}>
                    {c.kind === "boolean" ? (
                      <select
                        name={`value:${c.id}:${i}`}
                        required
                        defaultValue={previous?.value ?? ""}
                      >
                        <option value="" disabled>
                          Chọn kết quả
                        </option>
                        <option value="1">Có / Đạt</option>
                        <option value="0">Không / Chưa đạt</option>
                      </select>
                    ) : (
                      <input
                        name={`value:${c.id}:${i}`}
                        defaultValue={previous?.value}
                        type="number"
                        step="any"
                        required
                      />
                    )}
                  </Field>
                )}
                {(editor.kind === "result" || correction) && (
                  <Field label="Thời điểm quan sát (Việt Nam)">
                    <Input
                      type="datetime-local"
                      name={`measuredAt:${c.id}:${i}`}
                      required
                      readOnly={!!previous?.measurementId}
                      defaultValue={localDateTime(
                        previous?.measuredAt ?? new Date().toISOString(),
                      )}
                    />
                    {previous?.measurementId && (
                      <>
                        <input
                          type="hidden"
                          name={`measurementId:${c.id}:${i}`}
                          value={previous.measurementId}
                        />
                        <input
                          type="hidden"
                          name={`sourceMeasuredAt:${c.id}:${i}`}
                          value={previous.measuredAt ?? ""}
                        />
                      </>
                    )}
                    {c.measurementScope && (
                      <MeasurementPicker
                        runId={run.id}
                        criterion={c.id}
                        slot={String(i + 1)}
                        onSelect={(o) =>
                          setImported((values) => ({
                            ...values,
                            [`${c.id}:${i}`]: o,
                          }))
                        }
                      />
                    )}
                    {previous?.measurementId && (
                      <button
                        type="button"
                        onClick={() =>
                          setImported((values) => ({
                            ...values,
                            [`${c.id}:${i}`]: {
                              criterionId: c.id,
                              slot: String(i + 1),
                              value: previous.value,
                              evidence: previous.evidence,
                              numerator: previous.numerator,
                              denominator: previous.denominator,
                            },
                          }))
                        }
                      >
                        Ghi quan sát mới
                      </button>
                    )}
                  </Field>
                )}
                {(editor.kind === "result" || correction) && (
                  <Field label="Minh chứng / ghi nhận">
                    <input
                      name={`evidence:${c.id}:${i}`}
                      defaultValue={previous?.evidence}
                      required={c.evidenceRequired}
                      maxLength={1000}
                    />
                  </Field>
                )}
                {c.measurementTimes?.[i] && (
                  <small>
                    Giờ kiểm tra: {c.measurementTimes[i]} (Việt Nam)
                  </small>
                )}
              </div>
            );
          })}
        </fieldset>
      ))}
      {editor.kind === "verify" && (
        <Field label="Nhận xét xác minh">
          <textarea name="note" required rows={3} />
        </Field>
      )}
    </>
  );
}
