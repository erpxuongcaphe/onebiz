import type { MktContext } from "@/lib/mkt/context";

export const MKT_READINESS_ROLES = [
  { value: "ceo", label: "CEO / Ch\u1ee7" },
  { value: "store_manager", label: "Qu\u1ea3n l\u00fd c\u1eeda h\u00e0ng" },
  { value: "finance", label: "K\u1ebf to\u00e1n" },
  { value: "ops", label: "V\u1eadn h\u00e0nh" },
  { value: "warehouse", label: "Kho" },
] as const;

export const MKT_READINESS_ROLE_LABEL: Record<string, string> = Object.fromEntries(
  MKT_READINESS_ROLES.map((role) => [role.value, role.label]),
);

// Existing rows may still carry the two legacy profile-role values.
MKT_READINESS_ROLE_LABEL.owner = "CEO / Ch\u1ee7";
MKT_READINESS_ROLE_LABEL.manager = "Qu\u1ea3n l\u00fd c\u1eeda h\u00e0ng";

export function normalizeReadinessRole(role: string | null | undefined): string | null {
  if (!role) return null;
  if (role === "owner") return "ceo";
  if (role === "manager" || role === "store") return "store_manager";
  return role;
}

export function isMktReadinessRole(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const normalized = normalizeReadinessRole(value);
  return MKT_READINESS_ROLES.some((role) => role.value === normalized);
}

export function canConfirmReadiness(
  ctx: MktContext,
  requiredRole: string | null,
  requiredBranchId: string | null,
): boolean {
  if (ctx.canOverride) return true;
  const role = normalizeReadinessRole(requiredRole);
  if (!role || !ctx.readinessRoles?.includes(role)) return false;
  return !requiredBranchId || requiredBranchId === ctx.branchId;
}
