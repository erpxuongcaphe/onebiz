import { normalizeListSearch } from "@/lib/local-list-query";

export interface StaffDirectoryPerson {
  id: string; fullName: string; email: string; phone?: string | null;
  branchIds: string[]; departmentIds?: string[];
}
export interface StaffDirectoryFilters { branchIds: string[]; departmentIds: string[]; search: string }
export const EMPTY_STAFF_FILTERS: StaffDirectoryFilters = { branchIds: [], departmentIds: [], search: "" };
/** Input must already be server-authorized. Filters only narrow; never fetch/union more users. */
export function filterStaffDirectory<T extends StaffDirectoryPerson>(people: T[], filters: StaffDirectoryFilters): T[] {
  const words = normalizeListSearch(filters.search).split(/\s+/).filter(Boolean);
  return people.filter(person =>
    (!filters.branchIds.length || filters.branchIds.some(id => person.branchIds.includes(id))) &&
    (!filters.departmentIds.length || filters.departmentIds.some(id => id === "__unassigned__"
      ? person.departmentIds?.length === 0 : person.departmentIds?.includes(id))) &&
    words.every(word => normalizeListSearch(`${person.fullName} ${person.email} ${person.phone ?? ""}`).includes(word)));
}

/** Hidden selections must never become silent bulk-edit targets. */
export function visibleStaffSelection(selected: Set<string>, visibleIds: string[]): Set<string> {
  return new Set(visibleIds.filter(id => selected.has(id)));
}
