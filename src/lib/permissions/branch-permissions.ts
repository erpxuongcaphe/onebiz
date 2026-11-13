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

/** Match permissionsForBranch without allocating a permission set per table row. */
export function hasPermissionForBranch(
  base: ReadonlySet<string>,
  adjustments: readonly { branchId: string; code: string; allowed: boolean }[],
  branchId: string | null,
  code: string,
) {
  if (base.has("*")) return true;
  let allowed = base.has(code);
  for (const entry of adjustments) {
    if (entry.code !== code) continue;
    if (branchId === null) {
      if (!entry.allowed) allowed = false;
    } else if (entry.branchId === branchId) {
      allowed = entry.allowed;
    }
  }
  return allowed;
}

/** The print server preserves existing account-level F&B printing rights even
 * when an operational permission is restricted at a particular branch. */
export function hasFnbPrintPermission(
  base: ReadonlySet<string>,
  adjustments: readonly { branchId: string; code: string; allowed: boolean }[],
  branchId: string,
) {
  if (base.has("*") || base.has("system.manage_branches")) return true;
  return ["pos_fnb.view_orders", "pos_fnb.send_kitchen", "pos_fnb.checkout"].some(
    (code) => base.has(code) || hasPermissionForBranch(base, adjustments, branchId, code),
  );
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

/** Resolve a legacy alias against a document's branch, not the current filter. */
export function permissionWithLegacyAtBranch(
  base: ReadonlySet<string>,
  adjustments: readonly { branchId: string; code: string; allowed: boolean }[],
  branchId: string | null,
  code: string,
  legacyCode: string,
  legacyDenials: readonly string[] = [],
) {
  if (base.has("*")) return true;
  if (legacyDenials.includes(code)) return false;
  if (hasPermissionForBranch(base, adjustments, branchId, code)) return true;
  if (!hasPermissionForBranch(base, adjustments, branchId, legacyCode))
    return false;
  return !adjustments.some(
    (entry) =>
      entry.code === code && (branchId === null || entry.branchId === branchId),
  );
}
