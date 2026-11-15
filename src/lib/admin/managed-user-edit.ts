export type ManagedUserEditDraft = {
  fullName: string;
  phone: string;
  roleId: string;
  branchIds: string[];
  allBranches: boolean;
};

export function usesLegacyScopeEditor(isOwner: boolean, targetRole: string) {
  return !isOwner || targetRole === "owner";
}

export function buildManagedUserEdit(
  actor: { id: string | undefined; isOwner: boolean },
  target: { id: string; role: string },
  draft: ManagedUserEditDraft,
) {
  const legacyScope = usesLegacyScopeEditor(actor.isOwner, target.role);
  const canChangeBranches = legacyScope && target.id !== actor.id;
  if (canChangeBranches && !draft.allBranches && draft.branchIds.length === 0) {
    return { error: "missing_branch" as const };
  }
  return {
    payload: {
      userId: target.id,
      fullName: draft.fullName.trim() || undefined,
      phone: draft.phone.trim(),
      ...(legacyScope && target.role !== "owner" && target.id !== actor.id
        ? { roleId: draft.roleId || null } : {}),
      ...(canChangeBranches ? {
        branchIds: draft.allBranches ? [] : draft.branchIds,
        allBranches: draft.allBranches,
      } : {}),
    },
  };
}
