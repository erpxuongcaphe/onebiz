"use client";

import { useEffect, useState } from "react";
import { getAuditLogsByEntity, type AuditLogEntry } from "@/lib/services";
import { formatDate } from "@/lib/format";
import { Icon } from "@/components/ui/icon";

interface AuditHistoryTabProps {
  entityType: string;
  entityId: string;
  /** Số bản ghi tối đa lấy về. Mặc định 50. */
  limit?: number;
}

/**
 * Tab "Lịch sử" cho InlineDetailPanel — fetch audit_log theo entity + render
 * timeline vertical với icon hành động + thời gian + người thao tác.
 */
export function AuditHistoryTab({
  entityType,
  entityId,
  limit = 50,
}: AuditHistoryTabProps) {
  const [entries, setEntries] = useState<AuditLogEntry[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!entityId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    getAuditLogsByEntity(entityType, entityId, limit)
      .then((rows) => {
        if (cancelled) return;
        setEntries(rows);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Không tải được lịch sử");
        setEntries([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [entityType, entityId, limit]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
        <Icon name="progress_activity" size={16} className="animate-spin mr-2" />
        Đang tải lịch sử...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-destructive py-4 text-center">{error}</div>
    );
  }

  if (!entries || entries.length === 0) {
    return (
      <div className="text-sm text-muted-foreground py-4 text-center">
        Chưa có lịch sử thay đổi
      </div>
    );
  }

  return (
    <ol className="relative border-l border-border ml-3 pl-5 space-y-4 py-2">
      {entries.map((e) => (
        <li key={e.id} className="relative">
          <span
            className={`absolute -left-[28px] top-0.5 flex items-center justify-center w-5 h-5 rounded-full text-[11px] ${actionColor(e.action)}`}
          >
            <Icon name={actionIcon(e.action)} size={12} />
          </span>
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="text-sm font-medium text-foreground">
              {e.actionLabel}
            </span>
            <span className="text-xs text-muted-foreground">
              bởi{" "}
              <span className="font-medium text-foreground">{e.userName}</span>
            </span>
            <span className="text-xs text-muted-foreground">
              · {formatDate(e.createdAt)}
            </span>
          </div>
          {e.newData && Object.keys(e.newData).length > 0 && (
            <DiffSummary
              oldData={e.oldData}
              newData={e.newData}
              action={e.action}
            />
          )}
        </li>
      ))}
    </ol>
  );
}

function actionIcon(action: string): string {
  switch (action) {
    case "create":
      return "add";
    case "update":
      return "edit";
    case "delete":
      return "delete";
    case "complete":
      return "check";
    case "cancel":
      return "close";
    case "approve":
      return "verified";
    case "receive":
      return "inventory_2";
    case "return":
      return "undo";
    case "transfer":
      return "swap_horiz";
    default:
      return "history";
  }
}

function actionColor(action: string): string {
  switch (action) {
    case "create":
    case "complete":
    case "approve":
    case "receive":
      return "bg-status-success/15 text-status-success";
    case "update":
      return "bg-status-info/15 text-status-info";
    case "delete":
    case "cancel":
      return "bg-destructive/15 text-destructive";
    case "return":
    case "transfer":
      return "bg-status-warning/15 text-status-warning";
    default:
      return "bg-muted text-muted-foreground";
  }
}

/**
 * Hiển thị tóm tắt field thay đổi. Chỉ show tối đa 4 field để không rối mắt.
 */
function DiffSummary({
  oldData,
  newData,
  action,
}: {
  oldData: Record<string, unknown> | null;
  newData: Record<string, unknown> | null;
  action: string;
}) {
  if (action === "create" && newData) {
    const codeOrName = newData["code"] ?? newData["name"] ?? null;
    if (codeOrName) {
      return (
        <p className="text-xs text-muted-foreground mt-0.5">
          Tạo <span className="font-medium text-foreground">{String(codeOrName)}</span>
        </p>
      );
    }
    return null;
  }

  if (action === "update" && oldData && newData) {
    const changedKeys = Object.keys(newData).filter(
      (k) =>
        k !== "updated_at" &&
        k !== "updated_by" &&
        JSON.stringify(oldData[k]) !== JSON.stringify(newData[k])
    );
    if (changedKeys.length === 0) return null;
    const shown = changedKeys.slice(0, 4);
    return (
      <ul className="text-xs text-muted-foreground mt-0.5 space-y-0.5">
        {shown.map((k) => (
          <li key={k}>
            <span className="font-medium">{k}:</span>{" "}
            <span className="line-through opacity-60">
              {formatValue(oldData[k])}
            </span>{" "}
            →{" "}
            <span className="text-foreground">{formatValue(newData[k])}</span>
          </li>
        ))}
        {changedKeys.length > shown.length && (
          <li className="italic">
            …và {changedKeys.length - shown.length} thay đổi khác
          </li>
        )}
      </ul>
    );
  }

  return null;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
