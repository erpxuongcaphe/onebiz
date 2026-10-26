import { normalizeSearch, rankSearchMatch, type SearchMatchKind } from './smart-search';

const priority: Record<SearchMatchKind, number> = { identifier: 0, name: 1, partial: 2, near: 3 };

/** Rank suggestions only; callers retain IDs and require an explicit selection. */
export function searchOptions<T>(items: readonly T[], query: string,
  fields: (item: T) => { name: string; identifiers?: readonly string[] },
): { item: T; approximate: boolean }[] {
  if (!query.trim()) return items.map(item => ({ item, approximate: false }));
  if (!normalizeSearch(query)) return [];
  return items.flatMap((item, index) => {
    const { name, identifiers = [] } = fields(item);
    const match = rankSearchMatch(name, identifiers, query);
    return match ? [{ item, approximate: match === 'near', rank: priority[match], index }] : [];
  }).sort((a, b) => a.rank - b.rank || a.index - b.index);
}
