import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { RetailProductSalesTab } from "@/components/shared/retail-product-sales-tab";
import { getSalesHistory } from "@/lib/services";

vi.mock("@/lib/services", () => ({ getSalesHistory: vi.fn() }));

it("retries the SKU and branch lookup without presenting a failed load as no sales", async () => {
  const fetchHistory = vi.mocked(getSalesHistory);
  const line = {
    id: "line", invoiceCode: "HD009724", date: "2026-11-17T04:42:00Z",
    customerName: "Khách lẻ", quantity: 2, sellPrice: 100000, discount: 0,
    totalAmount: 200000, status: "completed" as const, statusName: "Hoàn thành", createdBy: "—",
  };
  fetchHistory
    .mockRejectedValueOnce(new Error("Unavailable"))
    .mockResolvedValueOnce({ total: 26, data: [line] })
    .mockResolvedValueOnce({ total: 26, data: [{ ...line, id: "older", invoiceCode: "HD001226" }] });

  render(<RetailProductSalesTab productId="sku" branchId="warehouse" />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Không tải được lịch sử bán");
  fireEvent.click(screen.getByRole("button", { name: "Thử lại" }));
  expect(await screen.findByText("HD009724")).toBeInTheDocument();
  expect(fetchHistory).toHaveBeenNthCalledWith(1, "sku", { branchId: "warehouse", page: 0, pageSize: 25 });
  expect(fetchHistory).toHaveBeenNthCalledWith(2, "sku", { branchId: "warehouse", page: 0, pageSize: 25 });

  fireEvent.click(screen.getByRole("button", { name: "Sau" }));
  expect(await screen.findByText("HD001226")).toBeInTheDocument();
  expect(screen.getByText("Trang 2")).toBeInTheDocument();
  expect(fetchHistory).toHaveBeenNthCalledWith(3, "sku", { branchId: "warehouse", page: 1, pageSize: 25 });
});
