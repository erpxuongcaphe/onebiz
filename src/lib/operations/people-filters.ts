import type { Workspace } from "./contracts";
import type { QualityWorkspace } from "./quality-contracts";

// Filters retain people attached to visible historical records, even after a
// role is withdrawn. Assignment controls use the database permission RPC instead.
export function filterPeople(workspace: Workspace, quality?: QualityWorkspace | null) {
  const ids = new Set(workspace.members.map((member) => member.user_id));
  for (const run of workspace.runs) ids.add(run.assignee_id);
  for (const todo of workspace.todos) { ids.add(todo.assignee_id); todo.collaborators.forEach((id) => ids.add(id)); }
  for (const department of quality?.departments ?? []) department.members.forEach((id) => ids.add(id));
  for (const grant of quality?.grants ?? []) ids.add(grant.user_id);
  for (const row of quality?.rows ?? []) for (const field of ["assignee_id", "operator_id", "actor_id", "auditor_id"]) if (typeof row[field] === "string") ids.add(row[field]);
  return workspace.people.filter((person) => ids.has(person.id));
}
