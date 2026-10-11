import { PERMISSIONS } from "@/lib/permissions/constants";

export const operationsPermissionByCapability = {
  view: PERMISSIONS.OPS_VIEW,
  work: PERMISSIONS.OPS_WORK,
  verify: PERMISSIONS.OPS_VERIFY,
  approve_policy: PERMISSIONS.OPS_CONFIGURE,
  close_period: PERMISSIONS.OPS_CLOSE_PERIOD,
  cancel_todo: PERMISSIONS.OPS_CANCEL_TODO,
  manage_members: PERMISSIONS.OPS_MANAGE_MEMBERS,
} as const;

export type OperationsCapability = keyof typeof operationsPermissionByCapability;

/** For UI previews only. SQL remains authoritative for every read and write. */
export function hasOperationsPermission(
  effectivePermissions: readonly string[],
  capability: OperationsCapability,
): boolean {
  return effectivePermissions.includes(PERMISSIONS.OPS_VIEW) &&
    effectivePermissions.includes(operationsPermissionByCapability[capability]);
}
