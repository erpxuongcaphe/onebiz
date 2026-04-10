import { describe, it, expect } from "vitest";
import { getPaginationRange, isAscending, handleError, getFilterValue } from "@/lib/services/supabase/base";
import type { QueryParams } from "@/lib/types";

describe("getPaginationRange", () => {
  it("returns correct range for first page", () => {
    const params = { page: 0, pageSize: 15 } as QueryParams;
    expect(getPaginationRange(params)).toEqual({ from: 0, to: 14 });
  });

  it("returns correct range for second page", () => {
    const params = { page: 1, pageSize: 15 } as QueryParams;
    expect(getPaginationRange(params)).toEqual({ from: 15, to: 29 });
  });

  it("handles page size of 1", () => {
    const params = { page: 3, pageSize: 1 } as QueryParams;
    expect(getPaginationRange(params)).toEqual({ from: 3, to: 3 });
  });

  it("handles large page size", () => {
    const params = { page: 0, pageSize: 100 } as QueryParams;
    expect(getPaginationRange(params)).toEqual({ from: 0, to: 99 });
  });
});

describe("isAscending", () => {
  it('returns true when sortOrder is "asc"', () => {
    expect(isAscending({ sortOrder: "asc" } as QueryParams)).toBe(true);
  });

  it('returns false when sortOrder is "desc"', () => {
    expect(isAscending({ sortOrder: "desc" } as QueryParams)).toBe(false);
  });

  it("returns false when sortOrder is undefined", () => {
    expect(isAscending({} as QueryParams)).toBe(false);
  });
});

describe("handleError", () => {
  it("throws error with context and message", () => {
    expect(() => handleError({ message: "not found", code: "PGRST116" }, "getSupplier")).toThrow(
      "[getSupplier] not found (code: PGRST116)"
    );
  });

  it("handles missing error code", () => {
    expect(() => handleError({ message: "fail" }, "test")).toThrow(
      "[test] fail (code: unknown)"
    );
  });
});

describe("getFilterValue", () => {
  it("returns undefined when filters is undefined", () => {
    expect(getFilterValue(undefined, "status")).toBeUndefined();
  });

  it("returns undefined when key does not exist", () => {
    expect(getFilterValue({ other: "x" }, "status")).toBeUndefined();
  });

  it("returns string value directly", () => {
    expect(getFilterValue({ status: "active" }, "status")).toBe("active");
  });

  it("returns first element when value is array", () => {
    expect(getFilterValue({ status: ["active", "inactive"] }, "status")).toBe("active");
  });

  it("returns undefined for empty string", () => {
    expect(getFilterValue({ status: "" }, "status")).toBeUndefined();
  });

  it("returns undefined for empty array", () => {
    expect(getFilterValue({ status: [] }, "status")).toBeUndefined();
  });
});
