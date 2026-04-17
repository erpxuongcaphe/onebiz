"use client";

import { useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// Button still used for loading/disabled states below
import { useToast } from "@/lib/contexts";
import {
  getAllowedTransitions,
  transitionPipelineItem,
} from "@/lib/services";
import type { AllowedTransition } from "@/lib/types";
import { Icon } from "@/components/ui/icon";

interface PipelineTransitionActionsProps {
  pipelineItemId: string;
  /** Called after a successful transition */
  onTransitioned?: () => void;
  size?: "sm" | "default";
  variant?: "default" | "outline";
}

/**
 * Dropdown of allowed transitions for a pipeline item.
 * Loads on mount, calls RPC on click.
 */
export function PipelineTransitionActions({
  pipelineItemId,
  onTransitioned,
  size = "sm",
  variant = "outline",
}: PipelineTransitionActionsProps) {
  const { toast } = useToast();
  const [transitions, setTransitions] = useState<AllowedTransition[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getAllowedTransitions(pipelineItemId)
      .then((t) => {
        if (!cancelled) setTransitions(t);
      })
      .catch(() => {
        if (!cancelled) setTransitions([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pipelineItemId]);

  async function handleTransition(t: AllowedTransition) {
    setRunning(t.transitionId);
    try {
      await transitionPipelineItem(pipelineItemId, t.toStageId);
      toast({
        title: "Đã chuyển trạng thái",
        description: `→ ${t.toStageName}`,
        variant: "success",
      });
      onTransitioned?.();
    } catch (err) {
      toast({
        title: "Lỗi chuyển trạng thái",
        description: err instanceof Error ? err.message : "Vui lòng thử lại",
        variant: "error",
      });
    } finally {
      setRunning(null);
    }
  }

  if (loading) {
    return (
      <Button size={size} variant={variant} disabled className="gap-1.5">
        <Icon name="progress_activity" size={14} className="animate-spin" />
        Đang tải...
      </Button>
    );
  }

  if (transitions.length === 0) {
    return (
      <Button size={size} variant={variant} disabled className="gap-1.5">
        Không có hành động
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border px-3 text-sm font-medium cursor-pointer",
          size === "sm" ? "h-8" : "h-9",
          variant === "default"
            ? "bg-primary text-primary-foreground border-primary hover:bg-primary/90"
            : "bg-background hover:bg-accent border-input"
        )}
      >
        {running ? (
          <Icon name="progress_activity" size={14} className="animate-spin" />
        ) : (
          <Icon name="arrow_forward" size={14} />
        )}
        Chuyển trạng thái
        <Icon name="expand_more" size={14} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {transitions.map((t) => (
          <DropdownMenuItem
            key={t.transitionId}
            onClick={() => handleTransition(t)}
            disabled={!!running}
          >
            {t.toStageColor && (
              <span
                className="mr-2 inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: t.toStageColor }}
              />
            )}
            {t.name || `→ ${t.toStageName}`}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
