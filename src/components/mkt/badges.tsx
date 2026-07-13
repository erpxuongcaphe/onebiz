// Badge trạng thái MKT. Theo Developer Handover: hiển thị acceptance_status và
// task_status thành 2 badge TÁCH RỜI. Nhãn giữ tiếng Anh như prototype; màu theo
// quy ước (pending cam, need-discussion vàng, rejected/blocked đỏ, done/approved xanh).

const BASE =
  "inline-flex h-6 max-w-full items-center rounded-full border px-2 text-xs font-medium whitespace-nowrap";

function Pill({ label, cls }: { label: string; cls: string }) {
  return <span className={BASE + " " + cls}>{label}</span>;
}

const ACCEPTANCE: Record<string, { label: string; cls: string }> = {
  pending: { label: "Pending Acceptance", cls: "border-orange-200 bg-orange-50 text-orange-700" },
  accepted: { label: "Accepted", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  need_discussion: { label: "Need Discussion", cls: "border-amber-200 bg-amber-50 text-amber-700" },
  rejected: { label: "Rejected", cls: "border-rose-200 bg-rose-50 text-rose-700" },
};

const TASK_STATUS: Record<string, { label: string; cls: string }> = {
  blocked: { label: "Blocked", cls: "border-rose-200 bg-rose-50 text-rose-700" },
  todo: { label: "To Do", cls: "border-slate-200 bg-slate-50 text-slate-700" },
  doing: { label: "Doing", cls: "border-indigo-200 bg-indigo-50 text-indigo-700" },
  reviewing: { label: "Reviewing", cls: "border-amber-200 bg-amber-50 text-amber-700" },
  done: { label: "Done", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  canceled: { label: "Canceled", cls: "border-slate-200 bg-slate-100 text-slate-500" },
};

const CONTENT_STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "Draft", cls: "border-slate-200 bg-slate-50 text-slate-700" },
  pending_review: { label: "Pending Review", cls: "border-amber-200 bg-amber-50 text-amber-700" },
  revision_required: { label: "Revision Required", cls: "border-orange-200 bg-orange-50 text-orange-700" },
  approved: { label: "Approved", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  rejected: { label: "Rejected", cls: "border-rose-200 bg-rose-50 text-rose-700" },
  published: { label: "Published", cls: "border-sky-200 bg-sky-50 text-sky-700" },
};

const RISK: Record<string, { label: string; cls: string }> = {
  low: { label: "Rủi ro thấp", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  medium: { label: "Rủi ro TB", cls: "border-amber-200 bg-amber-50 text-amber-700" },
  high: { label: "Rủi ro cao", cls: "border-rose-200 bg-rose-50 text-rose-700" },
  critical: { label: "Nghiêm trọng", cls: "border-rose-300 bg-rose-100 text-rose-800" },
};

const READINESS: Record<string, { label: string; cls: string }> = {
  pending: { label: "Chờ xác nhận", cls: "border-amber-200 bg-amber-50 text-amber-700" },
  confirmed: { label: "Đã xác nhận", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  waived: { label: "Đã miễn", cls: "border-indigo-200 bg-indigo-50 text-indigo-700" },
};

const PLAN_STATUS: Record<string, { label: string; cls: string }> = {
  planning: { label: "Đang lập kế hoạch", cls: "border-indigo-200 bg-indigo-50 text-indigo-700" },
  submitted: { label: "Chờ duyệt kế hoạch", cls: "border-amber-200 bg-amber-50 text-amber-700" },
  revision_required: { label: "Cần sửa kế hoạch", cls: "border-orange-200 bg-orange-50 text-orange-700" },
  approved: { label: "Kế hoạch đã duyệt", cls: "border-emerald-200 bg-emerald-50 text-emerald-700" },
  in_execution: { label: "Đang thực thi", cls: "border-sky-200 bg-sky-50 text-sky-700" },
  superseded: { label: "Đã thay thế", cls: "border-slate-200 bg-slate-100 text-slate-500" },
  canceled: { label: "Đã huỷ", cls: "border-slate-200 bg-slate-100 text-slate-500" },
};

const FALLBACK = { cls: "border-slate-200 bg-slate-50 text-slate-700" };

export function AcceptanceBadge({ value, taskStatus }: { value: string; taskStatus?: string }) {
  // Task đã Done/Huỷ mà chưa qua bước nhận việc (hệ thống tự hoàn tất — VD task
  // Duyệt tự Done khi nội dung được duyệt): nhãn "Pending Acceptance" gây hiểu lầm.
  if (value === "pending" && (taskStatus === "done" || taskStatus === "canceled")) return null;
  const m = ACCEPTANCE[value] ?? { label: value, ...FALLBACK };
  return <Pill label={m.label} cls={m.cls} />;
}
export function TaskStatusBadge({ value }: { value: string }) {
  const m = TASK_STATUS[value] ?? { label: value, ...FALLBACK };
  return <Pill label={m.label} cls={m.cls} />;
}
export function ContentStatusBadge({ value }: { value: string }) {
  const m = CONTENT_STATUS[value] ?? { label: value, ...FALLBACK };
  return <Pill label={m.label} cls={m.cls} />;
}
export function RiskBadge({ value }: { value: string }) {
  const m = RISK[value] ?? { label: value, ...FALLBACK };
  return <Pill label={m.label} cls={m.cls} />;
}
export function ReadinessBadge({ value }: { value: string }) {
  const m = READINESS[value] ?? { label: value, ...FALLBACK };
  return <Pill label={m.label} cls={m.cls} />;
}
export function PlanStatusBadge({ value }: { value: string }) {
  const m = PLAN_STATUS[value] ?? { label: value, ...FALLBACK };
  return <Pill label={m.label} cls={m.cls} />;
}
