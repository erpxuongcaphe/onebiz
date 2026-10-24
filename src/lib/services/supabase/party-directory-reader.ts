import type { Customer } from "@/lib/types/customers";
export type PartyDirectoryKind = "customer" | "supplier";
export interface PartyDirectoryScope {
  scope: "company" | "assigned" | "branch";
  branchIds: string[];
}
export interface PartyDirectoryContact extends Omit<Customer, "currentDebt" | "totalSales" | "totalSalesMinusReturns"> {
  id: string;
  code: string;
  name: string;
  phone: string;
  activity: number | null;
  debt: number | null;
  returns: number | null;
  orders: number | null;
  lastPurchaseAt: string | null;
  note?: string;
  isActive?: boolean;
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
function optionalText(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : text(value);
}
function optionalNumber(value: unknown): number | undefined {
  return value === null || value === undefined ? undefined : numeric(value);
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
    if (row.is_active != null && typeof row.is_active !== "boolean") throw new Error("PARTY_DIRECTORY_CONTACT_INCOMPLETE");
    if (lastPurchaseAt !== null && (!canViewActivity || typeof lastPurchaseAt !== "string"
      || !Number.isFinite(Date.parse(lastPurchaseAt)))) throw new Error("PARTY_DIRECTORY_DATE_INVALID");
    return {
      id, code: text(row.code), name: identifier(row.name), phone: text(row.phone),
      email: optionalText(row.email), address: optionalText(row.address),
      houseNumber: optionalText(row.house_number), street: optionalText(row.street),
      quarter: optionalText(row.quarter), ward: optionalText(row.ward), province: optionalText(row.province),
      country: optionalText(row.country), taxCode: optionalText(row.tax_code), note: optionalText(row.note),
      createdAt: optionalText(row.created_at) ?? "",
      isActive: typeof row.is_active === "boolean" ? row.is_active : undefined,
      type: row.customer_type === "company" ? "company" : "individual",
      gender: row.gender === "male" || row.gender === "female" ? row.gender : undefined,
      isInternal: row.is_internal === true, isWalkIn: row.is_walk_in === true,
      branchId: optionalText(row.branch_id), groupId: optionalText(row.group_id),
      groupName: row.customer_groups == null ? undefined : optionalText(record(row.customer_groups).name),
      groupDiscountPercent: row.customer_groups == null ? undefined : optionalNumber(record(row.customer_groups).discount_percent),
      priceTierId: optionalText(row.price_tier_id), loyaltyPoints: optionalNumber(row.loyalty_points),
      loyaltyTierId: optionalText(row.loyalty_tier_id),
      loyaltyTierName: row.loyalty_tiers == null ? undefined : optionalText(record(row.loyalty_tiers).name),
      loyaltyTierDiscount: row.loyalty_tiers == null ? undefined : optionalNumber(record(row.loyalty_tiers).discount_percent),
      birthday: optionalText(row.birthday),
      tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === "string") : [],
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
