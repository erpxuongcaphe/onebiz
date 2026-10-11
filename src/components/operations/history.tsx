"use client";

import { useEffect, useRef, useState } from "react";
import { formatDate } from "@/lib/format";
import { states, type Person } from "@/lib/operations/contracts";
import styles from "./workspace.module.css";

interface HistoryRow {
  id: string;
  title: string;
  action: string;
  actor_name: string;
  created_at: string;
  reason: string | null;
}
interface Page {
  rows: HistoryRow[];
  next: { at: string; id: string } | null;
}
const labels: Record<string, string> = {
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
};
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
