import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ from: vi.fn(), tenant: vi.fn(), calls: [] as unknown[][], response: { data: [] as Record<string, unknown>[], error: null as null | { message: string } } }));
vi.mock("@/lib/services/supabase/base", () => ({ getClient: () => m, getCurrentTenantId: m.tenant, handleError: (e: { message: string }) => { throw new Error(e.message); } }));
import { getReceiverContacts } from "@/lib/services/supabase/receiver-contacts";
beforeEach(() => {
  vi.clearAllMocks(); m.calls = []; m.tenant.mockResolvedValue("tenant-test");
  m.response = { data: [{ id: "contact-test", code: "TEST-001", name: "Synthetic recipient", phone: "0000000000", address: "Test street", ward: "Test ward", province: "Test province", unused: 123 }], error: null };
  const q: Record<string, unknown> = {};
  for (const method of ["select", "eq", "or", "order", "range", "returns", "abortSignal"]) q[method] = (...args: unknown[]) => { m.calls.push([method, ...args]); return q; };
  q.then = (resolve: (v: typeof m.response) => unknown) => Promise.resolve(m.response).then(resolve);
  m.from.mockReturnValue(q);
});
it("reads an explicit recipient projection and retains all address fields", async () => {
  const result = await getReceiverContacts(" recipient ");
  expect(m.calls).toContainEqual(["select", "id,code,name,phone,address,ward,province"]);
  expect(m.calls).toContainEqual(["eq", "tenant_id", "tenant-test"]);
  expect(m.calls).toContainEqual(["or", "is_internal.is.null,is_internal.eq.false"]);
  expect(m.calls).toContainEqual(["range", 0, 7]);
  expect(m.calls).toContainEqual(["order", "id", { ascending: true }]);
  expect(result[0]).toEqual({ id: "contact-test", code: "TEST-001", name: "Synthetic recipient", phone: "0000000000", address: "Test street", ward: "Test ward", province: "Test province" });
});
it("handles missing optional address fields without fabricating an address", async () => {
  m.response.data[0] = { id: "contact-test", code: "TEST-001", name: "Synthetic", phone: null, address: null, ward: null, province: null };
  expect((await getReceiverContacts("Synthetic"))[0]).toMatchObject({ phone: "", address: undefined, ward: undefined, province: undefined });
});
it("escapes literal wildcards and forwards cancellation", async () => {
  const c = new AbortController(); await getReceiverContacts("10%_", c.signal);
  expect(m.calls).toContainEqual(["or", "name.ilike.%10\\%\\_%,code.ilike.%10\\%\\_%,phone.ilike.%10\\%\\_%"]);
  expect(m.calls).toContainEqual(["abortSignal", c.signal]);
});
it("does not issue a request for an empty or aborted search", async () => {
  expect(await getReceiverContacts(" ")).toEqual([]);
  const c = new AbortController(); c.abort();
  await expect(getReceiverContacts("Test", c.signal)).rejects.toThrow();
  expect(m.from).not.toHaveBeenCalled();
});
it("surfaces read errors without trying another source", async () => {
  m.response.error = { message: "Read failed" };
  await expect(getReceiverContacts("Test")).rejects.toThrow("Read failed");
  expect(m.from).toHaveBeenCalledOnce();
});
