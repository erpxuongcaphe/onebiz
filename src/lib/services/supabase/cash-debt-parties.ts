import { getScopedCustomerDirectoryV2, getScopedSupplierDirectoryV2 } from "./party-directory-workspace";

export interface CashDebtParty { id: string; code: string; name: string; debt: number }
export class CashDebtReadError extends Error {}

export async function getCashDebtParties(mode: "customer" | "supplier", branchId: string, signal?: AbortSignal): Promise<CashDebtParty[]> {
  if (!branchId.trim()) throw new CashDebtReadError("Chọn một chi nhánh cụ thể trước khi lập phiếu.");
  signal?.throwIfAborted();
  const params = { page: 0, pageSize: 200, branchId, sortBy: "name", sortDesc: false };
  const options = { allPages: true, signal };
  const page = mode === "customer"
    ? await getScopedCustomerDirectoryV2({ ...params, debtFilter: "has_debt" }, options)
    : await getScopedSupplierDirectoryV2({ ...params, debtFrom: "0" }, options);
  signal?.throwIfAborted();
  if (!page.canViewDebt) throw new CashDebtReadError(mode === "customer" ? "Chưa được cấp quyền xem công nợ khách hàng." : "Chưa được cấp quyền xem công nợ nhà cung cấp.");
  return page.contacts.flatMap(p => !p.isInternal && p.debt !== null && p.debt > 0
    ? [{ id: p.id, code: p.code, name: p.name, debt: p.debt }] : []);
}
