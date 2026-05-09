"use client";

import { useToast, type ToastVariant } from "@/lib/contexts";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";

const variantStyles: Record<
  ToastVariant,
  { bg: string; border: string; icon: string; iconColor: string }
> = {
  default: {
    bg: "bg-background",
    border: "border-border",
    icon: "info",
    iconColor: "text-foreground",
  },
  success: {
    bg: "bg-status-success/10",
    border: "border-status-success/25",
    icon: "check_circle",
    iconColor: "text-status-success",
  },
  error: {
    bg: "bg-status-error/10",
    border: "border-status-error/25",
    icon: "error",
    iconColor: "text-status-error",
  },
  warning: {
    bg: "bg-status-warning/10",
    border: "border-status-warning/25",
    icon: "warning",
    iconColor: "text-status-warning",
  },
  info: {
    bg: "bg-primary-fixed",
    border: "border-primary-fixed",
    icon: "info",
    iconColor: "text-primary",
  },
};

export function ToastContainer() {
  const { toasts, dismiss } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-[420px] w-full pointer-events-none sm:bottom-6 sm:right-6">
      {toasts.map((t) => {
        const style = variantStyles[t.variant];
        return (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex items-start gap-3 rounded-lg border p-4 shadow-lg animate-in slide-in-from-bottom-5 fade-in-0 duration-200",
              style.bg,
              style.border
            )}
            role="alert"
          >
            <Icon
              name={style.icon}
              size={20}
              fill
              className={cn("shrink-0 mt-0.5", style.iconColor)}
            />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">{t.title}</p>
              {t.description && (
                <p className="text-sm text-muted-foreground mt-0.5">
                  {t.description}
                </p>
              )}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              className="shrink-0 rounded-lg p-1 hover:bg-black/5 transition-colors"
              aria-label="Đóng"
            >
              <Icon name="close" size={16} className="text-muted-foreground" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
