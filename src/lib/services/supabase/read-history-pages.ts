/** Read every permitted row; never mistake a server row limit for complete history. */
export async function readHistoryPages<T extends { id: string }>(
  fetchPage: (offset: number, size: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  limit: number | null = null,
): Promise<T[]> {
  if (limit !== null && (!Number.isSafeInteger(limit) || limit < 1)) throw new Error("Giới hạn lịch sử không hợp lệ.");
  const rows: T[] = [];
  const ids = new Set<string>();
  while (limit === null || rows.length < limit) {
    const size = Math.min(200, limit === null ? 200 : limit - rows.length);
    const result = await fetchPage(rows.length, size);
    if (result.error) throw new Error(result.error.message);
    const batch = result.data ?? [];
    if (batch.length > size) throw new Error("Nguồn lịch sử trả vượt số dòng yêu cầu.");
    for (const row of batch) {
      if (!row.id || ids.has(row.id)) throw new Error("Lịch sử thay đổi trong lúc tải. Vui lòng tải lại.");
      ids.add(row.id);
      rows.push(row);
    }
    if (batch.length < size) return rows;
  }
  return rows;
}
