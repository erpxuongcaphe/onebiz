"use client";

import { useEffect, useRef, useState } from "react";
import { formatDate, formatShortDate } from "@/lib/format";
import { scheduleSummary } from "@/lib/operations/recurrence";
import { states, type Person } from "@/lib/operations/contracts";
import type { QualityAction } from "@/lib/operations/quality-contracts";
import styles from "./workspace.module.css";

interface HistoryRow {
  id: string;
  title: string;
  action: string;
  actor_name: string;
  created_at: string;
  reason: string | null;
  before_schedule?: ScheduleSnapshot | null;
  after_schedule?: ScheduleSnapshot | null;
}
type ScheduleSnapshot={frequency?:string;day_number?:number;month_number?:number|null;due_time?:string;effective_from?:string;effective_until?:string|null;stop_after?:string|null;original_due_at?:string;current_due_at?:string|null};
function ScheduleHistory({title,value}:{title:string;value:ScheduleSnapshot}){
  return <div><strong>{title}</strong>{value.frequency&&<p>{scheduleSummary(value.frequency,value.day_number??1,value.month_number??1)}{value.due_time?` · ${value.due_time.slice(0,5)}`:''}</p>}<p>{value.effective_from?`Từ ${formatShortDate(`${value.effective_from}T00:00:00+07:00`)}`:''}{value.effective_until?` đến ${formatShortDate(`${value.effective_until}T00:00:00+07:00`)}`:''}</p>{value.stop_after&&<p>Ngày thực hiện cuối: {formatShortDate(`${value.stop_after}T00:00:00+07:00`)}</p>}{value.original_due_at&&<p>Hạn gốc: {formatDate(value.original_due_at)}</p>}{value.current_due_at&&<p>Hạn hiện tại: {formatDate(value.current_due_at)}</p>}</div>;
}
interface Page {
  rows: HistoryRow[];
  next: { at: string; id: string } | null;
}
const qualityLabels: Record<QualityAction,string> = {
  check:"Ghi kết quả tự kiểm tra",issue:"Tạo vấn đề",issue_update:"Cập nhật vấn đề",issue_assign:"Phân công xử lý",recheck:"Kiểm tra lại",
  department:"Cấu hình bộ phận",assignment:"Phân công cùng lịch",qc_grant:"Cấp / thu hồi quyền QC, kế toán",catalog:"Cấu hình tiêu chuẩn QC",catalog_import:"Nhập tiêu chuẩn QC",
  rule:"Cấu hình chính sách",rule_approve:"Duyệt chính sách",qc_create:"Tạo đợt QC",qc_line:"Ghi kết quả QC",qc_complete:"Hoàn tất đợt QC",qc_correct:"Đính chính kết quả QC",
  accounting:"Ghi chỉ số kế toán",accounting_approve:"Duyệt chỉ số kế toán",settle:"Chốt kỳ",period:"Cấu hình kỳ đánh giá",group:"Cấu hình nhóm QC",adhoc:"Tạo công việc phát sinh",reference:"Liên kết hồ sơ",
  target:"Cấu hình chỉ tiêu",revenue:"Ghi nguồn doanh thu",approve_revenue:"Duyệt nguồn doanh thu",onebiz_revenue:"Lấy doanh thu OneBiz",revenue_batch:"Nhập doanh thu theo lô",
};
const labels: Record<string, string> = {
  ...Object.fromEntries(Object.entries(qualityLabels).map(([key,value])=>[`quality:${key}`,value])),
  'working_library:save':"Lưu bộ tiêu chí chung",
  'working_library:archive':"Ẩn bộ tiêu chí chung",
  'working_library:restore':"Khôi phục bộ tiêu chí chung",
  member: "Phân quyền",
  standard: "Tạo mẫu",
  approve_standard: "Duyệt mẫu",
  result: "Ghi kết quả",
  verify: "Xác minh",
  todo: "Tạo To-do",
  transfer: "Chuyển To-do",
  todo_update: "Cập nhật To-do",
  comment: "Trao đổi",
  target: "Chỉ tiêu",
  revenue: "Nguồn doanh thu",
  approve_revenue: "Duyệt doanh thu",
  policy: "Chính sách thưởng",
  approve_policy: "Duyệt chính sách",
  close_period: "Chốt kỳ",
  remediation: "Khắc phục sau chốt",
  ensure_schedule: "Bù lịch",
  generate: "Sinh lịch",
  event: "Công việc sự kiện",
  onebiz_revenue: "Lấy doanh thu OneBiz",
  configure_schedule: "Thiết lập lịch thực hiện",
  end_schedule: "Kết thúc lịch lặp",
  move_run: "Đổi hạn một công việc",
  replace_schedule: "Thay lịch cùng ngày",
  apply_schedule_change: "Áp dụng thay đổi lịch",
  generate_schedule: "Sinh công việc theo lịch",
  apply_working_library: "Áp dụng bộ tiêu chí cho chi nhánh",
  library_update: "Cập nhật bộ tiêu chí cho chi nhánh",
  library_remove_criterion: "Ngừng tiêu chí theo bộ chung",
  common_standard: "Tạo công việc chung",
  propose_standard: "Đề xuất công việc",
  request_standard_changes: "Yêu cầu sửa đề xuất",
  retire_standard: "Ngừng áp dụng công việc",
  discard_standard: "Hủy bản nháp",
};
export function OperationsHistoryPanel({branch,period}:{branch:string;period:string}) {
  const [open,setOpen]=useState(false);
  return <details onToggle={event=>setOpen(event.currentTarget.open)}><summary>Nhật ký thao tác</summary>{open&&<OperationsHistory branch={branch} period={period}/>}</details>;
}
export function OperationsHistory({
  branch,
  period,
}: {
  branch: string;
  period: string;
  people?: Person[];
}) {
  const [kind, setKind] = useState<"audit" | "todos">("audit");
  const [page, setPage] = useState<Page>({ rows: [], next: null });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const epoch = useRef(0);
  const active = useRef<AbortController | null>(null);
  async function load(cursor: Page["next"] = null, generation = epoch.current) {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams({ branch, period, kind });
      if (cursor) {
        params.set("cursorAt", cursor.at);
        params.set("cursorId", cursor.id);
      }
      const response = await fetch(`/api/operations/history?${params}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const body = await response.json();
      if (!response.ok)
        throw new Error(body.error ?? "Không tải được lịch sử.");
      if (generation !== epoch.current) return;
      setPage((previous) => ({
        rows: cursor ? [...previous.rows, ...body.rows] : body.rows,
        next: body.next,
      }));
    } catch (cause) {
      if (!controller.signal.aborted && generation === epoch.current)
        setError(
          cause instanceof Error ? cause.message : "Không tải được lịch sử.",
        );
    } finally {
      if (generation === epoch.current) setBusy(false);
    }
  }
  useEffect(() => {
    const counter = epoch;
    const generation = ++counter.current;
    setPage({ rows: [], next: null });
    if (branch) void load(null, generation);
    return () => {
      ++counter.current;
      active.current?.abort();
    };
    // Scope changes start a fresh read; there is no polling or automatic retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch, period, kind]);
  return (
    <section>
      <h2 className={styles.sectionTitle}>Lịch sử kỳ</h2>
      <div className={styles.toolbar}>
        <select
          aria-label="Loại lịch sử"
          value={kind}
          onChange={(e) => setKind(e.target.value as typeof kind)}
        >
          <option value="audit">Nhật ký thay đổi</option>
          <option value="todos">To-do đã tạo trong kỳ</option>
        </select>
      </div>
      {error && (
        <p role="alert">
          {error}{" "}
          <button disabled={busy} onClick={() => void load()}>
            Tải lại
          </button>
        </p>
      )}
      {page.rows.map((row) => (
        <article key={row.id} className={styles.audit}>
          <strong>
            {row.title ||
              labels[row.action] ||
              states[row.action] ||
              "Thay đổi vận hành"}
          </strong>
          <p>
            {row.actor_name} · {formatDate(row.created_at)} ·{" "}
            {labels[row.action] || states[row.action] || "Thay đổi vận hành"}
          </p>
          {row.reason && <small>{row.reason}</small>}
          {(row.before_schedule||row.after_schedule)&&<details><summary>Xem lịch thực hiện</summary>{row.before_schedule&&<ScheduleHistory title="Trước thay đổi" value={row.before_schedule}/>} {row.after_schedule&&<ScheduleHistory title={row.before_schedule?'Sau thay đổi':'Lịch đã sử dụng'} value={row.after_schedule}/>}</details>}
        </article>
      ))}
      {!busy && !error && !page.rows.length && (
        <p>Chưa có lịch sử trong kỳ đã chọn.</p>
      )}
      {busy && <p role="status">Đang tải lịch sử…</p>}
      {page.next && (
        <button disabled={busy} onClick={() => void load(page.next)}>
          Xem thêm
        </button>
      )}
    </section>
  );
}
