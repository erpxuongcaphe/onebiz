"use client";

import { useToast, type ToastVariant } from "@/lib/contexts";
import { CheckCircle2, AlertCircle, AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Icon } from "@/components/ui/icon";

const variantStyles: Record<
  ToastVariant,
  { bg: string; border: string; icon: typeof CheckCircle2; iconColor: string }
> = {
  default: {
    bg: "bg-background",
    border: "border-border",
    icon: Info,
    iconColor: "text-foreground",
  },
  success: {
    bg: "bg-green-50",
    border: "border-green-200",
    icon: CheckCircle2,
    iconColor: "text-green-600",
  },
  error: {
    bg: "bg-red-50",
    border: "border-red-200",
    icon: AlertCircle,
    iconColor: "text-red-600",
  },
  warning: {
    bg: "bg-amber-50",
    border: "border-amber-200",
    icon: AlertTriangle,
    iconColor: "text-amber-600",
  },
  info: {
    bg: "bg-blue-50",
    border: "border-blue-200",
    icon: Info,
    iconColor: "text-blue-600",
  },
};

export function ToastContainer() {
  const { toasts, dismiss } = useToast();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-[420px] w-full pointer-events-none sm:bottom-6 sm:right-6">
      {toasts.map((t) => {
        const style = variantStyles[t.variant];
        const Icon = style.icon;
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
            <Icon className={cn("h-5 w-5 shrink-0 mt-0.5", style.iconColor)} />
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
              className="shrink-0 rounded-md p-1 hover:bg-black/5 transition-colors"
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
