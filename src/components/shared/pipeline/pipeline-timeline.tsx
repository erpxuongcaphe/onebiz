"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { getPipelineTimeline } from "@/lib/services";
import type { TimelineEntry } from "@/lib/types";
import { formatDate } from "@/lib/format";

interface PipelineTimelineProps {
  pipelineItemId: string;
}

/**
 * Vertical timeline showing all stage changes for a pipeline item.
 */
export function PipelineTimeline({ pipelineItemId }: PipelineTimelineProps) {
  const [entries, setEntries] = useState<TimelineEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getPipelineTimeline(pipelineItemId)
      .then((e) => {
        if (!cancelled) setEntries(e);
      })
      .catch(() => {
        if (!cancelled) setEntries([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pipelineItemId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <div className="text-sm text-muted-foreground text-center py-6">
        Chưa có lịch sử chuyển trạng thái
      </div>
    );
  }

  return (
    <ol className="relative border-l border-border ml-3 space-y-4 py-2">
      {entries.map((entry) => (
        <li key={entry.id} className="ml-4">
          <span
            className="absolute -left-[7px] h-3.5 w-3.5 rounded-full border-2 border-background"
            style={{ backgroundColor: entry.toColor || "#94a3b8" }}
          />
          <div className="text-xs text-muted-foreground">
            {formatDate(entry.changedAt)}
            {entry.changedBy && <span> · {entry.changedBy}</span>}
          </div>
          <div className="mt-0.5 flex items-center gap-1.5 text-sm">
            {entry.fromStage && (
              <>
                <span className="text-muted-foreground">{entry.fromStage}</span>
                <span className="text-muted-foreground">→</span>
              </>
            )}
            <span
              className="font-medium"
              style={{ color: entry.toColor || undefined }}
            >
              {entry.toStage}
            </span>
          </div>
          {entry.note && (
            <div className="mt-1 text-xs text-muted-foreground italic">
              {entry.note}
            </div>
          )}
        </li>
      ))}
    </ol>
  );
}
