export type PartyDirectoryKind = "customer" | "supplier";
export interface PartyDirectoryScope {
  scope: "company" | "assigned" | "branch";
  branchIds: string[];
}
export interface PartyDirectoryContact {
  id: string;
  code: string;
  name: string;
  phone: string;
  activity: number | null;
  debt: number | null;
  returns: number | null;
  orders: number | null;
  lastPurchaseAt: string | null;
}
export interface PartyDirectoryPage {
  revision: string;
  scope: PartyDirectoryScope;
  contacts: PartyDirectoryContact[];
  total: number;
  canViewActivity: boolean;
  canViewDebt: boolean;
  activity: number | null;
  debt: number | null;
  returns: number | null;
  netSales: number | null;
  partiesWithDebt: number | null;
}

type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("PARTY_DIRECTORY_INVALID");
  return value as RecordValue;
}
function identifier(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("PARTY_DIRECTORY_ID_REQUIRED");
  return value;
}
function numeric(value: unknown, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value)
    || (integer && (!Number.isSafeInteger(value) || value < 0))) throw new Error("PARTY_DIRECTORY_NUMBER_INVALID");
  return value;
}
function amount(value: unknown, allowed: boolean, integer = false): number | null {
  if (allowed) return numeric(value, integer);
  if (value !== null) throw new Error("PARTY_DIRECTORY_UNEXPECTED_DISCLOSURE");
  return null;
}
function text(value: unknown): string {
  if (value === null) return "";
  if (typeof value !== "string") throw new Error("PARTY_DIRECTORY_CONTACT_INCOMPLETE");
  return value;
}

// Masked amounts remain null; they must never become a zero balance in UI or Excel.
export function parsePartyDirectoryPage(
  kind: PartyDirectoryKind,
  value: unknown,
  request: { branchId: string | null; page: number; pageSize: number },
): PartyDirectoryPage {
  if (!Number.isSafeInteger(request.page) || request.page < 0
    || !Number.isSafeInteger(request.pageSize) || request.pageSize < 1 || request.pageSize > 200) {
    throw new Error("PARTY_DIRECTORY_PAGE_INVALID");
  }
  const payload = record(value);
  if (typeof payload.revision !== "string" || !/^[a-f0-9]{32}$/.test(payload.revision)) {
    throw new Error("PARTY_DIRECTORY_REVISION_REQUIRED");
  }
  const summary = record(payload.summary);
  const rawScope = record(summary.scope);
  if (typeof summary.canViewActivity !== "boolean" || typeof summary.canViewDebt !== "boolean"
    || !["company", "assigned", "branch"].includes(String(rawScope.scope)) || !Array.isArray(rawScope.branchIds)) {
    throw new Error("PARTY_DIRECTORY_SCOPE_INVALID");
  }
  const branchIds = rawScope.branchIds.map(identifier);
  if (new Set(branchIds).size !== branchIds.length
    || (rawScope.scope === "branch" && branchIds.length !== 1)
    || (request.branchId !== null && (rawScope.scope !== "branch" || branchIds[0] !== request.branchId))
    || (request.branchId === null && rawScope.scope === "branch")
    || (!branchIds.length && (summary.canViewActivity || summary.canViewDebt))) {
    throw new Error("PARTY_DIRECTORY_SCOPE_MISMATCH");
  }
  const total = numeric(payload.total, true);
  const offset = request.page * request.pageSize;
  if (!Number.isSafeInteger(offset) || !Array.isArray(payload.items)
    || payload.items.length !== Math.min(request.pageSize, Math.max(0, total - offset))) {
    throw new Error("PARTY_DIRECTORY_PAGE_INCOMPLETE");
  }
  const canViewActivity = summary.canViewActivity;
  const canViewDebt = summary.canViewDebt;
  const customer = kind === "customer";
  const ids = new Set<string>();
  const contacts = payload.items.map<PartyDirectoryContact>(value => {
    const row = record(value);
    const id = identifier(row.id);
    if (ids.has(id)) throw new Error("PARTY_DIRECTORY_DUPLICATE_CONTACT");
    ids.add(id);
    const lastPurchaseAt = customer ? row.last_purchase_at : null;
    if (lastPurchaseAt !== null && (!canViewActivity || typeof lastPurchaseAt !== "string"
      || !Number.isFinite(Date.parse(lastPurchaseAt)))) throw new Error("PARTY_DIRECTORY_DATE_INVALID");
    return {
      id, code: text(row.code), name: identifier(row.name), phone: text(row.phone),
      activity: amount(row[customer ? "total_spent" : "total_purchases"], canViewActivity),
      debt: amount(row.debt, canViewDebt),
      returns: customer ? amount(row.returned_total, canViewActivity) : null,
      orders: customer ? amount(row.total_orders, canViewActivity, true) : null,
      lastPurchaseAt,
    };
  });
  const activity = amount(summary[customer ? "totalSales" : "totalPurchases"], canViewActivity);
  const returns = customer ? amount(summary.totalReturns, canViewActivity) : null;
  const netSales = customer ? amount(summary.netSales, canViewActivity) : null;
  if (activity !== null && returns !== null && netSales !== null && Math.abs(activity - returns - netSales) > 0.01) {
    throw new Error("PARTY_DIRECTORY_SALES_MISMATCH");
  }
  const partiesWithDebt = amount(summary[customer ? "customersWithDebt" : "suppliersWithDebt"], canViewDebt, true);
  if (partiesWithDebt !== null && partiesWithDebt > total) throw new Error("PARTY_DIRECTORY_DEBT_COUNT_INVALID");
  return {
    revision: payload.revision,
    scope: { scope: rawScope.scope as PartyDirectoryScope["scope"], branchIds }, contacts, total,
    canViewActivity, canViewDebt, activity, returns, netSales, partiesWithDebt,
    debt: amount(summary.totalDebt, canViewDebt),
  };
}

