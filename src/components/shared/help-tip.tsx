"use client";

/**
 * HelpTip — Icon ℹ️ small + tooltip hướng dẫn (CEO 07/05).
 *
 * Pattern: bấm hoặc hover icon "i" tròn → hiện tooltip có 1-2 câu hướng dẫn.
 * Dùng nhiều nơi: settings toggle, label form, table column header, kebab menu.
 *
 * Default trigger: hover (desktop) + click (mobile/tablet) — base-ui Tooltip
 * tự handle accessibility + portal positioning.
 *
 * Usage:
 *   <Toggle ... />
 *   <HelpTip>Bật để tự động in phiếu khi gửi bếp</HelpTip>
 *
 *   // Hoặc nhúng inline trong label:
 *   <Label>Khổ giấy <HelpTip>58mm cho máy nhỏ, 80mm chuẩn FnB</HelpTip></Label>
 *
 *   // Custom icon size:
 *   <HelpTip size={14} side="right">...</HelpTip>
 */

import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  TooltipProvider,
} from "@/components/ui/tooltip";

interface HelpTipProps {
  /** Nội dung tooltip — text ngắn 1-3 câu hoặc JSX (vd list bullet). */
  children: ReactNode;
  /** Icon size px (default 14 — phù hợp inline text). */
  size?: number;
  /** Vị trí tooltip mở. Default "top". */
  side?: "top" | "right" | "bottom" | "left";
  /** Class custom cho icon wrapper (vd ml-1). */
  className?: string;
  /** Aria label cho screen reader. Default "Xem hướng dẫn". */
  label?: string;
}

export function HelpTip({
  children,
  size = 14,
  side = "top",
  className,
  label = "Xem hướng dẫn",
}: HelpTipProps) {
  return (
    <TooltipProvider delay={150}>
      <Tooltip>
        <TooltipTrigger
          aria-label={label}
          className={cn(
            "inline-flex items-center justify-center text-on-surface-variant/70 hover:text-primary transition-colors cursor-help align-middle ml-1",
            className,
          )}
          // Cho phép click trên touch — base-ui mặc định hover desktop
          // + click mobile, không cần extra logic.
          type="button"
        >
          <Icon name="info" size={size} />
        </TooltipTrigger>
        <TooltipContent
          side={side}
          className="max-w-[280px] text-xs leading-relaxed whitespace-normal text-left"
        >
          {children}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
