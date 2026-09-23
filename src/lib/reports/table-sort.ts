const vietnameseCollator = new Intl.Collator("vi", {
  numeric: true,
  sensitivity: "base",
});

function compareValues(left: unknown, right: unknown): number {
  const leftEmpty = left === null || left === undefined || left === "";
  const rightEmpty = right === null || right === undefined || right === "";
  if (leftEmpty || rightEmpty) return Number(leftEmpty) - Number(rightEmpty);
  if (typeof left === "number" && typeof right === "number") return left - right;
  return vietnameseCollator.compare(String(left), String(right));
}

export function sortReportRows<T>(
  rows: T[],
  value: (row: T) => unknown,
  direction: "asc" | "desc",
): T[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const left = value(a.row);
      const right = value(b.row);
      const empty = left === null || left === undefined || left === "" || right === null || right === undefined || right === "";
      const result = compareValues(left, right);
      return (empty ? result : direction === "asc" ? result : -result) || a.index - b.index;
    })
    .map(({ row }) => row);
}
