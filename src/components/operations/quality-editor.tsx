"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import type { Workspace, Run, Observation } from "@/lib/operations/contracts";
import type {
  QualityAction,
  QualityIssue,
  QualityLine,
  QualityRule,
  QualityWorkspace,
} from "@/lib/operations/quality-contracts";
import { evaluateQualityObservations } from "@/lib/operations/quality-policy";
import { formatDate, formatNumber } from "@/lib/format";
import { CatalogFields, RuleFields, rulePayload } from "./quality-settings";
import {
  Field,
  IssueFields,
  Notes,
  ObservationFields,
  SelectField,
  TextField,
  issuePayload,
  vnToday,
  inputTime,
} from "./quality-fields";
import { EvidenceFiles } from "./evidence-files";
import { OperationsMktLinks } from "./mkt-links";
import { QualityReferences } from "./quality-references";
import { scoringPeriodSchema } from "@/lib/operations/quality-periods";
import { criterionTitle, compareCriteriaBySource } from "@/lib/operations/criterion-presentation";
import s from "./quality.module.css";

export type QualityEditor =
  | { kind: "check"; run: Run }
  | { kind: "adhoc" }
  | { kind: "period" }
  | { kind: "group"; group?: NonNullable<QualityWorkspace['groups']>[number] }
  | { kind: "issue"; recurrenceOf?: string; title?: string }
  | {
      kind: "issue_update" | "recheck" | "issue_assign" | "issue_detail";
      issue: QualityIssue;
    }
  | { kind: "qc_create" }
  | { kind: "qc_line" | "qc_correct"; line: QualityLine }
  | {
      kind: "department";
      department?: QualityWorkspace["departments"][number] & {
        version?: number;
      };
    }
  | { kind: "assignment"; familyId?: string }
  | { kind: "qc_grant" }
  | { kind: "catalog"; item?: import("@/lib/operations/quality-contracts").QualityItem }
  | { kind: "rule"; rule?: QualityRule }
  | { kind: "accounting" }
  | { kind: "settle" };
const titles: Record<QualityEditor["kind"], string> = {
  check: "Ghi nhận tự kiểm tra",
  adhoc: "Tự kiểm tra phát sinh",
  period: "Kỳ đánh giá tùy chỉnh",
  group: "Nhóm tiêu chuẩn QC",
  issue: "Tạo To-do",
  issue_update: "Cập nhật xử lý",
  recheck: "Quản lý kiểm tra lại",
  issue_assign: "Đổi phân công / deadline",
  issue_detail: "Hồ sơ xử lý",
  qc_create: "Tạo đợt QC độc lập",
  qc_line: "Ghi kết quả QC",
  qc_correct: "Đính chính kết quả QC",
  department: "Bộ phận phối hợp",
  assignment: "Phân công theo công việc",
  qc_grant: "Quyền QC và số liệu kế toán",
  catalog: "Phiên bản tiêu chuẩn QC",
  rule: "Chính sách điểm và thưởng",
  accounting: "Số liệu hao hụt từ kế toán",
  settle: "Chốt kỳ QC và kinh doanh",
};

function IssueLinks({
  branch,
  period,
  value,
  onChange,
  family,
}: {
  branch: string;
  period: string;
  value: string[];
  onChange: (v: string[]) => void;
  family?: string;
}) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<QualityIssue[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({
        branch,
        period,
        kind: "issues",
        search: query,
      });
      void fetch(`/api/operations/quality?${params}`, {
        signal: controller.signal,
        cache: "no-store",
      })
        .then(async (r) => {
          const body = await r.json();
          if (!r.ok) throw Error(body.error);
          setRows(
            body.rows.filter(
              (v: QualityIssue) => !["done", "canceled"].includes(v.state),
            ),
          );
          setError("");
        })
        .catch((e) => {
          if (!controller.signal.aborted) setError(e.message);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [branch, period, query, family]);
  return (
    <section>
      <h3>To-do đang mở liên quan</h3>
      <Field label="Tìm nội dung To-do">
        {(id) => (
          <input
            id={id}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            type="search"
            maxLength={200}
          />
        )}
      </Field>
      {error && (
        <p role="alert" className={s.alert}>
          {error}
        </p>
      )}
      <div>
        {rows.map((r) => (
          <label className={s.issueRow} key={r.id}>
            <input
              type="checkbox"
              checked={value.includes(r.id)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...value, r.id]
                    : value.filter((v) => v !== r.id),
                )
              }
            />
            <div>
              {r.title}
              <p className={s.muted}>
                {formatDate(r.created_at)} ·{" "}
                {r.state === "pending_review"
                  ? "Chờ kiểm tra lại"
                  : r.state === "in_progress"
                    ? "Đang xử lý"
                    : "Mới"}
              </p>
            </div>
          </label>
        ))}
      </div>
    </section>
  );
}

