export function permissionsForBranch(
  base: ReadonlySet<string>,
  adjustments: readonly { branchId: string; code: string; allowed: boolean }[],
  branchId: string | null,
) {
  if (!adjustments.length || base.has("*")) return new Set(base);
  const next = new Set(base);
  for (const entry of adjustments) {
    if (branchId === null) {
      if (!entry.allowed) next.delete(entry.code);
    } else if (entry.branchId === branchId) {
      if (entry.allowed) next.add(entry.code);
      else next.delete(entry.code);
    }
  }
  return next;
}
