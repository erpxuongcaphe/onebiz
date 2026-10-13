export type TableColumnAlignment = "left" | "center" | "right";

/** Explicit alignment wins, including for empty tables and formatted cells.
 * Infer only from source numbers, never from display strings (codes/dates).
 * Numeric identifiers remain text columns unless explicitly overridden.
 */
export function resolveTableColumnAlignment(
  explicit: TableColumnAlignment | undefined,
  key: string,
  values: readonly unknown[],
): TableColumnAlignment {
  if (explicit) return explicit;
  const tokens = key.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
  if (/(^|[_.])(id|code|barcode|phone|mobile|tel|postal|zip)([_.]|$)/.test(tokens)) return "left";
  const present = values.filter(value => value !== null && value !== undefined);
  return present.length > 0 && present.every(value => typeof value === "number" && Number.isFinite(value))
    ? "right"
    : "left";
}

export function tableColumnAlignmentClass(alignment: TableColumnAlignment): string {
  return alignment === "right" ? "text-right tabular-nums" : alignment === "center" ? "text-center" : "text-left";
}