function IssueDetail({
  issue,
  workspace,
  canWork,
  branch,
  period,
  busy,
  onSave,
  commandError,
}: {
  issue: QualityIssue;
  workspace: Workspace;
  canWork: boolean;
  branch: string;
  period: string;
  busy: boolean;
  onSave: (action: QualityAction, payload: Record<string, unknown>) => Promise<boolean>;
  commandError?: string;
}) {
  const [history, setHistory] = useState<
    {
      id: string;
      action: string;
      actor_name: string;
      created_at: string;
      reason: string;
    }[]
  >([]);
  const [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    void fetch(
      `/api/operations/quality?${new URLSearchParams({ branch: issue.branch_id ?? branch, period, kind: "history", entity: issue.id })}`,
      { signal: c.signal },
    )
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw Error(b.error);
        setHistory(b.rows);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [issue.id, issue.branch_id, branch, period]);
  const name = (id: string) =>
    workspace.people.find((p) => p.id === id)?.name ?? "Người dùng OneBiz";
  return (
    <div className={s.formGrid}>
      <section>
        <h3>{issue.title}</h3>
        <p>{issue.description}</p>
        <p>Chịu trách nhiệm: {name(issue.assignee_id)}</p>
        <p>
          Xử lý: {issue.operator_id ? name(issue.operator_id) : "Chờ nhận việc"}
        </p>
        <p>
          Hạn gốc: {formatDate(issue.original_due_at)} · Hạn hiện tại:{" "}
          {formatDate(issue.due_at)}
        </p>
        {issue.resolution && <p>Kết quả khắc phục: {issue.resolution}</p>}
        <h3>Nguồn ghi nhận</h3>
        {(issue.sources ?? []).map((source) => (
          <p key={source.qc_line_id ?? source.check_id ?? source.id}>{source.qc_line_id ? "Kiểm tra QC độc lập" : "Tự kiểm tra công việc"} · {formatDate(source.created_at)}</p>
        ))}
        {!issue.sources?.length && <p>To-do phát sinh trực tiếp.</p>}
        <h3>Các lần kiểm tra lại</h3>
        {(issue.rechecks ?? []).map((recheck) => (
          <article key={recheck.id} className={s.section}>
            <strong>{recheck.result === "met" ? "Đạt" : "Chưa đạt"}</strong>
            <p>{name(recheck.actor_id)} · {formatDate(recheck.created_at)}</p>
            <p>{recheck.note}</p>
            {recheck.evidence && <p>Minh chứng: {recheck.evidence}</p>}
          </article>
        ))}
        {!issue.rechecks?.length && <p>Chưa có lần kiểm tra lại.</p>}
        <EvidenceFiles
          entity={issue.todo_id}
          kind="todo"
          canUpload={canWork || issue.collaborators.includes(workspace.userId)}
        />
        <OperationsMktLinks
          todoId={issue.todo_id}
          canLink={canWork && issue.assignee_id === workspace.userId}
        />
        <QualityReferences issue={issue} branch={branch} period={period} busy={busy} canLink={canWork && issue.assignee_id===workspace.userId && !['done','canceled'].includes(issue.state)} onSave={onSave} commandError={commandError}/>
      </section>
      <section>
        <h3>Lịch sử xử lý</h3>
        {error && <p role="alert">{error}</p>}
        <div className={s.timeline}>
          {history.map((h) => (
            <article key={h.id}>
              <strong>
                {(
                  {
                    "quality:issue": "Tạo hồ sơ",
                    "quality:issue_update": "Cập nhật xử lý",
                    "quality:issue_assign": "Đổi phân công / hạn",
                    "quality:recheck": "Kiểm tra lại",
                  } as Record<string, string>
                )[h.action] ?? "Cập nhật hồ sơ"}
              </strong>
              <p>
                {h.actor_name} · {formatDate(h.created_at)}
              </p>
              <p>{h.reason}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

export function QualityEditorDialog({
  editor,
  workspace,
  quality,
  branch,
  period,
  busy,
  error,
  onClose,
  onSave,
}: {
  editor: QualityEditor;
  workspace: Workspace;
  quality: QualityWorkspace;
  branch: string;
  period: string;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSave: (
    action: QualityAction,
    payload: Record<string, unknown>,
  ) => Promise<boolean>;
}) {
  const [observations, setObservations] = useState<Observation[]>(
    "run" in editor ? [] : "line" in editor ? editor.line.observations : [],
  );
  const [links, setLinks] = useState<string[]>(
    editor.kind === "qc_correct" ? editor.line.issue_ids : [],
  );
  const [newIssue, setNewIssue] = useState(false);
  const [issueCount, setIssueCount] = useState(1);
  const [standardId, setStandardId] = useState('');
  const [assignmentFamily, setAssignmentFamily] = useState(editor.kind === "assignment" ? editor.familyId ?? "" : "");
  const [excluded, setExcluded] = useState(false);
  const [localError, setLocalError] = useState("");
  const [accountingId, setAccountingId] = useState("");
  const lock = useRef(false);
  const criteria =
    "run" in editor
      ? editor.run.criteria
      : "line" in editor
        ? editor.line.item_snapshot.criteria
        : editor.kind === 'adhoc' ? workspace.standards.find((item) => item.id === standardId)?.criteria ?? [] : [];
  const qualityResult = evaluateQualityObservations(criteria, observations);
  const failed = criteria.length > 0 && qualityResult === "unmet" && !excluded;
  const managers = workspace.people.filter((u) =>
    workspace.members.some(
      (m) => m.user_id === u.id && m.member_role === "manager" && m.active,
    ),
  );
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (lock.current || busy) return;
    setLocalError("");
    lock.current = true;
    try {
      const f = new FormData(event.currentTarget);
      const get = (k: string) => String(f.get(k) ?? "");
      let payload: Record<string, unknown> = {};
      if (
        editor.kind === "check" ||
        editor.kind === "adhoc" ||
        editor.kind === "qc_line" ||
        editor.kind === "qc_correct"
      ) {
        if (!excluded && qualityResult === "unknown")
          throw Error("Chưa đủ kết quả hoặc minh chứng cho các lần kiểm tra.");
        if (failed && !links.length && !newIssue)
          throw Error(
            "Kết quả Không đạt cần liên kết To-do hoặc tạo vấn đề mới.",
          );
        const issues: Record<string, unknown>[] = links.map((issueId) => ({
          issueId,
        }));
        if (failed && newIssue) for (let i = 0; i < issueCount; i++) issues.push(issuePayload(f, i === 0 ? 'issue:' : `issue:${i}:`));
        payload = {
          id: "run" in editor ? editor.run.id : "line" in editor ? editor.line.id : undefined,
          version: "run" in editor ? editor.run.version : "line" in editor ? editor.line.version : undefined,
          ...(editor.kind === 'adhoc' ? { standardId } : {}),
          observations,
          result: excluded ? "excluded" : qualityResult,
          note: get("note"),
          evidence: get("evidence"),
          issues,
          accountingId: get("accountingId") || null,
          closedConfirm: f.get("closedConfirm") === "on",
          settlementRevision: quality.settlement?.revision ?? null,
        };
      } else if (editor.kind === 'period') {
        const parsed = scoringPeriodSchema.safeParse({ title: get('title'), startsOn: get('startsOn'), endsOn: get('endsOn') });
        if (!parsed.success) throw new Error("Kiểm tra tên kỳ, ngày bắt đầu và kết thúc; kỳ tối đa 367 ngày.");
        payload = parsed.data;
      }
      else if (editor.kind === 'group') payload = { id: editor.group?.id, version: editor.group?.version, title: get('title'), active: f.get('active') === 'on' };
      else if (editor.kind === "issue")
        payload = {
          ...issuePayload(f),
          recurrenceOf: editor.recurrenceOf ?? null,
        };
      else if (editor.kind === "issue_update")
        payload = {
          id: editor.issue.id,
          version: editor.issue.version,
          state: get("state"),
          resolution: get("resolution"),
          note: get("note"),
        };
      else if (editor.kind === "issue_assign")
        payload = {
          id: editor.issue.id,
          version: editor.issue.version,
          assigneeId: get("assigneeId"),
          departmentId: get("departmentId") || null,
          operatorId: get("operatorId") || null,
          collaborators: f.getAll("collaborators").map(String),
          dueAt: new Date(`${get("dueAt")}:00+07:00`).toISOString(),
          note: get("note"),
        };
      else if (editor.kind === "recheck")
        payload = {
          id: editor.issue.id,
          version: editor.issue.version,
          result: get("result"),
          note: get("note"),
          evidence: get("evidence"),
          selfFix: f.get("selfFix") === "on",
          resolution: get("resolution"),
        };
      else if (editor.kind === "qc_create")
        payload = { title: get("title"), period, catalogIds: f.getAll("catalogIds").map(String) };
      else if (editor.kind === "department")
        payload = {
          id: editor.department?.id ?? null,
          title: get("title"),
          members: f.getAll("members").map(String),
          active: f.get("active") === "on",
          version: editor.department?.version,
        };
      else if (editor.kind === "assignment")
        payload = {
          familyId: get("familyId"),
          managerIds: f.getAll("managerIds").map(String),
          note: get("note"),
        };
      else if (editor.kind === "qc_grant")
        payload = {
          userId: get("userId"),
          canAudit: f.get("canAudit") === "on",
          canCorrect: f.get("canCorrect") === "on",
          canAccounting: f.get("canAccounting") === "on",
          active: f.get("active") === "on",
        };
      else if (editor.kind === "catalog")
        payload = {
          standardId: get("standardId"),
          code: get("code"),
          category: get("category"),
          scoreType: get("scoreType"),
          weight: Number(get("weight")),
          effectiveFrom: get("effectiveFrom"),
          critical: f.get("critical") === "on",
          accountingRequired: f.get("accountingRequired") === "on",
        };
      else if (editor.kind === "rule")
        payload = {
          title: get("title"),
          effectiveFrom: get("effectiveFrom"),
          config: rulePayload(f, managers, quality.catalog),
        };
      else if (editor.kind === "accounting")
        payload = {
          period,
          title: get("title"),
          numerator: Number(get("numerator")),
          denominator: Number(get("denominator")),
          unit: get("unit"),
          evidence: get("evidence"),
        };
      else if (editor.kind === "settle")
        payload = { period, note: get("note") };
      if (editor.kind !== "issue_detail") await onSave(editor.kind, payload);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Chưa lưu được.");
    } finally {
      lock.current = false;
    }
  }
  if (editor.kind === "issue_detail")
    return (
      <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
        <DialogContent className={`${s.dialog} translate-x-0 translate-y-0`}>
          <div className={s.dialogHeader}>
            <DialogTitle>{titles.issue_detail}</DialogTitle>
            <p className={s.muted}>{workspace.branches.find((b) => b.id === branch)?.name} · {period}</p>
          </div>
          <div className={s.dialogBody}>
            <IssueDetail issue={editor.issue} workspace={workspace} canWork={quality.can.work} branch={branch} period={period} busy={busy} onSave={onSave} commandError={error}/>
          </div>
          <footer className={s.dialogFooter}>
            <button type="button" data-dialog-close onClick={onClose}>Đóng</button>
          </footer>
        </DialogContent>
      </Dialog>
    );
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className={`${s.dialog} translate-x-0 translate-y-0`} showCloseButton={!busy}>
        <div className={s.dialogHeader}>
          <DialogTitle>{titles[editor.kind]}</DialogTitle>
          <p className={s.muted}>
            {workspace.branches.find((b) => b.id === branch)?.name} · {quality.periods?.find(item => item.key === period)?.title ?? period}
          </p>
        </div>
        <form onSubmit={submit} style={{ display: "contents" }}>
          <div className={s.dialogBody}>
            {(editor.kind === "check" || editor.kind === 'adhoc' ||
              editor.kind === "qc_line" ||
              editor.kind === "qc_correct") && (
              <>
                <div className={s.formGrid}>
                  <section>
                    <h3>
                      {"run" in editor
                        ? editor.run.title
                        : "line" in editor ? editor.line.item_snapshot.title : 'Kiểm tra ngoài lịch'}
                    </h3>
                    {editor.kind === 'adhoc' && <SelectField label="Công việc được kiểm tra" name="standardId" options={workspace.standards.filter((item) => item.status === 'approved').map((item) => ({ id: item.id, name: item.title }))} value={standardId} required onChange={(id) => { setStandardId(id); setObservations([]); }} />}
                    {"line" in editor && (
                      <label className={s.check}>
                        <input
                          type="checkbox"
                          checked={excluded}
                          onChange={(e) => setExcluded(e.target.checked)}
                        />
                        Loại khỏi phạm vi đợt này (cần lý do)
                      </label>
                    )}
                    {!excluded && (
                      <ObservationFields
                        criteria={criteria}
                        observations={observations}
                        onChange={setObservations}
                        booleanPassLabel={editor.kind === "check" || editor.kind === "adhoc" ? "Đã làm / Đạt" : "Đạt"}
                      />
                    )}
                    {"line" in editor &&
                      editor.line.item_snapshot.accounting_required &&
                      !excluded && (
                        <SelectField
                          label="Số liệu kế toán đã xác nhận"
                          name="accountingId"
                          required
                          value={accountingId}
                          onChange={(id) => {
                            setAccountingId(id);
                            const a = quality.accounting.find(
                              (v) => v.id === id,
                            );
                            if (a)
                              setObservations([
                                ...observations.filter(
                                  (o) =>
                                    !criteria.some(
                                      (c) =>
                                        c.id === o.criterionId &&
                                        c.kind === "percent",
                                    ),
                                ),
                                ...criteria
                                  .filter((c) => c.kind === "percent")
                                  .flatMap((c) =>
                                    Array.from(
                                      { length: c.samples },
                                      (_, i) => ({
                                        criterionId: c.id,
                                        slot: String(i + 1),
                                        value:
                                          (a.numerator / a.denominator) * 100,
                                        numerator: a.numerator,
                                        denominator: a.denominator,
                                        evidence: a.evidence,
                                      }),
                                    ),
                                  ),
                              ]);
                          }}
                          options={quality.accounting
                            .filter((a) => a.state === "approved")
                            .map((a) => ({
                              id: a.id,
                              name: `${a.title} · ${formatNumber((a.numerator / a.denominator) * 100)}% · ${a.unit}`,
                            }))}
                        />
                      )}
                    <Notes
                      required={excluded || editor.kind === "qc_correct" || editor.kind === "adhoc"}
                    />
                    {"line" in editor && (
                      <TextField
                        label="Minh chứng QC / căn cứ đính chính"
                        name="evidence"
                        required={
                          editor.kind === "qc_correct" ||
                          (editor.line.item_snapshot.score_type === "bonus" &&
                            qualityResult === "met")
                        }
                      />
                    )}
                    {editor.kind === "qc_correct" && quality.settlement && (
                      <label className={s.check}>
                        <input type="checkbox" name="closedConfirm" required />
                        Xác nhận tạo phiên bản điều chỉnh kỳ đã chốt; giữ nguyên
                        nguồn doanh thu và kỳ gốc
                      </label>
                    )}
                    {"run" in editor && (
                      <EvidenceFiles
                        entity={editor.run.id}
                        kind="run"
                        canUpload={quality.can.work}
                      />
                    )}
                    {"line" in editor && (
                      <EvidenceFiles
                        entity={editor.line.id}
                        kind="qc_line"
                        canUpload={quality.can.qc || quality.can.correct}
                      />
                    )}
                  </section>
                  <section>
                    {failed ? (
                      <>
                        <IssueLinks
                          branch={branch}
                          period={period}
                          value={links}
                          onChange={setLinks}
                          family={
                            "run" in editor
                              ? (editor.run as Run & { family_id?: string })
                                  .family_id
                              : "line" in editor ? editor.line.item_snapshot.family_id : workspace.standards.find((item) => item.id === standardId)?.family_id
                          }
                        />
                        <label className={s.check}>
                          <input
                            type="checkbox"
                            checked={newIssue}
                            onChange={(e) => setNewIssue(e.target.checked)}
                          />
                          Tạo To-do cho sự việc khác / chưa có
                        </label>
                        {newIssue && Array.from({length: issueCount}, (_, i) => (
                          <fieldset key={i}><legend>Vấn đề mới {i + 1}</legend><IssueFields
                            workspace={workspace}
                            quality={quality}
                            prefix={i === 0 ? 'issue:' : `issue:${i}:`}
                            initialTitle={
                              "run" in editor
                                ? editor.run.title
                                : "line" in editor ? editor.line.item_snapshot.title : workspace.standards.find((item) => item.id === standardId)?.title
                            }
                          /></fieldset>
                        ))}
                        {newIssue && <div className={s.actions}><button type="button" disabled={issueCount + links.length >= 20} onClick={() => setIssueCount((count) => count + 1)}><Icon name="add" size={16} />Thêm vấn đề khác</button>{issueCount > 1 && <button type="button" onClick={() => setIssueCount((count) => count - 1)}>Bỏ vấn đề cuối</button>}</div>}
                      </>
                    ) : (
                      <p className={s.muted}>
                        Kết quả:{" "}
                        {excluded
                          ? "Ngoài phạm vi"
                          : qualityResult === "met"
                            ? "Đạt"
                            : qualityResult === "unmet"
                              ? "Không đạt"
                              : "Chưa đủ kết quả"}
                      </p>
                    )}
                    {editor.kind === "qc_correct" && (
                      <p className={s.alert}>
                        Bản gốc được giữ nguyên; hệ thống ghi bản đính chính và
                        khoản điều chỉnh điểm riêng.
                      </p>
                    )}
                  </section>
                </div>
              </>
            )}
            {editor.kind === "issue" && (
              <IssueFields
                workspace={workspace}
                quality={quality}
                initialTitle={editor.title}
              />
            )}
            {editor.kind === "issue_update" && (
              <div className={s.formGrid}>
                <section>
                  <h3>{editor.issue.title}</h3>
                  <SelectField
                    label="Trạng thái tiếp theo"
                    name="state"
                    options={
                      editor.issue.state === "pending"
                        ? {
                            in_progress: "Nhận và bắt đầu xử lý",
                            canceled: "Hủy do ghi nhầm",
                          }
                        : {
                            pending_review:
                              "Đã xử lý, gửi quản lý kiểm tra lại",
                            canceled: "Hủy do ghi nhầm",
                          }
                    }
                    required
                  />
                  <Notes label="Kết quả khắc phục" name="resolution" />
                  <Notes label="Ghi chú / lý do hủy" />
                </section>
                <EvidenceFiles
                  entity={editor.issue.todo_id}
                  kind="todo"
                  canUpload
                />
              </div>
            )}
            {editor.kind === "issue_assign" && (
              <div className={s.formGrid}>
                <SelectField
                  label="Quản lý chịu trách nhiệm"
                  name="assigneeId"
                  userPurpose="manager"
                  value={editor.issue.assignee_id}
                  options={managers}
                  required
                />
                <SelectField label="Bộ phận phối hợp" name="departmentId"
                  value={editor.issue.department_id ?? ""}
                  options={quality.departments.filter((d) => d.active).map((d) => ({ id: d.id, name: d.title }))} />
                <SelectField userPurpose="participant" label="Người phối hợp" name="collaborators" multiple
                  value={editor.issue.collaborators} options={workspace.people} />
                <SelectField userPurpose="participant" label="Người xử lý" name="operatorId"
                  value={editor.issue.operator_id ?? ""} options={workspace.people} />
                <TextField
                  label="Deadline mới (giờ Việt Nam)"
                  name="dueAt"
                  value={inputTime(editor.issue.due_at)}
                  type="datetime-local"
                  required
                />
                <Notes label="Lý do thay đổi" required />
              </div>
            )}
            {editor.kind === "recheck" && (
              <div className={s.formGrid}>
                <section>
                  <h3>{editor.issue.title}</h3>
                  <p>
                    Kết quả khắc phục: {editor.issue.resolution ?? "Chưa ghi"}
                  </p>
                  <SelectField
                    label="Kết quả tại quán"
                    name="result"
                    options={{
                      met: "Đạt, đóng việc",
                      unmet: "Chưa đạt, tiếp tục xử lý",
                    }}
                    required
                  />
                  <Notes label="Kết quả kiểm tra lại" required />
                  <TextField label="Minh chứng kiểm tra lại" name="evidence" />
                  {editor.issue.state !== "pending_review" && (
                    <>
                      <label className={s.check}>
                        <input type="checkbox" name="selfFix" required />
                        Tôi tự xử lý và xác nhận tại quán
                      </label>
                      <Notes
                        label="Nội dung đã tự khắc phục"
                        name="resolution"
                        required
                      />
                    </>
                  )}
                </section>
                <EvidenceFiles
                  entity={editor.issue.todo_id}
                  kind="todo"
                  canUpload
                />
              </div>
            )}
            {editor.kind === "qc_create" && (
              <>
                <TextField
                  label="Tên đợt kiểm tra"
                  name="title"
                  value={`QC ${period}`}
                  required
                />
                <p>Kỳ điểm: {period}</p>
                <fieldset>
                  <legend>Phạm vi kiểm tra</legend>
                  {quality.catalog.filter((item) => item.effective_from <= vnToday()).map((item) => (
                    <label key={item.id} className={s.check}>
                      <input type="checkbox" name="catalogIds" value={item.id} defaultChecked />
                      {item.code} · {item.title}
                    </label>
                  ))}
                </fieldset>
                <p>
                  {quality.catalog.length} tiêu chuẩn trong danh mục; kết quả QC
                  được ghi độc lập với tự kiểm tra.
                </p>
              </>
            )}
            {editor.kind === "department" && (
              <div className={s.formGrid}>
                <TextField
                  label="Tên bộ phận"
                  name="title"
                  value={editor.department?.title}
                  required
                />
                <SelectField
                  label="Người có thể nhận việc"
                  name="members"
                  userPurpose="department"
                  options={workspace.people}
                  value={editor.department?.members}
                  multiple
                />
                <p className={s.muted}>Bộ phận có thể gồm người văn phòng hỗ trợ nhiều chi nhánh. Việc thêm vào bộ phận là phân công phối hợp rõ ràng, không cấp quyền quản lý chi nhánh.</p>
                <label className={s.check}>
                  <input
                    type="checkbox"
                    name="active"
                    defaultChecked={editor.department?.active ?? true}
                  />
                  Đang hoạt động
                </label>
              </div>
            )}
            {editor.kind === "assignment" && (
              <div className={s.formGrid}>
                <p className={s.scopeNotice}>Chọn một hoặc nhiều quản lý cho công việc này tại chi nhánh đang xem. Các công việc khác giữ nguyên. Phân công có hiệu lực ngay cho công việc này, không chỉ một lần thực hiện; kết quả đã ghi vẫn được giữ lại.</p>
                <SelectField
                  label="Công việc cần phân công"
                  name="familyId"
                  value={assignmentFamily}
                  onChange={setAssignmentFamily}
                  options={workspace.standards
                    .filter((x) => x.status === "approved" && x.branch_id === branch)
                    .filter((x, index, rows) => rows.findIndex(item => item.family_id === x.family_id) === index)
                    .map(x => ({ ...x, code: quality.catalog?.find(item => item.standard_id === x.id)?.code }))
                    .sort(compareCriteriaBySource)
                    .map((x) => ({ id: x.family_id, name: criterionTitle(x) }))}
                  required
                />
                <SelectField
                  key={assignmentFamily}
                  label="Người phụ trách công việc này"
                  name="managerIds"
                  value={quality.assignments.find(item => item.family_id === assignmentFamily)?.manager_ids
                    ?? [workspace.standards.find(item => item.family_id === assignmentFamily && item.branch_id === branch)?.assignee_id ?? ""].filter(Boolean)}
                  userPurpose="manager"
                  options={managers}
                  multiple
                  required
                />
                <Notes label="Lý do phân công / thay đổi" required />
              </div>
            )}
            {editor.kind === "qc_grant" && (
              <div className={s.formGrid}>
                <SelectField
                  label="Tài khoản OneBiz"
                  name="userId"
                  userPurpose="qc_grant"
                  options={workspace.people.filter(
                    (p) => p.id !== workspace.userId,
                  )}
                  required
                />
                <section>
                  {[
                    ["canAudit", "Thực hiện QC độc lập"],
                    ["canCorrect", "Đính chính kết quả QC"],
                    ["canAccounting", "Cung cấp số liệu kế toán"],
                  ].map(([k, v]) => (
                    <label className={s.check} key={k}>
                      <input type="checkbox" name={k} />
                      {v}
                    </label>
                  ))}
                  <label className={s.check}>
                    <input type="checkbox" name="active" defaultChecked />
                    Đang có hiệu lực
                  </label>
                </section>
                <p className={s.muted}>
                  Cần quyền Hub tương ứng trong OneBiz và phân công tại chi
                  nhánh. Quản lý không được tự QC quán mình phụ trách.
                </p>
              </div>
            )}
            {editor.kind === "catalog" && (
              <CatalogFields workspace={workspace} groups={quality.groups} value={editor.item} />
            )}
            {editor.kind === 'period' && <div className={s.formGrid}><TextField label="Tên kỳ đánh giá" name="title" required /><TextField label="Ngày bắt đầu" name="startsOn" type="date" required /><TextField label="Đến hết ngày" name="endsOn" type="date" required /></div>}
            {editor.kind === 'group' && <><TextField label="Tên nhóm tiêu chuẩn" name="title" value={editor.group?.title} required /><label className={s.check}><input type="checkbox" name="active" defaultChecked={editor.group?.active ?? true} />Đang áp dụng</label></>}
            {editor.kind === "rule" && (
              <>
                <div className={s.ruleFields}>
                  <TextField
                    label="Tên phiên bản chính sách"
                    name="title"
                    required
                  />
                  <TextField
                    label="Hiệu lực từ"
                    name="effectiveFrom"
                    value={vnToday()}
                    type="date"
                    required
                  />
                </div>
                <RuleFields people={managers} value={editor.rule} catalog={quality.catalog} />
              </>
            )}
            {editor.kind === "accounting" && (
              <div className={s.formGrid}>
                <TextField
                  label="Tên số liệu / phạm vi hao hụt"
                  name="title"
                  required
                />
                <TextField
                  label="Số hao hụt"
                  name="numerator"
                  type="number"
                  step="any"
                  required
                />
                <TextField
                  label="Số làm căn cứ tính tỷ lệ"
                  name="denominator"
                  type="number"
                  step="any"
                  required
                />
                <TextField label="Đơn vị và cách đo" name="unit" required />
                <Notes
                  label="Nguồn / tài liệu đối chiếu kế toán"
                  name="evidence"
                  required
                />
              </div>
            )}
            {editor.kind === "settle" && (
              <>
                <p>
                  Điểm QC:{" "}
                  {quality.score.score === null
                    ? "Chưa đủ"
                    : formatNumber(quality.score.score)}{" "}
                  · Thưởng QC:{" "}
                  {quality.score.rewardCents === null
                    ? "Chưa đủ"
                    : `${formatNumber(quality.score.rewardCents / 100)} đồng`}
                </p>
                <p>
                  Chốt lưu riêng nguồn QC, doanh thu kinh doanh và chính sách.
                  Không tạo phiếu chi và không sửa kho.
                </p>
                <Notes label="Ghi chú chốt kỳ" required />
                <label className={s.check}>
                  <input type="checkbox" required />
                  Tôi xác nhận kết quả, phân bổ và dữ liệu kỳ này
                </label>
              </>
            )}
          </div>
          <footer className={s.dialogFooter}>
            {(error || localError) && <p role="alert" className={s.alert}>{localError || error}</p>}
            <button
              type="button"
              data-dialog-close
              disabled={busy}
              onClick={onClose}
            >
              Hủy
            </button>
              <button type="submit" className={s.primary} disabled={busy}>
                <Icon name={busy ? "hourglass_empty" : "save"} size={18} />
                {busy
                  ? "Đang lưu…"
                  : editor.kind === "rule"
                    ? "Lưu phiên bản nháp"
                    : editor.kind === "settle"
                      ? "Chốt kỳ"
                      : "Lưu"}
              </button>
          </footer>
        </form>
      </DialogContent>
    </Dialog>
  );
}
