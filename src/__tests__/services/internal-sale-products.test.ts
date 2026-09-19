import { beforeEach, describe, expect, it, vi } from "vitest";
import { internalSaleSearchFilter, searchInternalSaleProducts } from "@/lib/services/supabase/internal-sale-products";

const mocks = vi.hoisted(() => ({
  from: vi.fn(), context: vi.fn(),
}));
vi.mock("@/lib/services/supabase/base", () => ({
  getClient: () => ({ from: mocks.from }),
  getCurrentContext: mocks.context,
  handleError: (error: { message: string }) => { throw new Error(error.message); },
}));

function queryResult(data: unknown[] = [], error: unknown = null) {
  const query = {
    select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    or: vi.fn().mockReturnThis(), order: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(), in: vi.fn().mockReturnThis(), abortSignal: vi.fn().mockReturnThis(),
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data, error }).then(resolve),
  };
  mocks.from.mockReturnValue(query);
  return query;
}

describe("internal supply product search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.context.mockResolvedValue({ tenantId: "tenant-a" });
  });

  it("scopes to tenant and active products without using global stock", async () => {
    const query = queryResult([{ id: "box", code: "SKU-SUA-001", vat_rate: null }]);
    const rows = await searchInternalSaleProducts("milk");
    expect(query.eq).toHaveBeenCalledWith("tenant_id", "tenant-a");
    expect(query.eq).toHaveBeenCalledWith("is_active", true);
    expect(query.select.mock.calls[0][0]).not.toContain("stock");
    expect(query.or).toHaveBeenCalledWith("product_type.neq.sku,channel.is.null,channel.neq.fnb");
    expect(rows[0]).toMatchObject({ id: "box", code: "SKU-SUA-001", vat_rate: 0 });
  });

  it("quotes punctuation and escapes wildcard searches", () => {
    expect(internalSaleSearchFilter(' milk, (box) ')).toBe('name.ilike."%milk, (box)%",code.ilike."%milk, (box)%"');
    const filter = internalSaleSearchFilter('50%_"*');
    expect(filter).toContain(JSON.stringify('%50\\%\\_"\\*%'));
  });

  it("does not query blank input or cancelled requests", async () => {
    const controller = new AbortController();
    controller.abort();
    expect(await searchInternalSaleProducts(" ")).toEqual([]);
    expect(await searchInternalSaleProducts("milk", controller.signal)).toEqual([]);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("cancels before starting a query when context finishes late", async () => {
    const controller = new AbortController();
    mocks.context.mockImplementation(async () => {
      controller.abort();
      return { tenantId: "tenant-a" };
    });
    expect(await searchInternalSaleProducts("milk", controller.signal)).toEqual([]);
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("surfaces database failures instead of reporting empty results", async () => {
    queryResult([], { message: "permission denied" });
    await expect(searchInternalSaleProducts("milk")).rejects.toThrow("permission denied");
  });

  it("passes cancellation to the query", async () => {
    const query = queryResult();
    const controller = new AbortController();
    await searchInternalSaleProducts("milk", controller.signal);
    expect(query.abortSignal).toHaveBeenCalledWith(controller.signal);
  });

  it("limits F&B configuration to Retail SKUs without changing generic transfers", async () => {
    const query = queryResult();
    await searchInternalSaleProducts("milk", undefined, true);
    expect(query.eq).toHaveBeenCalledWith("product_type", "sku");
    query.eq.mockClear();
    await searchInternalSaleProducts("milk");
    expect(query.eq).not.toHaveBeenCalledWith("product_type", "sku");
  });

  it("filters to exact approved catalog IDs only when an enabled destination passes them", async () => {
    const query = queryResult();
    await searchInternalSaleProducts("milk", undefined, false, ["box", "carton"]);
    expect(query.in).toHaveBeenCalledWith("id", ["box", "carton"]);

    mocks.from.mockClear();
    expect(await searchInternalSaleProducts("milk", undefined, false, [])).toEqual([]);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
