import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), tenant: vi.fn(), calls: [] as unknown[][],
  response: { data: [] as Record<string, unknown>[], count: 0, error: null as null | { message: string } } }));
vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => state,
  getCurrentTenantId: state.tenant,
  handleError: (error: { message: string }) => { throw new Error(error.message); },
}));
import { getCustomerContacts, getSupplierContacts } from "@/lib/services/supabase/counterparty-contacts";

beforeEach(() => {
  vi.clearAllMocks(); state.calls = []; state.tenant.mockResolvedValue("tenant-a");
  state.response = { data: [{ id: "a", code: "CONTACT-001", name: "Contact A", phone: "0900000000", email: null }], count: 1, error: null };
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "or", "order", "range", "abortSignal"]) {
    query[method] = (...args: unknown[]) => { state.calls.push([method, ...args]); return query; };
  }
  query.then = (resolve: (value: typeof state.response) => unknown) => Promise.resolve(state.response).then(resolve);
  state.from.mockReturnValue(query);
});

it.each([["customer", getCustomerContacts, "customers"], ["supplier", getSupplierContacts, "suppliers"]] as const)("loads the %s contact directory with stable pagination", async (_, read, table) => {
  const result = await read({ page: 2, pageSize: 5, search: "  Contact  ", sortBy: "name", sortOrder: "asc" });
  expect(result).toEqual({ data: state.response.data, total: 1 });
  expect(state.from).toHaveBeenCalledExactlyOnceWith(table);
  expect(state.calls).toContainEqual(["select", "id,code,name,phone,email", { count: "exact" }]);
  expect(state.calls).toContainEqual(["eq", "tenant_id", "tenant-a"]);
  expect(state.calls).toContainEqual(["or", "is_internal.is.null,is_internal.eq.false"]);
  expect(state.calls).toContainEqual(["or", "name.ilike.%Contact%,code.ilike.%Contact%,phone.ilike.%Contact%"]);
  expect(state.calls).toContainEqual(["order", "name", { ascending: true }]);
  expect(state.calls).toContainEqual(["order", "id", { ascending: true }]);
  expect(state.calls).toContainEqual(["range", 10, 14]);
  expect(state.rpc).not.toHaveBeenCalled();
});

it("bounds page size and escapes literal wildcard characters", async () => {
  await getSupplierContacts({ page: -1, pageSize: 900, search: "10%_" });
  expect(state.calls).toContainEqual(["range", 0, 499]);
  expect(state.calls).toContainEqual(["or", "name.ilike.%10\\%\\_%,code.ilike.%10\\%\\_%,phone.ilike.%10\\%\\_%"]);
});

it("returns only the contact contract even when a response includes extra fields", async () => {
  state.response.data[0].extra = "unused";
  const result = await getCustomerContacts({ page: 0, pageSize: 5 });
  expect(Object.keys(result.data[0])).toEqual(["id", "code", "name", "phone", "email"]);
});

it("reports a failed read instead of retrying a different source", async () => {
  state.response.error = { message: "Contact read failed" };
  await expect(getCustomerContacts({ page: 0, pageSize: 5 })).rejects.toThrow("Contact read failed");
  expect(state.from).toHaveBeenCalledTimes(1);
});

it("does not query for a cancelled request", async () => {
  const controller = new AbortController(); controller.abort();
  await expect(getSupplierContacts({ page: 0, pageSize: 5, signal: controller.signal })).rejects.toThrow();
  expect(state.from).not.toHaveBeenCalled();
});

it("passes cancellation to the source", async () => {
  const controller = new AbortController();
  await getCustomerContacts({ page: 0, pageSize: 5, signal: controller.signal });
  expect(state.calls).toContainEqual(["abortSignal", controller.signal]);
});
