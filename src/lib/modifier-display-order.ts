export type ModifierOrderMode = "common" | "custom";

export function moveModifierId(ids: string[], id: string, direction: -1 | 1): string[] {
  const from = ids.indexOf(id);
  const to = from + direction;
  if (from < 0 || to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

export function modifierOrderMode(links: { useCommonOrder?: boolean }[]): ModifierOrderMode {
  return links.length === 0 || links.every(link => link.useCommonOrder === true) ? "common" : "custom";
}

export function orderedModifierIds(
  groups: { id: string; name: string; sortOrder: number }[],
  selectedIds: Iterable<string>,
  mode: ModifierOrderMode,
): string[] {
  const selected = [...selectedIds];
  if (mode === "custom") return selected;
  const ranks = new Map(groups.map(group => [group.id, group]));
  return selected.sort((a, b) => {
    const left = ranks.get(a), right = ranks.get(b);
    return (left?.sortOrder ?? 0) - (right?.sortOrder ?? 0) ||
      (left?.name ?? a).localeCompare(right?.name ?? b, "vi") || a.localeCompare(b);
  });
}
