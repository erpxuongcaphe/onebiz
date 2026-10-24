import type { Customer } from "@/lib/types/customers";
import type { Supplier } from "@/lib/types/suppliers";
import type { PartyDirectoryPage, PartyDirectoryScope } from "./party-directory-reader";

export function directoryScopeLabel(scope: PartyDirectoryScope): string {
  if (scope.scope === "company") return "Toàn công ty";
  if (scope.scope === "branch") return "Chi nhánh đang chọn";
  return scope.branchIds.length ? `${scope.branchIds.length} chi nhánh được giao` : "Liên hệ dùng chung";
}

export type DirectoryCustomer = Omit<Customer, "currentDebt" | "totalSales" | "totalSalesMinusReturns"> & {
  currentDebt: number | null; totalSales: number | null; totalSalesMinusReturns: number | null;
  isActive?: boolean;
};
export type DirectorySupplier = Omit<Supplier, "currentDebt" | "totalPurchases"> & {
  currentDebt: number | null; totalPurchases: number | null;
  isActive?: boolean;
};
function omitFields<T extends object, K extends keyof T>(value: T, keys: K[]): Omit<T, K> {
  const result = { ...value };
  for (const key of keys) Reflect.deleteProperty(result, key);
  return result;
}

export function customerDirectoryModel(page: PartyDirectoryPage) {
  const data: DirectoryCustomer[] = page.contacts.map(contact => ({
    ...omitFields(contact, ["activity", "debt", "returns", "orders", "note"]), currentDebt: contact.debt, totalSales: contact.activity,
    totalSalesMinusReturns: contact.activity === null || contact.returns === null ? null : contact.activity - contact.returns,
  }));
  return { ...page, data, summary: { totalSales: page.activity, totalReturns: page.returns, netSales: page.netSales,
    totalDebt: page.debt, customersWithDebt: page.partiesWithDebt } };
}
export function supplierDirectoryModel(page: PartyDirectoryPage) {
  const data: DirectorySupplier[] = page.contacts.map(contact => ({
    id: contact.id, code: contact.code, name: contact.name, phone: contact.phone,
    email: contact.email, address: contact.address, houseNumber: contact.houseNumber,
    street: contact.street, quarter: contact.quarter, ward: contact.ward, province: contact.province,
    country: contact.country, taxCode: contact.taxCode, note: contact.note,
    createdAt: contact.createdAt, isInternal: contact.isInternal, branchId: contact.branchId, isActive: contact.isActive,
    currentDebt: contact.debt, totalPurchases: contact.activity,
  }));
  return { ...page, data, summary: { totalPurchases: page.activity, totalDebt: page.debt, suppliersWithDebt: page.partiesWithDebt } };
}
export function customerEditProfile(customer: DirectoryCustomer): Omit<DirectoryCustomer, "currentDebt" | "totalSales" | "totalSalesMinusReturns"> {
  return omitFields(customer, ["currentDebt", "totalSales", "totalSalesMinusReturns"]);
}
export function supplierEditProfile(supplier: DirectorySupplier): Omit<DirectorySupplier, "currentDebt" | "totalPurchases"> {
  return omitFields(supplier, ["currentDebt", "totalPurchases"]);
}
