"use client";

/**
 * usePermissions — Hook to check current user's permissions.
 *
 * Reads from AuthContext cached permissions. Owner role always has all permissions.
 */

import { useAuth } from "@/lib/contexts";
import type { PermissionCode } from "./constants";

export interface PermissionsAPI {
  /** Check if user has a specific permission */
  hasPermission: (code: PermissionCode | string) => boolean;
  /** Check if user has ANY of the given permissions */
  hasAny: (codes: (PermissionCode | string)[]) => boolean;
  /** Check if user has ALL of the given permissions */
  hasAll: (codes: (PermissionCode | string)[]) => boolean;
  /** Raw permission set */
  permissions: Set<string>;
  /** True while permissions are loading */
  isLoading: boolean;
}

export function usePermissions(): PermissionsAPI {
  const { user, permissions, isLoading } = useAuth();

  const isOwner = user?.role === "owner";

  const hasPermission = (code: PermissionCode | string): boolean => {
    if (isOwner) return true;
    if (permissions.has("*")) return true;
    return permissions.has(code);
  };

  const hasAny = (codes: (PermissionCode | string)[]): boolean =>
    codes.some((c) => hasPermission(c));

  const hasAll = (codes: (PermissionCode | string)[]): boolean =>
    codes.every((c) => hasPermission(c));

  return { hasPermission, hasAny, hasAll, permissions, isLoading };
}
