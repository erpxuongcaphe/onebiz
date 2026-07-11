export default function MktLoading() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-on-surface-variant">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-outline-variant border-t-primary" />
        <span className="text-sm font-medium">Đang tải…</span>
      </div>
    </div>
  );
}
