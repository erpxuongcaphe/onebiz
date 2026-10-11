"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link2, RefreshCw } from "lucide-react";
import { states } from "@/lib/operations/contracts";
import { operationsModuleLink } from "@/lib/operations/module-link";
import styles from "./workspace.module.css";
interface Linked {
  id: string;
  task_id: string;
  todo_id: string;
  branch_id: string;
  task_title: string;
  task_state: string;
  todo_title: string;
  todo_state: string;
}
interface Candidate {
  id: string;
  title: string;
  task_status: string;
}
export function OperationsMktLinks({
  todoId,
  taskId,
  canLink = false,
}: {
  todoId?: string;
  taskId?: string;
  canLink?: boolean;
}) {
  const [rows, setRows] = useState<Linked[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [host, setHost] = useState("");
  const [protocol, setProtocol] = useState("https:");
  const controller = useRef<AbortController | null>(null);
  const saving = useRef(false);
  useEffect(() => {
    setHost(window.location.host);
    setProtocol(window.location.protocol);
    return () => controller.current?.abort();
  }, []);
  async function load(search = "") {
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    setBusy(true);
    setError("");
    try {
      const p = new URLSearchParams(
        todoId ? { todoId, search } : { taskId: taskId! },
      );
      const response = await fetch(`/api/operations/mkt-links?${p}`, {
        cache: "no-store",
        signal: active.signal,
      });
      const body = await response.json();
      if (!response.ok) throw Error(body.error);
      if (!active.signal.aborted) {
        setRows(body.links);
        setCandidates(body.candidates);
      }
    } catch (cause) {
      if (!active.signal.aborted)
        setError(
          cause instanceof Error ? cause.message : "Không tải được liên kết.",
        );
    } finally {
      if (!active.signal.aborted) setBusy(false);
    }
  }
  async function link(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError("");
    try {
      const id = String(new FormData(event.currentTarget).get("task"));
      const response = await fetch("/api/operations/mkt-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ todoId, taskId: id }),
      });
      const body = await response.json();
      if (!response.ok) throw Error(body.error);
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Không lưu được liên kết.",
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <details
      onToggle={(e) => {
        if (e.currentTarget.open) void load();
      }}
      className={styles.moduleLinks}
    >
      <summary>
        <Link2 size={14} /> Phối hợp {todoId ? "MKT" : "Vận hành"}
      </summary>
      {error && <p role="alert">{error}</p>}
      <button
        type="button"
        aria-label="Tải lại liên kết"
        title="Tải lại liên kết"
        disabled={busy}
        onClick={() => void load()}
      >
        <RefreshCw size={14} />
      </button>
      {rows.map((row) => (
        <p key={row.id}>
          <a
            href={operationsModuleLink(
              todoId ? "mkt" : "hub",
              todoId
                ? new URLSearchParams({ task: row.task_id }).toString()
                : new URLSearchParams({
                    branch: row.branch_id,
                    view: "todo",
                    search: row.todo_title.slice(0, 200),
                    todo: row.todo_id,
                  }).toString(),
              host,
              protocol,
            )}
          >
            {todoId ? row.task_title : row.todo_title}
          </a>{" "}
          ·{" "}
          {todoId
            ? ({
                todo: "Chưa làm",
                doing: "Đang làm",
                reviewing: "Chờ duyệt",
                blocked: "Đang chờ",
                done: "Hoàn thành",
                canceled: "Đã hủy",
              }[row.task_state] ?? row.task_state)
            : states[row.todo_state]}
        </p>
      ))}
      {canLink && todoId && (
        <>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void load(String(new FormData(e.currentTarget).get("search")));
            }}
            className={styles.toolbar}
          >
            <input
              name="search"
              type="search"
              maxLength={200}
              aria-label="Tìm việc MKT"
              placeholder="Tìm việc MKT"
            />
            <button type="submit" disabled={busy}>
              Tìm
            </button>
          </form>
          <form onSubmit={link} className={styles.toolbar}>
            <select name="task" required aria-label="Công việc MKT">
              <option value="">Chọn việc phối hợp</option>
              {candidates
                .filter((c) => !rows.some((r) => r.task_id === c.id))
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
            </select>
            <button type="submit" disabled={busy}>
              Liên kết
            </button>
          </form>
        </>
      )}
    </details>
  );
}
