"use client";

import { Icon } from "@/components/ui/icon";

/**
 * FnbLoadingSkeleton — Khung xám nhấp nháy thay "trang trắng + dòng chữ rỗng".
 * Sprint LOAD-1 (CEO 08/05).
 *
 * Pattern industry standard (Facebook/Shopee/YouTube): user F5 → thấy khung
 * xám có hình dáng giống nội dung sắp hiện → biết "đang load", không tưởng
 * trang lỗi.
 *
 * Layout match đúng FnB POS thật:
 *   - Header 64px (☰ + Logo + Branch + view toggle + search + ...)
 *   - Tab row 40px (đơn mới + tab placeholder)
 *   - Body 3 cột (sidebar 200px + menu grid + cart 320-400px)
 *
 * Dùng `animate-pulse` Tailwind cho shimmer mềm. KHÔNG dùng spinner xoay
 * vì với layout phức tạp, skeleton đẹp + thông tin hơn.
 */

interface FnbLoadingSkeletonProps {
  title?: string;
  detail?: string;
  elapsedMs?: number;
  onRetry?: () => void;
  onOpenBranchPicker?: () => void;
}

export function FnbLoadingSkeleton({
  title = "Đang tải POS F&B",
  detail = "OneBiz đang chuẩn bị menu, bàn và giỏ hàng cho chi nhánh hiện tại.",
  elapsedMs = 0,
  onRetry,
  onOpenBranchPicker,
}: FnbLoadingSkeletonProps) {
  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  const showProgressHint = elapsedMs >= 2_000;
  const showRecovery = elapsedMs >= 8_000;

  return (
    <div className="flex flex-col h-screen bg-surface-container-low">
      {/* Header skeleton — match đúng h-16 + light theme thật */}
      <header className="h-16 bg-surface/95 backdrop-blur-md border-b border-outline-variant/30 flex items-center px-3 gap-2 shrink-0">
        {/* ☰ button */}
        <div className="w-10 h-10 rounded-xl bg-surface-container animate-pulse" />
        {/* Logo placeholder */}
        <div className="w-7 h-7 rounded bg-surface-container animate-pulse" />
        {/* Branch chip placeholder */}
        <div className="h-9 w-44 rounded-lg bg-surface-container animate-pulse" />
        {/* Shift indicator placeholder */}
        <div className="h-7 w-24 rounded-full bg-surface-container animate-pulse" />
        {/* View toggle placeholder */}
        <div className="h-9 w-44 rounded-xl bg-surface-container animate-pulse" />
        {/* Search bar placeholder */}
        <div className="h-9 w-56 rounded-xl bg-surface-container animate-pulse" />
        {/* Filler */}
        <div className="flex-1" />
        {/* KDS button placeholder */}
        <div className="h-9 w-24 rounded-lg bg-surface-container animate-pulse" />
      </header>

      {/* Tab row skeleton 40px */}
      <div className="h-10 bg-surface-container-lowest border-b border-outline-variant/20 flex items-center px-3 gap-1.5 shrink-0">
        <div className="h-7 w-32 rounded-lg bg-surface-container animate-pulse" />
        <div className="h-7 w-20 rounded-lg bg-surface-container animate-pulse" />
      </div>

      {showProgressHint && (
        <div className="border-b border-outline-variant/20 bg-surface-container-lowest px-3 py-2">
          <div className="mx-auto flex max-w-3xl flex-col gap-2 rounded-xl border border-outline-variant/30 bg-white/80 px-3 py-2 shadow-sm sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-sm font-semibold text-on-surface">
                <Icon
                  name={showRecovery ? "wifi_tethering_error" : "hourglass_top"}
                  size={16}
                  className={showRecovery ? "text-status-warning" : "text-primary"}
                />
                <span>{title}</span>
                {elapsedSeconds > 0 && (
                  <span className="text-xs font-medium text-muted-foreground">
                    {elapsedSeconds}s
                  </span>
                )}
              </div>
              <p className="mt-0.5 text-xs leading-relaxed text-on-surface-variant">
                {showRecovery
                  ? onOpenBranchPicker
                    ? "Đang tải lâu hơn bình thường. Anh có thể thử tải lại hoặc chọn lại chi nhánh mà không ảnh hưởng dữ liệu."
                    : "Đang tải lâu hơn bình thường. Anh có thể thử tải lại trang mà không ảnh hưởng dữ liệu."
                  : detail}
              </p>
            </div>

            {showRecovery && (onRetry || onOpenBranchPicker) && (
              <div className="flex shrink-0 items-center gap-2">
                {onOpenBranchPicker && (
                  <button
                    type="button"
                    onClick={onOpenBranchPicker}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-outline-variant/40 bg-white px-3 text-xs font-semibold text-on-surface hover:bg-surface-container transition-colors"
                  >
                    <Icon name="storefront" size={14} />
                    Chọn chi nhánh
                  </button>
                )}
                {onRetry && (
                  <button
                    type="button"
                    onClick={onRetry}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-xs font-semibold text-on-primary hover:bg-primary/90 transition-colors"
                  >
                    <Icon name="refresh" size={14} />
                    Thử lại
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Body 3 cột — sidebar + menu grid + cart */}
      <div className="flex flex-1 min-h-0">
        {/* Categories sidebar 200px (lg) — ẩn trên mobile */}
        <aside className="hidden lg:flex w-50 shrink-0 bg-surface-container-lowest border-r border-outline-variant/20 flex-col p-1.5 gap-1.5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-10 rounded-lg bg-surface-container animate-pulse"
              style={{ animationDelay: `${i * 80}ms` }}
            />
          ))}
        </aside>

        {/* Compact sidebar 144px (md only) */}
        <aside className="hidden md:flex lg:hidden w-36 shrink-0 bg-surface-container-lowest border-r border-outline-variant/20 flex-col p-1.5 gap-1.5">
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-9 rounded-lg bg-surface-container animate-pulse"
              style={{ animationDelay: `${i * 80}ms` }}
            />
          ))}
        </aside>

        {/* Mobile category grid 4-col */}
        <div className="md:hidden grid grid-cols-4 gap-1.5 p-2 shrink-0 max-h-[140px] bg-surface-container-lowest border-b border-outline-variant/20">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="h-14 rounded-xl bg-surface-container animate-pulse"
              style={{ animationDelay: `${i * 80}ms` }}
            />
          ))}
        </div>

        {/* Menu grid skeleton — flex-1 */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 p-3 overflow-hidden">
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className="bg-surface-container-low rounded-xl overflow-hidden flex flex-col"
                style={{ animationDelay: `${i * 60}ms` }}
              >
                {/* Image area aspect-square */}
                <div className="aspect-square bg-surface-container animate-pulse" />
                {/* Name + meta */}
                <div className="p-3 space-y-1.5">
                  <div className="h-3.5 w-3/4 rounded bg-surface-container animate-pulse" />
                  <div className="h-3 w-1/2 rounded bg-surface-container animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Cart skeleton 320px (lg+) — ẩn mobile/tablet portrait */}
        <aside className="hidden lg:flex w-[320px] xl:w-[400px] flex-col shrink-0 bg-surface-container-lowest rounded-xl ambient-shadow border border-outline-variant/20 my-3 mr-3 overflow-hidden">
          {/* Cart header */}
          <div className="p-4 border-b border-outline-variant/20 space-y-2">
            <div className="h-5 w-32 rounded bg-surface-container animate-pulse" />
            <div className="h-9 w-full rounded-lg bg-surface-container animate-pulse" />
          </div>
          {/* Order type pills */}
          <div className="px-4 pt-3 flex gap-1">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="flex-1 h-7 rounded-full bg-surface-container animate-pulse"
                style={{ animationDelay: `${i * 80}ms` }}
              />
            ))}
          </div>
          {/* Empty cart icon space */}
          <div className="flex-1 flex items-center justify-center">
            <div className="h-16 w-16 rounded-full bg-surface-container animate-pulse" />
          </div>
          {/* Footer summary */}
          <div className="p-4 border-t border-outline-variant/20 space-y-2">
            <div className="h-3 w-full rounded bg-surface-container animate-pulse" />
            <div className="h-7 w-32 rounded bg-surface-container animate-pulse ml-auto" />
            <div className="grid grid-cols-2 gap-2 mt-3">
              <div className="h-12 rounded-lg bg-surface-container animate-pulse" />
              <div className="h-12 rounded-lg bg-surface-container animate-pulse" />
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
