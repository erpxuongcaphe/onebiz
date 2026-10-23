import { categories } from "./contracts";

type CriterionLabel = { code?: string; title: string };

export function criterionSourceNumber(code?: string): number | null {
  const match = code?.match(/^WS-(?:[a-f0-9]{32}-)?(\d+)$/i);
  return match ? Number(match[1]) : null;
}

export function criterionTitle(item: CriterionLabel): string {
  const number = criterionSourceNumber(item.code);
  return number === null ? item.title : `${number}. ${item.title}`;
}

export function compareCriteriaBySource(a: CriterionLabel, b: CriterionLabel): number {
  const left = criterionSourceNumber(a.code);
  const right = criterionSourceNumber(b.code);
  if (left !== null && right !== null && left !== right) return left - right;
  if (left !== null && right === null) return -1;
  if (left === null && right !== null) return 1;
  return (a.code ?? a.title).localeCompare(b.code ?? b.title, "vi", { numeric: true });
}

export function criterionGroup(
  item: { category?: string; group_title?: string | null },
  groups: { id: string; title: string }[],
): string {
  return item.group_title?.trim()
    || groups.find(group => `group:${group.id}` === item.category)?.title
    || categories[item.category as keyof typeof categories]
    || "Chưa phân nhóm";
}
