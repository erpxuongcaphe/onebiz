"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatNumber } from "@/lib/format";
import type { Run, Todo } from "@/lib/operations/contracts";
import styles from "./workspace.module.css";
export function OperationsFilteredList<T extends Run | Todo>({ kind, branch, search, onlyMine, params, revision, renderItem }: {
  kind: "run" | "todo"; branch: string; search: string; onlyMine: boolean; params: string | null;
  revision: unknown; renderItem: (item: T) => ReactNode;
}) {
  type Cursor = { due: string; id: string } | null;
  const [page, setPage] = useState<{ rows: T[]; next: Cursor }>({ rows: [], next: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const epoch = useRef(0), active = useRef<AbortController | null>(null), loading = useRef(false);
  async function load(cursor: Cursor = null, generation = epoch.current) {
    if (params === null || (cursor && loading.current)) return;
    active.current?.abort();
    const controller = new AbortController(); active.current = controller; loading.current = true; setBusy(true); setError("");
    try {
      const query = new URLSearchParams(params);
      query.set("kind", kind); query.set("search", search); query.set("mine", String(onlyMine));
      if (branch) query.set("branch", branch);
      if (cursor) { query.set("cursorDue", cursor.due); query.set("cursorId", cursor.id); }
      const response = await fetch(`/api/operations/list?${query}`, { cache: "no-store", signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Không tải được công việc.");
      if (generation !== epoch.current) return;
      setPage(previous => ({ rows: cursor ? [...new Map([...previous.rows, ...result.rows].map((row: T) => [row.id, row])).values()] : result.rows, next: result.next }));
    } catch (cause) {
      if (!controller.signal.aborted && generation === epoch.current) setError(cause instanceof Error ? cause.message : "Không tải được danh sách.");
    } finally { if (generation === epoch.current) { loading.current = false; setBusy(false); } }
  }
  useEffect(() => {
    const counter = epoch;
    const generation = ++counter.current; setPage({ rows: [], next: null }); setError(""); setBusy(params !== null);
    const timer = setTimeout(() => void load(null, generation), 300);
    return () => { clearTimeout(timer); ++counter.current; active.current?.abort(); };
    // Changing scope cancels stale reads; no polling or automatic retries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, branch, search, onlyMine, params, revision]);
  return <div className={styles.list}>
    {params !== null && page.rows.map(renderItem)}
    {!busy && !error && params !== null && !page.rows.length && <p className={styles.empty}>Không có công việc phù hợp. Thử đặt lại bộ lọc.</p>}
    {error && <p className={styles.error} role="alert">{error} <button disabled={busy} onClick={() => void load()}>Tải lại</button></p>}
    <div className={styles.pagination}><span role="status">{params === null ? "Chọn khoảng ngày hợp lệ để tìm." : busy ? "Đang tìm…" : `Đã hiển thị ${formatNumber(page.rows.length)} công việc`}</span>{page.next && params !== null && <button disabled={busy} onClick={() => void load(page.next)}>Xem thêm</button>}</div>
  </div>;
}
