import type { FnbInvoiceContext } from "@/lib/utils/fnb-invoice-context";

export type PartyHistoryKind = "document" | "return" | "loyalty";
export interface PartyHistoryRow extends FnbInvoiceContext {
  id: string; branchId: string | null; kind: PartyHistoryKind;
  code: string; date: string; status: string; totalAmount: number | null;
  paid: number | null; debt: number | null; source: string | null; invoiceCode: string;
  points: number | null; balanceAfter: number | null; loyaltyType: string | null;
  note: string | null;
}
export interface PartyHistoryPage {
  partyId: string; mode: "customer" | "supplier"; branchId: string | null;
  canViewDebt: boolean; revision: string; total: number; rows: PartyHistoryRow[];
}
export type PartyHistoryDocument = Omit<PartyHistoryRow, "totalAmount"> & { totalAmount: number; total: number; amountOwed: number | null };
export type PartyHistoryReturn = Omit<PartyHistoryRow, "totalAmount"> & { totalAmount: number };
export function partyHistoryModel(page: PartyHistoryPage | null) {
  return {
    documents: (page?.rows ?? []).filter(row => row.kind === "document").map((row): PartyHistoryDocument => ({
      ...row, status: page?.mode === "customer" && ["draft", "confirmed"].includes(row.status) ? "processing" : row.status,
      totalAmount: row.totalAmount!, total: row.totalAmount!, amountOwed: row.debt,
    })),
    returns: (page?.rows ?? []).filter(row => row.kind === "return").map((row): PartyHistoryReturn => ({ ...row, totalAmount: row.totalAmount! })),
    loyalty: (page?.rows ?? []).filter(row => row.kind === "loyalty").map(row => ({
      id: row.id, type: row.loyaltyType!, points: row.points!, balanceAfter: row.balanceAfter, note: row.note, createdAt: row.date,
    })),
  };
}
type ObjectRow = Record<string, unknown>;
const invalid = () => new Error("Lịch sử chưa đầy đủ hoặc đã thay đổi. Vui lòng tải lại.");
function object(value: unknown): ObjectRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid();
  return value as ObjectRow;
}
function text(value: unknown): string { if (typeof value !== "string") throw invalid(); return value; }
function nullableText(value: unknown): string | null { return value === null ? null : text(value); }
function number(value: unknown): number { if (typeof value !== "number" || !Number.isFinite(value)) throw invalid(); return value; }
function nullableNumber(value: unknown): number | null { return value === null ? null : number(value); }
const rowKeys = new Set(["id", "branchId", "kind", "code", "date", "status", "totalAmount", "paid", "debt",
  "source", "invoiceCode", "points", "balanceAfter", "loyaltyType", "note", "tableName", "tableNumber", "areaName", "openedAt", "paidAt", "posNote"]);
export function parsePartyHistoryPage(value: unknown, request: {
  partyId: string; mode: "customer" | "supplier"; branchId: string | null; offset: number; limit: number;
}): PartyHistoryPage {
  const page = object(value);
  if (page.partyId !== request.partyId || page.mode !== request.mode || page.branchId !== request.branchId
    || typeof page.canViewDebt !== "boolean" || typeof page.revision !== "string" || !/^[a-f0-9]{32}$/.test(page.revision)
    || !Number.isSafeInteger(page.total) || Number(page.total) < 0 || !Array.isArray(page.rows)
    || page.rows.length !== Math.min(request.limit, Math.max(0, Number(page.total) - request.offset))) throw invalid();
  const seen = new Set<string>();
  const rows = page.rows.map((value): PartyHistoryRow => {
    const row = object(value);
    if (Object.keys(row).some(key => !rowKeys.has(key))) throw invalid();
    const id = text(row.id), kind = text(row.kind);
    if (!id || !["document", "return", "loyalty"].includes(kind) || seen.has(`${kind}:${id}`)) throw invalid();
    seen.add(`${kind}:${id}`);
    const branchId = nullableText(row.branchId), date = text(row.date);
    if (!Number.isFinite(Date.parse(date)) || request.branchId !== null && branchId !== request.branchId
      || kind !== "loyalty" && !branchId || request.mode === "supplier" && kind === "loyalty") throw invalid();
    const totalAmount = nullableNumber(row.totalAmount), paid = nullableNumber(row.paid), debt = nullableNumber(row.debt);
    if (kind !== "loyalty" && totalAmount === null || !page.canViewDebt && (paid !== null || debt !== null)
      || kind === "document" && page.canViewDebt && (paid === null || debt === null)
      || kind !== "document" && (paid !== null || debt !== null)) throw invalid();
    const result: PartyHistoryRow = { id, branchId, kind: kind as PartyHistoryKind, date,
      code: text(row.code), status: text(row.status), totalAmount, paid, debt,
      source: nullableText(row.source), invoiceCode: text(row.invoiceCode), points: nullableNumber(row.points),
      balanceAfter: nullableNumber(row.balanceAfter), loyaltyType: nullableText(row.loyaltyType), note: nullableText(row.note) };
    for (const key of ["tableName", "tableNumber", "areaName", "openedAt", "paidAt", "posNote"] as const) {
      const value = nullableText(row[key]);
      if (value !== null) {
        if ((key === "openedAt" || key === "paidAt") && !Number.isFinite(Date.parse(value))) throw invalid();
        result[key] = value;
      }
    }
    if (kind === "loyalty" && (result.points === null || !Number.isSafeInteger(result.points)
      || !["earn", "redeem", "adjust", "expire"].includes(result.loyaltyType ?? "") || totalAmount !== null)) throw invalid();
    return result;
  });
  return { partyId: request.partyId, mode: request.mode, branchId: request.branchId,
    canViewDebt: page.canViewDebt, revision: page.revision, total: Number(page.total), rows };
}

export async function readPartyHistoryPages(
  request: { partyId: string; mode: "customer" | "supplier"; branchId: string | null },
  read: (offset: number, limit: number) => Promise<unknown>, signal?: AbortSignal,
): Promise<PartyHistoryPage> {
  let first: PartyHistoryPage | null = null;
  const rows: PartyHistoryRow[] = [], seen = new Set<string>();
  for (let offset = 0; ; offset += 200) {
    signal?.throwIfAborted();
    const page = parsePartyHistoryPage(await read(offset, 200), { ...request, offset, limit: 200 });
    signal?.throwIfAborted();
    if (first && (first.revision !== page.revision || first.total !== page.total || first.canViewDebt !== page.canViewDebt)) throw invalid();
    first ??= page;
    for (const row of page.rows) {
      const key = `${row.kind}:${row.id}`;
      if (seen.has(key)) throw invalid();
      seen.add(key); rows.push(row);
    }
    if (rows.length >= page.total) return { ...first, rows };
  }
}
