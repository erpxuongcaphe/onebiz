function localDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function parseDateKey(value: string): Date | null {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return localDateKey(date) === value ? date : null;
}

export function dayKeysForRange(
  dateRange: { from: string; to: string } | undefined,
  fallbackDays: number = 30,
): string[] {
  if (!dateRange) {
    const now = new Date();
    return Array.from({ length: fallbackDays }, (_, index) => {
      const date = new Date(now);
      date.setDate(now.getDate() - (fallbackDays - index - 1));
      return localDateKey(date);
    });
  }

  const cursor = parseDateKey(dateRange.from);
  const end = parseDateKey(dateRange.to);
  if (!cursor || !end || cursor > end) return [];

  const keys: string[] = [];
  while (cursor <= end) {
    keys.push(localDateKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
}
