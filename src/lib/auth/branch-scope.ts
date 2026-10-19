import { PERMISSIONS } from "@/lib/permissions/constants";

export function canViewAllBranches(role: string | undefined, permissions: ReadonlySet<string>) {
  return role === "owner" || permissions.has("*") || permissions.has(PERMISSIONS.REPORTS_VIEW_ALL_BRANCHES);
}

export function parseAccessibleBranchIds(value: unknown): Set<string> {
  if (!Array.isArray(value)) throw new Error("Không tải được phạm vi chi nhánh.");
  const ids = new Set<string>();
  for (const row of value) {
    if (!row || typeof row !== "object" || !("branch_id" in row) || typeof row.branch_id !== "string" || !row.branch_id) {
      throw new Error("Phạm vi chi nhánh không hợp lệ.");
    }
    ids.add(row.branch_id);
  }
  return ids;
}
