import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { RetailProductSalesTab } from "@/components/shared/retail-product-sales-tab";
import { getSalesHistory } from "@/lib/services";

vi.mock("@/lib/services", () => ({ getSalesHistory: vi.fn() }));

it("retries the SKU and branch lookup without presenting a failed load as no sales", async () => {
  const fetchHistory = vi.mocked(getSalesHistory);
  fetchHistory.mockRejectedValueOnce(new Error("Unavailable")).mockResolvedValueOnce({
    total: 1,
    data: [{
      id: "line", invoiceCode: "HD009724", date: "2026-11-17T04:42:00Z",
      customerName: "Khách lẻ", quantity: 2, sellPrice: 100000, discount: 0,
      totalAmount: 200000, status: "completed", statusName: "Hoàn thành", createdBy: "—",
    }],
  });

  render(<RetailProductSalesTab productId="sku" branchId="warehouse" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Không tải được lịch sử bán");
  fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
  expect(await screen.findByText("HD009724")).toBeInTheDocument();
  expect(fetchHistory).toHaveBeenNthCalledWith(2, "sku", { branchId: "warehouse", page: 1, pageSize: 25 });
});
