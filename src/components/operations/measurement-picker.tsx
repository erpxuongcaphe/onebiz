"use client";
import { useEffect, useRef, useState } from "react";
import { formatDate } from "@/lib/format";
import type { Observation } from "@/lib/operations/contracts";
import styles from "./workspace.module.css";
interface Measurement {
  id: string;
  observed_at: string;
  actor_name: string;
  observation: Observation;
}
export function MeasurementPicker({
  runId,
  criterion,
  slot,
  onSelect,
}: {
  runId: string;
  criterion: string;
  slot: string;
  onSelect: (o: Observation) => void;
}) {
  const [rows, setRows] = useState<Measurement[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function load() {
    controller.current?.abort();
    const active = new AbortController();
    controller.current = active;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(
        `/api/operations/measurements?${new URLSearchParams({ runId, criterion, slot })}`,
        { cache: "no-store", signal: active.signal },
      );
      const body = await response.json();
      if (!response.ok) throw Error(body.error);
      if (!active.signal.aborted) setRows(body.rows);
    } catch (cause) {
      if (!active.signal.aborted)
        setError(
          cause instanceof Error ? cause.message : "Không tải được quan sát.",
        );
    } finally {
      if (!active.signal.aborted) setBusy(false);
    }
  }
  return (
    <div className={styles.todoPicker}>
      <button type="button" onClick={() => void load()} disabled={busy}>
        {busy ? "Đang tìm…" : "Tìm quan sát dùng chung"}
      </button>
      {error && <p role="alert">{error}</p>}
      {rows.map((row) => (
        <button
          type="button"
          key={row.id}
          className={styles.pickerItem}
          onClick={() =>
            onSelect({
              ...row.observation,
              criterionId: criterion,
              slot,
              measurementId: row.id,
              measuredAt: row.observed_at,
            })
          }
        >
          <span>
            {row.actor_name} · {formatDate(row.observed_at)}
          </span>
          <small>Dùng quan sát</small>
        </button>
      ))}
    </div>
  );
}
