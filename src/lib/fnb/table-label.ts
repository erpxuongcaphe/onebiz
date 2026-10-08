type TableIdentity = { name?: string | null; tableNumber?: string | number };

/** Names are the customer-facing identity; the numeric key remains unchanged. */
export function getTableLabel(table: TableIdentity): string {
  return table.name?.trim() || `Bàn ${table.tableNumber ?? ""}`.trim();
}

export function getCompactTableLabel(table: TableIdentity): string {
  const label = getTableLabel(table);
  return label === `Bàn ${table.tableNumber}` || label === `Ban ${table.tableNumber}`
    ? String(table.tableNumber)
    : label;
}

export function suggestZonePrefix(zoneName: string): string {
  return zoneName.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/gi, "D").trim().split(/\s+/).map(word => word[0] ?? "").join("").toUpperCase().slice(0, 8);
}

export function composeTableCode(prefix: string, ordinal: string): string {
  const normalizedPrefix = prefix.trim().toUpperCase();
  const number = Number(ordinal);
  if (!/^[A-Z][A-Z0-9_-]{0,7}$/.test(normalizedPrefix) || !/^\d+$/.test(ordinal) || number < 1 || number > 9999) return "";
  return `${normalizedPrefix} ${String(number).padStart(2, "0")}`;
}
