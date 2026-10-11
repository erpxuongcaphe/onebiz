"use client";
import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { formatDate } from "@/lib/format";
import styles from "./workspace.module.css";
interface Notice {
  id: string;
  title: string;
  kind: string;
  branch_name: string;
  due_at: string;
  read_at: string | null;
}
export function OperationsInbox() {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<Notice[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController();
    setBusy(true);
    setError("");
    void fetch("/api/operations/inbox", {
      cache: "no-store",
      signal: abort.signal,
    })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error);
        setRows(body.rows);
      })
      .catch((cause) => {
        if (!abort.signal.aborted)
          setError(
            cause instanceof Error
              ? cause.message
              : "Không tải được thông báo.",
          );
      })
      .finally(() => {
        if (!abort.signal.aborted) setBusy(false);
      });
    return () => abort.abort();
  }, [open]);
  async function mark(id: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/operations/inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setRows(body.rows);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Không cập nhật được thông báo.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={styles.inbox}>
      <button
        type="button"
        title="Thông báo vận hành"
        aria-label="Thông báo vận hành"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <Bell size={18} />
      </button>
      {open && (
        <section className={styles.inboxPanel} aria-label="Thông báo">
          <h2>Thông báo</h2>
          {error && <p role="alert">{error}</p>}
          {busy && <p role="status">Đang tải…</p>}
          {!busy && !error && !rows.length && <p>Chưa có thông báo.</p>}
          {rows.map((row) => (
            <article className={styles.audit} key={row.id}>
              <strong>{row.title}</strong>
              <p>
                {row.branch_name} · {formatDate(row.due_at)}
              </p>
              {!row.read_at && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void mark(row.id)}
                >
                  Đánh dấu đã đọc
                </button>
              )}
            </article>
          ))}
        </section>
      )}
    </div>
  );
}
