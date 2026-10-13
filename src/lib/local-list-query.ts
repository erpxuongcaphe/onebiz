export function normalizeListSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLocaleLowerCase("vi").trim();
}

/** Filter before sorting/paging. Copy the array: presentation must never reorder source data. */
export function queryLocalList<T>(rows: T[], options: {
  search: string; searchText: (row: T) => string; matches: (row: T) => boolean;
  sortValue?: (row: T) => string | number; direction: "asc" | "desc";
}): T[] {
  const terms = normalizeListSearch(options.search).split(/\s+/).filter(Boolean);
  const result = rows.filter(row => options.matches(row) && terms.every(term => normalizeListSearch(options.searchText(row)).includes(term)));
  const sortValue = options.sortValue;
  if (!sortValue) return result;
  return result.sort((a, b) => {
    const left = sortValue(a), right = sortValue(b);
    const comparison = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right), "vi", { numeric: true, sensitivity: "base" });
    return options.direction === "asc" ? comparison : -comparison;
  });
}
