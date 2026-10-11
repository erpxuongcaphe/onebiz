"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { formatNumber } from "@/lib/format";
import type { Todo } from "@/lib/operations/contracts";
import styles from "./workspace.module.css";

interface Page {
  rows: Todo[];
  next: { closed: boolean; due: string; id: string } | null;
}
export function OperationsTodoList({
  branch,
  search,
  onlyMine,
  renderItem,
  revision,
}: {
  branch: string;
  search: string;
  onlyMine: boolean;
  renderItem: (todo: Todo) => ReactNode;
  revision: unknown;
}) {
  const [page, setPage] = useState<Page>({ rows: [], next: null });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const epoch = useRef(0);
  const active = useRef<AbortController | null>(null);
  const loading = useRef(false);
  async function load(cursor: Page["next"] = null, generation = epoch.current) {
    if (cursor && loading.current) return;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    loading.current = true;
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams({ search, mine: String(onlyMine) });
      if (branch) params.set("branch", branch);
      if (cursor) {
        params.set("closed", String(cursor.closed));
        params.set("due", cursor.due);
        params.set("id", cursor.id);
      }
      const response = await fetch(`/api/operations/todos?${params}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Không tải được To-do.");
      if (generation !== epoch.current) return;
      setPage((previous) => ({
        rows: cursor
          ? [
              ...new Map(
                [...previous.rows, ...body.rows].map((row: Todo) => [
                  row.id,
                  row,
                ]),
              ).values(),
            ]
          : body.rows,
        next: body.next,
      }));
    } catch (cause) {
      if (!controller.signal.aborted && generation === epoch.current)
        setError(
          cause instanceof Error ? cause.message : "Không tải được To-do.",
        );
    } finally {
      if (generation === epoch.current) {
        loading.current = false;
        setBusy(false);
      }
    }
  }
  useEffect(() => {
    const counter = epoch;
    const generation = ++counter.current;
    setPage({ rows: [], next: null });
    const timer = setTimeout(() => void load(null, generation), 250);
    return () => {
      clearTimeout(timer);
      ++counter.current;
      active.current?.abort();
    };
    // Scope changes restart the read; searches are debounced, with no polling/retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branch, search, onlyMine, revision]);
  return (
    <div className={styles.list}>
      {page.rows.map(renderItem)}
      {!busy && !error && !page.rows.length && (
        <p className={styles.empty}>Chưa có To-do trong bộ lọc này.</p>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}{" "}
          <button type="button" disabled={busy} onClick={() => void load()}>
            Tải lại
          </button>
        </p>
      )}
      <div className={styles.pagination}>
        <span role="status">
          {busy
            ? "Đang tải…"
            : `Đã hiển thị ${formatNumber(page.rows.length)} công việc`}
        </span>
        {page.next && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void load(page.next)}
          >
            Xem thêm
          </button>
        )}
      </div>
    </div>
  );
}
