"use client";

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";

export function RecipeCostLoadError({ onRetry }: { onRetry: () => void }) {
  return <div role="alert" className="flex flex-wrap items-center justify-between gap-2 border-y border-destructive/20 bg-destructive/5 px-3 py-2 text-sm">
    <span className="text-destructive">Không tải được giá vốn chi nhánh.</span>
    <Button type="button" variant="outline" size="sm" onClick={onRetry}><Icon name="refresh" size={14} />Thử lại</Button>
  </div>;
}