export function partyDirectoryExportRows(page: PartyDirectoryPage): Record<string, string | number | null>[] {
  return page.contacts.map(contact => ({
    code: contact.code, name: contact.name, phone: contact.phone,
    ...(page.canViewActivity ? { activity: contact.activity } : {}),
    ...(page.canViewDebt ? { debt: contact.debt } : {}),
  }));
}

export async function readPartyDirectoryPages(
  kind: PartyDirectoryKind,
  branchId: string | null,
  read: (request: { branchId: string | null; page: number; pageSize: number }) => Promise<unknown>,
  signal?: AbortSignal,
): Promise<PartyDirectoryPage> {
  const pageSize = 200;
  let result: PartyDirectoryPage | null = null;
  let signature: string | null = null;
  const ids = new Set<string>();
  for (let page = 0; ; page++) {
    signal?.throwIfAborted();
    const request = { branchId, page, pageSize };
    const next = parsePartyDirectoryPage(kind, await read(request), request);
    signal?.throwIfAborted();
    // A changed authorized dataset must restart the export, not mix pages.
    const nextSignature = JSON.stringify({
      revision: next.revision,
      total: next.total, scope: next.scope.scope, branches: [...next.scope.branchIds].sort(),
      canViewActivity: next.canViewActivity, canViewDebt: next.canViewDebt,
      activity: next.activity, debt: next.debt, returns: next.returns,
      netSales: next.netSales, partiesWithDebt: next.partiesWithDebt,
    });
    if (signature !== null && signature !== nextSignature) throw new Error("PARTY_DIRECTORY_CHANGED_DURING_READ");
    signature = nextSignature;
    for (const contact of next.contacts) {
      if (ids.has(contact.id)) throw new Error("PARTY_DIRECTORY_DUPLICATE_CONTACT");
      ids.add(contact.id);
    }
    if (result === null) result = { ...next, contacts: [] };
    result.contacts.push(...next.contacts);
    if (result.contacts.length === next.total) return result;
  }
}
