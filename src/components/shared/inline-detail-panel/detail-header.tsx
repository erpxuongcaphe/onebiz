"use client";

import { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface DetailHeaderProps {
  /** Main title (e.g. customer name, product name) */
  title: string;
  /** Code (e.g. HD010766, SP000632) */
  code?: string;
  /** Status badge */
  status?: {
    label: string;
    variant?: "default" | "secondary" | "destructive" | "outline";
    className?: string;
  };
  /** Right-side text (e.g. "Chi nhánh trung tâm") */
  subtitle?: string;
  /** Avatar/image element */
  avatar?: ReactNode;
  /** "Xem phân tích" or edit link */
  actionLink?: {
    label: string;
    onClick: () => void;
  };
  /** Tag badges (e.g. "Combo - đóng gói", "Bán trực tiếp") */
  tags?: string[];
  /** Meta info row (e.g. "Người tạo: Cao Thị Huyền Trang | Ngày tạo: 19/03/2026") */
  meta?: ReactNode;
  className?: string;
}

export function DetailHeader({
  title,
  code,
  status,
  subtitle,
  avatar,
  actionLink,
  tags,
  meta,
  className,
}: DetailHeaderProps) {
  return (
    <div className={cn("space-y-2", className)}>
      {/* Top row: title + code + status | subtitle */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          {avatar && (
            <div className="shrink-0 h-16 w-16 rounded-md overflow-hidden bg-muted flex items-center justify-center">
              {avatar}
            </div>
          )}
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-semibold">{title}</h3>
              {code && (
                <span className="text-sm text-muted-foreground flex items-center gap-1">
                  <ExternalLink className="h-3.5 w-3.5" />
                  {code}
                </span>
              )}
              {status && (
                <Badge
                  variant={status.variant || "default"}
                  className={cn("text-xs", status.className)}
                >
                  {status.label}
                </Badge>
              )}
            </div>

            {/* Tags */}
            {tags && tags.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
                {tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-xs font-normal">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}

            {/* Action link */}
            {actionLink && (
              <button
                type="button"
                onClick={actionLink.onClick}
                className="text-sm text-primary hover:underline flex items-center gap-1"
              >
                <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                {actionLink.label}
              </button>
            )}
          </div>
        </div>
        {subtitle && (
          <span className="text-sm text-muted-foreground whitespace-nowrap">
            {subtitle}
          </span>
        )}
      </div>

      {/* Meta row */}
      {meta && <div className="text-sm text-muted-foreground">{meta}</div>}
    </div>
  );
}
