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

/** Legacy aliases cannot bypass an explicit exception on the target operation. */
export function permissionWithLegacyFallback(
  effective: ReadonlySet<string>,
  adjustments: readonly { branchId: string; code: string; allowed: boolean }[],
  branchId: string | null,
  code: string,
  legacyCode?: string,
  legacyDenials: readonly string[] = [],
) {
  if (legacyDenials.includes(code) && !effective.has("*")) return false;
  if (effective.has("*") || effective.has(code)) return true;
  if (!legacyCode || !effective.has(legacyCode)) return false;
  return !adjustments.some(
    (entry) =>
      entry.code === code && (branchId === null || entry.branchId === branchId),
  );
}
