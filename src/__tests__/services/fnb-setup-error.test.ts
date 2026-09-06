import { describe, expect, it, vi } from "vitest";
import {
  FnbSetupRequestTimeoutError,
  getFnbSetupErrorMessage,
  withFnbSetupTimeout,
} from "@/lib/fnb-setup-error";

describe("FnB setup request and error handling", () => {
  it("keeps the real Supabase message, details and code", () => {
    expect(getFnbSetupErrorMessage({
      code: "P0001",
      message: "Không thể lưu định lượng",
      details: "Thiếu mức 80%",
    })).toBe("Không thể lưu định lượng Thiếu mức 80% (mã: P0001)");
  });

  it("turns known recipe errors into an actionable message", () => {
    expect(getFnbSetupErrorMessage({
      code: "P0001",
      message: "FNB_EXACT_RECIPE_GROUP_NOT_EFFECTIVE_FOR_PRODUCT",
    })).toContain("Kiểm tra tab Tùy chọn F&B");
  });

  it("does not degrade a plain object error to an unknown error", () => {
    expect(getFnbSetupErrorMessage({ message: "Database unavailable" }))
      .toBe("Database unavailable");
  });

  it("stops a stalled setup request", async () => {
    vi.useFakeTimers();
    try {
      const stalled = withFnbSetupTimeout(
        new Promise<never>(() => undefined),
        25,
        "Tải công thức quá lâu.",
      );
      const assertion = expect(stalled).rejects.toEqual(
        expect.objectContaining({
          name: "FnbSetupRequestTimeoutError",
          message: "Tải công thức quá lâu.",
        }),
      );
      await vi.advanceTimersByTimeAsync(25);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("preserves a request result before the timeout", async () => {
    await expect(withFnbSetupTimeout(Promise.resolve("ok"), 25)).resolves.toBe("ok");
    expect(new FnbSetupRequestTimeoutError()).toBeInstanceOf(Error);
  });
});
