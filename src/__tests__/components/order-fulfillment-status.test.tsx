import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  FulfilledOrderStatus,
  getOrderInvoiceCodes,
} from "@/app/(main)/don-hang/dat-hang/order-fulfillment-status";

describe("FulfilledOrderStatus", () => {
  it("links the completed order to its child invoice without opening the row", () => {
    const onRowClick = vi.fn();
    render(
      <div onClick={onRowClick}>
        <FulfilledOrderStatus invoiceCode="HD001551" />
      </div>,
    );

    const link = screen.getByRole("link", { name: "Mở hóa đơn HD001551" });
    expect(link).toHaveAttribute("href", "/don-hang/hoa-don?tim=HD001551&mo=1");

    // jsdom cannot navigate a document. Prevent only its default browser action
    // while preserving the bubbling behavior that the row needs to avoid.
    window.addEventListener("click", (event) => event.preventDefault(), {
      capture: true,
      once: true,
    });
    fireEvent.click(link);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  it("still renders the invoice state when no child invoice code is available", () => {
    render(<FulfilledOrderStatus />);

    expect(screen.getByText("Đã có hóa đơn số")).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("unifies child, anchored and legacy in-place invoice codes", () => {
    expect(
      getOrderInvoiceCodes({
        completedChildCodes: ["HD001601", "HD001602"],
        fulfilledInvoiceCode: "HD001601",
        invoiceCode: "HD001599",
      }),
    ).toEqual(["HD001601", "HD001602", "HD001599"]);
  });
});
