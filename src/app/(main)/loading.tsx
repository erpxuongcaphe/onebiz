/**
 * Loading skeleton — shared cho toàn bộ (main) route group
 *
 * Sprint UX-1 Stage 1 (CEO 04/05/2026): Next.js Suspense fallback khi
 * navigate giữa pages trong (main) group. Trước đây không có
 * loading.tsx → page đứng yên đến khi compile/fetch xong → user
 * tưởng web treo.
 *
 * Plus NextTopLoader (line top) → 2 layer feedback:
 * - Top progress bar: indicate đang nav
 * - Skeleton này: indicate đang load page content
 */

export default function Loading() {
  return (
    <div className="p-3 md:p-4 space-y-3">
      {/* Page header skeleton */}
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <div className="h-8 w-48 rounded-lg bg-muted/60 animate-pulse" />
          <div className="h-3 w-32 rounded bg-muted/40 animate-pulse" />
        </div>
        <div className="flex gap-2">
          <div className="h-8 w-20 rounded-lg bg-muted/60 animate-pulse" />
          <div className="h-8 w-24 rounded-lg bg-muted/60 animate-pulse" />
        </div>
      </div>

      {/* KPI cards skeleton */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="rounded-lg border border-border border-l-2 border-l-primary/40 bg-white p-3"
          >
            <div className="h-3 w-20 rounded bg-muted/50 animate-pulse mb-2" />
            <div className="h-7 w-28 rounded bg-muted/60 animate-pulse" />
            <div className="h-3 w-16 rounded bg-muted/40 animate-pulse mt-2" />
          </div>
        ))}
      </div>

      {/* Content area skeleton */}
      <div className="rounded-xl border border-border bg-white">
        {/* Header strip */}
        <div className="border-b border-border p-3 flex items-center gap-3">
          <div className="h-8 w-64 rounded-lg bg-muted/40 animate-pulse" />
          <div className="ml-auto flex gap-2">
            <div className="h-8 w-20 rounded-lg bg-muted/40 animate-pulse" />
            <div className="h-8 w-20 rounded-lg bg-muted/40 animate-pulse" />
          </div>
        </div>
        {/* Rows */}
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="border-b border-border last:border-0 p-3 flex items-center gap-3">
            <div className="h-4 w-4 rounded bg-muted/40 animate-pulse" />
            <div className="h-4 w-32 rounded bg-muted/50 animate-pulse" />
            <div className="h-4 w-48 rounded bg-muted/40 animate-pulse" />
            <div className="h-4 w-24 rounded bg-muted/40 animate-pulse ml-auto" />
            <div className="h-6 w-20 rounded-full bg-muted/50 animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}
