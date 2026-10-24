"use client";

import { Button } from "@/components/ui/button";

export function ListWorkspaceError({ label, error, onRetry }: {
  label: string; error: string | null; onRetry: () => void;
}) {
  if (!error) return null;
  return <div role="alert" className="flex flex-wrap items-center gap-2 border-l-2 border-destructive bg-destructive/5 px-3 py-2 text-sm">
    <span className="min-w-0 flex-1 break-words">Không tải được {label}. {error}</span>
    <Button variant="outline" size="sm" onClick={onRetry}>Thử lại</Button>
  </div>;
}
