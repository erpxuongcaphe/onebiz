import type { Customer } from "@/lib/types/customers";
import { getClient, handleError } from "./base";
import {isRpcUnavailable} from './rpc-utils';

export type RetailCustomerContact = Omit<Customer,
  "currentDebt" | "totalSales" | "totalSalesMinusReturns" | "createdAt" | "lastPurchaseAt">;

export interface RetailContactRequest {
  branchId: string;
  search?: string;
  customerId?: string;
  internal?: boolean;
  limit?: number;
  signal?: AbortSignal;
}

type Row = Record<string, unknown>;
function invalid(): never { throw new Error("Hồ sơ khách bán hàng chưa hợp lệ."); }
function record(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid();
  return value as Row;
}
function text(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") return invalid();
  return value;
}
function required(value: unknown): string {
  const result = text(value);
  return result?.trim() ? result : invalid();
}
function numeric(value: unknown, maximum = Infinity): number | undefined {
  if (value === null || value === undefined) return undefined;
  if ((typeof value !== "number" && typeof value !== "string") || value === ""
    || typeof value === "string" && !value.trim()) return invalid();
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 && result <= maximum ? result : invalid();
}
function flag(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  return typeof value === "boolean" ? value : invalid();
}
function relation(value: unknown): { name?: string; discount?: number } {
  if (value === null || value === undefined) return {};
  const row = record(value);
  return { name: text(row.name), discount: numeric(row.discount_percent, 100) };
}

export function parseRetailCustomerContacts(value: unknown, request: RetailContactRequest): RetailCustomerContact[] {
  const limit = request.limit ?? 10;
  if (!Array.isArray(value) || value.length > limit) return invalid();
  const seen = new Set<string>();
  return value.map(value => {
    const row = record(value);
    if (["current_debt", "total_spent", "total_orders", "total_sales", "last_purchase_at",
      "currentDebt", "totalSales", "totalSalesMinusReturns"].some(key => key in row)) return invalid();
    const id = required(row.id);
    const internal = flag(row.is_internal);
    const branchId = text(row.branch_id);
    if (seen.has(id) || (request.customerId && id !== request.customerId)
      || internal !== (request.internal ?? false) || internal && branchId === request.branchId) return invalid();
    seen.add(id);
    const group = relation(row.customer_groups);
    const tier = relation(row.loyalty_tiers);
    const customerType = row.customer_type ?? "individual";
    if (customerType !== "individual" && customerType !== "company") return invalid();
    return {
      id, code: required(row.code), name: required(row.name), phone: text(row.phone) ?? "",
      email: text(row.email), address: text(row.address), houseNumber: text(row.house_number), street: text(row.street),
      quarter: text(row.quarter), ward: text(row.ward), province: text(row.province), country: text(row.country),
      taxCode: text(row.tax_code), type: customerType, isInternal: internal, isWalkIn: flag(row.is_walk_in), branchId,
      groupId: text(row.group_id), groupName: group.name, groupDiscountPercent: group.discount,
      priceTierId: text(row.price_tier_id), loyaltyPoints: numeric(row.loyalty_points),
      loyaltyTierId: text(row.loyalty_tier_id), loyaltyTierName: tier.name, loyaltyTierDiscount: tier.discount,
    };
  });
}

export async function getRetailCustomerContacts(request: RetailContactRequest): Promise<RetailCustomerContact[]> {
  request.signal?.throwIfAborted();
  const limit = request.limit ?? 10;
  const search = request.search?.trim() || null;
  if (!request.branchId.trim() || request.branchId === "all" || request.branchId !== request.branchId.trim()
    || !Number.isSafeInteger(limit) || limit < 1 || limit > 50 || (search?.length ?? 0) > 128
    || request.customerId !== undefined && !request.customerId.trim()) {
    throw new Error("Phạm vi tìm khách chưa hợp lệ.");
  }
  const params={
    p_branch_id: request.branchId, p_search: search, p_customer_id: request.customerId ?? null,
    p_internal: request.internal ?? false, p_limit: limit,
  };
  const query = getClient().rpc("get_pos_retail_customer_contacts_identity" as never,params as never);
  let { data, error } = await (request.signal ? query.abortSignal(request.signal) : query);
  if(error&&isRpcUnavailable(error)){
    const legacy=getClient().rpc('get_pos_customer_contacts_scoped' as never,params as never);
    ({data,error}=await(request.signal?legacy.abortSignal(request.signal):legacy));
  }
  request.signal?.throwIfAborted();
  if (error) handleError(error, "getRetailCustomerContacts");
  return parseRetailCustomerContacts(data, request);
}

export async function getRetailCustomerContactById(request: Omit<RetailContactRequest, "search" | "limit"> & { customerId: string }) {
  const rows = await getRetailCustomerContacts({ ...request, limit: 1 });
  return rows[0] ?? null;
}

export async function resolveRetailCustomerContact(customerId: string, branchId: string) {
  const request = { customerId, branchId };
  return await getRetailCustomerContactById(request)
    ?? await getRetailCustomerContactById({ ...request, internal: true });
}
