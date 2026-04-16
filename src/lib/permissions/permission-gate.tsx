"use client";

/**
 * <Can> — Permission gate component.
 *
 * Renders children only if user has the required permission.
 * Usage: <Can permission="pos_fnb.void"><Button>Hủy</Button></Can>
 */

import type { ReactNode } from "react";
import { usePermissions } from "./use-permission";
import type { PermissionCode } from "./constants";

interface CanProps {
  /** Single permission code to check */
  permission?: PermissionCode | string;
  /** Multiple codes — renders if user has ANY of them */
  anyOf?: (PermissionCode | string)[];
  /** Multiple codes — renders if user has ALL of them */
  allOf?: (PermissionCode | string)[];
  /** Fallback content when unauthorized (defaults to null) */
  fallback?: ReactNode;
  children: ReactNode;
}

export function Can({ permission, anyOf, allOf, fallback = null, children }: CanProps) {
  const { hasPermission, hasAny, hasAll } = usePermissions();

  let allowed = true;

  if (permission) {
    allowed = hasPermission(permission);
  } else if (anyOf) {
    allowed = hasAny(anyOf);
  } else if (allOf) {
    allowed = hasAll(allOf);
  }

  return allowed ? <>{children}</> : <>{fallback}</>;
}
