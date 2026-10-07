"use client";

import { usePathname } from "next/navigation";
import { useCallback, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { useFnbSubdomain } from "@/lib/hooks/use-fnb-subdomain";
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
  const pathname = usePathname();
  const { isFnb } = useFnbSubdomain();
  const isFnbPos = pathname === "/pos/fnb" || (isFnb && pathname === "/");
  const [expanded, setExpanded] = useState(false);
  const subscribeRegion = useCallback((notify: () => void) => {
    if (!isFnbPos) return () => {};
    const observer = new MutationObserver(notify);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, [isFnbPos]);
  const readRegion = useCallback(() => {
    if (!isFnbPos) return null;
    const slots = Array.from(document.querySelectorAll("[data-pos-toast-region]"));
    return slots.filter(slot => slot.getClientRects().length > 0).at(-1) ?? null;
  }, [isFnbPos]);
  const region = useSyncExternalStore(subscribeRegion, readRegion, () => null);

  if (toasts.length === 0) return null;

  const visibleToasts = isFnbPos && !expanded ? toasts.slice(-1) : toasts.slice(-3);
  const content = (
    <div
      className={cn(
        "flex flex-col gap-1 pointer-events-none",
        isFnbPos
          ? "w-full max-h-40 overflow-y-auto px-2 py-1 shrink-0"
          : "fixed right-3 top-[calc(4rem+env(safe-area-inset-top))] z-[100] w-[calc(100%-1.5rem)] max-w-[360px] sm:right-5",
      )}
    >
      {visibleToasts.map((t) => {
        const style = variantStyles[t.variant];
        return (
          <div
            key={t.id}
            className={cn(
              "pointer-events-auto flex items-start gap-2 rounded-md border bg-background px-3 py-2 shadow-sm animate-in fade-in-0 duration-200",
              style.bg,
              style.border
            )}
            role={t.variant === "error" ? "alert" : "status"}
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
                <p className="text-xs leading-relaxed text-muted-foreground mt-0.5 break-words line-clamp-3">
                  {t.description}
                </p>
              )}
            </div>
            <button
              onClick={() => dismiss(t.id)}
              className="shrink-0 flex h-11 w-11 -my-1 items-center justify-center rounded-md hover:bg-black/5 transition-colors"
              aria-label="Đóng"
            >
              <Icon name="close" size={16} className="text-muted-foreground" />
            </button>
          </div>
        );
      })}
      {isFnbPos && toasts.length > 1 && <button type="button" onClick={() => setExpanded(value => !value)} className="pointer-events-auto self-end min-h-9 px-2 text-xs font-semibold text-primary">{expanded ? "Thu gọn" : `Xem ${toasts.length - 1} thông báo trước`}</button>}
    </div>
  );
  return isFnbPos ? (region ? createPortal(content, region) : null) : content;
}
