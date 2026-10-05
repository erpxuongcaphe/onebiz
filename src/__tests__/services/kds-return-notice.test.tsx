import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { KdsReturnNotice } from "@/app/pos/fnb/kds/kds-return-notice";

afterEach(cleanup);
describe("KDS partial return notice", () => {
  it("keeps the original kitchen quantities explicit instead of guessing returned rows", () => {
    render(<KdsReturnNotice summary={{ soldQuantity: 3, returnedQuantity: 1 }} />);
    expect(screen.getByRole("status").textContent).toContain("Đã trả 1/3 phần");
    expect(screen.getByRole("status").textContent).toContain("lúc gọi món");
    expect(screen.getByRole("status").textContent).toContain("thu ngân");
  });
  it("does not turn failed reads into a no-return result", () => {
    render(<KdsReturnNotice summary={null} />);
    expect(screen.getByRole("status").textContent).toContain("Chưa kiểm tra được hoàn trả");
  });
  it("distinguishes exact source updates from legacy or topping-only returns", () => {
    const { rerender } = render(<KdsReturnNotice summary={{ soldQuantity: 3, returnedQuantity: 1 }} exactReturnedQuantity={1} />);
    expect(screen.getByRole("status").textContent).toContain("đúng dòng món");
    rerender(<KdsReturnNotice summary={{ soldQuantity: 3, returnedQuantity: 2 }} exactReturnedQuantity={1} />);
    expect(screen.getByRole("status").textContent).toContain("Phần trả còn lại");
  });
  it("does not clutter orders with no returns", () => {
    render(<KdsReturnNotice summary={{ soldQuantity: 2, returnedQuantity: 0 }} />);
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("supports fractional quantities and full return notices", () => {
    render(<KdsReturnNotice summary={{ soldQuantity: 1.5, returnedQuantity: 1.5 }} />);
    expect(screen.getByRole("status").textContent).toContain("1.5/1.5");
  });
});
