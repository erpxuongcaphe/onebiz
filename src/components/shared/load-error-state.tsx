"use client";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

interface LoadErrorStateProps {
  title?: string;
  description?: string;
  onRetry: () => void;
  className?: string;
}

export function LoadErrorState({
  title = "Không tải được dữ liệu",
  description = "Kiểm tra kết nối rồi thử lại. Dữ liệu hiện có không bị thay đổi.",
  onRetry,
  className,
}: LoadErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex min-h-48 flex-col items-center justify-center gap-3 rounded-lg border border-status-error/30 bg-status-error/5 p-6 text-center",
        className,
      )}
    >
      <span className="flex size-10 items-center justify-center rounded-full bg-status-error/10 text-status-error">
        <Icon name="cloud_off" size={22} />
      </span>
      <div className="max-w-md space-y-1">
        <p className="font-semibold text-foreground">{title}</p>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      <Button type="button" variant="outline" onClick={onRetry}>
        <Icon name="refresh" size={16} className="mr-1.5" />
        Thử lại
      </Button>
    </div>
  );
}
