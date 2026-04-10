import { describe, it, expect, vi, beforeEach } from "vitest";

const mockResult = vi.fn();

function createChain() {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = vi.fn(self);
  chain.insert = vi.fn(self);
  chain.update = vi.fn(self);
  chain.delete = vi.fn(self);
  chain.eq = vi.fn(self);
  chain.single = mockResult;
  chain.maybeSingle = mockResult;
  return chain;
}

const mockChain = createChain();
const mockFrom = vi.fn(() => mockChain);

vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ from: mockFrom }),
  getPaginationRange: (p: { page: number; pageSize: number }) => ({
    from: p.page * p.pageSize,
    to: p.page * p.pageSize + p.pageSize - 1,
  }),
  handleError: (error: { message: string }, ctx: string) => {
    throw new Error(`[${ctx}] ${error.message}`);
  },
}));

import {
  createCustomer,
  updateCustomer,
  deleteCustomer,
  getCustomerGroups,
} from "@/lib/services/supabase/customers";

describe("createCustomer", () => {
  beforeEach(() => vi.clearAllMocks());

  it("inserts a customer and returns mapped data", async () => {
    mockResult.mockResolvedValueOnce({
      data: { id: "c-1", code: "KH001", name: "KH Test", phone: "0909876543" },
      error: null,
    });

    const result = await createCustomer({ name: "KH Test", phone: "0909876543", code: "KH001" });

    expect(mockFrom).toHaveBeenCalledWith("customers");
    expect(mockChain.insert).toHaveBeenCalled();
    expect(result.id).toBe("c-1");
    expect(result.name).toBe("KH Test");
  });

  it("throws on insert error", async () => {
    mockResult.mockResolvedValueOnce({
      data: null,
      error: { message: "duplicate key" },
    });

    await expect(createCustomer({ name: "Dup", code: "X" })).rejects.toThrow("duplicate key");
  });
});

describe("updateCustomer", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates and returns mapped customer", async () => {
    mockResult.mockResolvedValueOnce({
      data: { id: "c-1", code: "KH001", name: "Updated KH", customer_groups: null },
      error: null,
    });

    const result = await updateCustomer("c-1", { name: "Updated KH" });

    expect(mockFrom).toHaveBeenCalledWith("customers");
    expect(mockChain.update).toHaveBeenCalledWith(expect.objectContaining({ name: "Updated KH" }));
    expect(result.name).toBe("Updated KH");
  });
});

describe("deleteCustomer", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes a customer by id", async () => {
    (mockChain.eq as ReturnType<typeof vi.fn>).mockReturnValueOnce({ error: null });

    await deleteCustomer("c-1");

    expect(mockFrom).toHaveBeenCalledWith("customers");
    expect(mockChain.delete).toHaveBeenCalled();
    expect(mockChain.eq).toHaveBeenCalledWith("id", "c-1");
  });
});

describe("getCustomerGroups", () => {
  it("returns an array (sync fallback)", () => {
    const result = getCustomerGroups();
    expect(Array.isArray(result)).toBe(true);
  });
});
