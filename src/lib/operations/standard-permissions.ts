import type { Standard, Workspace } from "./contracts";

export function canProposeStandard(data: Workspace, branch: string): boolean {
  return !data.isCeo && data.branches.some(item => item.id === branch && item.capabilities.includes("work"))
    && data.members.some(member => member.user_id === data.userId && member.active && member.member_role === "manager");
}

export function canProposeRevision(standard: Standard, userId: string): boolean {
  return standard.scope === "branch" && (standard.status === "approved"
    || (standard.status === "changes_requested" && standard.created_by === userId));
}

export const initialMineFilters = { work: true, todo: false, review: false };
